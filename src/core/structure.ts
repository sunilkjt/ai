// Market structure: swings, HH/HL/LH/LL, BOS, CHoCH. Deterministic, causal only.
import type { Candle, MarketStructure } from '../types';

export function findSwings(candles: Candle[], left = 2, right = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

export function analyzeStructure(candles: Candle[]): MarketStructure {
  const notes: string[] = [];
  if (candles.length < 10) {
    return {
      trend: 'NEUTRAL', swingHighs: [], swingLows: [], lastSwingHigh: null, lastSwingLow: null,
      bos: null, choch: null, hh: false, hl: false, lh: false, ll: false,
      structurePoints: 0, notes: ['Insufficient data for structure'],
    };
  }
  const { highs, lows } = findSwings(candles);
  const swingHighs = highs.slice(-4).map((i) => candles[i].high);
  const swingLows = lows.slice(-4).map((i) => candles[i].low);
  const lastSwingHigh = swingHighs.length ? swingHighs[swingHighs.length - 1] : null;
  const lastSwingLow = swingLows.length ? swingLows[swingLows.length - 1] : null;
  const close = candles[candles.length - 1].close;

  let hh = false, hl = false, lh = false, ll = false;
  if (swingHighs.length >= 2) {
    const [a, b] = swingHighs.slice(-2);
    hh = b > a; lh = b < a;
  }
  if (swingLows.length >= 2) {
    const [a, b] = swingLows.slice(-2);
    hl = b > a; ll = b < a;
  }

  // BOS / CHoCH from closes relative to last confirmed swings (excluding live forming bar bias:
  // use swings confirmed at least 2 bars ago — findSwings already excludes the last `right` bars).
  let bos: MarketStructure['bos'] = null;
  let choch: MarketStructure['choch'] = null;
  const prevCloses = candles.slice(0, -3).map((c) => c.close);
  const wasAboveHigh = lastSwingHigh != null && prevCloses.some((c) => c > lastSwingHigh);
  const wasBelowLow = lastSwingLow != null && prevCloses.some((c) => c < lastSwingLow);

  // Determine prior trend from swing pattern
  const bullishPattern = (hh || hl) && !ll && !lh;
  const bearishPattern = (ll || lh) && !hh && !hl;

  if (lastSwingHigh != null && close > lastSwingHigh) {
    if (bearishPattern || wasBelowLow) { choch = 'BULLISH'; notes.push('Bullish CHoCH: close above swing high after bearish structure'); }
    else { bos = 'BULLISH'; notes.push('Bullish BOS: continuation above swing high'); }
  }
  if (lastSwingLow != null && close < lastSwingLow) {
    if (bullishPattern || wasAboveHigh) { choch = 'BEARISH'; notes.push('Bearish CHoCH: close below swing low after bullish structure'); }
    else { bos = 'BEARISH'; notes.push('Bearish BOS: continuation below swing low'); }
  }

  let trend: MarketStructure['trend'] = 'NEUTRAL';
  let points = 0;
  if ((hh && hl) || (bos === 'BULLISH') || (choch === 'BULLISH')) { trend = 'BULLISH'; points += 2; }
  else if ((ll && lh) || (bos === 'BEARISH') || (choch === 'BEARISH')) { trend = 'BEARISH'; points -= 2; }
  else if (hh || hl) { trend = 'BULLISH'; points += 1; }
  else if (ll || lh) { trend = 'BEARISH'; points -= 1; }

  if (hh) notes.push('Higher High (HH)');
  if (hl) notes.push('Higher Low (HL)');
  if (lh) notes.push('Lower High (LH)');
  if (ll) notes.push('Lower Low (LL)');
  if (!notes.length) notes.push('Structure neutral — no clear HH/HL/LH/LL sequence');

  return {
    trend, swingHighs, swingLows, lastSwingHigh, lastSwingLow,
    bos, choch, hh, hl, lh, ll, structurePoints: points, notes,
  };
}
