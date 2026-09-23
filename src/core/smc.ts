// SMC + ICT engines: liquidity sweeps (ATR-gated), FVG, order blocks,
// premium/discount dealing range, displacement. Never confirm without data.
import type { Candle, FVG, ICTAnalysis, LiquidityAnalysis, OrderBlock, SMCAnalysis } from '../types';
import { atr } from './indicators';

export function analyzeLiquidity(candles: Candle[]): LiquidityAnalysis {
  const notes: string[] = [];
  if (candles.length < 20) {
    return {
      equalHighs: false, equalLows: false, sweepHigh: false, sweepLow: false,
      nearestLiquidityAbove: null, nearestLiquidityBelow: null, notes: ['Insufficient data for liquidity'],
    };
  }
  const atrArr = atr(candles, 14);
  const a = atrArr[atrArr.length - 1] ?? 0;
  const lookback = candles.slice(-30, -1);
  const live = candles[candles.length - 1];

  const recentHigh = Math.max(...lookback.map((c) => c.high));
  const recentLow = Math.min(...lookback.map((c) => c.low));

  // Equal highs/lows: two highs within 0.1*ATR
  const tol = a * 0.15;
  const highs = lookback.map((c) => c.high);
  const lows = lookback.map((c) => c.low);
  let equalHighs = false;
  let equalLows = false;
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i] - highs[j]) <= tol) equalHighs = true;
      if (Math.abs(lows[i] - lows[j]) <= tol) equalLows = true;
    }
  }

  // Sweep = wick beyond level + close back inside (ATR-gated: poke must exceed 0.2 ATR to count)
  const minPoke = a * 0.2;
  const sweepHigh = live.high > recentHigh + minPoke && live.close < recentHigh;
  const sweepLow = live.low < recentLow - minPoke && live.close > recentLow;
  if (equalHighs) notes.push('Equal highs — buy-side liquidity resting above');
  if (equalLows) notes.push('Equal lows — sell-side liquidity resting below');
  if (sweepHigh) notes.push('Liquidity sweep of highs (wick + reclaim)');
  if (sweepLow) notes.push('Liquidity sweep of lows (wick + reclaim)');

  return {
    equalHighs, equalLows, sweepHigh, sweepLow,
    nearestLiquidityAbove: recentHigh, nearestLiquidityBelow: recentLow, notes,
  };
}

export function detectFVG(candles: Candle[], maxAge = 30): FVG[] {
  const out: FVG[] = [];
  const start = Math.max(1, candles.length - maxAge);
  for (let i = start; i < candles.length - 1; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    const c = candles[i + 1];
    // Bullish FVG: low[i+1] > high[i-1]
    if (c.low > a.high) {
      const mitigated = candles.slice(i + 2).some((k) => k.low <= (c.low + a.high) / 2);
      out.push({ type: 'BULLISH', top: c.low, bottom: a.high, mitigated, index: i });
    }
    // Bearish FVG: high[i+1] < low[i-1]
    if (c.high < a.low) {
      const mitigated = candles.slice(i + 2).some((k) => k.high >= (c.high + a.low) / 2);
      out.push({ type: 'BEARISH', top: a.low, bottom: c.high, mitigated, index: i });
    }
  }
  return out.slice(-5);
}

