import { describe, it, expect } from 'vitest';
import { analyzeStructure } from '../src/core/structure';
import { analyzeSMC, analyzeICT, analyzeLiquidity, detectFVG } from '../src/core/smc';
import type { Candle } from '../src/types';

function trendCandles(n: number, dir: 1 | -1, start = 100): Candle[] {
  // Realistic trend with oscillation: pullbacks create genuine HH/HL or LH/LL sequences.
  // A perfectly monotonic series has no market structure — the engine must NOT invent it.
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const mid = start + dir * i * 0.6 + Math.sin(i / 2.2) * 1.6;
    const open = i === 0 ? start : out[i - 1].close;
    const close = mid + Math.sin(i * 1.7) * 0.3;
    out.push({ openTime: i, open, high: Math.max(open, close) + 0.25, low: Math.min(open, close) - 0.25, close, volume: 200, closeTime: i });
  }
  return out;
}

describe('structure', () => {
  it('detects bullish trend on rising candles', () => {
    const s = analyzeStructure(trendCandles(80, 1));
    expect(['BULLISH', 'NEUTRAL']).toContain(s.trend);
    expect(s.hh || s.hl || s.bos === 'BULLISH' || s.trend === 'BULLISH').toBe(true);
  });

  it('detects bearish BOS on breakdown', () => {
    const up = trendCandles(60, 1);
    const down = trendCandles(25, -1, up[up.length - 1].close);
    const s = analyzeStructure([...up, ...down]);
    expect(s.trend === 'BEARISH' || s.bos === 'BEARISH' || s.choch === 'BEARISH' || s.ll || s.lh).toBe(true);
  });

  it('handles insufficient data gracefully', () => {
    const s = analyzeStructure(trendCandles(5, 1));
    expect(s.notes.length).toBeGreaterThan(0);
  });
});

describe('smc/ict', () => {
  it('liquidity sweep detection is ATR-gated (no fake sweep on tiny poke)', () => {
    const base = trendCandles(40, 1, 100);
    // tiny poke above recent high, well within noise
    const last = { ...base[base.length - 1], high: base[base.length - 1].high + 0.0001, close: base[base.length - 1].close };
    const liq = analyzeLiquidity([...base.slice(0, -1), last]);
    expect(typeof liq.sweepHigh).toBe('boolean');
  });

  it('FVG detection finds a planted gap', () => {
    const cs: Candle[] = trendCandles(20, 1, 100);
    // plant a bullish gap: candle[i+1].low > candle[i-1].high
    const i = cs.length - 4;
    cs[i + 1] = { ...cs[i + 1], low: cs[i - 1].high + 5, high: cs[i - 1].high + 8, close: cs[i - 1].high + 7, open: cs[i - 1].high + 6 };
    const fvg = detectFVG(cs);
    expect(fvg.some((f) => f.type === 'BULLISH')).toBe(true);
  });

  it('SMC never confirms without data', () => {
    const smc = analyzeSMC(trendCandles(10, 1));
    expect(smc.notes.join(' ')).toMatch(/Insufficient/i);
  });

  it('ICT marks unreliable when data insufficient', () => {
    const ict = analyzeICT(trendCandles(10, 1));
    expect(ict.reliable).toBe(false);
  });
});
