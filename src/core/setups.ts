// LONG / SHORT specialist agents (deterministic).
// Each evaluates an explicit checklist and returns CANDIDATE only when the
// configured requirements are satisfied — with "missing" blockers for WAIT cards.
import type { DerivativesAnalysis, SetupEvaluation, TimeframeAnalysis } from '../types';

function check(pass: boolean, name: string, detail: string): { name: string; pass: boolean; detail: string } {
  return { name, pass, detail };
}

export function evaluateLongSetup(frames: TimeframeAnalysis[], derivatives: DerivativesAnalysis): SetupEvaluation {
  const exec = frames[frames.length - 1];
  const htfBullish = frames.slice(0, 2).filter((t) => t.bias === 'BULLISH').length;
  const emaOk = exec.indicators.emaTrend === 'BULLISH';
  const structBull = exec.structure.trend === 'BULLISH';
  const bosBull = frames.some((t) => t.structure.bos === 'BULLISH');
  const sweepLow = frames.some((t) => t.smc.liquiditySweep === 'LOW' || t.structure.choch === 'BULLISH');
  const discount = exec.smc.discount;
  const bullFvg = exec.smc.fvg.some((f) => f.type === 'BULLISH' && !f.mitigated);
  const bullOb = exec.smc.orderBlocks.some((o) => o.type === 'BULLISH' && !o.mitigated);
  const momOk = exec.indicators.rsi == null || (exec.indicators.rsi > 45 && exec.indicators.rsi < 70);
  const volOk = exec.indicators.volumeState === 'HIGH' || exec.indicators.volumeState === 'NORMAL';
  const fundOk = derivatives.fundingRate == null || derivatives.fundingRate <= 0.001;

  const checks = [
    check(htfBullish >= 1, 'Higher-TF context', htfBullish >= 1 ? `${htfBullish}/2 higher TFs bullish` : 'higher TFs not bullish'),
    check(structBull, 'Bullish structure', structBull ? 'execution structure bullish' : 'execution structure not bullish'),
    check(bosBull, 'Bullish BOS', bosBull ? 'bullish BOS printed' : 'Waiting for: bullish BOS confirmation'),
    check(sweepLow, 'Liquidity sweep / CHoCH', sweepLow ? 'sweep or bullish CHoCH present' : 'Waiting for: liquidity sweep of lows'),
    check(discount, 'Discount zone', discount ? 'price in discount' : 'not in discount — avoid mid/premium longs'),
    check(bullFvg || bullOb, 'Bullish POI', bullFvg || bullOb ? 'bullish FVG/OB present' : 'Waiting for: bullish FVG or order block'),
    check(emaOk, 'EMA alignment', emaOk ? 'EMA trend bullish' : 'EMA not aligned bullish'),
    check(momOk, 'Momentum confirmation', momOk ? `RSI ${exec.indicators.rsi?.toFixed(0) ?? 'n/a'} supports` : 'momentum stretched or bearish'),
    check(volOk, 'Volume confirmation', volOk ? `volume ${exec.indicators.volumeState.toLowerCase()}` : 'volume thin — confirmation weak'),
    check(fundOk, 'Derivatives context', fundOk ? 'funding not excessively long-crowded' : 'funding excessively positive — crowded longs'),
  ];
  const missing = checks.filter((c) => !c.pass).map((c) => c.detail);
  // LONG CANDIDATE requires structure + HTF + POI + EMA; the rest tighten quality.
  const candidate = structBull && htfBullish >= 1 && (bullFvg || bullOb) && emaOk && fundOk;
  return { side: 'LONG', candidate, checks, missing };
}

export function evaluateShortSetup(frames: TimeframeAnalysis[], derivatives: DerivativesAnalysis): SetupEvaluation {
  const exec = frames[frames.length - 1];
  const htfBearish = frames.slice(0, 2).filter((t) => t.bias === 'BEARISH').length;
  const emaOk = exec.indicators.emaTrend === 'BEARISH';
  const structBear = exec.structure.trend === 'BEARISH';
  const bosBear = frames.some((t) => t.structure.bos === 'BEARISH');
  const sweepHigh = frames.some((t) => t.smc.liquiditySweep === 'HIGH' || t.structure.choch === 'BEARISH');
  const premium = exec.smc.premium;
  const bearFvg = exec.smc.fvg.some((f) => f.type === 'BEARISH' && !f.mitigated);
  const bearOb = exec.smc.orderBlocks.some((o) => o.type === 'BEARISH' && !o.mitigated);
  const momOk = exec.indicators.rsi == null || (exec.indicators.rsi < 55 && exec.indicators.rsi > 30);
  const volOk = exec.indicators.volumeState === 'HIGH' || exec.indicators.volumeState === 'NORMAL';
  const fundOk = derivatives.fundingRate == null || derivatives.fundingRate >= -0.001;

  const checks = [
    check(htfBearish >= 1, 'Higher-TF context', htfBearish >= 1 ? `${htfBearish}/2 higher TFs bearish` : 'higher TFs not bearish'),
    check(structBear, 'Bearish structure', structBear ? 'execution structure bearish' : 'execution structure not bearish'),
    check(bosBear, 'Bearish BOS', bosBear ? 'bearish BOS printed' : 'Waiting for: bearish BOS confirmation'),
    check(sweepHigh, 'Liquidity sweep / CHoCH', sweepHigh ? 'sweep or bearish CHoCH present' : 'Waiting for: liquidity sweep of highs'),
    check(premium, 'Premium zone', premium ? 'price in premium' : 'not in premium — avoid mid/discount shorts'),
    check(bearFvg || bearOb, 'Bearish POI', bearFvg || bearOb ? 'bearish FVG/OB present' : 'Waiting for: bearish FVG or order block'),
    check(emaOk, 'EMA alignment', emaOk ? 'EMA trend bearish' : 'EMA not aligned bearish'),
    check(momOk, 'Momentum confirmation', momOk ? `RSI ${exec.indicators.rsi?.toFixed(0) ?? 'n/a'} supports` : 'momentum stretched or bullish'),
    check(volOk, 'Volume confirmation', volOk ? `volume ${exec.indicators.volumeState.toLowerCase()}` : 'volume thin — confirmation weak'),
    check(fundOk, 'Derivatives context', fundOk ? 'funding not excessively short-crowded' : 'funding excessively negative — crowded shorts'),
  ];
  const missing = checks.filter((c) => !c.pass).map((c) => c.detail);
  const candidate = structBear && htfBearish >= 1 && (bearFvg || bearOb) && emaOk && fundOk;
  return { side: 'SHORT', candidate, checks, missing };
}
