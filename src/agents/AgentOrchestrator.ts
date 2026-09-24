// AgentOrchestrator — staged multi-agent pipeline with stop conditions.
// Decides which agents run based on market/analysis state (never one giant prompt):
//   specialists (deterministic) → trap/contrarian → AI analyst → critic →
//   risk → quality gate → final. Cheap deterministic stages always run;
// expensive AI stages are skipped when deterministic stop conditions hit.
// Max AI calls per market is configurable (default 2: analyst + critic).
import type {
  AgentRun, AIAnalysis, AICritique, AIProvider, AnalysisMemoryEntry, AssetCategory,
  ConfluenceResult, DerivativesAnalysis, Direction, FinalDecision, HyperliquidContext,
  HyperliquidMarket, MarketIdentity, MarketRegime, RiskAnalysis, ScreenResult, ScreenStatus,
  SetupEvaluation, TimeframeAnalysis, ToolCallEntry, TradingSignal, TrapRisk,
} from '../types';
import {
  ALL_SPECIALISTS, SignalCriticAgent, enrichSpecialist,
  type SpecialistInput, type SpecialistOutput,
} from './specialists';
import { decideFinalSignal, detectContradictions, type FinalSignal } from './finalDecision';
import { createPipelineTools, runAgenticAnalyst, runAgenticCritic } from './agenticLoop';
import { APP_CONFIG } from '../config/app';
import { computeRisk } from '../core/risk';
import { setupQuality } from '../core/quality';
import { detectTraps, type TrapReport } from '../core/traps';
import { evaluateLongSetup, evaluateShortSetup } from '../core/setups';
import { LocalFallbackProvider } from '../providers/ai/providers';

export interface PipelineInput {
  identity: MarketIdentity | null;
  symbol: string;
  category: AssetCategory;
  market: HyperliquidMarket | null;
  executionTimeframe: string;
  price: number;
  change24h: number | null;
  oiRising: boolean | null;
  regime: MarketRegime;
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  assetInsights: string[];
  demo: boolean;
  stale: boolean;
  provider: AIProvider | null;
  riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
  memory?: AnalysisMemoryEntry[];
  maxAiCalls?: number;
  /** Skip AI entirely (fast path / cost control) */
  aiEnabled?: boolean;
}

export interface PipelineOutput {
  direction: Direction;
  finalDecision: FinalDecision;
  /** Explicit FinalDecisionAgent output (votes, validated numbers, consensus) */
  final: FinalSignal;
  status: ScreenStatus;
  statusReason: string;
  longSetup: SetupEvaluation;
  shortSetup: SetupEvaluation;
  trap: TrapReport;
  scores: import('../types').ComponentScores | null;
  quality: number | null;
  ai: AIAnalysis | null;
  critique: AICritique | null;
  risk: RiskAnalysis | null;
  aiAvailable: boolean;
  aiCallsUsed: number;
  ledger: AgentRun[];
  /** Named specialist outputs (deterministic layer) */
  specialists: SpecialistOutput[];
  /** Real tool invocations traced during this run */
  toolLog: ToolCallEntry[];
  memoryDelta: string[];
  why: string[];
  against: string[];
}

function stage(ledger: AgentRun[], agent: AgentRun['agent'], status: AgentRun['status'], summary: string, started: number): void {
  ledger.push({ agent, status, summary, durationMs: Date.now() - started, at: Date.now() });
}

