import { describe, it, expect } from 'vitest';
import {
  ALL_SPECIALISTS, SignalCriticAgent, MarketDataAgent, LongSetupAgent, ShortSetupAgent,
  type SpecialistInput,
} from '../src/agents/specialists';
import { decideFinalSignal, validateSignalNumbers } from '../src/agents/finalDecision';
import {
  createTools, createToolContext, executeTool, planNextTool, runToolLoop,
} from '../src/agents/tools';
import { filterScreenResults } from '../src/services/screener';
import { analyzeTimeframe } from '../src/core/mtf';
import { computeConfluence } from '../src/core/confluence';
import { generateSignal } from '../src/core/signals';
import type {
  Candle, DerivativesAnalysis, ScreenResult, TimeframeAnalysis, TradingSignal,
} from '../src/types';

const EMPTY_DERIV: DerivativesAnalysis = {
  fundingRate: null, openInterest: null, longShortRatio: null, basis: null,
  markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null,
  unavailable: [], bias: 'NEUTRAL', notes: [],
};

function trendCandles(n = 150, dir = 1): Candle[] {
  let p = 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = p;
    p += 0.5 * dir;
    out.push({ openTime: i * 60000, open, high: Math.max(open, p) + 0.2, low: Math.min(open, p) - 0.2, close: p, volume: 400, closeTime: i * 60000 });
  }
  return out;
}

function specInput(dir: 1 | -1 = 1): SpecialistInput {
  const cs = trendCandles(150, dir);
  const tf = analyzeTimeframe('15m', cs);
  const frames = [tf];
  const conf = computeConfluence(frames, EMPTY_DERIV);
  const signal = generateSignal({
    symbol: 'T', timeframe: '15m', price: cs[cs.length - 1].close,
    confluence: conf, regime: 'RANGE', atr: 1, swingHigh: null, swingLow: null, timeframeConflict: false,
  });
  return {
    symbol: 'T', category: 'CRYPTO', market: null, price: cs[cs.length - 1].close,
    change24h: 0.5, oiRising: null, regime: 'RANGE', timeframes: frames,
    confluence: conf, signal, derivatives: EMPTY_DERIV, hyperliquid: null,
    demo: false, stale: false,
  };
}

const noopTrace = (): void => {};

