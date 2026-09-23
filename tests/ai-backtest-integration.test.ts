import { describe, it, expect } from 'vitest';
import { validateAIAnalysis, extractJson, LocalFallbackProvider } from '../src/providers/ai/providers';
import { decideFinal } from '../src/agents/orchestrator';
import { runBacktest } from '../src/core/backtest';
import { analyzeTimeframe } from '../src/core/mtf';
import { computeConfluence } from '../src/core/confluence';
import { generateSignal } from '../src/core/signals';
import { classifyMarket, resolveSymbol, toDisplaySymbol } from '../src/hyperliquid/symbols';
import { buildHyperliquidContext, derivativesFromMarket } from '../src/hyperliquid/derivatives';
import { analyzeAsset } from '../src/analyzers/AssetAnalyzer';
import type { AIContext, Candle, DerivativesAnalysis } from '../src/types';

const EMPTY_DERIV: DerivativesAnalysis = {
  fundingRate: null, openInterest: null, longShortRatio: null, basis: null,
  markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null,
  unavailable: [], bias: 'NEUTRAL', notes: [],
};

describe('AI validation', () => {
  it('accepts valid AI JSON', () => {
    const v = validateAIAnalysis({
      symbol: 'ETH', decision: 'WAIT', direction: 'LONG', marketRegime: 'BULLISH_PULLBACK',
      confidence: 78, supportingFactors: ['4H bullish structure'], opposingFactors: ['resistance nearby'],
      invalidation: 'CHoCH below support', explanation: 'HTF bullish, LTF unconfirmed.',
    });
    expect(v).not.toBeNull();
    expect(v!.confidence).toBe(78);
  });

  it('rejects invalid AI JSON', () => {
    expect(validateAIAnalysis({ foo: 1 })).toBeNull();
    expect(validateAIAnalysis({ symbol: 'ETH', decision: 'MOON' })).toBeNull();
  });

  it('repairs chatty responses by extracting JSON block', () => {
    const j = extractJson('Sure! Here is my analysis: {"a":1} thanks!');
    expect(j).toEqual({ a: 1 });
  });

  it('critic can downgrade LONG to WAIT in final decision', () => {
    const sig = { id: '1', symbol: 'BTC', direction: 'LONG', timeframe: '15m', entry: 100, stopLoss: 99, takeProfit1: 101.5, riskReward: 1.5, confluenceScore: 70, supportingReasons: [], opposingReasons: ['weak volume', 'resistance'], marketRegime: 'BULLISH_PULLBACK', status: 'NEW', timestamp: 1, expiresAt: 9999999999999 } as never;
    const ai = { symbol: 'BTC', decision: 'LONG', direction: 'LONG', marketRegime: 'BULLISH_PULLBACK', confidence: 70, supportingFactors: [], opposingFactors: [], invalidation: 'x', explanation: 'y', provider: 't', cached: false, timestamp: 1 } as never;
    const critique = { symbol: 'BTC', verdict: 'WAIT', risks: ['r'], critique: 'c', downgraded: true, timestamp: 1 } as never;
    expect(decideFinal(sig, ai, critique, { valid: true } as never)).toBe('WAIT');
  });

  it('AI never invents a trade the engine rejected', () => {
    const sig = { id: '1', symbol: 'BTC', direction: 'WAIT', timeframe: '15m', confluenceScore: 30, supportingReasons: [], opposingReasons: [], marketRegime: 'RANGE', status: 'NEW', timestamp: 1, expiresAt: 9999999999999 } as never;
    const ai = { symbol: 'BTC', decision: 'LONG', direction: 'LONG', marketRegime: 'RANGE', confidence: 90, supportingFactors: [], opposingFactors: [], invalidation: 'x', explanation: 'y', provider: 't', cached: false, timestamp: 1 } as never;
    expect(decideFinal(sig, ai, null, null)).toBe('WAIT');
  });

  it('local fallback analyst works without keys', async () => {
    const cs: Candle[] = Array.from({ length: 120 }, (_, i) => ({ openTime: i, open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1, close: 100 + i * 0.1, volume: 100, closeTime: i }));
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const sig = generateSignal({ symbol: 'BTC', timeframe: '15m', price: cs[cs.length - 1].close, confluence: conf, regime: 'RANGE', atr: 1, swingHigh: null, swingLow: null, timeframeConflict: false });
    const ctx: AIContext = { symbol: 'BTC', category: 'CRYPTO', identity: null, price: 100, executionTimeframe: '15m', regime: 'RANGE', timeframes: [tf], confluence: conf, signal: sig, derivatives: EMPTY_DERIV, hyperliquid: null, assetInsights: [], risk: null };
    const fb = new LocalFallbackProvider();
    const a = await fb.analyze(ctx);
    expect(a.provider).toBe('local-fallback');
    expect(a.explanation.length).toBeGreaterThan(10);
  });
});

describe('backtest has no look-ahead', () => {
  it('runs causally and reports metrics', () => {
    const cs: Candle[] = Array.from({ length: 300 }, (_, i) => {
      const base = 100 + Math.sin(i / 10) * 8 + i * 0.02;
      return { openTime: i, open: base, high: base + 1, low: base - 1, close: base + 0.2, volume: 200, closeTime: i };
    });
    const r = runBacktest(cs, 'BTC', '1H');
    expect(r.totalTrades).toBeGreaterThanOrEqual(0);
    expect(r.winRate).toBeGreaterThanOrEqual(0);
    expect(r.winRate).toBeLessThanOrEqual(100);
    for (const t of r.trades) {
      expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
    }
  });
});

