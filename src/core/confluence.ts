// Confluence engine: 6 blocks, 0-100. Direction needs cross-block agreement.
import type { ConfluenceItem, ConfluenceResult, DerivativesAnalysis, TimeframeAnalysis, TrendDirection } from '../types';

function dirScore(votes: number): TrendDirection {
  if (votes >= 2) return 'BULLISH';
  if (votes <= -2) return 'BEARISH';
  return 'NEUTRAL';
}

export function computeConfluence(frames: TimeframeAnalysis[], derivatives: DerivativesAnalysis): ConfluenceResult {
  const exec = frames[frames.length - 1];
  const supportingReasons: string[] = [];
  const opposingReasons: string[] = [];
  const items: ConfluenceItem[] = [];

  // SMC 30
  const smcVotes = frames.reduce((a, f) => a + Math.sign(f.smc.points), 0);
  const smcDir = dirScore(smcVotes);
  const smcScore = Math.min(30, Math.abs(smcVotes) * 8 + (exec.smc.swept ? 6 : 0) + (exec.smc.displacement ? 4 : 0));
  items.push({
    block: 'SMC', score: smcScore, max: 30, direction: smcDir,
    reasons: exec.smc.notes.slice(0, 4),
  });

  // TREND 20
  const trendVotes = frames.reduce(
    (a, f) => a + (f.indicators.emaTrend === 'BULLISH' ? 1 : f.indicators.emaTrend === 'BEARISH' ? -1 : 0), 0,
  );
  const trendDir = dirScore(trendVotes);
  const trendScore = Math.min(20, Math.abs(trendVotes) * 6 + (exec.indicators.priceAboveEma20 && exec.indicators.priceAboveEma50 ? 4 : 0));
  items.push({ block: 'TREND', score: trendScore, max: 20, direction: trendDir, reasons: [`EMA trend ${exec.indicators.emaTrend}`] });

  // MOMENTUM 15
  const rsi = exec.indicators.rsi;
  let momScore = 5;
  let momDir: TrendDirection = 'NEUTRAL';
  if (exec.indicators.rsiState === 'BULLISH') { momScore = 11; momDir = 'BULLISH'; }
  else if (exec.indicators.rsiState === 'BEARISH') { momScore = 11; momDir = 'BEARISH'; }
  else if (exec.indicators.rsiState === 'OVERBOUGHT') { momScore = 6; momDir = 'BULLISH'; opposingReasons.push('RSI overbought — chase risk'); }
  else if (exec.indicators.rsiState === 'OVERSOLD') { momScore = 6; momDir = 'BEARISH'; opposingReasons.push('RSI oversold — bounce risk for shorts'); }
  if (exec.indicators.volumeState === 'HIGH') { momScore += 4; supportingReasons.push('Volume confirmation (high)'); }
  if (exec.indicators.volumeState === 'LOW') { momScore -= 2; opposingReasons.push('Weak volume confirmation'); }
  momScore = Math.max(0, Math.min(15, momScore));
  items.push({ block: 'MOMENTUM', score: momScore, max: 15, direction: momDir, reasons: [`RSI ${rsi != null ? rsi.toFixed(1) : 'n/a'} (${exec.indicators.rsiState}), volume ${exec.indicators.volumeState}`] });

  // STRUCTURE 15
  const structVotes = frames.reduce((a, f) => a + Math.sign(f.structure.structurePoints), 0);
  const structDir = dirScore(structVotes);
  const structScore = Math.min(15, Math.abs(structVotes) * 5 + (exec.structure.bos ? 4 : 0) + (exec.structure.choch ? 2 : 0));
  items.push({ block: 'STRUCTURE', score: structScore, max: 15, direction: structDir, reasons: exec.structure.notes.slice(0, 3) });

  // CONDITIONS 10
  const atrp = exec.indicators.atrPercent ?? 1;
  const condScore = atrp > 3 ? 3 : atrp < 0.3 ? 4 : 8;
  if (atrp > 3) opposingReasons.push('Very high volatility — wide stops needed');
  items.push({ block: 'CONDITIONS', score: condScore, max: 10, direction: 'NEUTRAL', reasons: [`ATR ${atrp.toFixed(2)}%`] });

  // DERIVATIVES 10
  let derScore = 5;
  const derDir = derivatives.bias;
  if (derivatives.fundingRate != null && Math.abs(derivatives.fundingRate) > 0.001) {
    opposingReasons.push(`Elevated funding (${(derivatives.fundingRate * 100).toFixed(3)}%) — crowded positioning risk`);
    derScore = 3;
  } else if (derivatives.fundingRate != null) {
    derScore = 7;
  }
  items.push({ block: 'DERIVATIVES', score: derScore, max: 10, direction: derDir, reasons: derivatives.notes.slice(0, 3) });

  const total = items.reduce((a, i) => a + i.score, 0);

  // Direction requires cross-block agreement (at least 3 of 4 directional blocks agree)
  const dirs = [smcDir, trendDir, momDir, structDir].filter((d) => d !== 'NEUTRAL');
  const bulls = dirs.filter((d) => d === 'BULLISH').length;
  const bears = dirs.filter((d) => d === 'BEARISH').length;
  let direction: TrendDirection = 'NEUTRAL';
  if (bulls >= 3) direction = 'BULLISH';
  else if (bears >= 3) direction = 'BEARISH';

  for (const it of items) {
    if (it.direction !== 'NEUTRAL' && it.direction === direction) supportingReasons.push(`${it.block}: ${it.reasons[0] ?? ''}`.trim());
    else if (it.direction !== 'NEUTRAL' && direction !== 'NEUTRAL') opposingReasons.push(`${it.block} disagrees (${it.direction})`);
  }

  const band = total >= 90 ? 'VERY_STRONG' : total >= 75 ? 'STRONG' : total >= 60 ? 'MODERATE' : total >= 40 ? 'DEVELOPING' : 'WEAK';

  return { total, band, direction, items, supportingReasons: supportingReasons.slice(0, 8), opposingReasons: opposingReasons.slice(0, 8) };
}
