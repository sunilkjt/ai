// Agent tool registry — explicit, read-only analysis tools.
// v1 contains NO trading execution tools by design (no placeOrder/cancelOrder/withdraw/transfer).
// Dependencies are injected (createTools) so this module never imports services.
import type {
  AISignal, Candle, DerivativesAnalysis, FinalDecision, HyperliquidMarket,
  MarketRegime, ScreenStatus, TimeframeAnalysis, TradingSignal, TrapRisk,
} from '../types';

export interface ToolDeps {
  getMarkets(): HyperliquidMarket[];
  searchMarkets(q: string): HyperliquidMarket[];
  getMarket(id: string): HyperliquidMarket | undefined;
  getCandles(coin: string, timeframe: string, limit?: number): Promise<Candle[]>;
  analyzeMarket(id: string, opts?: { executionTimeframe?: string }): Promise<import('../types').FinalTradeAnalysis | null>;
  getPreviousAnalyses(symbol: string, n?: number): import('../types').AnalysisMemoryEntry[];
  scanFast(opts?: { limit?: number }): Promise<import('../types').ScreenResult[]>;
}

export interface ToolDef {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** All tool names — asserted read-only in tests (no execution tools may exist). */
export const TOOL_NAMES = [
  'discoverMarkets', 'searchMarkets', 'getMarket', 'getCandles',
  'getMultiTimeframeData', 'getIndicators', 'getMarketStructure', 'getSMC',
  'getICT', 'getLiquidity', 'getDerivatives', 'getConfluence',
  'calculateRisk', 'getSignal', 'getPreviousAnalysis', 'scanMarkets',
  'compareMarkets', 'validateSignal',
] as const;

export function createTools(deps: ToolDeps): ToolDef[] {
  const byName = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool ${name}`);
    return t.run(args);
  };
  const tools: ToolDef[] = [
    { name: 'discoverMarkets', description: 'List the current Hyperliquid market universe (all DEXes).', run: async () => deps.getMarkets() },
    { name: 'searchMarkets', description: 'Search markets across identity fields.', run: async (a) => deps.searchMarkets(str(a.q)) },
    { name: 'getMarket', description: 'Get one market by marketId/internal/display symbol.', run: async (a) => deps.getMarket(str(a.id)) ?? null },
    { name: 'getCandles', description: 'Fetch candles for a coin + timeframe.', run: async (a) => deps.getCandles(str(a.coin), str(a.timeframe, '15m'), num(a.limit, 200)) },
    {
      name: 'getMultiTimeframeData', description: 'Full MTF analysis for a market.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.timeframes ?? null;
      },
    },
    {
      name: 'getIndicators', description: 'Deterministic indicators for a market/timeframe.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.timeframes.find((t) => t.timeframe === str(a.timeframe, '15m'))?.indicators ?? null;
      },
    },
    {
      name: 'getMarketStructure', description: 'Deterministic market structure.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.timeframes.find((t) => t.timeframe === str(a.timeframe, '15m'))?.structure ?? null;
      },
    },
    {
      name: 'getSMC', description: 'Deterministic SMC findings.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.timeframes.find((t) => t.timeframe === str(a.timeframe, '15m'))?.smc ?? null;
      },
    },
    {
      name: 'getICT', description: 'Deterministic ICT findings (never faked).', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.timeframes.find((t) => t.timeframe === str(a.timeframe, '15m'))?.ict ?? null;
      },
    },
    {
      name: 'getLiquidity', description: 'Liquidity pools/sweeps summary.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        const tf = full?.timeframes.find((t) => t.timeframe === str(a.timeframe, '15m'));
        return tf ? { sweep: tf.smc.liquiditySweep, swept: tf.smc.swept, fvg: tf.smc.fvg.length, orderBlocks: tf.smc.orderBlocks.length } : null;
      },
    },
    {
      name: 'getDerivatives', description: 'Hyperliquid derivatives context.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: '15m' });
        return full ? { derivatives: full.derivatives, hyperliquid: full.hyperliquid } : null;
      },
    },
    {
      name: 'getConfluence', description: 'Deterministic confluence result.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.confluence ?? null;
      },
    },
    {
      name: 'calculateRisk', description: 'Deterministic risk math for a signal.', run: async (a) => {
        const { computeRisk } = await import('../core/risk');
        return computeRisk(a.signal as TradingSignal, {
          accountBalance: num(a.accountBalance, 10000),
          riskPercent: num(a.riskPercent, 1),
          leverage: num(a.leverage, 1),
        });
      },
    },
    {
      name: 'getSignal', description: 'Current deterministic signal for a market.', run: async (a) => {
        const full = await deps.analyzeMarket(str(a.id), { executionTimeframe: str(a.timeframe, '15m') });
        return full?.deterministic ?? null;
      },
    },
    { name: 'getPreviousAnalysis', description: 'Structured memory of previous analyses.', run: async (a) => deps.getPreviousAnalyses(str(a.symbol), num(a.n, 3)) },
    { name: 'scanMarkets', description: 'Fast deterministic universe scan.', run: async (a) => deps.scanFast({ limit: num(a.limit, 40) }) },
    {
      name: 'compareMarkets', description: 'Side-by-side deterministic comparison.', run: async (a) => {
        const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String).slice(0, 4) : [];
        const out = [];
        for (const id of ids) {
          const full = await deps.analyzeMarket(id, { executionTimeframe: '15m' });
          out.push(full ? { symbol: full.symbol, regime: full.regime, direction: full.deterministic.direction, confluence: full.confluence.total } : { symbol: id, error: 'no data' });
        }
        return out;
      },
    },
    {
      name: 'validateSignal', description: 'Run the signal quality gate over a candidate.', run: async (a) => {
        const { qualityGate } = await import('./AgentOrchestrator');
        const c = a.candidate as import('../types').ScreenResult;
        return qualityGate({
          demo: c.demo, stale: c.stale,
          direction: c.aiDirection, confluence: c.confluence,
          riskReward: c.riskReward, riskValid: c.riskReward != null && c.riskReward >= 1,
          criticApproval: null, trapRisk: c.trapRisk,
        }, { minRiskReward: num(a.minRR, 1.2) });
      },
    },
  ];
  void byName;
  return tools;
}

// ---- Genuine tool-calling loop ----
// Observe → decide (planner) → call (budget/timeout/cache) → observe result →
// reason (stored state) → next call → validate → structured answer.
// Stops on sufficient evidence, missing data, contradiction, or budget.

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  cached: boolean;
  error?: string;
}

export interface ToolContext {
  /** Per-loop result cache: identical calls never re-execute */
  cache: Map<string, unknown>;
  /** Ordered call trace */
  calls: ToolCallRecord[];
  maxCalls: number;
  /** Per-tool timeout ms */
  timeoutMs: number;
  /** Shared trace sink (e.g. pipeline toolLog); receives a copy of every call */
  sink?: (entry: import('../types').ToolCallEntry) => void;
  sinkAgent?: string;
}

export function createToolContext(opts?: { maxCalls?: number; timeoutMs?: number; sink?: ToolContext['sink']; sinkAgent?: string }): ToolContext {
  return {
    cache: new Map(), calls: [],
    maxCalls: opts?.maxCalls ?? 10, timeoutMs: opts?.timeoutMs ?? 15000,
    sink: opts?.sink, sinkAgent: opts?.sinkAgent,
  };
}

function cacheKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tool timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Execute one tool call with budget enforcement, caching and timeout. */
export async function executeTool(
  tools: ToolDef[],
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: unknown; cached: boolean }> {
  const key = cacheKey(name, args);
  const started = Date.now();
  const record = (ok: boolean, cached: boolean, error?: string): void => {
    const rec: ToolCallRecord = { tool: name, args, ms: Date.now() - started, ok, cached, error };
    ctx.calls.push(rec);
    ctx.sink?.({ agent: ctx.sinkAgent ?? 'tool-loop', tool: name, input: JSON.stringify(args).slice(0, 200), ms: rec.ms, ok, at: Date.now(), origin: 'system', cached, error });
  };
  if (ctx.cache.has(key)) {
    record(true, true);
    return { result: ctx.cache.get(key), cached: true };
  }
  if (ctx.calls.filter((c) => !c.cached).length >= ctx.maxCalls) {
    throw new Error(`max tool calls (${ctx.maxCalls}) reached — stopping`);
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  try {
    const result = await withTimeout(tool.run(args), ctx.timeoutMs);
    ctx.cache.set(key, result);
    record(true, false);
    return { result, cached: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'tool failed';
    record(false, false, msg);
    throw e;
  }
}

export type LoopGoal = 'market-deep-dive' | 'compare' | 'scan';

export interface PlannedCall {
  tool: string;
  args: Record<string, unknown>;
  storeAs: string;
}

/** Deterministic planner: decides the next tool from what is still missing. Null = stop. */
export function planNextTool(goal: LoopGoal, have: Set<string>, params: Record<string, unknown>): PlannedCall | null {
  const id = str(params.id);
  if (goal === 'market-deep-dive') {
    if (!id) return null;
    if (!have.has('market')) return { tool: 'getMarket', args: { id }, storeAs: 'market' };
    if (!have.has('mtf')) return { tool: 'getMultiTimeframeData', args: { id }, storeAs: 'mtf' };
    if (!have.has('confluence')) return { tool: 'getConfluence', args: { id }, storeAs: 'confluence' };
    if (!have.has('signal')) return { tool: 'getSignal', args: { id }, storeAs: 'signal' };
    if (!have.has('previous')) return { tool: 'getPreviousAnalysis', args: { symbol: str(params.symbol, id) }, storeAs: 'previous' };
    return null;
  }
  if (goal === 'compare') {
    if (!have.has('comparison')) {
      const ids = Array.isArray(params.ids) ? (params.ids as unknown[]).map(String).slice(0, 4) : [];
      if (!ids.length) return null;
      return { tool: 'compareMarkets', args: { ids }, storeAs: 'comparison' };
    }
    return null;
  }
  if (goal === 'scan') {
    if (!have.has('scan')) return { tool: 'scanMarkets', args: { limit: num(params.limit, 20) }, storeAs: 'scan' };
    return null;
  }
  return null;
}

export interface LoopResult {
  done: boolean;
  stopReason: string;
  state: Record<string, unknown>;
  calls: ToolCallRecord[];
}

export async function runToolLoop(
  tools: ToolDef[],
  ctx: ToolContext,
  goal: LoopGoal,
  params: Record<string, unknown> = {},
): Promise<LoopResult> {
  const state: Record<string, unknown> = {};
  const have = new Set<string>();
  for (;;) {
    const next = planNextTool(goal, have, params);
    if (!next) {
      return { done: true, stopReason: 'sufficient evidence collected', state, calls: ctx.calls };
    }
    try {
      const { result } = await executeTool(tools, ctx, next.tool, next.args);
      if (result == null && next.tool !== 'getPreviousAnalysis') {
        return { done: false, stopReason: `data unavailable from ${next.tool} — stopping without fabricating`, state, calls: ctx.calls };
      }
      state[next.storeAs] = result;
      have.add(next.storeAs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'tool failed';
      if (msg.includes('max tool calls')) {
        return { done: false, stopReason: msg, state, calls: ctx.calls };
      }
      return { done: false, stopReason: `tool ${next.tool} failed (${msg}) — stopping`, state, calls: ctx.calls };
    }
  }
}

// ---- AISignal schema validation (§54) ----

const DECISIONS: FinalDecision[] = ['LONG', 'SHORT', 'WAIT', 'NO_TRADE'];
const STATUSES: ScreenStatus[] = ['WATCHING', 'CANDIDATE', 'AI_REVIEW', 'CONFIRMED', 'CONDITIONAL', 'INVALIDATED', 'EXPIRED', 'REJECTED'];
const TRAPS: TrapRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

export function validateAISignal(raw: unknown): AISignal | null {
  if (typeof raw !== 'object' || raw == null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.marketId !== 'string' || typeof r.dex !== 'string') return null;
  if (!DECISIONS.includes(r.decision as FinalDecision)) return null;
  if (!STATUSES.includes(r.status as ScreenStatus)) return null;
  if (!TRAPS.includes(r.trapRisk as TrapRisk)) return null;
  const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const conf = Number(r.aiConfidence);
  const sq = Number(r.setupQuality);
  const cf = Number(r.confluence);
  if (!Number.isFinite(conf) || !Number.isFinite(sq) || !Number.isFinite(cf)) return null;
  if (!Array.isArray(r.supportingFactors) || !Array.isArray(r.opposingFactors)) return null;
  if (typeof r.explanation !== 'string' || typeof r.invalidation !== 'string' || typeof r.critic !== 'string') return null;
  return {
    marketId: r.marketId, dex: r.dex, category: (r.category as AISignal['category']) ?? 'UNKNOWN',
    decision: r.decision as FinalDecision, status: r.status as ScreenStatus,
    aiConfidence: Math.max(0, Math.min(100, Math.round(conf))),
    setupQuality: Math.max(0, Math.min(100, Math.round(sq * 10) / 10)),
    trapRisk: r.trapRisk as TrapRisk, confluence: cf,
    timeframeAlignment: typeof r.timeframeAlignment === 'string' ? r.timeframeAlignment : 'UNCLEAR',
    entry: numOrNull(r.entry), stopLoss: numOrNull(r.stopLoss),
    takeProfit1: numOrNull(r.takeProfit1), takeProfit2: numOrNull(r.takeProfit2),
    riskReward: numOrNull(r.riskReward),
    supportingFactors: (r.supportingFactors as unknown[]).map(String).slice(0, 8),
    opposingFactors: (r.opposingFactors as unknown[]).map(String).slice(0, 8),
    invalidation: String(r.invalidation), critic: String(r.critic), explanation: String(r.explanation),
  };
}

export type { Candle, DerivativesAnalysis, HyperliquidMarket, MarketRegime, TimeframeAnalysis };