/** Signal quality gate (§45). CONFIRMED requires everything; otherwise CONDITIONAL/WAIT. */
export function qualityGate(candidate: {
  demo: boolean;
  stale: boolean;
  direction: Direction;
  confluence: number;
  riskReward: number | null | undefined;
  riskValid: boolean;
  criticApproval: 'APPROVE' | 'CONDITIONAL' | 'REJECT' | null;
  trapRisk: TrapRisk | null;
}, opts?: { minRiskReward?: number }): { status: ScreenStatus; reasons: string[] } {
  const minRR = opts?.minRiskReward ?? APP_CONFIG.minRiskReward;
  const reasons: string[] = [];
  if (candidate.demo) return { status: 'INVALIDATED', reasons: ['demo data — LIVE ANALYSIS UNAVAILABLE'] };
  if (candidate.stale) reasons.push('stale data — cannot CONFIRM');
  if (candidate.direction === 'WAIT') reasons.push('no deterministic setup');
  if (candidate.confluence < 55) reasons.push(`confluence ${candidate.confluence}/100 below 55`);
  if (candidate.riskReward == null || candidate.riskReward < minRR) {
    reasons.push(candidate.riskReward == null ? 'risk/reward uncomputable' : `R:R ${candidate.riskReward.toFixed(2)} below ${minRR}`);
  }
  if (!candidate.riskValid) reasons.push('risk validation failed');
  if (candidate.criticApproval === 'REJECT') reasons.push('AI critic REJECTED the setup');
  if (candidate.criticApproval === 'CONDITIONAL') reasons.push('AI critic CONDITIONAL — only with stated conditions');
  if (candidate.trapRisk === 'HIGH') reasons.push('trap risk HIGH');
  if (reasons.length === 0) return { status: 'CONFIRMED', reasons: ['all gate requirements satisfied'] };
  // CONDITIONAL when the only soft issue is critic caution or staleness with an otherwise valid setup
  const hard = reasons.filter((r) => !r.startsWith('stale data') && r !== 'AI critic caution');
  if (candidate.direction !== 'WAIT' && candidate.criticApproval !== 'REJECT' && hard.length === 0) {
    return { status: 'CONDITIONAL', reasons };
  }
  if (candidate.criticApproval === 'CONDITIONAL' && candidate.direction !== 'WAIT' && candidate.riskValid) {
    return { status: 'CONDITIONAL', reasons };
  }
  return { status: candidate.direction === 'WAIT' ? 'WATCHING' : 'REJECTED', reasons };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const ledger: AgentRun[] = [];
  const toolLog: ToolCallEntry[] = [];
  const trace = (agent: SpecialistOutput['agent'], tool: string, inputSummary: string, ms: number, ok: boolean): void => {
    toolLog.push({ agent, tool, input: inputSummary, ms, ok, at: Date.now(), origin: 'deterministic', cached: false });
  };
  const maxAiCalls = input.maxAiCalls ?? 2;
  const aiOn = (input.aiEnabled ?? true) && maxAiCalls > 0;
  let aiCallsUsed = 0;
  let t = Date.now();

  // Named deterministic specialists (real systems, traced tool use).
  const specInput: SpecialistInput = {
    symbol: input.symbol, category: input.category, market: input.market ?? null,
    price: input.price, change24h: input.change24h, oiRising: input.oiRising,
    regime: input.regime, timeframes: input.timeframes, confluence: input.confluence,
    signal: input.signal, derivatives: input.derivatives, hyperliquid: input.hyperliquid,
    demo: input.demo, stale: input.stale, riskOpts: input.riskOpts,
  };
  const specialists: SpecialistOutput[] = [];
  for (const agent of [...ALL_SPECIALISTS, SignalCriticAgent]) {
    const started = Date.now();
    const raw = agent.run(specInput, (tool, summary, ms, ok) => trace(agent.name, tool, summary, ms, ok));
    const output = enrichSpecialist(
      raw, specInput,
      toolLog.filter((e) => e.agent === agent.name).map((e) => e.tool),
    );
    specialists.push(output);
    stage(ledger, agent.name, output.ok ? 'ok' : 'failed', output.summary, started);
  }

  // Canonical outputs reused downstream (same core functions, no duplication).
  const longSetup = evaluateLongSetup(input.timeframes, input.derivatives);
  const shortSetup = evaluateShortSetup(input.timeframes, input.derivatives);
  const trap = detectTraps({
    signal: input.signal, timeframes: input.timeframes,
    derivatives: input.derivatives, change24h: input.change24h, oiRising: input.oiRising,
  });

  // Stop condition: nothing directional + weak confluence → skip expensive AI.
  const stopEarly = input.signal.direction === 'WAIT' && input.confluence.total < 40 && !longSetup.candidate && !shortSetup.candidate;

  // Contradiction review input (deterministic): routed to critic + final gate.
  const execTrend = input.timeframes[input.timeframes.length - 1]?.structure.trend ?? 'NEUTRAL';
  const contradictions = detectContradictions({
    longCandidate: longSetup.candidate, shortCandidate: shortSetup.candidate,
    structureTrend: execTrend, fundingRate: input.derivatives.fundingRate,
    trapRisk: trap.risk, direction: input.signal.direction,
  });
  if (contradictions.length) {
    stage(ledger, 'contrarian', 'ok', `contradiction review: ${contradictions.join('; ')}`, t); t = Date.now();
  }

  let ai: AIAnalysis | null = null;
  let critique: AICritique | null = null;
  let aiAvailable = true;
  const pushAiTrace = (entry: { agent: string; tool: string; input: string; ms: number; ok: boolean; origin: 'ai' }): void => {
    toolLog.push({ ...entry, at: Date.now(), cached: false });
  };
  const toolInput = {
    market: input.market ?? null, marketId: input.identity?.marketId ?? input.symbol,
    symbol: input.symbol, timeframes: input.timeframes, confluence: input.confluence,
    signal: input.signal, derivatives: input.derivatives, memory: input.memory ?? [],
    riskOpts: input.riskOpts,
  };
  if (input.demo) {
    stage(ledger, 'critic', 'skipped', 'demo data — AI review withheld', t); t = Date.now();
  } else if (stopEarly || !aiOn) {
    stage(ledger, 'critic', 'skipped', stopEarly ? 'no setup + confluence < 40 — AI skipped (cost control)' : 'AI disabled for this run', t); t = Date.now();
  } else {
    const active: AIProvider = input.provider ?? new LocalFallbackProvider();
    const ctx = {
      symbol: input.symbol, category: input.category, identity: input.identity,
      price: input.price, executionTimeframe: input.executionTimeframe, regime: input.regime,
      timeframes: input.timeframes, confluence: input.confluence, signal: input.signal,
      derivatives: input.derivatives, hyperliquid: input.hyperliquid,
      assetInsights: input.assetInsights, risk: null,
    };
    const liveAgentic = active.name !== 'local-fallback' && active.decide != null;
    const brief = (): string =>
      `Market ${input.symbol} (${input.category} ${input.identity?.dexLabel ?? ''} perp). ` +
      `Deterministic: ${input.signal.direction} conf ${input.confluence.total}/100 regime ${input.regime}. ` +
      `LONG ${longSetup.candidate ? 'candidate' : `blocked: ${longSetup.missing.slice(0, 2).join('; ')}`} · ` +
      `SHORT ${shortSetup.candidate ? 'candidate' : `blocked: ${shortSetup.missing.slice(0, 2).join('; ')}`} · ` +
      `trap ${trap.risk}. ` +
      (contradictions.length ? `Contradictions: ${contradictions.join('; ')}. ` : '') +
      `Ask for any missing verified value via tools; never invent.`;
    try {
      if (liveAgentic) {
        // Genuine AI tool selection: the model pulls verified tools, then concludes.
        t = Date.now();
        const analystRun = await runAgenticAnalyst({
          provider: active, toolInput, brief,
          budget: { maxIterations: 4, maxToolCalls: 4 },
          onTrace: pushAiTrace,
        });
        aiCallsUsed += analystRun.llmCalls;
        ai = analystRun.analysis;
        stage(ledger, 'analyst', ai ? 'ok' : 'failed',
          ai ? `agentic analyst: ${ai.decision} (${ai.confidence}/100 via ${ai.provider})` : `agentic analyst stopped: ${analystRun.stopReason}`, t);
        t = Date.now();
        if (ai) {
          const riskPreview = computeRisk(input.signal, input.riskOpts);
          const thesis = (): string =>
            `Thesis ${ai?.decision} ${ai?.direction} (${ai?.confidence}/100). ${ai?.explanation ?? ''} ` +
            `Supporting: ${ai?.supportingFactors.join('; ') ?? ''} Opposing: ${ai?.opposingFactors.join('; ') ?? ''} ` +
            (contradictions.length ? `Material contradictions: ${contradictions.join('; ')} — investigate before approving.` : '');
          const criticRun = await runAgenticCritic({
            provider: active, toolInput, thesis,
            budget: { maxIterations: 4, maxToolCalls: 4 },
            onTrace: pushAiTrace,
          });
          aiCallsUsed += criticRun.llmCalls;
          critique = criticRun.critique;
          stage(ledger, 'critic', critique ? 'ok' : 'failed',
            critique ? `agentic critic ${critique.approval} (verdict ${critique.verdict})` : `agentic critic stopped: ${criticRun.stopReason}`, t);
        }
        if (!ai || !critique) throw new Error('agentic review incomplete');
      } else {
        t = Date.now();
        ai = await active.analyze(ctx);
        aiCallsUsed += 1;
        stage(ledger, 'analyst', 'ok', `AI analyst: ${ai.decision} (${ai.confidence}/100 via ${ai.provider})`, t);
        t = Date.now();
        const riskPreview = computeRisk(input.signal, input.riskOpts);
        const analystSummary = contradictions.length
          ? `${ai.explanation}\nMaterial contradictions under review: ${contradictions.join('; ')} — investigate before approving.`
          : ai.explanation;
        critique = await active.critique({ ...ctx, risk: riskPreview, analystSummary });
        aiCallsUsed += 1;
        stage(ledger, 'critic', 'ok', `critic ${critique.approval} (verdict ${critique.verdict})`, t);
      }
    } catch {
      aiAvailable = active.name !== 'local-fallback';
      try {
        const fb = new LocalFallbackProvider();
        t = Date.now();
        ai = await fb.analyze(ctx);
        aiCallsUsed += 1;
        stage(ledger, 'analyst', 'ok', `AI analyst fallback: ${ai.decision}`, t);
        t = Date.now();
        critique = await fb.critique({ ...ctx, risk: null, analystSummary: ai.explanation });
        aiCallsUsed += 1;
        stage(ledger, 'critic', 'ok', `fallback critic ${critique.approval}`, t);
      } catch {
        ai = null; critique = null;
        stage(ledger, 'critic', 'failed', 'AI unavailable and fallback failed', t);
      }
    }
    t = Date.now();
  }

  // Risk agent (deterministic math; AI never rewrites numbers)
  const risk = computeRisk(input.signal, input.riskOpts);
  stage(ledger, 'risk', risk ? 'ok' : 'skipped',
    risk ? `R:R ${risk.riskReward.toFixed(2)}${risk.valid ? '' : ' — INVALID'}` : 'no trade — risk uncomputable', t); t = Date.now();

  // Setup quality (transparent)
  const { quality, scores } = setupQuality({
    direction: input.signal.direction, timeframes: input.timeframes,
    confluence: input.confluence, derivatives: input.derivatives, risk,
  });

  // Quality gate → status
  const gate = qualityGate({
    demo: input.demo,
    stale: input.stale,
    direction: input.signal.direction,
    confluence: input.confluence.total,
    riskReward: risk?.riskReward,
    riskValid: risk?.valid ?? false,
    criticApproval: critique?.approval ?? null,
    trapRisk: trap.risk,
  });
  let status = gate.status;

  // FinalDecisionAgent: votes + gates + validated numbers → LONG | SHORT | WAIT.
  const final = decideFinalSignal({
    symbol: input.symbol, category: input.category, regime: input.regime,
    timeframes: input.timeframes, confluence: input.confluence, signal: input.signal,
    derivatives: input.derivatives, hyperliquid: input.hyperliquid,
    longCandidate: longSetup.candidate, longDetail: longSetup.missing.join('; ') || 'checklist satisfied',
    shortCandidate: shortSetup.candidate, shortDetail: shortSetup.missing.join('; ') || 'checklist satisfied',
    contrarian: trap.contrarian, trapRisk: trap.risk, trapFlags: trap.flags,
    ai, critique, risk, demo: input.demo, stale: input.stale,
    gateStatus: gate.status, gateReasons: gate.reasons,
    contradictions,
  });
  let finalDecision: FinalDecision = final.decision;
  if ((status === 'CONFIRMED' || status === 'CONDITIONAL') && finalDecision !== 'LONG' && finalDecision !== 'SHORT') {
    status = 'WATCHING';
  }
  if (status === 'REJECTED') finalDecision = 'WAIT';
  stage(ledger, 'final', 'ok',
    `${finalDecision} / ${status} — consensus L${final.consensus.longVotes}/S${final.consensus.shortVotes}/W${final.consensus.waitVotes}; ${gate.reasons.join('; ') || 'gate passed'}`, t);

  // Memory delta: what changed vs the previous structured summary
  const memoryDelta: string[] = [];
  const prev = input.memory?.[input.memory.length - 1];
  if (prev) {
    if (prev.direction !== input.signal.direction) memoryDelta.push(`direction ${prev.direction} → ${input.signal.direction}`);
    if (prev.regime !== input.regime) memoryDelta.push(`regime ${prev.regime} → ${input.regime}`);
    const dc = input.confluence.total - prev.confluence;
    if (Math.abs(dc) >= 10) memoryDelta.push(`confluence ${prev.confluence} → ${input.confluence.total}`);
  }

  const why = [...input.signal.supportingReasons];
  if (longSetup.candidate && input.signal.direction === 'LONG') why.push('LONG specialist checklist satisfied');
  if (shortSetup.candidate && input.signal.direction === 'SHORT') why.push('SHORT specialist checklist satisfied');
  const against = [...input.signal.opposingReasons, ...trap.flags];

  return {
    direction: input.signal.direction, finalDecision, final, status,
    statusReason: gate.reasons.join('; ') || 'gate passed',
    longSetup, shortSetup, trap, scores, quality,
    ai, critique, risk, aiAvailable, aiCallsUsed, ledger, specialists, toolLog, memoryDelta, why, against,
  };
}