export function detectOrderBlocks(candles: Candle[]): OrderBlock[] {
  const out: OrderBlock[] = [];
  if (candles.length < 6) return out;
  // Order block = last opposite candle before a displacement move (body > 1.2 * ATR-ish proxy: 1.5x avg body)
  const bodies = candles.slice(-40, -1).map((c) => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((x, y) => x + y, 0) / Math.max(1, bodies.length);
  for (let i = Math.max(1, candles.length - 30); i < candles.length - 1; i++) {
    const body = Math.abs(candles[i + 1].close - candles[i + 1].open);
    if (avgBody > 0 && body > avgBody * 1.8) {
      const dir = candles[i + 1].close > candles[i + 1].open ? 'BULLISH' : 'BEARISH';
      const ob = candles[i];
      const mitigated =
        dir === 'BULLISH'
          ? candles.slice(i + 2).some((k) => k.low < ob.low)
          : candles.slice(i + 2).some((k) => k.high > ob.high);
      if (
        (dir === 'BULLISH' && ob.close < ob.open) ||
        (dir === 'BEARISH' && ob.close > ob.open)
      ) {
        out.push({ type: dir, top: ob.high, bottom: ob.low, index: i, mitigated });
      }
    }
  }
  return out.slice(-3);
}

export function analyzeSMC(candles: Candle[]): SMCAnalysis {
  const notes: string[] = [];
  if (candles.length < 30) {
    return {
      liquiditySweep: null, swept: false, fvg: [], orderBlocks: [],
      premium: false, discount: false, equilibrium: null, displacement: null,
      points: 0, notes: ['Insufficient data — SMC unconfirmed'],
    };
  }
  const liq = analyzeLiquidity(candles);
  const fvg = detectFVG(candles);
  const orderBlocks = detectOrderBlocks(candles);

  const range = candles.slice(-50);
  const rangeHigh = Math.max(...range.map((c) => c.high));
  const rangeLow = Math.min(...range.map((c) => c.low));
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const price = candles[candles.length - 1].close;
  const premium = price > equilibrium + (rangeHigh - rangeLow) * 0.05;
  const discount = price < equilibrium - (rangeHigh - rangeLow) * 0.05;

  // Displacement: last closed body > 1.8x average body
  const bodies = candles.slice(-30, -1).map((c) => Math.abs(c.close - c.open));
  const avg = bodies.reduce((a, b) => a + b, 0) / Math.max(1, bodies.length);
  const lastBody = Math.abs(candles[candles.length - 2].close - candles[candles.length - 2].open);
  const prev = candles[candles.length - 2];
  let displacement: SMCAnalysis['displacement'] = null;
  if (avg > 0 && lastBody > avg * 1.8) {
    displacement = prev.close > prev.open ? 'BULLISH' : 'BEARISH';
    notes.push(`${displacement === 'BULLISH' ? 'Bullish' : 'Bearish'} displacement (expansive body)`);
  }

  const liquiditySweep = liq.sweepHigh ? 'HIGH' : liq.sweepLow ? 'LOW' : null;
  if (liquiditySweep) notes.push(`Liquidity sweep of ${liquiditySweep === 'HIGH' ? 'highs' : 'lows'}`);
  const liveFvgBull = fvg.filter((f) => !f.mitigated && f.type === 'BULLISH').length;
  const liveFvgBear = fvg.filter((f) => !f.mitigated && f.type === 'BEARISH').length;
  if (liveFvgBull) notes.push(`${liveFvgBull} unmitigated bullish FVG`);
  if (liveFvgBear) notes.push(`${liveFvgBear} unmitigated bearish FVG`);
  const liveObBull = orderBlocks.filter((o) => !o.mitigated && o.type === 'BULLISH').length;
  const liveObBear = orderBlocks.filter((o) => !o.mitigated && o.type === 'BEARISH').length;
  if (liveObBull) notes.push(`${liveObBull} unmitigated bullish order block`);
  if (liveObBear) notes.push(`${liveObBear} unmitigated bearish order block`);
  if (premium) notes.push('Price in PREMIUM (above equilibrium) — longs less favorable');
  if (discount) notes.push('Price in DISCOUNT (below equilibrium) — shorts less favorable');

  let points = 0;
  if (liquiditySweep === 'LOW') points += 1;
  if (liquiditySweep === 'HIGH') points -= 1;
  if (liveFvgBull) points += 1;
  if (liveFvgBear) points -= 1;
  if (liveObBull) points += 1;
  if (liveObBear) points -= 1;
  if (displacement === 'BULLISH') points += 1;
  if (displacement === 'BEARISH') points -= 1;

  return {
    liquiditySweep, swept: liquiditySweep != null, fvg, orderBlocks,
    premium, discount, equilibrium, displacement, points, notes,
  };
}

export function analyzeICT(candles: Candle[]): ICTAnalysis {
  const notes: string[] = [];
  if (candles.length < 50) {
    return {
      dealingRangeHigh: null, dealingRangeLow: null, premiumZone: false, discountZone: false,
      judasSwing: null, marketMakerModel: 'UNCLEAR', sessionBias: 'Unknown — session data unavailable',
      points: 0, notes: ['Insufficient data — ICT unconfirmed'], reliable: false,
    };
  }
  const range = candles.slice(-50);
  const dealingRangeHigh = Math.max(...range.map((c) => c.high));
  const dealingRangeLow = Math.min(...range.map((c) => c.low));
  const eq = (dealingRangeHigh + dealingRangeLow) / 2;
  const price = candles[candles.length - 1].close;
  const premiumZone = price > eq;
  const discountZone = price < eq;

  // Judas swing: sweep of session-ish range (use 20-bar range) with reclaim
  const liq = analyzeLiquidity(candles);
  const judasSwing = liq.sweepHigh ? 'HIGH' : liq.sweepLow ? 'LOW' : null;
  if (judasSwing) notes.push(`Judas swing ${judasSwing === 'HIGH' ? 'above highs' : 'below lows'} (manipulation signature)`);

  let marketMakerModel: ICTAnalysis['marketMakerModel'] = 'UNCLEAR';
  if (judasSwing && premiumZone === false && discountZone === true) marketMakerModel = 'ACCUMULATION';
  else if (judasSwing) marketMakerModel = 'MANIPULATION';
  else if (!judasSwing && Math.abs(price - eq) / (dealingRangeHigh - dealingRangeLow || 1) < 0.1) marketMakerModel = 'ACCUMULATION';

  let points = 0;
  if (discountZone) points += 1;
  if (premiumZone) points -= 1;
  if (judasSwing === 'LOW') points += 1;
  if (judasSwing === 'HIGH') points -= 1;

  notes.push(premiumZone ? 'Price in premium array' : discountZone ? 'Price in discount array' : 'Price at equilibrium');
  return {
    dealingRangeHigh, dealingRangeLow, premiumZone, discountZone, judasSwing,
    marketMakerModel, sessionBias: 'Session timing unavailable from candle data — bias from structure only',
    points, notes, reliable: true,
  };
}
