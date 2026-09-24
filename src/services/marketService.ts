// Market service (Hyperliquid-first): discovery → candles → MTF →
// confluence → deterministic signal → asset-aware insights → AI (on demand).
// AI is NEVER called per tick — only when withAI=true (user request / signal / refresh).
import type { AssetCategory, Candle, DerivativesAnalysis, FinalTradeAnalysis, HyperliquidContext, HyperliquidMarket, MarketIdentity, MarketRegime, TimeframeAnalysis, TradingSignal } from '../types';
import { APP_CONFIG, TIMEFRAMES } from '../config/app';
import type { MarketDataProvider } from '../types';
import { HyperliquidProvider, demoCandles, findMarket, getDiscoveredMarkets } from '../providers/market-data/hyperliquid';
import { TTLCache } from '../providers/market-data/cache';
import { analyzeTimeframe, detectRegime, higherTimeframeBias, timeframeConflict } from '../core/mtf';
import { computeConfluence } from '../core/confluence';
import { generateSignal } from '../core/signals';
import { derivativesFromMarket, buildHyperliquidContext } from '../hyperliquid/derivatives';
import { analyzeAsset } from '../analyzers/AssetAnalyzer';
import { runFullAnalysis } from '../agents/orchestrator';
import type { AIProvider } from '../types';

const candleCache = new TTLCache<Candle[]>(60_000);

export const marketProvider: MarketDataProvider = new HyperliquidProvider();

export interface SymbolAnalysis {
  internalSymbol: string;
  marketId: string;
  symbol: string; // display, e.g. TSLA / GOLD / BTC
  assetName: string;
  dex: string;
  dexLabel: string;
  category: AssetCategory;
  /** Full identity snapshot for the AI + UI (includes staleness) */
  identity: MarketIdentity;
  /** Discovery timestamp backing this analysis (stale-data protection) */
  discoveryUpdatedAt: number;
  stale: boolean;
  /** True when synthetic demo candles were used — NEVER yields live signals */
  demo: boolean;
  price: number;
  change24h: number;
  volume24h: number;
  openInterest: number | null;
  fundingRate: number | null;
  timeframes: TimeframeAnalysis[];
  regime: MarketRegime;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext;
  assetInsights: string[];
  full: FinalTradeAnalysis | null;
  offline: boolean;
  updatedAt: number;
}

export async function fetchCandlesCached(
  coin: string,
  tf: string,
  limit = APP_CONFIG.candleLimit,
  marketId = coin,
): Promise<{ candles: Candle[]; offline: boolean; demo: boolean }> {
  // Cache is keyed by canonical marketId: the same coin name on two DEXes
  // must never share candles.
  const key = `${marketId}|${tf}|${limit}`;
  const hit = candleCache.get(key);
  if (hit) return { candles: hit, offline: false, demo: false };
  try {
    const candles = await marketProvider.getCandles(coin, tf, limit);
    if (candles.length >= 20) {
      candleCache.set(key, candles);
      return { candles, offline: false, demo: false };
    }
    throw new Error('too few candles');
  } catch {
    const cached = candleCache.get(key);
    if (cached) return { candles: cached, offline: true, demo: false };
    // Explicit demo fallback — flagged so it can NEVER produce live signals.
    return { candles: demoCandles(100, limit), offline: true, demo: true };
  }
}

