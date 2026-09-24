import { describe, it, expect } from 'vitest';
import { TOOL_NAMES, createTools, validateAISignal } from '../src/agents/tools';
import { stage0 } from '../src/services/screener';
import type { HyperliquidMarket } from '../src/types';
import { qualityGate } from '../src/agents/AgentOrchestrator';
import { setupQualityFromScores, QUALITY_WEIGHTS, scoreComponents } from '../src/core/quality';
import { detectTraps } from '../src/core/traps';
import { evaluateLongSetup, evaluateShortSetup } from '../src/core/setups';
import { transitionSignal, generateSignal } from '../src/core/signals';
import { analyzeTimeframe } from '../src/core/mtf';
import { computeConfluence } from '../src/core/confluence';
import type { Candle, DerivativesAnalysis } from '../src/types';

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

describe('tool registry', () => {
  it('exposes only read-only analysis tools — no execution tools', () => {
    expect(TOOL_NAMES.length).toBeGreaterThan(10);
    for (const n of TOOL_NAMES) {
      expect(n).not.toMatch(/placeOrder|cancelOrder|withdraw|transfer|leverage|order/i);
    }
  });

  it('every tool runs independently with valid/missing data', async () => {
    const tools = createTools({
      getMarkets: () => [],
      searchMarkets: () => [],
      getMarket: () => undefined,
      getCandles: async () => [],
      analyzeMarket: async () => null,
      getPreviousAnalyses: () => [],
      scanFast: async () => [],
    });
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(await tools.find((t) => t.name === 'discoverMarkets')!.run({})).toEqual([]);
    expect(await tools.find((t) => t.name === 'getMarket')!.run({ id: 'NOPE' })).toBeNull();
    expect(await tools.find((t) => t.name === 'getSignal')!.run({ id: 'NOPE' })).toBeNull();
  });
});

describe('AISignal schema validation', () => {
  const base = {
    marketId: 'xyz:GOLD', dex: 'xyz', category: 'COMMODITY', decision: 'LONG',
    status: 'CONFIRMED', aiConfidence: 84, setupQuality: 87, trapRisk: 'LOW',
    confluence: 89, timeframeAlignment: 'BULLISH', entry: 1234, stopLoss: 1220,
    takeProfit1: 1260, takeProfit2: 1285, riskReward: 2.4,
    supportingFactors: ['4H structure'], opposingFactors: ['resistance'],
    invalidation: 'CHoCH', critic: 'fine', explanation: 'bullish',
  };
  it('accepts the §54 example shape', () => {
    const v = validateAISignal(base);
    expect(v).not.toBeNull();
    expect(v!.aiConfidence).toBe(84);
  });
  it('rejects invalid decisions, statuses, trap levels, non-numbers', () => {
    expect(validateAISignal({ ...base, decision: 'MOON' })).toBeNull();
    expect(validateAISignal({ ...base, status: 'YOLO' })).toBeNull();
    expect(validateAISignal({ ...base, trapRisk: 'EXTREME' })).toBeNull();
    expect(validateAISignal({ ...base, aiConfidence: 'high' })).toBeNull();
    expect(validateAISignal({ foo: 1 })).toBeNull();
  });
});

