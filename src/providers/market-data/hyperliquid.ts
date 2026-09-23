// HyperliquidProvider — the primary MarketDataProvider. No Binance, no Coinbase.
// Implements discovery + ticker + candles + funding + OI over Hyperliquid.
import type {
  Candle,
  FundingData,
  HyperliquidMarket,
  MarketDataProvider,
  OpenInterestData,
  Ticker,
} from '../../types';
import { discoverMarkets } from '../../hyperliquid/markets';
import { fetchHyperliquidCandles } from '../../hyperliquid/candles';
import { derivativesFromMarket } from '../../hyperliquid/derivatives';

let marketCache: { at: number; data: HyperliquidMarket[] } | null = null;
const MARKET_TTL = Number(import.meta.env.VITE_MARKET_CACHE_MS ?? 60000);

export async function getDiscoveredMarkets(force = false): Promise<HyperliquidMarket[]> {
  if (!force && marketCache && Date.now() - marketCache.at < MARKET_TTL) return marketCache.data;
  const data = await discoverMarkets();
  marketCache = { at: Date.now(), data };
  return data;
}

export function findMarket(markets: HyperliquidMarket[], symbol: string): HyperliquidMarket | undefined {
  // symbol may be a marketId, internal ("xyz:TSLA") or display ("TSLA")
  return (
    markets.find((m) => m.marketId === symbol) ??
    markets.find((m) => m.internalSymbol === symbol) ??
    markets.find((m) => m.displaySymbol === symbol)
  );
}

export class HyperliquidProvider implements MarketDataProvider {
  readonly name = 'hyperliquid';

  async discoverMarkets(): Promise<HyperliquidMarket[]> {
    return getDiscoveredMarkets(true);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const markets = await getDiscoveredMarkets();
    const m = findMarket(markets, symbol);
    if (!m) throw new Error(`Unknown Hyperliquid market: ${symbol}`);
    const price = m.price ?? m.ctx?.markPx ?? m.ctx?.midPx ?? m.ctx?.oraclePx;
    if (price == null) throw new Error(`No price for ${symbol}`);
    const prev = m.ctx?.prevDayPx;
    const dayVlm = m.ctx?.dayNtlVlm ?? 0;
    return {
      symbol: m.internalSymbol,
      price,
      priceChangePercent24h: m.priceChangePercent24h ?? 0,
      high24h: price,
      low24h: prev ?? price,
      volume24h: dayVlm,
      quoteVolume24h: dayVlm,
      timestamp: Date.now(),
    };
  }

  async getCandles(symbol: string, timeframe: string, limit = 200): Promise<Candle[]> {
    const markets = await getDiscoveredMarkets().catch(() => [] as HyperliquidMarket[]);
    const m = findMarket(markets, symbol);
    const coin = m?.internalSymbol ?? symbol;
    return fetchHyperliquidCandles(coin, timeframe, limit);
  }

  async getFunding(symbol: string): Promise<FundingData> {
    try {
      const markets = await getDiscoveredMarkets();
      const m = findMarket(markets, symbol);
      const d = derivativesFromMarket(m);
      return { symbol, fundingRate: d.fundingRate, nextFundingTime: null };
    } catch {
      return { symbol, fundingRate: null, nextFundingTime: null };
    }
  }

  async getOpenInterest(symbol: string): Promise<OpenInterestData> {
    try {
      const markets = await getDiscoveredMarkets();
      const m = findMarket(markets, symbol);
      const d = derivativesFromMarket(m);
      return { symbol, openInterest: d.openInterest };
    } catch {
      return { symbol, openInterest: null };
    }
  }
}

// Demo fallback candles so the app never shows an empty screen offline.
export function demoCandles(seedPrice = 100, n = 200): Candle[] {
  let p = seedPrice;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const out: Candle[] = [];
  let t = Date.now() - n * 60_000;
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.48) * p * 0.004;
    const open = p;
    const close = Math.max(1, p + drift);
    const high = Math.max(open, close) * (1 + rnd() * 0.001);
    const low = Math.min(open, close) * (1 - rnd() * 0.001);
    out.push({ openTime: t, open, high, low, close, volume: 100 + rnd() * 900, closeTime: t + 60_000 });
    p = close;
    t += 60_000;
  }
  return out;
}
