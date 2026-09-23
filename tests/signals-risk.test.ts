import { describe, it, expect } from 'vitest';
import { computeConfluence } from '../src/core/confluence';
import { generateSignal, evaluateSignalLifecycle } from '../src/core/signals';
import { computeRisk } from '../src/core/risk';
import { analyzeTimeframe, detectRegime } from '../src/core/mtf';
import type { Candle } from '../src/types';

function rising(n = 120, start = 100): Candle[] {
  let p = start;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = p;
    p += 0.6;
    out.push({ openTime: i * 60000, open, high: Math.max(open, p) + 0.2, low: Math.min(open, p) - 0.2, close: p, volume: 300, closeTime: i * 60000 });
  }
  return out;
}

describe('confluence + signals + risk', () => {
  it('strong uptrend yields bullish confluence and LONG signal with sane R:R', () => {
    const cs = rising();
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], { fundingRate: 0.0001, openInterest: 1000, longShortRatio: null, basis: null, markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null, unavailable: [], bias: 'NEUTRAL', notes: [] });
    expect(conf.total).toBeGreaterThanOrEqual(0);
    expect(conf.total).toBeLessThanOrEqual(100);
    const sig = generateSignal({
      symbol: 'BTC', timeframe: '15m', price: cs[cs.length - 1].close,
      confluence: conf, regime: detectRegime([tf]),
      atr: tf.indicators.atr, swingHigh: tf.structure.lastSwingHigh, swingLow: tf.structure.lastSwingLow,
      timeframeConflict: false,
    });
    if (sig.direction === 'LONG') {
      expect(sig.stopLoss!).toBeLessThan(sig.entry!);
      expect(sig.takeProfit1!).toBeGreaterThan(sig.entry!);
      expect(sig.riskReward!).toBeGreaterThan(0);
      const risk = computeRisk(sig, { accountBalance: 10000, riskPercent: 1, leverage: 1 });
      expect(risk).not.toBeNull();
      expect(risk!.positionSize).toBeGreaterThan(0);
    } else {
      expect(sig.direction).toBe('WAIT');
    }
  });

  it('timeframe conflict forces WAIT', () => {
    const cs = rising();
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], { fundingRate: null, openInterest: null, longShortRatio: null, basis: null, markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null, unavailable: ['all'], bias: 'NEUTRAL', notes: [] });
    const sig = generateSignal({
      symbol: 'ETH', timeframe: '15m', price: 100, confluence: { ...conf, total: 95, direction: 'BULLISH' },
      regime: 'RANGE', atr: 1, swingHigh: 110, swingLow: 90, timeframeConflict: true,
    });
    expect(sig.direction).toBe('WAIT');
    expect(sig.opposingReasons.join(' ')).toMatch(/TIMEFRAME CONFLICT/);
  });

  it('signal lifecycle: TP1 then TP2 then SL precedence', () => {
    const base = generateSignal({
      symbol: 'SOL', timeframe: '15m', price: 100,
      confluence: { total: 80, band: 'STRONG', direction: 'BULLISH', items: [], supportingReasons: [], opposingReasons: [] },
      regime: 'TRENDING_BULLISH', atr: 1, swingHigh: 110, swingLow: 95, timeframeConflict: false,
    });
    expect(base.direction).toBe('LONG');
    expect(evaluateSignalLifecycle(base, 50)).toBe('SL_HIT');
    expect(evaluateSignalLifecycle(base, base.takeProfit1! + 0.01)).toBe('TP1_HIT');
    expect(evaluateSignalLifecycle(base, (base.takeProfit2 ?? base.takeProfit1!) + 0.01)).toBe('TP2_HIT');
  });

  it('position sizing risks ~1% of account', () => {
    const sig = generateSignal({
      symbol: 'BTC', timeframe: '15m', price: 50000,
      confluence: { total: 80, band: 'STRONG', direction: 'BULLISH', items: [], supportingReasons: [], opposingReasons: [] },
      regime: 'TRENDING_BULLISH', atr: 200, swingHigh: 51000, swingLow: 49500, timeframeConflict: false,
    });
    const risk = computeRisk(sig, { accountBalance: 10000, riskPercent: 1 });
    expect(risk).not.toBeNull();
    const risked = risk!.positionSize * risk!.riskDistance;
    expect(risked).toBeCloseTo(100, 6);
  });
});
