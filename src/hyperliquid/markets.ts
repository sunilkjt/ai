// Asset discovery: Hyperliquid → current markets → classify.
// Iterates every perp dex (main + HIP-3 equity dexes) via metaAndAssetCtxs
// with the dex parameter, so stocks/commodities/indices/forex are included.
// Never hard-codes BTC/ETH/SOL as the universe.
import type { HyperliquidAssetCtx, HyperliquidMarket } from '../types';
import { assetNameFor, classifyMarket, dexLabelFor, marketIdFor, toDisplaySymbol, toUnderlying } from './symbols';
import { hlPost, type HLAssetCtx, type MetaAndCtxs } from './client';

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toCtx(raw: HLAssetCtx | undefined): HyperliquidAssetCtx | null {
  if (!raw) return null;
  return {
    markPx: num(raw.markPx),
    oraclePx: num(raw.oraclePx),
    midPx: num(raw.midPx),
    funding: num(raw.funding),
    openInterest: num(raw.openInterest),
    dayNtlVlm: num(raw.dayNtlVlm),
    prevDayPx: num(raw.prevDayPx),
    premium: num(raw.premium),
  };
}

async function discoverDexNames(): Promise<string[]> {
  try {
    const dexs = await hlPost<unknown[]>({ type: 'perpDexs' });
    // First entry is null (= main dex). Map to '' for the main dex.
    return (Array.isArray(dexs) ? dexs : []).map((d) => {
      if (d == null) return '';
      if (typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string') {
        return (d as { name: string }).name;
      }
      return '';
    });
  } catch {
    return [''];
  }
}

export async function discoverMarkets(): Promise<HyperliquidMarket[]> {
  const dexNames = await discoverDexNames();
  const dexes = dexNames.length ? dexNames : [''];
  const out: HyperliquidMarket[] = [];

  const results = await Promise.allSettled(
    dexes.map((dex) =>
      hlPost<MetaAndCtxs>(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }),
    ),
  );

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const [meta, ctxs] = r.value;
    const dex = dexes[i] ?? '';
    const now = Date.now();
    meta.universe.forEach((u, j) => {
      if (u.isDelisted) return;
      // Identity is dex-qualified: identical symbols on different DEXes are
      // preserved as separate markets and must never overwrite each other.
      const marketId = marketIdFor(u.name, dex);
      if (out.some((m) => m.marketId === marketId)) return;
      const ctx = toCtx(ctxs[j]);
      const { category, reason, source } = classifyMarket(u.name, dex);
      const displaySymbol = toDisplaySymbol(u.name);
      const mark = ctx?.markPx ?? ctx?.midPx ?? ctx?.oraclePx ?? null;
      const prev = ctx?.prevDayPx ?? null;
      out.push({
        marketId,
        internalSymbol: u.name,
        displaySymbol,
        assetName: assetNameFor(displaySymbol),
        underlying: toUnderlying(u.name),
        category,
        classificationSource: source,
        dex,
        dexLabel: dexLabelFor(dex),
        maxLeverage: u.maxLeverage ?? 10,
        szDecimals: u.szDecimals ?? 3,
        onlyIsolated: Boolean(u.onlyIsolated),
        isDelisted: Boolean(u.isDelisted),
        classificationReason: reason,
        discoveredAt: now,
        updatedAt: now,
        ctx,
        price: mark,
        priceChangePercent24h:
          mark != null && prev != null && prev !== 0 ? ((mark - prev) / prev) * 100 : null,
      });
    });
  });

  if (!out.length) throw new Error('Hyperliquid discovery returned no markets');
  return out;
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  return hlPost<Record<string, string>>({ type: 'allMids' });
}
