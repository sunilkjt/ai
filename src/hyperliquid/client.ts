// Hyperliquid HTTP client — thin POST wrapper over https://api.hyperliquid.xyz/info
// No API key required for public market data. No trading endpoints in v1.
import { APP_CONFIG } from '../config/app';

const BASE = (): string => APP_CONFIG.hyperliquidApi.replace(/\/$/, '');

export async function hlPost<T>(body: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Raw wire types ----

export interface HLUniverseEntry {
  name: string;
  szDecimals: number;
  maxLeverage?: number;
  marginTableId?: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  marginMode?: string;
}

export interface HLAssetCtx {
  dayNtlVlm?: string;
  funding?: string;
  impactPxs?: string[] | null;
  markPx?: string;
  midPx?: string | null;
  openInterest?: string;
  oraclePx?: string;
  premium?: string | null;
  prevDayPx?: string;
  dayBaseVlm?: string;
}

export interface HLMeta {
  universe: HLUniverseEntry[];
}

export type MetaAndCtxs = [HLMeta, HLAssetCtx[]];
export type AllPerpMetas = Array<[HLMeta & { collateralToken?: number }, HLAssetCtx[]]>;

export interface HLCandleRaw {
  t: number; // open time ms
  T: number; // close time ms
  s: string; // coin
  i: string; // interval
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}
