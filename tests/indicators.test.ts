import { describe, it, expect } from 'vitest';
import { ema, rsi, atr, lastEma } from '../src/core/indicators';
import type { Candle } from '../src/types';

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ openTime: i, open: c, high: c + 1, low: c - 1, close: c, volume: 100, closeTime: i }));
}

describe('indicators', () => {
  it('ema converges upward on rising series', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const e20 = lastEma(closes, 20);
    expect(e20).not.toBeNull();
    expect(e20!).toBeGreaterThan(100);
    expect(e20!).toBeLessThan(160);
  });

  it('rsi flags overbought on straight rally', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const out = rsi(closes, 14);
    expect(out[out.length - 1]!).toBeGreaterThan(70);
  });

  it('rsi flags oversold on straight selloff', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i * 2);
    const out = rsi(closes, 14);
    expect(out[out.length - 1]!).toBeLessThan(30);
  });

  it('atr is positive on volatile candles', () => {
    const cs = candlesFromCloses(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5));
    const a = atr(cs, 14);
    expect(a[a.length - 1]!).toBeGreaterThan(0);
  });

  it('ema returns nulls when insufficient data', () => {
    expect(ema([1, 2, 3], 20).every((v) => v === null)).toBe(true);
  });
});
