// FinalDecisionAgent — explicit final-decision stage.
// Inputs: every upstream agent output. Output: exactly LONG | SHORT | WAIT.
// WAIT is first-class: any failed gate, invalid number, or missing agreement → WAIT.
// All trade numbers are validated deterministically and R:R is recomputed
// mathematically (never trusted from upstream).
import type {
  AICritique, AIAnalysis, AssetCategory, ConfluenceResult, DerivativesAnalysis,
  Direction, FinalDecision, HyperliquidContext, MarketRegime, RiskAnalysis,
  ScreenStatus, TimeframeAnalysis, TradingSignal, TrapRisk,
} from '../types';

export interface AgentVote {
  agent: string;
  stance: 'LONG' | 'SHORT' | 'WAIT';
  detail: string;
}

export interface AgentConsensus {
  votes: AgentVote[];
  longVotes: number;
  shortVotes: number;
  waitVotes: number;
  /** winning side needs >= 2 votes AND gate pass; else WAIT */
  agreement: 'LONG' | 'SHORT' | 'NONE';
}

export interface NumberValidation {
  ok: boolean;
  errors: string[];
  recomputedRR: number | null;
}

/**
 * Deterministic number validation.
 * LONG requires SL < Entry < TP1 (< TP2). SHORT requires TP2 < TP1 < Entry < SL.
 * R:R is recomputed as |TP1-Entry| / |Entry-SL| and must match within tolerance.
 */
export function validateSignalNumbers(
  decision: 'LONG' | 'SHORT',
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfit1: number | null | undefined,
  takeProfit2: number | null | undefined,
  claimedRR: number | null | undefined,
): NumberValidation {
  const errors: string[] = [];
  if (entry == null || !Number.isFinite(entry)) errors.push('entry missing or non-finite');
  if (stopLoss == null || !Number.isFinite(stopLoss)) errors.push('stop-loss missing or non-finite');
  if (takeProfit1 == null || !Number.isFinite(takeProfit1)) errors.push('TP1 missing or non-finite');
  if (errors.length) return { ok: false, errors, recomputedRR: null };
  const e = entry as number;
  const sl = stopLoss as number;
  const tp1 = takeProfit1 as number;
  if (decision === 'LONG') {
    if (!(sl < e)) errors.push(`LONG requires SL < Entry (SL ${sl}, entry ${e})`);
    if (!(e < tp1)) errors.push(`LONG requires Entry < TP1 (entry ${e}, TP1 ${tp1})`);
    if (takeProfit2 != null && Number.isFinite(takeProfit2) && !(tp1 < (takeProfit2 as number))) {
      errors.push(`LONG requires TP1 < TP2 (TP1 ${tp1}, TP2 ${takeProfit2})`);
    }
  } else {
    if (!(sl > e)) errors.push(`SHORT requires SL > Entry (SL ${sl}, entry ${e})`);
    if (!(e > tp1)) errors.push(`SHORT requires Entry > TP1 (entry ${e}, TP1 ${tp1})`);
    if (takeProfit2 != null && Number.isFinite(takeProfit2) && !(tp1 > (takeProfit2 as number))) {
      errors.push(`SHORT requires TP1 > TP2 (TP1 ${tp1}, TP2 ${takeProfit2})`);
    }
  }
  const riskDist = Math.abs(e - sl);
  const rewardDist = Math.abs(tp1 - e);
  const recomputedRR = riskDist > 0 ? rewardDist / riskDist : null;
  if (recomputedRR == null) {
    errors.push('R:R uncomputable (zero risk distance)');
  } else if (claimedRR != null && Number.isFinite(claimedRR)) {
    const drift = Math.abs(claimedRR - recomputedRR) / Math.max(1e-9, recomputedRR);
    if (drift > 1e-6) errors.push(`claimed R:R ${claimedRR} != recomputed ${recomputedRR.toFixed(4)}`);
  }
  return { ok: errors.length === 0, errors, recomputedRR };
}

export interface FinalDecisionInput {
  symbol: string;
  category: AssetCategory;
  regime: MarketRegime;
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  longCandidate: boolean;
  longDetail: string;
  shortCandidate: boolean;
  shortDetail: string;
  contrarian: string[];
  trapRisk: TrapRisk;
  trapFlags: string[];
  ai: AIAnalysis | null;
  critique: AICritique | null;
  risk: RiskAnalysis | null;
  demo: boolean;
  stale: boolean;
  gateStatus: ScreenStatus;
  gateReasons: string[];
}

export interface FinalSignal {
  decision: 'LONG' | 'SHORT' | 'WAIT';
  consensus: AgentConsensus;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  /** AI assessment confidence 0-100 — NOT probability of profit */
  confidence: number | null;
  confluence: number;
  why: string[];
  against: string[];
  invalidation: string;
  trapRisk: TrapRisk;
  validation: NumberValidation | null;
  timestamp: number;
  notes: string[];
}

function vote(agent: string, stance: AgentVote['stance'], detail: string): AgentVote {
  return { agent, stance, detail };
}