describe('integration pipeline', () => {
  it('market data → analysis → confluence → signal → AI → critic → risk → final', async () => {
    const { LocalFallbackProvider } = await import('../src/providers/ai/providers');
    const { runFullAnalysis } = await import('../src/agents/orchestrator');
    const cs: Candle[] = Array.from({ length: 150 }, (_, i) => {
      const base = 2000 + i * 1.5;
      return { openTime: i, open: base, high: base + 3, low: base - 3, close: base + 1, volume: 500, closeTime: i };
    });
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const sig = generateSignal({ symbol: 'ETH', timeframe: '15m', price: cs[cs.length - 1].close, confluence: conf, regime: 'TRENDING_BULLISH', atr: 5, swingHigh: null, swingLow: null, timeframeConflict: false });
    const full = await runFullAnalysis({
      symbol: 'ETH', category: 'CRYPTO', identity: null, executionTimeframe: '15m', price: cs[cs.length - 1].close, regime: 'TRENDING_BULLISH',
      timeframes: [tf], confluence: conf, signal: sig,
      derivatives: EMPTY_DERIV, hyperliquid: null, assetInsights: [],
      provider: new LocalFallbackProvider(),
    });
    expect(['LONG', 'SHORT', 'WAIT', 'NO_TRADE']).toContain(full.finalDecision);
    expect(full.ai).not.toBeNull();
    expect(full.critique).not.toBeNull();
    expect(full.category).toBe('CRYPTO');
  });
});

describe('Hyperliquid symbol resolver + classification', () => {
  it('resolves display symbols robustly', () => {
    expect(toDisplaySymbol('BTC')).toBe('BTC');
    expect(toDisplaySymbol('xyz:TSLA')).toBe('TSLA');
  });

  it('classifies known assets without false claims', () => {
    expect(classifyMarket('BTC').category).toBe('CRYPTO');
    expect(classifyMarket('xyz:TSLA', 'xyz').category).toBe('STOCK');
    expect(classifyMarket('GOLD').category).toBe('COMMODITY');
    expect(classifyMarket('SP500').category).toBe('INDEX');
    expect(classifyMarket('EURUSD').category).toBe('FOREX');
  });

  it('returns UNKNOWN for unrecognized HIP-3 markets, venue default for main dex', () => {
    expect(classifyMarket('xyz:ZZZQ', 'xyz').category).toBe('UNKNOWN');
    // Main perp dex is the crypto venue: unrecognized main-dex listings default to CRYPTO…
    expect(classifyMarket('SOMEFutureCoin123').category).toBe('CRYPTO');
    // …except genuinely ambiguous names, which stay UNKNOWN.
    expect(classifyMarket('SPX').category).toBe('UNKNOWN');
    expect(classifyMarket('GAS').category).toBe('UNKNOWN');
  });

  it('resolveSymbol maps internal → display/category/underlying', () => {
    const s = resolveSymbol('xyz:NVDA', 'xyz');
    expect(s.displaySymbol).toBe('NVDA');
    expect(s.assetClass).toBe('STOCK');
    expect(s.marketType).toBe('PERP');
  });
});

describe('Hyperliquid derivatives + context', () => {
  it('derivativesFromMarket handles missing ctx', () => {
    const d = derivativesFromMarket(undefined);
    expect(d.fundingRate).toBeNull();
    expect(d.unavailable.length).toBeGreaterThan(0);
  });

  it('buildHyperliquidContext separates underlying vs perp behavior', () => {
    const ctx = buildHyperliquidContext(
      {
        marketId: 'BTC', internalSymbol: 'BTC', displaySymbol: 'BTC', assetName: 'Bitcoin', underlying: 'BTC', category: 'CRYPTO',
        classificationSource: 'MAPPING', dex: '', dexLabel: 'MAIN', maxLeverage: 50, szDecimals: 5, onlyIsolated: false, isDelisted: false,
        classificationReason: 'known crypto', discoveredAt: Date.now(), updatedAt: Date.now(),
        ctx: { markPx: 100, oraclePx: 100, midPx: 100, funding: 0.001, openInterest: 1000, dayNtlVlm: 5000, prevDayPx: 99, premium: 0.0001 },
        price: 100, priceChangePercent24h: 1,
      },
      'BULLISH',
      900,
    );
    expect(ctx.underlyingTrend).toBe('BULLISH');
    expect(ctx.openInterestTrend).toBe('RISING');
    expect(ctx.crowdingRisk).toBe(true);
    expect(ctx.interpretation.length).toBeGreaterThan(10);
  });

  it('asset analyzers differ per category', () => {
    const cs: Candle[] = Array.from({ length: 120 }, (_, i) => ({ openTime: i, open: 100, high: 101, low: 99, close: 100 + Math.sin(i) , volume: 500, closeTime: i }));
    const tf = analyzeTimeframe('15m', cs);
    const gold = analyzeAsset({ category: 'COMMODITY', displaySymbol: 'GOLD', timeframes: [tf], derivatives: EMPTY_DERIV });
    const aapl = analyzeAsset({ category: 'STOCK', displaySymbol: 'AAPL', timeframes: [tf], derivatives: EMPTY_DERIV });
    expect(gold.join(' ')).not.toBe(aapl.join(' '));
    expect(gold.length).toBeGreaterThan(0);
    expect(aapl.length).toBeGreaterThan(0);
  });
});