describe('specialist agents', () => {
  it('all 16 run with structured I/O on valid data', () => {
    const input = specInput();
    const all = [...ALL_SPECIALISTS, SignalCriticAgent];
    expect(all.length).toBe(16);
    for (const agent of all) {
      expect(agent.responsibility.length).toBeGreaterThan(5);
      const out = agent.run(input, noopTrace);
      expect(out.agent).toBe(agent.name);
      expect(typeof out.ok).toBe('boolean');
      expect(typeof out.summary).toBe('string');
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(100);
      expect(Array.isArray(out.evidence)).toBe(true);
      expect(Array.isArray(out.risks)).toBe(true);
      expect(out.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles missing data without throwing (ok:false + error, never fabricated)', () => {
    const broken = { ...specInput(), timeframes: [] as TimeframeAnalysis[] };
    const out = LongSetupAgent.run(broken, noopTrace);
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it('flags stale/demo data as risks, not live facts', () => {
    const stale = MarketDataAgent.run({ ...specInput(), stale: true }, noopTrace);
    expect(stale.risks.join(' ')).toMatch(/STALE/);
    const demo = MarketDataAgent.run({ ...specInput(), demo: true }, noopTrace);
    expect(demo.ok).toBe(false);
  });

  it('long/short specialists are independent (never mere inverses)', () => {
    const up = specInput(1);
    expect(LongSetupAgent.run(up, noopTrace).confidence).toBeGreaterThanOrEqual(
      ShortSetupAgent.run(up, noopTrace).confidence,
    );
    const down = specInput(-1);
    expect(ShortSetupAgent.run(down, noopTrace).confidence).toBeGreaterThanOrEqual(
      LongSetupAgent.run(down, noopTrace).confidence,
    );
    // Independent checklists: LONG failing checks differ from SHORT passing checks
    const l = LongSetupAgent.run(down, noopTrace);
    const s = ShortSetupAgent.run(down, noopTrace);
    expect(l.summary).not.toBe(s.summary);
  });
});

describe('FinalDecisionAgent number validation', () => {
  it('enforces SL<Entry<TP1<TP2 (LONG) and mirror (SHORT), recomputes R:R', () => {
    const ok = validateSignalNumbers('LONG', 100, 99, 101.5, 103, 1.5);
    expect(ok.ok).toBe(true);
    expect(ok.recomputedRR).toBeCloseTo(1.5, 6);
    const bad = validateSignalNumbers('LONG', 100, 101, 101.5, 103, 1.5);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/SL < Entry/);
    const short = validateSignalNumbers('SHORT', 100, 101, 98.5, 97, 1.5);
    expect(short.ok).toBe(true);
    const drift = validateSignalNumbers('LONG', 100, 99, 101.5, 103, 99);
    expect(drift.ok).toBe(false);
    expect(drift.errors.join(' ')).toMatch(/recomputed/);
  });

  it('WAIT is first-class: REJECT/invalid/no-agreement/demo all yield WAIT', () => {
    const input = specInput();
    const conf = computeConfluence(input.timeframes, EMPTY_DERIV);
    const base = {
      symbol: 'T', category: 'CRYPTO' as const, regime: 'RANGE' as const,
      timeframes: input.timeframes, confluence: conf, signal: input.signal,
      derivatives: EMPTY_DERIV, hyperliquid: null,
      longCandidate: false, longDetail: 'no LONG', shortCandidate: false, shortDetail: 'no SHORT',
      contrarian: [], trapRisk: 'LOW' as const, trapFlags: [],
      ai: null, critique: null, risk: null, demo: false, stale: false,
      gateStatus: 'WATCHING' as const, gateReasons: [] as string[],
    };
    expect(decideFinalSignal(base).decision).toBe('WAIT');
    expect(decideFinalSignal({ ...base, demo: true }).notes.join(' ')).toMatch(/LIVE ANALYSIS UNAVAILABLE/);
    const rej = decideFinalSignal({
      ...base, longCandidate: true, critique: { symbol: 'T', verdict: 'WAIT' as const, approval: 'REJECT' as const, risks: ['x'], critique: 'bad', downgraded: true, timestamp: 1 },
    });
    expect(rej.decision).toBe('WAIT');
    expect(rej.consensus.longVotes + rej.consensus.shortVotes + rej.consensus.waitVotes).toBe(rej.consensus.votes.length);
  });
});

describe('tool-calling loop', () => {
  const full = {
    timeframes: [],
    confluence: { total: 60, band: 'MODERATE', direction: 'NEUTRAL', items: [], supportingReasons: [], opposingReasons: [] },
    deterministic: { direction: 'WAIT', confluenceScore: 60 },
  };
  const tools = createTools({
    getMarkets: () => [],
    searchMarkets: () => [],
    getMarket: (id) => (id === 'main:T' ? { marketId: 'main:T' } : undefined) as never,
    getCandles: async () => [],
    analyzeMarket: async () => full as never,
    getPreviousAnalyses: () => [],
    scanFast: async () => [],
  });

  it('runs observe→plan→call→reason to completion with trace', async () => {
    const ctx = createToolContext({ maxCalls: 10 });
    const loop = await runToolLoop(tools, ctx, 'market-deep-dive', { id: 'main:T', symbol: 'T' });
    expect(loop.done).toBe(true);
    expect(loop.calls.length).toBeGreaterThan(0);
    expect(loop.calls.every((c) => typeof c.ms === 'number')).toBe(true);
    expect(planNextTool('market-deep-dive', new Set(['market', 'mtf', 'confluence', 'signal', 'previous']), { id: 'x' })).toBeNull();
  });

  it('caches identical calls and enforces max-calls + timeouts', async () => {
    const ctx = createToolContext({ maxCalls: 10 });
    await executeTool(tools, ctx, 'getMarket', { id: 'main:T' });
    const second = await executeTool(tools, ctx, 'getMarket', { id: 'main:T' });
    expect(second.cached).toBe(true);
    expect(ctx.calls.filter((c) => c.cached).length).toBe(1);

    const tiny = createToolContext({ maxCalls: 1 });
    await executeTool(tools, tiny, 'getMarket', { id: 'main:T' });
    await expect(executeTool(tools, tiny, 'getMarket', { id: 'other' })).rejects.toThrow(/max tool calls/);

    const slow = createTools({
      getMarkets: () => [], searchMarkets: () => [], getMarket: () => undefined,
      getCandles: async () => [], analyzeMarket: async () => null, getPreviousAnalyses: () => [],
      scanFast: async () => [],
    });
    const slowCtx = createToolContext({ timeoutMs: 5 });
    const hanging = [{ name: 'hang', description: 'x', run: async () => { await new Promise((r) => setTimeout(r, 500)); return 1; } }, ...slow];
    await expect(executeTool(hanging, slowCtx, 'hang', {})).rejects.toThrow(/timeout/);
  });

  it('stops honestly on missing data without fabricating', async () => {
    const ctx = createToolContext({ maxCalls: 10 });
    const loop = await runToolLoop(tools, ctx, 'market-deep-dive', { id: 'main:MISSING', symbol: 'MISSING' });
    expect(loop.done).toBe(false);
    expect(loop.stopReason).toMatch(/unavailable|failed|stopping/);
  });
});

describe('screener result filters', () => {
  const mk = (over: Partial<ScreenResult>): ScreenResult => ({
    marketId: 'main:T', displaySymbol: 'T', assetName: 'T', dex: '', dexLabel: 'MAIN',
    category: 'CRYPTO', price: 100, change24h: 1, liquidityNotional: 500000,
    trend: 'BULLISH', mtfBias: 'BULLISH', confluence: 60, setupQuality: 70,
    scores: null, consensus: null, specialists: null, trapRisk: 'LOW', trapNotes: [],
    longSetup: null, shortSetup: null, aiDirection: 'LONG', aiConfidence: 80,
    aiProvider: 'local-fallback', entry: 100, stopLoss: 99, takeProfit1: 101.5,
    takeProfit2: null, riskReward: 1.5, status: 'CONFIRMED', statusReason: '',
    why: [], against: [], invalidation: '', criticSummary: null, explanation: null,
    demo: false, stale: false, updatedAt: Date.now(), ...over,
  });
  const rows = [
    mk({ marketId: 'main:A', aiConfidence: 85, confluence: 80, trapRisk: 'LOW', liquidityNotional: 5000000 }),
    mk({ marketId: 'main:B', aiConfidence: 50, confluence: 60, trapRisk: 'HIGH', liquidityNotional: 10000, aiDirection: 'WAIT', status: 'WATCHING' }),
  ];
  it('applies quality gates conjunctively', () => {
    expect(filterScreenResults(rows, {})).toHaveLength(2);
    expect(filterScreenResults(rows, { highConfidence: true }).map((r) => r.marketId)).toEqual(['main:A']);
    expect(filterScreenResults(rows, { highConfluence: true }).map((r) => r.marketId)).toEqual(['main:A']);
    expect(filterScreenResults(rows, { lowTrap: true }).map((r) => r.marketId)).toEqual(['main:A']);
    expect(filterScreenResults(rows, { highLiquidity: true }).map((r) => r.marketId)).toEqual(['main:A']);
    expect(filterScreenResults(rows, { dir: 'WAIT' }).map((r) => r.marketId)).toEqual(['main:B']);
  });
});
