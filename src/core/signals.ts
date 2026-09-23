// Signal engine: deterministic LONG/SHORT/WAIT + lifecycle evaluation on polled prices.
import type { AssetCategory, ConfluenceResult, Direction, MarketRegime, SignalStatus, TradingSignal } from '../types';
import { APP_CONFIG } from '../config/app';

let counter = 0;

export function generateSignal(params: {
  symbol: string;
  marketId?: string;
  dex?: string;
  category?: AssetCategory;
  timeframe: string;
  price: number;
  confluence: ConfluenceResult;
  regime: MarketRegime;
  atr: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  timeframeConflict: boolean;
}): TradingSignal {
  const { symbol, timeframe, price, confluence, regime, atr, swingHigh, swingLow, timeframeConflict } = params;
  const id = `${symbol}-${timeframe}-${Date.now()}-${counter++}`;
  const timestamp = Date.now();

  let direction: Direction = 'WAIT';
  if (!timeframeConflict) {
    if (confluence.direction === 'BULLISH' && confluence.total >= APP_CONFIG.confluenceLongThreshold) direction = 'LONG';
    if (confluence.direction === 'BEARISH' && confluence.total >= APP_CONFIG.confluenceShortThreshold) direction = 'SHORT';
  }

  const risk = atr != null && atr > 0 ? atr * 1.5 : price * 0.005;
  let entry = price;
  let stopLoss: number | undefined;
  let takeProfit1: number | undefined;
  let takeProfit2: number | undefined;
  let invalidation: string | undefined;

  if (direction === 'LONG') {
    stopLoss = swingLow != null && swingLow < price ? swingLow - risk * 0.2 : price - risk;
    takeProfit1 = price + (price - stopLoss) * 1.5;
    takeProfit2 = price + (price - stopLoss) * 3;
    invalidation = swingLow != null ? `15M bearish CHoCH / close below ${swingLow.toFixed(2)}` : 'Close back below entry structure';
  } else if (direction === 'SHORT') {
    stopLoss = swingHigh != null && swingHigh > price ? swingHigh + risk * 0.2 : price + risk;
    takeProfit1 = price - (stopLoss - price) * 1.5;
    takeProfit2 = price - (stopLoss - price) * 3;
    invalidation = swingHigh != null ? `15M bullish CHoCH / close above ${swingHigh.toFixed(2)}` : 'Close back above entry structure';
  }

  const riskReward =
    stopLoss != null && takeProfit1 != null
      ? Math.abs(takeProfit1 - entry) / Math.max(1e-9, Math.abs(entry - stopLoss))
      : undefined;

  const opposing = [...confluence.opposingReasons];
  if (timeframeConflict) opposing.unshift('TIMEFRAME CONFLICT: higher TF vs execution TF disagree — forced WAIT');
  if (direction === 'WAIT' && confluence.total < 55) opposing.unshift(`Confluence ${confluence.total}/100 below threshold`);

  return {
    id, symbol, marketId: params.marketId, dex: params.dex, category: params.category,
    direction, timeframe, entry: direction === 'WAIT' ? undefined : entry,
    stopLoss, takeProfit1, takeProfit2, takeProfit3: undefined,
    riskReward, confluenceScore: confluence.total,
    setupQuality: undefined, trapRisk: undefined, aiConfidence: null,
    supportingReasons: confluence.supportingReasons,
    opposingReasons: opposing,
    invalidation, marketRegime: regime, status: 'NEW',
    history: [{ at: timestamp, from: 'NONE', to: 'NEW', reason: `deterministic ${direction} (confluence ${confluence.total}/100)` }],
    timestamp, expiresAt: timestamp + APP_CONFIG.signalExpiryMs,
  };
}

export function evaluateSignalLifecycle(signal: TradingSignal, price: number, now = Date.now()): SignalStatus {
  if (signal.direction === 'WAIT') return now > signal.expiresAt ? 'EXPIRED' : signal.status;
  if (now > signal.expiresAt && (signal.status === 'NEW' || signal.status === 'ACTIVE')) return 'EXPIRED';
  if (signal.stopLoss == null || signal.takeProfit1 == null) return signal.status;
  if (signal.direction === 'LONG') {
    if (price <= signal.stopLoss) return 'SL_HIT';
    if (signal.takeProfit2 != null && price >= signal.takeProfit2) return 'TP2_HIT';
    if (price >= signal.takeProfit1) return 'TP1_HIT';
  } else {
    if (price >= signal.stopLoss) return 'SL_HIT';
    if (signal.takeProfit2 != null && price <= signal.takeProfit2) return 'TP2_HIT';
    if (price <= signal.takeProfit1) return 'TP1_HIT';
  }
  if (signal.status === 'NEW') return 'ACTIVE';
  return signal.status;
}

export function isDuplicate(a: TradingSignal, b: TradingSignal): boolean {
  return a.symbol === b.symbol && a.timeframe === b.timeframe && a.direction === b.direction && Math.abs(a.timestamp - b.timestamp) < 1000 * 60 * 15;
}

/** Recorded lifecycle transition — every status change carries its reason. */
export function transitionSignal(signal: TradingSignal, to: SignalStatus, reason: string, at = Date.now()): TradingSignal {
  if (to === signal.status) return signal;
  return {
    ...signal,
    status: to,
    history: [...signal.history, { at, from: signal.status, to, reason }].slice(-50),
  };
}
