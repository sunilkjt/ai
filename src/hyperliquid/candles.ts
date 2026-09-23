// Hyperliquid candles via POST /info { type: "candleSnapshot", req: { coin, interval, startTime, endTime } }
import type { Candle } from '../types';
import { hlIntervalFor } from '../config/app';
import { hlPost, type HLCandleRaw } from './client';

function toCandle(r: HLCandleRaw): Candle {
  return {
    openTime: Number(r.t),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    volume: Number(r.v),
    closeTime: Number(r.T),
  };
}

/** Fetch up to `limit` candles ending now for a Hyperliquid coin + app timeframe. */
export async function fetchHyperliquidCandles(
  coin: string,
  timeframe: string,
  limit = 200,
): Promise<Candle[]> {
  const interval = hlIntervalFor(timeframe);
  const minutes =
    interval === '1m' ? 1
    : interval === '3m' ? 3
    : interval === '5m' ? 5
    : interval === '15m' ? 15
    : interval === '30m' ? 30
    : interval === '1h' ? 60
    : interval === '2h' ? 120
    : interval === '4h' ? 240
    : interval === '8h' ? 480
    : interval === '12h' ? 720
    : interval === '1d' ? 1440
    : interval === '3d' ? 4320
    : interval === '1w' ? 10080
    : 15;
  const endTime = Date.now();
  const startTime = endTime - limit * minutes * 60_000 - 5 * 60_000;
  const raw = await hlPost<HLCandleRaw[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });
  const candles = (Array.isArray(raw) ? raw : []).map(toCandle).filter((c) => Number.isFinite(c.close));
  return candles.slice(-limit);
}
