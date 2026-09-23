// Deterministic indicators: EMA, RSI, ATR, volume. Pure functions, no look-ahead.
import type { Candle, IndicatorSnapshot } from '../types';

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function lastEma(values: number[], period: number): number | null {
  const arr = ema(values, period);
  return arr[arr.length - 1] ?? null;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + trs[i - 1]) / period;
    out[i] = prev;
  }
  return out;
}

export function volumeStats(candles: Candle[], lookback = 20): { ratio: number | null; avg: number | null } {
  if (candles.length < lookback + 1) return { ratio: null, avg: null };
  const recent = candles.slice(-lookback - 1, -1);
  const avg = recent.reduce((a, c) => a + c.volume, 0) / recent.length;
  if (avg <= 0) return { ratio: null, avg };
  return { ratio: candles[candles.length - 1].volume / avg, avg };
}

export function buildIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ema20 = lastEma(closes, 20);
  const ema50 = lastEma(closes, 50);
  const rsiArr = rsi(closes, 14);
  const r = rsiArr[rsiArr.length - 1];
  const atrArr = atr(candles, 14);
  const a = atrArr[atrArr.length - 1];
  const { ratio } = volumeStats(candles, 20);

  let emaTrend: IndicatorSnapshot['emaTrend'] = 'NEUTRAL';
  if (ema20 != null && ema50 != null) {
    if (ema20 > ema50 && price > ema20) emaTrend = 'BULLISH';
    else if (ema20 < ema50 && price < ema20) emaTrend = 'BEARISH';
  } else if (ema20 != null) {
    emaTrend = price > ema20 ? 'BULLISH' : price < ema20 ? 'BEARISH' : 'NEUTRAL';
  }

  let rsiState: IndicatorSnapshot['rsiState'] = 'UNKNOWN';
  if (r != null) {
    if (r >= 70) rsiState = 'OVERBOUGHT';
    else if (r <= 30) rsiState = 'OVERSOLD';
    else if (r >= 55) rsiState = 'BULLISH';
    else if (r <= 45) rsiState = 'BEARISH';
    else rsiState = 'NEUTRAL';
  }

  return {
    ema20,
    ema50,
    emaTrend,
    priceAboveEma20: ema20 == null ? null : price > ema20,
    priceAboveEma50: ema50 == null ? null : price > ema50,
    rsi: r,
    rsiState,
    atr: a,
    atrPercent: a != null && price > 0 ? (a / price) * 100 : null,
    volumeRatio: ratio,
    volumeState: ratio == null ? 'UNKNOWN' : ratio >= 1.5 ? 'HIGH' : ratio <= 0.6 ? 'LOW' : 'NORMAL',
  };
}
