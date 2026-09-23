// Setup-quality scoring: transparent weighted model over deterministic components.
// Weights live in APP_CONFIG (configurable). Never hidden inside an LLM.
// setupQuality 0-100 measures setup quality — NOT profit probability.
import type { ComponentScores, ConfluenceResult, DerivativesAnalysis, RiskAnalysis, TimeframeAnalysis } from '../types';
import { APP_CONFIG } from '../config/app';

export const QUALITY_WEIGHTS: Record<keyof ComponentScores, number> = {
  trend: 1.4,
  mtf: 1.6,
  structure: 1.4,
  momentum: 1.0,
  volume: 0.8,
  smc: 1.2,
  ict: 0.6,
  liquidity: 1.0,
  derivatives: 0.8,
  risk: 1.2,
};

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function biasScore(bias: string, direction: 'LONG' | 'SHORT' | 'WAIT'): number {
  if (direction === 'WAIT') return 50;
  const want = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
  if (bias === want) return 95;
  if (bias === 'NEUTRAL') return 45;
  return 10;
}

export function scoreComponents(params: {
  direction: 'LONG' | 'SHORT' | 'WAIT';
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  derivatives: DerivativesAnalysis;
  risk: RiskAnalysis | null;
}): ComponentScores {
  const { direction, timeframes, confluence, derivatives, risk } = params;
  const exec = timeframes[timeframes.length - 1];
  const htf = timeframes.slice(0, 2);

  const trendVotes = timeframes.map((t) => biasScore(t.bias, direction));
  const trend = trendVotes.length ? trendVotes.reduce((a, b) => a + b, 0) / trendVotes.length : 50;

  const htfAgree = htf.filter((t) => biasScore(t.bias, direction) >= 90).length;
  const execAgree = exec ? biasScore(exec.bias, direction) : 50;
  const mtf = direction === 'WAIT' ? 50 : clamp100((htfAgree / Math.max(1, htf.length)) * 70 + execAgree * 0.3);

  const bosChoch = timeframes.some((t) =>
    direction === 'LONG'
      ? t.structure.bos === 'BULLISH' || t.structure.choch === 'BULLISH'
      : direction === 'SHORT'
        ? t.structure.bos === 'BEARISH' || t.structure.choch === 'BEARISH'
        : false,
  );
  const structure = direction === 'WAIT' ? 50 : clamp100(40 + (bosChoch ? 35 : 0) + (exec && exec.structure.trend !== 'NEUTRAL' && biasScore(exec.structure.trend, direction) >= 90 ? 20 : 0));

  const rsi = exec?.indicators.rsi;
  let momentum = 50;
  if (direction === 'LONG') momentum = rsi == null ? 50 : rsi >= 70 ? 35 : rsi >= 55 ? 80 : rsi >= 45 ? 55 : 25;
  else if (direction === 'SHORT') momentum = rsi == null ? 50 : rsi <= 30 ? 35 : rsi <= 45 ? 80 : rsi <= 55 ? 55 : 25;

  const vr = exec?.indicators.volumeRatio;
  const volume = vr == null ? 50 : vr >= 1.5 ? 85 : vr >= 1.0 ? 65 : vr >= 0.6 ? 45 : 25;

  const smcPts = exec?.smc.points ?? 0;
  const smc = direction === 'WAIT' ? 50 : clamp100(50 + (direction === 'LONG' ? smcPts : -smcPts) * 12 + (exec?.smc.swept ? 8 : 0));

  const ict = exec ? (exec.ict.reliable ? clamp100(55 + exec.ict.points * 10) : 50) : 50;

  const liq = exec ? clamp100(50 + (exec.smc.swept ? 20 : 0) + ((exec.smc.fvg.length > 0 || exec.smc.orderBlocks.length > 0) ? 10 : 0)) : 50;

  let derivativesScore = 60;
  if (derivatives.fundingRate != null && Math.abs(derivatives.fundingRate) > 0.001) derivativesScore -= 20;
  if (derivatives.openInterest != null && derivatives.openInterest > 0) derivativesScore += 10;
  if (derivatives.unavailable.length >= 3) derivativesScore = 50;

  let riskScore = 50;
  if (risk && risk.valid) riskScore = clamp100(55 + Math.min(30, (risk.riskReward - 1) * 20) - risk.warnings.length * 5);

  return {
    trend: clamp100(trend), mtf: clamp100(mtf), structure: clamp100(structure),
    momentum: clamp100(momentum), volume: clamp100(volume), smc: clamp100(smc),
    ict: clamp100(ict), liquidity: clamp100(liq),
    derivatives: clamp100(derivativesScore), risk: clamp100(riskScore),
  };
}

export function setupQualityFromScores(scores: ComponentScores, weights: Record<keyof ComponentScores, number> = QUALITY_WEIGHTS): number {
  let num = 0;
  let den = 0;
  (Object.keys(weights) as (keyof ComponentScores)[]).forEach((k) => {
    num += scores[k] * weights[k];
    den += weights[k];
  });
  return den > 0 ? Math.round((num / den) * 10) / 10 : 0;
}

/** Blend deterministic confluence with component quality (transparent, configurable). */
export function setupQuality(params: {
  direction: 'LONG' | 'SHORT' | 'WAIT';
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  derivatives: DerivativesAnalysis;
  risk: RiskAnalysis | null;
}): { quality: number; scores: ComponentScores } {
  const scores = scoreComponents(params);
  const weighted = setupQualityFromScores(scores);
  // Anchor at confluence (the engine's setup read) blended with component detail.
  const blend = APP_CONFIG.qualityConfluenceWeight;
  const quality = Math.round((params.confluence.total * blend + weighted * (1 - blend)) * 10) / 10;
  return { quality, scores };
}