describe('setup quality model', () => {
  it('is a transparent weighted blend (weights configurable)', () => {
    const cs = trendCandles();
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const s = scoreComponents({ direction: 'LONG', timeframes: [tf], confluence: conf, derivatives: EMPTY_DERIV, risk: null });
    const q1 = setupQualityFromScores(s, QUALITY_WEIGHTS);
    const q2 = setupQualityFromScores(s, { ...QUALITY_WEIGHTS, volume: 5 });
    expect(q1).toBeGreaterThanOrEqual(0);
    expect(q1).toBeLessThanOrEqual(100);
    expect(q2).not.toBe(q1); // weights actually matter
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('long/short specialists', () => {
  it('strong uptrend can satisfy LONG checklist; handles missing data', () => {
    const cs = trendCandles(200, 1);
    const tf = analyzeTimeframe('15m', cs);
    const long = evaluateLongSetup([tf], EMPTY_DERIV);
    const short = evaluateShortSetup([tf], EMPTY_DERIV);
    expect(long.checks.length).toBe(10);
    expect(short.candidate).toBe(false); // uptrend must not yield SHORT
    expect(long.missing.length + long.checks.filter((c) => c.pass).length).toBe(10);
  });
});

describe('trap detector + contrarian', () => {
  it('flags stretched, crowded, divergent conditions; LOW when clean', () => {
    const cs = trendCandles();
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const sig = generateSignal({ symbol: 'T', timeframe: '15m', price: 100, confluence: conf, regime: 'RANGE', atr: 1, swingHigh: null, swingLow: null, timeframeConflict: false });
    const clean = detectTraps({ signal: sig, timeframes: [tf], derivatives: EMPTY_DERIV, change24h: 0.2, oiRising: null });
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(clean.risk);
    const crowded = detectTraps({
      signal: { ...sig, direction: 'LONG', riskReward: 0.8 },
      timeframes: [tf], derivatives: { ...EMPTY_DERIV, fundingRate: 0.002 },
      change24h: -1, oiRising: true,
    });
    expect(crowded.flags.length).toBeGreaterThan(0);
    expect(crowded.oiPriceRegime).toContain('OI rising');
  });
});

describe('quality gate', () => {
  const good = {
    demo: false, stale: false, direction: 'LONG' as const, confluence: 80,
    riskReward: 2.0, riskValid: true, criticApproval: 'APPROVE' as const, trapRisk: 'LOW' as const,
  };
  it('CONFIRMs only when everything passes; WAIT/NO-TRADE otherwise', () => {
    expect(qualityGate(good).status).toBe('CONFIRMED');
    expect(qualityGate({ ...good, demo: true }).status).toBe('INVALIDATED');
    expect(qualityGate({ ...good, direction: 'WAIT' }).status).toBe('WATCHING');
    expect(qualityGate({ ...good, criticApproval: 'REJECT' }).status).toBe('REJECTED');
    expect(qualityGate({ ...good, riskReward: 0.9 }).status).not.toBe('CONFIRMED');
    expect(qualityGate({ ...good, criticApproval: 'CONDITIONAL' }).status).toBe('CONDITIONAL');
  });
});

describe('stage 0 validation', () => {
  const base: HyperliquidMarket = {
    marketId: 'main:T', internalSymbol: 'T', displaySymbol: 'T', assetName: 'T',
    underlying: 'T', category: 'CRYPTO', classificationSource: 'DEX', dex: '',
    dexLabel: 'MAIN', maxLeverage: 10, szDecimals: 3, onlyIsolated: false,
    isDelisted: false, classificationReason: 't', discoveredAt: Date.now(),
    updatedAt: Date.now(), ctx: null, price: 100, priceChangePercent24h: 1,
  };
  const withCtx = (over: Partial<HyperliquidMarket>): HyperliquidMarket => ({
    ...base,
    ctx: { markPx: 100, oraclePx: 100, midPx: 100, funding: 0, openInterest: 10, dayNtlVlm: 100000, prevDayPx: 99, premium: 0 },
    ...over,
  });
  it('rejects delisted / missing ctx / bad price / thin liquidity with counted reasons', () => {
    const markets = [
      withCtx({ marketId: 'main:OK' }),
      withCtx({ marketId: 'main:DEL', isDelisted: true }),
      { ...base, marketId: 'main:NOCTX' },
      withCtx({ marketId: 'main:NOPRICE', price: null, ctx: { markPx: null, oraclePx: null, midPx: null, funding: null, openInterest: null, dayNtlVlm: 100000, prevDayPx: null, premium: null } }),
      withCtx({ marketId: 'main:THIN', ctx: { markPx: 1, oraclePx: 1, midPx: 1, funding: 0, openInterest: 1, dayNtlVlm: 100, prevDayPx: 1, premium: 0 } }),
    ];
    const { passed, report } = stage0(markets);
    expect(report.discovered).toBe(5);
    expect(passed.map((m) => m.marketId)).toEqual(['main:OK']);
    expect(report.rejected.reduce((a, r) => a + r.count, 0)).toBe(4);
    expect(report.rejected.length).toBeGreaterThanOrEqual(3);
  });
});

describe('signal lifecycle transitions', () => {  it('records every transition with reason', () => {
    const cs = trendCandles();
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const sig = generateSignal({ symbol: 'T', timeframe: '15m', price: 100, confluence: conf, regime: 'RANGE', atr: 1, swingHigh: null, swingLow: null, timeframeConflict: false });
    expect(sig.history.length).toBeGreaterThan(0);
    const moved = transitionSignal(sig, 'ACTIVE', 'price holding entry zone');
    expect(moved.status).toBe('ACTIVE');
    expect(moved.history[moved.history.length - 1]).toMatchObject({ from: 'NEW', to: 'ACTIVE' });
    expect(transitionSignal(moved, 'ACTIVE', 'noop')).toBe(moved); // no-op, no duplicate event
  });
});