export async function analyzeSymbol(
  displayOrInternal: string,
  opts: {
    executionTimeframe?: string;
    aiProvider?: AIProvider | null;
    withAI?: boolean;
    riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
    markets?: HyperliquidMarket[];
  } = {},
): Promise<SymbolAnalysis> {
  const executionTimeframe = opts.executionTimeframe ?? '15m';
  const markets = opts.markets ?? (await getDiscoveredMarkets().catch(() => [] as HyperliquidMarket[]));
  const market = findMarket(markets, displayOrInternal);
  const coin = market?.internalSymbol ?? displayOrInternal;
  const display = market?.displaySymbol ?? displayOrInternal;
  const category: AssetCategory = market?.category ?? 'UNKNOWN';

  let price = NaN;
  let change24h = 0;
  let offline = false;
  try {
    const t = await marketProvider.getTicker(coin);
    price = t.price;
    change24h = t.priceChangePercent24h;
  } catch {
    offline = true;
  }

  const frames: TimeframeAnalysis[] = [];
  let demo = false;
  const cacheId = market?.marketId ?? coin;
  for (const tf of TIMEFRAMES) {
    const { candles, offline: off, demo: isDemo } = await fetchCandlesCached(coin, tf.id, APP_CONFIG.candleLimit, cacheId);
    if (off) offline = true;
    if (isDemo) demo = true;
    frames.push(analyzeTimeframe(tf.id, candles));
    if (Number.isNaN(price) && candles.length) price = candles[candles.length - 1].close;
  }

  const regime = detectRegime(frames);
  const conflict = timeframeConflict(frames);
  const exec = frames.find((f) => f.timeframe === executionTimeframe) ?? frames[3];

  const derivatives = derivativesFromMarket(market);
  const htfBias = higherTimeframeBias(frames);
  const hyperliquid = buildHyperliquidContext(market, htfBias === 'NEUTRAL' ? exec.bias : htfBias, null);
  const assetInsights = analyzeAsset({ category, displaySymbol: display, timeframes: frames, derivatives });

  const confluence = computeConfluence(frames, derivatives);
  const stale = Date.now() - (market?.updatedAt ?? 0) > APP_CONFIG.marketStaleMs;
  const identity: MarketIdentity = {
    marketId: market?.marketId ?? coin,
    dex: market?.dex ?? '',
    dexLabel: market?.dexLabel ?? 'MAIN',
    internalSymbol: coin,
    displaySymbol: display,
    displayName: market?.assetName ?? display,
    underlying: market?.underlying ?? display,
    category,
    classificationSource: market?.classificationSource ?? 'UNKNOWN',
    instrument: 'PERP',
    venue: 'Hyperliquid',
    stale,
  };
  let signal = generateSignal({
    symbol: display,
    marketId: identity.marketId,
    dex: identity.dex,
    category,
    timeframe: executionTimeframe,
    price,
    confluence,
    regime,
    atr: exec.indicators.atr,
    swingHigh: exec.structure.lastSwingHigh,
    swingLow: exec.structure.lastSwingLow,
    timeframeConflict: conflict,
  });
  if (demo) {
    // §47: demo candles must NEVER produce live signals.
    signal = {
      ...signal,
      direction: 'WAIT',
      entry: undefined, stopLoss: undefined, takeProfit1: undefined, takeProfit2: undefined,
      riskReward: undefined, status: 'INVALIDATED',
      opposingReasons: ['DEMO DATA — LIVE ANALYSIS UNAVAILABLE', ...signal.opposingReasons],
      history: [...signal.history, { at: Date.now(), from: 'NEW', to: 'INVALIDATED', reason: 'synthetic demo candles' }],
    };
  }

  let full: FinalTradeAnalysis | null = null;
  if (opts.withAI) {
    full = await runFullAnalysis({
      symbol: display, category, identity, executionTimeframe, price, regime, timeframes: frames,
      confluence, signal, derivatives, hyperliquid, assetInsights,
      provider: opts.aiProvider ?? null,
      riskOpts: opts.riskOpts,
    });
  }

  return {
    internalSymbol: coin,
    marketId: identity.marketId,
    symbol: display,
    assetName: identity.displayName,
    dex: identity.dex,
    dexLabel: identity.dexLabel,
    category,
    identity,
    discoveryUpdatedAt: market?.updatedAt ?? 0,
    stale,
    price,
    change24h,
    volume24h: derivatives.dayVolumeNotional ?? 0,
    openInterest: derivatives.openInterest,
    fundingRate: derivatives.fundingRate,
    timeframes: frames,
    regime,
    signal,
    derivatives,
    hyperliquid,
    assetInsights,
    full,
    offline,
    demo,
    updatedAt: Date.now(),
  };
}
