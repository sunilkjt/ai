// Asset-aware analyzers. Shared core: MarketStructure, Trend, Momentum,
// Liquidity, SMC, ICT, Risk. Asset-specific overlays add independent insight.
// Each analyzer returns short, factual insight strings (no invented data).
import type { AssetCategory, DerivativesAnalysis, TimeframeAnalysis } from '../types';

export interface AssetAnalyzerInput {
  category: AssetCategory;
  displaySymbol: string;
  timeframes: TimeframeAnalysis[];
  derivatives: DerivativesAnalysis;
}

function exec(frames: TimeframeAnalysis[]): TimeframeAnalysis | undefined {
  return frames.find((f) => f.role === 'CONFIRMATION') ?? frames[frames.length - 1];
}

function baseInsights(input: AssetAnalyzerInput): string[] {
  const e = exec(input.timeframes);
  if (!e) return [];
  const out: string[] = [];
  out.push(`Structure ${e.structure.trend} · EMA ${e.indicators.emaTrend} · RSI ${e.indicators.rsi != null ? e.indicators.rsi.toFixed(0) : 'n/a'} (${e.indicators.rsiState})`);
  if (e.smc.swept) out.push(`Liquidity sweep ${e.smc.liquiditySweep ?? ''} — watch for displacement follow-through`.trim());
  if (e.smc.fvg.length) out.push(`${e.smc.fvg.length} fair value gap(s) active near execution TF`);
  return out;
}

export function analyzeStock(input: AssetAnalyzerInput): string[] {
  const out = baseInsights(input);
  const e = exec(input.timeframes);
  if (e) {
    const v = e.indicators.volumeState;
    out.push(
      v === 'HIGH'
        ? 'Equity perp volume elevated vs average — participation confirms the move'
        : v === 'LOW'
          ? 'Equity perp volume thin — breakouts need confirmation, gaps may fill'
          : 'Equity perp volume normal',
    );
    if (e.indicators.atrPercent != null && e.indicators.atrPercent > 2) {
      out.push('Volatility elevated for a single equity — reduce size, widen invalidation');
    }
    out.push('Session behavior: equity perps trade 24/7 on Hyperliquid — overnight gaps reflect underlying session open dynamics');
  }
  if (input.derivatives.openInterest != null) out.push(`Open interest ${input.derivatives.openInterest} — rising OI with trend suggests participation`);
  return out;
}

export function analyzeCommodity(input: AssetAnalyzerInput): string[] {
  const out = baseInsights(input);
  out.push('Commodity lens: trend persistence + volatility regime matter more than intraday noise');
  const e = exec(input.timeframes);
  if (e?.indicators.atrPercent != null) {
    out.push(
      e.indicators.atrPercent > 1.5
        ? 'Commodity volatility elevated — use wider stops, smaller size'
        : 'Commodity volatility contained — structure levels more reliable',
    );
  }
  if (input.derivatives.premium != null) {
    out.push(input.derivatives.premium > 0 ? 'Perp trading at premium to oracle — long crowding possible' : 'Perp at discount to oracle — weak perp demand');
  }
  out.push('Liquidity: equal highs/lows and session sweeps are high-value on metals/energy');
  return out;
}

export function analyzeIndex(input: AssetAnalyzerInput): string[] {
  const out = baseInsights(input);
  out.push('Index lens: breadth-driven — single-TF breaks fail often in range regimes');
  const e = exec(input.timeframes);
  if (e && (e.structure.bos || e.structure.choch)) {
    out.push(`Index structure event: ${e.structure.bos ? `BOS ${e.structure.bos}` : ''} ${e.structure.choch ? `CHoCH ${e.structure.choch}` : ''}`.trim());
  }
  if (input.derivatives.dayVolumeNotional != null) {
    out.push(`Day notional $${Math.round(input.derivatives.dayVolumeNotional).toLocaleString()} — confirms participation`);
  }
  return out;
}

export function analyzeForex(input: AssetAnalyzerInput): string[] {
  const out = baseInsights(input);
  out.push('FX lens: trend + session liquidity — momentum fades at range extremes');
  const e = exec(input.timeframes);
  if (e) {
    if (e.indicators.rsiState === 'OVERBOUGHT' || e.indicators.rsiState === 'OVERSOLD') {
      out.push(`FX momentum stretched (${e.indicators.rsiState.toLowerCase()}) — wait for structure, not the oscillator`);
    }
    if (e.structure.trend === 'NEUTRAL') out.push('FX range — fade premium/discount edges, avoid mid-range entries');
  }
  return out;
}

export function analyzeCrypto(input: AssetAnalyzerInput): string[] {
  const out = baseInsights(input);
  const d = input.derivatives;
  if (d.fundingRate != null) {
    out.push(
      d.fundingRate > 0.0005
        ? 'Funding elevated positive — crowded longs, upside chases are risky'
        : d.fundingRate < -0.0005
          ? 'Funding negative — crowded shorts, downside chases are risky'
          : 'Funding neutral — no perp crowding signal',
    );
  }
  if (d.openInterest != null) out.push(`Crypto OI ${d.openInterest} — OI rising faster than price warns of leverage-driven moves`);
  out.push('Crypto lens: liquidations + funding + OI decide whether structure holds');
  return out;
}

export function analyzeAsset(input: AssetAnalyzerInput): string[] {
  switch (input.category) {
    case 'STOCK': return analyzeStock(input);
    case 'COMMODITY': return analyzeCommodity(input);
    case 'INDEX': return analyzeIndex(input);
    case 'FOREX': return analyzeForex(input);
    case 'CRYPTO': return analyzeCrypto(input);
    default: return baseInsights(input);
  }
}
