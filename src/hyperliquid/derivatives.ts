// HyperliquidDerivatives + HyperliquidContext.
// Distinguishes underlying market behavior from Hyperliquid perp behavior.
// Never auto-labels positive funding as bullish/bearish — context decides.
import type {
  DerivativesAnalysis,
  HyperliquidContext,
  HyperliquidMarket,
  TrendDirection,
} from '../types';

export function derivativesFromMarket(m: HyperliquidMarket | undefined): DerivativesAnalysis {
  if (!m?.ctx) {
    return {
      fundingRate: null,
      openInterest: null,
      longShortRatio: null,
      basis: null,
      markPrice: null,
      oraclePrice: null,
      premium: null,
      dayVolumeNotional: null,
      unavailable: ['funding', 'open interest', 'mark price', 'premium'],
      bias: 'NEUTRAL',
      notes: ['Hyperliquid derivatives context unavailable'],
    };
  }
  const c = m.ctx;
  const basis =
    c.markPx != null && c.oraclePx != null && c.oraclePx !== 0
      ? ((c.markPx - c.oraclePx) / c.oraclePx) * 100
      : null;
  const unavailable: string[] = [];
  if (c.funding == null) unavailable.push('funding');
  if (c.openInterest == null) unavailable.push('open interest');
  unavailable.push('long/short ratio', 'liquidations');
  const notes: string[] = [];
  if (c.funding != null) notes.push(`Funding ${(c.funding * 100).toFixed(4)}%/hr`);
  if (c.openInterest != null) notes.push(`OI ${c.openInterest}`);
  if (c.dayNtlVlm != null) notes.push(`Day notional $${Math.round(c.dayNtlVlm).toLocaleString()}`);
  if (basis != null) notes.push(`Basis ${basis.toFixed(3)}%`);
  if (c.premium != null) notes.push(`Premium ${(c.premium * 100).toFixed(3)}%`);
  return {
    fundingRate: c.funding,
    openInterest: c.openInterest,
    longShortRatio: null,
    basis,
    markPrice: c.markPx,
    oraclePrice: c.oraclePx,
    premium: c.premium,
    dayVolumeNotional: c.dayNtlVlm,
    unavailable,
    bias: 'NEUTRAL', // funding bias is contextual, resolved in HyperliquidContext
    notes: notes.length ? notes : ['Derivatives data pending'],
  };
}

export function buildHyperliquidContext(
  market: HyperliquidMarket | undefined,
  underlyingTrend: TrendDirection,
  prevOpenInterest: number | null | undefined,
): HyperliquidContext {
  const d = derivativesFromMarket(market);
  const oi = d.openInterest;
  let openInterestTrend: HyperliquidContext['openInterestTrend'] = 'UNKNOWN';
  if (oi != null && prevOpenInterest != null) {
    const chg = prevOpenInterest !== 0 ? (oi - prevOpenInterest) / Math.abs(prevOpenInterest) : 0;
    openInterestTrend = chg > 0.02 ? 'RISING' : chg < -0.02 ? 'FALLING' : 'FLAT';
  } else if (oi != null) {
    openInterestTrend = 'FLAT';
  }

  const f = d.fundingRate;
  const fundingState: HyperliquidContext['fundingState'] =
    f == null ? 'UNKNOWN' : f > 0.0005 ? 'ELEVATED_LONG' : f < -0.0005 ? 'ELEVATED_SHORT' : 'NEUTRAL';

  const p = d.premium;
  const premiumState: HyperliquidContext['premiumState'] =
    p == null ? 'UNKNOWN' : p > 0.0005 ? 'PREMIUM' : p < -0.0005 ? 'DISCOUNT' : 'FLAT';

  const crowdingRisk =
    openInterestTrend === 'RISING' &&
    (fundingState === 'ELEVATED_LONG' || fundingState === 'ELEVATED_SHORT');

  let perpBias: HyperliquidContext['perpBias'] = 'NEUTRAL';
  // Contextual only: elevated long funding + rising OI into resistance = crowded longs (caution),
  // not an automatic fade. Surface as NEUTRAL with interpretation.
  void perpBias;

  const parts: string[] = [];
  parts.push(`Underlying trend: ${underlyingTrend.toLowerCase()}`);
  if (openInterestTrend !== 'UNKNOWN') parts.push(`Hyperliquid OI ${openInterestTrend.toLowerCase()}`);
  if (fundingState !== 'UNKNOWN') {
    parts.push(
      fundingState === 'NEUTRAL'
        ? 'funding neutral'
        : fundingState === 'ELEVATED_LONG'
          ? 'funding elevated (longs pay)'
          : 'funding negative (shorts pay)',
    );
  }
  if (crowdingRisk) parts.push('crowding risk may be increasing');
  if (!market?.ctx) parts.push('derivatives context unavailable');

  return {
    underlyingTrend,
    perpBias: 'NEUTRAL',
    openInterestTrend,
    fundingState,
    premiumState,
    crowdingRisk,
    interpretation: parts.join('. ') + '.',
    unavailable: d.unavailable,
  };
}
