// Agentic tool-calling framework: AI decides WHICH verified tools it needs.
// Deterministic code owns data + validation; the LLM only reasons and selects.
// Hard limits everywhere: iterations, tool calls, per-tool + overall timeouts,
// evidence size. No live LLM → callers must use the deterministic planner instead.
import type {
  AgentStepDecision, AgentToolRequest, AIProvider, ToolResultEnvelope,
} from '../types';
import { TIMEFRAMES } from '../config/app';
import { computeRisk } from '../core/risk';

export interface AgentToolDef {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Agent-specific tool permissions (§4). Nobody gets every tool. */
export const AGENT_TOOLS: Record<string, string[]> = {
  LongSetupAgent: ['getMarket', 'getCandles', 'getMultiTimeframeData', 'getMarketStructure', 'getSMC', 'getICT', 'getLiquidity', 'getDerivatives', 'calculateRisk'],
  ShortSetupAgent: ['getMarket', 'getCandles', 'getMultiTimeframeData', 'getMarketStructure', 'getSMC', 'getICT', 'getLiquidity', 'getDerivatives', 'calculateRisk'],
  TrapDetectionAgent: ['getMarket', 'getLiquidity', 'getDerivatives', 'getMarketStructure', 'getMultiTimeframeData', 'getPreviousAnalysis'],
  ContrarianAgent: ['getMarket', 'getMultiTimeframeData', 'getMarketStructure', 'getDerivatives', 'getLiquidity', 'getPreviousAnalysis'],
  RiskAgent: ['getMarket', 'calculateRisk', 'validateSignal'],
  FinalDecisionAgent: ['getPreviousAnalysis', 'getSignal', 'validateSignal'],
  AIAnalyst: ['getMarket', 'getMultiTimeframeData', 'getMarketStructure', 'getSMC', 'getICT', 'getLiquidity', 'getDerivatives', 'getConfluence', 'getSignal', 'getPreviousAnalysis', 'calculateRisk'],
  AICritic: ['getMarket', 'getMultiTimeframeData', 'getMarketStructure', 'getDerivatives', 'getLiquidity', 'getConfluence', 'getSignal', 'getPreviousAnalysis', 'calculateRisk'],
};

const VALID_TIMEFRAMES = new Set(TIMEFRAMES.map((t) => t.id));

/** Validate a structured agent decision (unknown shapes are rejected, never executed). */
export function validateAgentDecision(raw: unknown): AgentStepDecision | null {
  if (typeof raw !== 'object' || raw == null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'stop') {
    return { type: 'stop', reason: typeof r.reason === 'string' ? r.reason.slice(0, 500) : 'stopped' };
  }
  if (r.type === 'final') {
    if (typeof r.result !== 'object' || r.result == null) return null;
    return { type: 'final', result: r.result };
  }
  if (r.type === 'tool_call') {
    if (typeof r.tool !== 'string' || typeof r.arguments !== 'object' || r.arguments == null) return null;
    return { type: 'tool_call', tool: r.tool, arguments: r.arguments as Record<string, unknown> };
  }
  return null;
}

export interface ToolValidation {
  ok: boolean;
  error?: string;
  args?: Record<string, unknown>;
}

/**
 * Validate a tool request: registered tool, agent permission, argument sanity.
 * marketId/timeframe/limits are checked; unknown tools and bad args are rejected.
 */
export function validateToolCall(
  registry: AgentToolDef[],
  allowed: string[],
  name: string,
  args: Record<string, unknown>,
): ToolValidation {
  const tool = registry.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  if (!allowed.includes(name)) return { ok: false, error: `tool ${name} not permitted for this agent` };
  const out: Record<string, unknown> = { ...args };
  for (const key of ['id', 'marketId']) {
    const v = out[key];
    if (v !== undefined) {
      if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `invalid ${key}: must be a non-empty market identifier` };
      out[key] = v.trim();
    }
  }
  if (out.timeframe !== undefined) {
    if (typeof out.timeframe !== 'string' || !VALID_TIMEFRAMES.has(out.timeframe)) {
      return { ok: false, error: `invalid timeframe: ${String(out.timeframe)} (expected one of ${[...VALID_TIMEFRAMES].join('/')})` };
    }
  }
  if (out.limit !== undefined) {
    const n = Number(out.limit);
    if (!Number.isFinite(n)) return { ok: false, error: 'invalid limit: must be a number' };
    out.limit = Math.max(1, Math.min(500, Math.floor(n)));
  }
  if (out.ids !== undefined && !Array.isArray(out.ids)) {
    return { ok: false, error: 'invalid ids: must be an array' };
  }
  return { ok: true, args: out };
}

