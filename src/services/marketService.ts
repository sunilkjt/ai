// Market service (Hyperliquid-first): discovery → candles → MTF →
// confluence → deterministic signal → asset-aware insights → AI (on demand).
// AI is NEVER called per tick — only when withAI=true (user request / signal / refresh).
import type { AssetCategory, Candle, DerivativesAnalysis, FinalTradeAnalysis, HyperliquidContext, HyperliquidMarket, MarketRegime, TimeframeAnalysis, TradingSignal } from '../types';
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
  symbol: string; // display, e.g. TSLA / GOLD / BTC
  category: AssetCategory;
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

export async function fetchCandlesCached(coin: string, tf: string, limit = APP_CONFIG.candleLimit): Promise<{ candles: Candle[]; offline: boolean }> {
  const key = `${coin}|${tf}|${limit}`;
  const hit = candleCache.get(key);
  if (hit) return { candles: hit, offline: false };
  try {
    const candles = await marketProvider.getCandles(coin, tf, limit);
    if (candles.length >= 20) {
      candleCache.set(key, candles);
      return { candles, offline: false };
    }
    throw new Error('too few candles');
  } catch {
    const cached = candleCache.get(key);
    if (cached) return { candles: cached, offline: true };
    return { candles: demoCandles(100, limit), offline: true };
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
  for (const tf of TIMEFRAMES) {
    const { candles, offline: off } = await fetchCandlesCached(coin, tf.id);
    if (off) offline = true;
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
  const signal = generateSignal({
    symbol: display,
    timeframe: executionTimeframe,
    price,
    confluence,
    regime,
    atr: exec.indicators.atr,
    swingHigh: exec.structure.lastSwingHigh,
    swingLow: exec.structure.lastSwingLow,
    timeframeConflict: conflict,
  });

  let full: FinalTradeAnalysis | null = null;
  if (opts.withAI) {
    full = await runFullAnalysis({
      symbol: display, category, executionTimeframe, price, regime, timeframes: frames,
      confluence, signal, derivatives, hyperliquid, assetInsights,
      provider: opts.aiProvider ?? null,
      riskOpts: opts.riskOpts,
    });
  }

  return {
    internalSymbol: coin,
    symbol: display,
    category,
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
    updatedAt: Date.now(),
  };
}