export function decideFinalSignal(input: FinalDecisionInput): FinalSignal {
  const notes: string[] = [];
  const timestamp = Date.now();
  const {
    signal, longCandidate, shortCandidate, ai, critique, risk,
    confluence, trapRisk, demo,
  } = input;

  // --- Agent consensus (independent votes, LONG/SHORT evaluated separately) ---
  const detStance: AgentVote['stance'] = signal.direction;
  const votes: AgentVote[] = [
    vote('deterministic-signal', detStance, `${signal.direction} (confluence ${signal.confluenceScore}/100)`),
    vote('long-agent', longCandidate ? 'LONG' : 'WAIT', input.longDetail),
    vote('short-agent', shortCandidate ? 'SHORT' : 'WAIT', input.shortDetail),
    vote('trap-detector', trapRisk === 'HIGH' ? 'WAIT' : detStance, `trap risk ${trapRisk}`),
  ];
  if (ai) votes.push(vote('ai-analyst', ai.direction, `${ai.decision} (${ai.confidence}/100 via ${ai.provider})`));
  if (critique) {
    votes.push(vote('critic', critique.approval === 'REJECT' ? 'WAIT' : critique.verdict,
      `${critique.approval}: ${critique.critique.slice(0, 160)}`));
  }
  const longVotes = votes.filter((v) => v.stance === 'LONG').length;
  const shortVotes = votes.filter((v) => v.stance === 'SHORT').length;
  const waitVotes = votes.filter((v) => v.stance === 'WAIT').length;
  const agreement: AgentConsensus['agreement'] =
    longVotes >= 2 && longVotes > shortVotes ? 'LONG'
    : shortVotes >= 2 && shortVotes > longVotes ? 'SHORT'
    : 'NONE';
  const consensus: AgentConsensus = { votes, longVotes, shortVotes, waitVotes, agreement };

  // --- Hard gates: any failure → WAIT (first-class, with reason) ---
  const blockers: string[] = [];
  if (demo) blockers.push('demo data — LIVE ANALYSIS UNAVAILABLE');
  if (critique?.approval === 'REJECT') blockers.push(`AI critic REJECTED: ${critique.critique.slice(0, 160)}`);
  if (risk && !risk.valid) blockers.push('risk validation failed');
  if (signal.direction === 'WAIT' && (!ai || (ai.direction !== 'LONG' && ai.direction !== 'SHORT'))) {
    blockers.push('no deterministic setup and no AI direction');
  }
  if (agreement === 'NONE' && signal.direction !== 'WAIT') {
    blockers.push(`insufficient agent agreement (LONG ${longVotes} / SHORT ${shortVotes} / WAIT ${waitVotes})`);
  }

  let decision: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
  if (blockers.length === 0) {
    if (agreement === 'LONG' || agreement === 'SHORT') {
      decision = agreement;
    } else if (ai && (ai.direction === 'LONG' || ai.direction === 'SHORT') && signal.direction === ai.direction) {
      // Deterministic + AI agree even without a second specialist vote.
      decision = ai.direction;
      notes.push('deterministic signal and AI agree');
    } else {
      blockers.push('no agreement path to a directional decision');
    }
  }

  // --- Numbers: attach, validate, recompute ---
  const entry = risk?.entry ?? signal.entry ?? null;
  const stopLoss = risk?.stopLoss ?? signal.stopLoss ?? null;
  const takeProfit1 = risk?.takeProfit1 ?? signal.takeProfit1 ?? null;
  const takeProfit2 = risk?.takeProfit2 ?? signal.takeProfit2 ?? null;
  const claimedRR = risk?.riskReward ?? signal.riskReward ?? null;
  let validation: NumberValidation | null = null;
  if (decision === 'LONG' || decision === 'SHORT') {
    validation = validateSignalNumbers(decision, entry, stopLoss, takeProfit1, takeProfit2, claimedRR);
    if (!validation.ok) {
      notes.push(`number validation failed: ${validation.errors.join('; ')}`);
      decision = 'WAIT';
    }
  }

  const why = [...signal.supportingReasons];
  if (decision === 'LONG' && longCandidate) why.push('LongSetupAgent checklist satisfied');
  if (decision === 'SHORT' && shortCandidate) why.push('ShortSetupAgent checklist satisfied');
  const against = [...signal.opposingReasons, ...input.trapFlags, ...input.contrarian.slice(0, 2)];

  const confidence = ai?.confidence ?? null; // AI assessment only; null when no AI review
  if (confidence != null && (confidence < 0 || confidence > 100)) {
    notes.push(`AI confidence out of range (${confidence}) — treated as unreliable`);
  }

  return {
    decision,
    consensus,
    entry: decision === 'WAIT' ? null : entry,
    stopLoss: decision === 'WAIT' ? null : stopLoss,
    takeProfit1: decision === 'WAIT' ? null : takeProfit1,
    takeProfit2: decision === 'WAIT' ? null : takeProfit2,
    riskReward: decision === 'WAIT' ? null : (validation?.recomputedRR ?? claimedRR),
    confidence: confidence != null ? Math.max(0, Math.min(100, Math.round(confidence))) : null,
    confluence: confluence.total,
    why: why.slice(0, 8),
    against: against.slice(0, 8),
    invalidation: signal.invalidation ?? ai?.invalidation ?? 'Structure break against the setup',
    trapRisk,
    validation,
    timestamp,
    notes: blockers.length ? [...blockers, ...notes] : notes,
  };
}
