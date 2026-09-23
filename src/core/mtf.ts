// Multi-timeframe engine: bias per timeframe, higher-TF vs execution-TF agreement.
import type { Candle, MarketRegime, TimeframeAnalysis, TrendDirection } from '../types';
import { TIMEFRAMES } from '../config/app';
import { buildIndicatorSnapshot } from './indicators';
import { analyzeStructure } from './structure';
import { analyzeICT, analyzeSMC } from './smc';

export function biasOf(indTrend: TrendDirection, structPoints: number, smcPoints: number): TrendDirection {
  const votes =
    (indTrend === 'BULLISH' ? 1 : indTrend === 'BEARISH' ? -1 : 0) +
    Math.sign(structPoints) +
    Math.sign(smcPoints);
  if (votes >= 2) return 'BULLISH';
  if (votes <= -2) return 'BEARISH';
  return 'NEUTRAL';
}

export function analyzeTimeframe(timeframe: string, candles: Candle[]): TimeframeAnalysis {
  const role = TIMEFRAMES.find((t) => t.id === timeframe)?.role ?? 'SETUP';
  const price = candles.length ? candles[candles.length - 1].close : NaN;
  const indicators = buildIndicatorSnapshot(candles);
  const structure = analyzeStructure(candles);
  const smc = analyzeSMC(candles);
  const ict = analyzeICT(candles);
  const bias = biasOf(indicators.emaTrend, structure.structurePoints, smc.points);
  const notes: string[] = [
    `EMA trend ${indicators.emaTrend}`,
    `RSI ${indicators.rsi != null ? indicators.rsi.toFixed(1) : 'n/a'} (${indicators.rsiState})`,
    `Structure ${structure.trend}`,
    ...structure.notes.slice(0, 2),
    ...smc.notes.slice(0, 2),
  ];
  return { timeframe, role, price, indicators, structure, smc, ict, bias, notes };
}

export function higherTimeframeBias(frames: TimeframeAnalysis[]): TrendDirection {
  const majors = frames.filter((f) => f.role === 'MACRO' || f.role === 'STRUCTURE');
  const pool = majors.length ? majors : frames.slice(0, 2);
  const votes = pool.reduce((a, f) => a + (f.bias === 'BULLISH' ? 1 : f.bias === 'BEARISH' ? -1 : 0), 0);
  if (votes > 0) return 'BULLISH';
  if (votes < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function executionBias(frames: TimeframeAnalysis[], executionTf: string): TrendDirection {
  const f = frames.find((x) => x.timeframe === executionTf) ?? frames[frames.length - 1];
  return f?.bias ?? 'NEUTRAL';
}

export function detectRegime(frames: TimeframeAnalysis[]): MarketRegime {
  const htf = higherTimeframeBias(frames);
  const exec = frames[frames.length - 1]?.bias ?? 'NEUTRAL';
  const vols = frames.map((f) => f.indicators.atrPercent ?? 0);
  const avgVol = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
  const anyBos = frames.some((f) => f.structure.bos);
  const anyChoch = frames.some((f) => f.structure.choch);

  if (avgVol > 2.5) return 'HIGH_VOLATILITY';
  if (htf === 'BULLISH' && exec === 'BULLISH') return anyBos ? 'BREAKOUT' : 'TRENDING_BULLISH';
  if (htf === 'BEARISH' && exec === 'BEARISH') return anyBos ? 'BREAKDOWN' : 'TRENDING_BEARISH';
  if (htf === 'BULLISH' && exec !== 'BULLISH') return 'BULLISH_PULLBACK';
  if (htf === 'BEARISH' && exec !== 'BEARISH') return 'BEARISH_PULLBACK';
  if (anyChoch) return 'UNCLEAR';
  if (htf === 'NEUTRAL' && exec === 'NEUTRAL' && avgVol < 0.6) return 'LOW_VOLATILITY';
  if (htf === 'NEUTRAL' || exec === 'NEUTRAL') return 'RANGE';
  return 'UNCLEAR';
}

export function timeframeConflict(frames: TimeframeAnalysis[]): boolean {
  const htf = higherTimeframeBias(frames);
  const exec = frames[frames.length - 1]?.bias ?? 'NEUTRAL';
  return (
    (htf === 'BULLISH' && exec === 'BEARISH') ||
    (htf === 'BEARISH' && exec === 'BULLISH')
  );
}
