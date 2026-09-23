// Backtest engine: causal only — signal at bar i may only use bars <= i. No look-ahead.
import type { BacktestResult, BacktestTrade, Candle, Direction } from '../types';
import { analyzeTimeframe } from './mtf';
import { computeConfluence } from './confluence';
import { APP_CONFIG } from '../config/app';

export interface BacktestOptions {
  feePercent?: number; // per side, e.g. 0.05 = 0.05%
  slippagePercent?: number;
  warmup?: number;
}

export function runBacktest(candles: Candle[], symbol: string, timeframe: string, opts: BacktestOptions = {}): BacktestResult {
  const { feePercent = 0.05, slippagePercent = 0.02, warmup = 60 } = opts;
  const trades: BacktestTrade[] = [];
  if (candles.length < warmup + 10) {
    return { symbol, timeframe, totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, profitFactor: 0, expectancy: 0, maxDrawdownR: 0, netR: 0, trades };
  }

  const costR = (feePercent + slippagePercent) / 100; // approx in R terms scaled later; applied as price penalty

  for (let i = warmup; i < candles.length - 1; i++) {
    const window = candles.slice(0, i + 1); // causal window only
    const tf = analyzeTimeframe(timeframe, window.slice(-200));
    const conf = computeConfluence([tf], { fundingRate: null, openInterest: null, longShortRatio: null, basis: null, markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null, unavailable: ['funding', 'OI'], bias: 'NEUTRAL', notes: [] });
    let direction: Direction = 'WAIT';
    if (conf.direction === 'BULLISH' && conf.total >= APP_CONFIG.confluenceLongThreshold) direction = 'LONG';
    else if (conf.direction === 'BEARISH' && conf.total >= APP_CONFIG.confluenceShortThreshold) direction = 'SHORT';
    if (direction === 'WAIT') continue;
    // one position at a time
    if (trades.length && trades[trades.length - 1].exitTime > candles[i].openTime) continue;

    const atrProxy = Math.abs(window[i].high - window[i].low);
    const risk = Math.max(atrProxy * 1.5, window[i].close * 0.003);
    const entry = candles[i + 1].open * (direction === 'LONG' ? 1 + costR : 1 - costR);
    const stop = direction === 'LONG' ? entry - risk : entry + risk;
    const tp = direction === 'LONG' ? entry + risk * 1.5 : entry - risk * 1.5;

    // walk forward to resolve
    let exit = entry;
    let result: BacktestTrade['result'] = 'EXPIRED';
    let exitTime = candles[Math.min(i + 50, candles.length - 1)].openTime;
    for (let j = i + 1; j < Math.min(i + 51, candles.length); j++) {
      const bar = candles[j];
      if (direction === 'LONG') {
        if (bar.low <= stop) { exit = stop; result = 'LOSS'; exitTime = bar.openTime; break; }
        if (bar.high >= tp) { exit = tp; result = 'WIN'; exitTime = bar.openTime; break; }
      } else {
        if (bar.high >= stop) { exit = stop; result = 'LOSS'; exitTime = bar.openTime; break; }
        if (bar.low <= tp) { exit = tp; result = 'WIN'; exitTime = bar.openTime; break; }
      }
    }
    const rMultiple = result === 'EXPIRED' ? 0 : direction === 'LONG' ? (exit - entry) / risk : (entry - exit) / risk;
    trades.push({ index: i, direction, entry, stopLoss: stop, takeProfit: tp, exit, result, rMultiple, entryTime: candles[i].openTime, exitTime });
    i += 2; // avoid re-entering on adjacent bars
  }

  const wins = trades.filter((t) => t.result === 'WIN').length;
  const losses = trades.filter((t) => t.result === 'LOSS').length;
  const decided = trades.filter((t) => t.result !== 'EXPIRED');
  const grossWin = decided.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(decided.filter((t) => t.rMultiple < 0).reduce((a, t) => a + t.rMultiple, 0));
  const netR = decided.reduce((a, t) => a + t.rMultiple, 0);
  const winRate = decided.length ? (wins / decided.length) * 100 : 0;
  const avgR = decided.length ? netR / decided.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  let peak = 0; let maxDd = 0; let cum = 0;
  for (const t of trades) { cum += t.rMultiple; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); }

  return { symbol, timeframe, totalTrades: trades.length, wins, losses, winRate, avgR, profitFactor, expectancy: avgR, maxDrawdownR: maxDd, netR, trades };
}
