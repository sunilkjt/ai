import type { AssetCategory, TimeframeConfig } from '../types';

// Execution mapping: 1D macro → 4H structure → 1H setup → 15M confirmation → 5M entry → 1M execution.
// Hyperliquid candle intervals: 1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d,3d,1w,1M
export const TIMEFRAMES: TimeframeConfig[] = [
  { id: '1D', minutes: 1440, role: 'MACRO', label: 'Macro trend', hlInterval: '1d' },
  { id: '4H', minutes: 240, role: 'STRUCTURE', label: 'Primary structure', hlInterval: '4h' },
  { id: '1H', minutes: 60, role: 'SETUP', label: 'Setup', hlInterval: '1h' },
  { id: '15m', minutes: 15, role: 'CONFIRMATION', label: 'Confirmation', hlInterval: '15m' },
  { id: '5m', minutes: 5, role: 'ENTRY', label: 'Entry', hlInterval: '5m' },
  { id: '1m', minutes: 1, role: 'EXECUTION', label: 'Optional execution', hlInterval: '1m' },
];

export function hlIntervalFor(timeframe: string): string {
  return TIMEFRAMES.find((t) => t.id === timeframe)?.hlInterval ?? '15m';
}

export const HIGHER_TIMEFRAMES = ['1D', '4H'];
export const EXECUTION_TIMEFRAME_DEFAULT =
  (import.meta.env.VITE_DEFAULT_TIMEFRAME as string | undefined) || '15m';

export type CategoryFilter = AssetCategory | 'ALL';

export const CATEGORY_FILTERS: CategoryFilter[] = [
  'ALL',
  'STOCK',
  'COMMODITY',
  'INDEX',
  'FOREX',
  'CRYPTO',
];

// Default category comes from env (VITE_DEFAULT_CATEGORY, plural "STOCKS" accepted)
// and falls back to STOCK — never crypto.
export function resolveDefaultCategory(): CategoryFilter {
  const valid: CategoryFilter[] = ['ALL', 'STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO'];
  const raw = ((import.meta.env.VITE_DEFAULT_CATEGORY as string | undefined) || 'STOCKS').toUpperCase();
  if (raw === 'STOCKS') return 'STOCK';
  const match = valid.find((c) => c === raw);
  return match ?? 'STOCK';
}

export const APP_CONFIG = {
  appName: 'Sunil AI',
  fullName: 'Sunil AI Hyperliquid Analyst',
  tagline: 'Stocks · Commodities · Indices · Forex · Crypto on Hyperliquid',
  pollIntervalMs: Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 30000),
  candleLimit: 200,
  minCandles: 60,
  confluenceLongThreshold: 55,
  confluenceShortThreshold: 55,
  signalExpiryMs: 1000 * 60 * 60 * 6,
  maxSignals: 100,
  defaultRiskPercent: 1,
  defaultLeverage: 1,
  aiCacheMs: 1000 * 60 * 5,
  /** Blend of deterministic confluence vs component detail in setupQuality (0..1) */
  qualityConfluenceWeight: 0.5,
  /** Min R:R for a CONFIRMED signal */
  minRiskReward: 1.2,
  /** Screener budgets: fast candidates → full pipeline → AI-reviewed */
  screenerMaxCandidates: 40,
  screenerMaxAI: 8,
  /** Discovery older than this is flagged STALE and the AI is told it is not live */
  marketStaleMs: 1000 * 60 * 5,
  hyperliquidApi: (import.meta.env.VITE_HYPERLIQUID_API as string | undefined) || 'https://api.hyperliquid.xyz',
  disclaimer: 'AI assessment confidence is not probability of profit. Informational only — not financial advice. No auto-trading in v1.',
};