export interface AgentLoopBudget {
  maxIterations: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
  overallTimeoutMs: number;
  /** evidence handed to the model is truncated beyond this */
  maxEvidenceChars: number;
}

export const DEFAULT_LOOP_BUDGET: AgentLoopBudget = {
  maxIterations: 6,
  maxToolCalls: 5,
  toolTimeoutMs: 15000,
  overallTimeoutMs: 90000,
  maxEvidenceChars: 12000,
};

export interface AgentLoopTrace {
  iteration: number;
  requested: AgentToolRequest | null;
  result: ToolResultEnvelope | null;
  rejected?: string;
}

export interface AgentLoopResult {
  /** validated final payload, or null when the loop stopped without one */
  final: unknown;
  stopReason: string;
  trace: AgentLoopTrace[];
  toolCallsUsed: number;
  llmCallsUsed: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function envelope(tool: string, started: number, ok: boolean, data?: unknown, error?: string): ToolResultEnvelope {
  return { tool, success: ok, data, error, timestamp: Date.now(), freshnessMs: Date.now() - started };
}

/**
 * Generic agentic loop. The provider decides; this executor validates, runs,
 * envelopes, and enforces every limit. Returns the validated final payload or
 * an explicit stop — never a fabricated answer.
 */
export async function runAgenticLoop(params: {
  provider: AIProvider;
  agentName: keyof typeof AGENT_TOOLS;
  system: string;
  evidence: () => string;
  registry: AgentToolDef[];
  onTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  validateFinal: (raw: unknown) => unknown | null;
  budget?: Partial<AgentLoopBudget>;
  onTrace?: (entry: { agent: string; tool: string; input: string; ms: number; ok: boolean; origin: 'ai' }) => void;
}): Promise<AgentLoopResult> {
  const budget: AgentLoopBudget = { ...DEFAULT_LOOP_BUDGET, ...params.budget };
  const allowed = AGENT_TOOLS[params.agentName] ?? [];
  const trace: AgentLoopTrace[] = [];
  let toolCallsUsed = 0;
  let llmCallsUsed = 0;
  const deadline = Date.now() + budget.overallTimeoutMs;

  if (!params.provider.decide) {
    return { final: null, stopReason: 'provider has no live agentic decisions — deterministic planner only', trace, toolCallsUsed, llmCallsUsed };
  }

  for (let i = 0; i < budget.maxIterations; i++) {
    if (Date.now() > deadline) {
      return { final: null, stopReason: 'overall timeout — stopping', trace, toolCallsUsed, llmCallsUsed };
    }
    if (toolCallsUsed >= budget.maxToolCalls) {
      return { final: null, stopReason: `max tool calls (${budget.maxToolCalls}) reached — stopping`, trace, toolCallsUsed, llmCallsUsed };
    }
    const evidence = params.evidence().slice(0, budget.maxEvidenceChars);
    let decision: import('../types').AgentStepDecision;
    try {
      llmCallsUsed += 1;
      decision = await withTimeout(params.provider.decide(params.system, evidence), budget.toolTimeoutMs, 'agent decision');
    } catch (e) {
      return { final: null, stopReason: `decision failed (${e instanceof Error ? e.message : 'error'}) — stopping`, trace, toolCallsUsed, llmCallsUsed };
    }
    if (decision.type === 'stop') {
      return { final: null, stopReason: `agent stopped: ${decision.reason}`, trace, toolCallsUsed, llmCallsUsed };
    }
    if (decision.type === 'final') {
      const valid = params.validateFinal(decision.result);
      if (valid == null) {
        return { final: null, stopReason: 'final payload failed schema validation — rejected, not fabricated', trace, toolCallsUsed, llmCallsUsed };
      }
      return { final: valid, stopReason: 'sufficient evidence — final accepted', trace, toolCallsUsed, llmCallsUsed };
    }
    // tool_call → validate → execute → envelope → back to the model
    const check = validateToolCall(params.registry, allowed, decision.tool, decision.arguments);
    if (!check.ok) {
      trace.push({ iteration: i, requested: decision, result: null, rejected: check.error });
      // Rejection itself is evidence: one more iteration lets the model correct itself.
      continue;
    }
    const started = Date.now();
    try {
      toolCallsUsed += 1;
      const data = await withTimeout(params.onTool(decision.tool, check.args ?? {}), budget.toolTimeoutMs, `tool ${decision.tool}`);
      const env = envelope(decision.tool, started, true, data);
      trace.push({ iteration: i, requested: decision, result: env });
      params.onTrace?.({ agent: params.agentName, tool: decision.tool, input: JSON.stringify(check.args ?? {}).slice(0, 200), ms: env.freshnessMs, ok: true, origin: 'ai' });
    } catch (e) {
      const env = envelope(decision.tool, started, false, undefined, e instanceof Error ? e.message : 'tool failed');
      trace.push({ iteration: i, requested: decision, result: env });
      params.onTrace?.({ agent: params.agentName, tool: decision.tool, input: JSON.stringify(check.args ?? {}).slice(0, 200), ms: env.freshnessMs, ok: false, origin: 'ai' });
    }
  }
  return { final: null, stopReason: `max iterations (${budget.maxIterations}) reached — stopping`, trace, toolCallsUsed, llmCallsUsed };
}

// ---- Pipeline-verified tool implementations (no import cycles: core + types only) ----

export interface PipelineToolInput {
  market: import('../types').HyperliquidMarket | null;
  marketId: string;
  symbol: string;
  timeframes: import('../types').TimeframeAnalysis[];
  confluence: import('../types').ConfluenceResult;
  signal: import('../types').TradingSignal;
  derivatives: import('../types').DerivativesAnalysis;
  memory: import('../types').AnalysisMemoryEntry[];
  riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
}

const pickTf = (input: PipelineToolInput, tf: string): import('../types').TimeframeAnalysis | undefined =>
  input.timeframes.find((t) => t.timeframe === tf) ?? input.timeframes[input.timeframes.length - 1];

/** Real tools over already-verified pipeline data — the model selects, never computes. */
export function createPipelineTools(input: PipelineToolInput): AgentToolDef[] {
  return [
    { name: 'getMarket', description: 'Market identity + discovery snapshot.', run: async () => input.market ?? null },
    { name: 'getCandles', description: 'Not available inside the verified pipeline (use timeframe analysis).', run: async () => { throw new Error('getCandles unavailable in-pipeline — use getMultiTimeframeData'); } },
    {
      name: 'getMultiTimeframeData', description: 'Bias/structure/SMC per timeframe.', run: async () =>
        input.timeframes.map((t) => ({ tf: t.timeframe, role: t.role, bias: t.bias, ema: t.indicators.emaTrend, rsi: t.indicators.rsi, structure: t.structure.trend, bos: t.structure.bos, choch: t.structure.choch })),
    },
    {
      name: 'getMarketStructure', description: 'Structure for one timeframe.', run: async (a) => {
        const tf = typeof a.timeframe === 'string' ? a.timeframe : '15m';
        return pickTf(input, tf)?.structure ?? null;
      },
    },
    {
      name: 'getSMC', description: 'SMC for one timeframe.', run: async (a) => {
        const tf = typeof a.timeframe === 'string' ? a.timeframe : '15m';
        const smc = pickTf(input, tf)?.smc;
        return smc ? { sweep: smc.liquiditySweep, swept: smc.swept, fvg: smc.fvg.length, obs: smc.orderBlocks.length, premium: smc.premium, discount: smc.discount, displacement: smc.displacement } : null;
      },
    },
    {
      name: 'getICT', description: 'ICT for one timeframe (unconfirmed when unreliable).', run: async (a) => {
        const tf = typeof a.timeframe === 'string' ? a.timeframe : '15m';
        return pickTf(input, tf)?.ict ?? null;
      },
    },
    {
      name: 'getLiquidity', description: 'Sweeps, FVG/OB counts, swing levels.', run: async (a) => {
        const tf = typeof a.timeframe === 'string' ? a.timeframe : '15m';
        const f = pickTf(input, tf);
        return f ? { sweep: f.smc.liquiditySweep, swept: f.smc.swept, fvg: f.smc.fvg.length, obs: f.smc.orderBlocks.length, above: f.structure.lastSwingHigh, below: f.structure.lastSwingLow } : null;
      },
    },
    {
      name: 'getDerivatives', description: 'Funding/OI/mark/oracle/premium/volume.', run: async () => ({
        funding: input.derivatives.fundingRate, oi: input.derivatives.openInterest,
        mark: input.derivatives.markPrice, oracle: input.derivatives.oraclePrice,
        premium: input.derivatives.premium, dayNotional: input.derivatives.dayVolumeNotional,
        unavailable: input.derivatives.unavailable, notes: input.derivatives.notes,
      }),
    },
    {
      name: 'getConfluence', description: 'Confluence blocks + reasons.', run: async () => ({
        total: input.confluence.total, band: input.confluence.band, direction: input.confluence.direction,
        items: input.confluence.items.map((i) => ({ block: i.block, score: i.score, max: i.max, direction: i.direction })),
        supporting: input.confluence.supportingReasons, opposing: input.confluence.opposingReasons,
      }),
    },
    {
      name: 'calculateRisk', description: 'Deterministic risk math (entry/SL/TP/R:R).', run: async () =>
        computeRisk(input.signal, input.riskOpts),
    },
    {
      name: 'getSignal', description: 'Current deterministic signal.', run: async () => ({
        direction: input.signal.direction, entry: input.signal.entry, sl: input.signal.stopLoss,
        tp1: input.signal.takeProfit1, tp2: input.signal.takeProfit2, rr: input.signal.riskReward,
        confluence: input.signal.confluenceScore, regime: input.signal.marketRegime,
        invalidation: input.signal.invalidation,
      }),
    },
    {
      name: 'getPreviousAnalysis', description: 'Structured memory entries.', run: async (a) => {
        const n = typeof a.n === 'number' ? Math.max(1, Math.min(10, Math.floor(a.n))) : 3;
        return input.memory.slice(-n);
      },
    },
  ];
}

export async function executePipelineTool(
  registry: AgentToolDef[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = registry.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args);
}

const ANALYST_SYSTEM = `You are the AI Analyst for a Hyperliquid perpetual market.
You receive verified deterministic evidence plus a toolbox. Rules:
- NEVER invent prices, indicators, funding, or OI. If a value is missing, request the tool that provides it.
- Request only registered tools you are permitted. One tool per step, then reassess.
- Stop (type "stop") when evidence suffices or data is unavailable.
- Finish with type "final" containing the full analysis JSON: symbol, decision (LONG/SHORT/WAIT/NO_TRADE), direction (LONG/SHORT/WAIT), marketRegime, confidence (0-100, AI assessment NOT profit probability), supportingFactors[], opposingFactors[], invalidation, explanation.
- confidence is AI assessment confidence — never profit probability.`;

const CRITIC_SYSTEM = `You are the AI Critic. You receive a trade thesis plus all agent outputs.
Rules: actively challenge the setup (conflicts, weak confirmation, crowding, bad math).
Request tools when you need verified numbers. Finish with type "final" JSON:
verdict (LONG/SHORT/WAIT), approval (APPROVE/CONDITIONAL/REJECT), risks[], critique.
Downgrade to WAIT rather than approve a flawed setup. Never invent prices.`;

/** Agentic analyst: model-driven tool selection over verified pipeline data. */
export async function runAgenticAnalyst(params: {
  provider: AIProvider;
  toolInput: PipelineToolInput;
  brief: () => string;
  budget?: Partial<AgentLoopBudget>;
  onTrace?: (entry: { agent: string; tool: string; input: string; ms: number; ok: boolean; origin: 'ai' }) => void;
}): Promise<{ analysis: import('../types').AIAnalysis | null; llmCalls: number; trace: AgentLoopTrace[]; stopReason: string }> {
  const registry = createPipelineTools(params.toolInput);
  const { validateAIAnalysis } = await import('../providers/ai/providers');
  const loop = await runAgenticLoop({
    provider: params.provider,
    agentName: 'AIAnalyst',
    system: `${ANALYST_SYSTEM}\nPermitted tools: ${AGENT_TOOLS.AIAnalyst.join(', ')}`,
    evidence: params.brief,
    registry,
    onTool: (name, args) => executePipelineTool(registry, name, args),
    validateFinal: (raw) => validateAIAnalysis(raw),
    budget: params.budget,
    onTrace: params.onTrace,
  });
  const analysis = loop.final as import('../types').AIAnalysis | null;
  return {
    analysis: analysis ? { ...analysis, provider: params.provider.name } : null,
    llmCalls: loop.llmCallsUsed,
    trace: loop.trace,
    stopReason: loop.stopReason,
  };
}

/** Agentic critic: receives thesis + evidence + contradictions, may pull tools, returns APPROVE/CONDITIONAL/REJECT. */
export async function runAgenticCritic(params: {
  provider: AIProvider;
  toolInput: PipelineToolInput;
  thesis: () => string;
  budget?: Partial<AgentLoopBudget>;
  onTrace?: (entry: { agent: string; tool: string; input: string; ms: number; ok: boolean; origin: 'ai' }) => void;
}): Promise<{ critique: import('../types').AICritique | null; llmCalls: number; trace: AgentLoopTrace[]; stopReason: string }> {
  const registry = createPipelineTools(params.toolInput);
  const loop = await runAgenticLoop({
    provider: params.provider,
    agentName: 'AICritic',
    system: `${CRITIC_SYSTEM}\nPermitted tools: ${AGENT_TOOLS.AICritic.join(', ')}`,
    evidence: params.thesis,
    registry,
    onTool: (name, args) => executePipelineTool(registry, name, args),
    validateFinal: (raw) => {
      if (typeof raw !== 'object' || raw == null) return null;
      const r = raw as Record<string, unknown>;
      const verdict = r.verdict === 'LONG' || r.verdict === 'SHORT' || r.verdict === 'WAIT' ? r.verdict : null;
      const approval = r.approval === 'APPROVE' || r.approval === 'CONDITIONAL' || r.approval === 'REJECT' ? r.approval : null;
      if (!verdict || !approval || typeof r.critique !== 'string') return null;
      return {
        symbol: params.toolInput.symbol,
        verdict, approval,
        risks: Array.isArray(r.risks) ? (r.risks as unknown[]).map(String).slice(0, 8) : [],
        critique: (r.critique as string).slice(0, 2000),
        downgraded: verdict === 'WAIT',
        timestamp: Date.now(),
      };
    },
    budget: params.budget,
    onTrace: params.onTrace,
  });
  return { critique: loop.final as import('../types').AICritique | null, llmCalls: loop.llmCallsUsed, trace: loop.trace, stopReason: loop.stopReason };
}
