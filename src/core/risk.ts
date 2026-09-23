// Deterministic risk engine. The LLM never invents prices or sizes.
import type { RiskAnalysis, TradingSignal } from '../types';

export function computeRisk(
  signal: TradingSignal,
  opts: { accountBalance?: number; riskPercent?: number; leverage?: number } = {},
): RiskAnalysis | null {
  const { accountBalance = 10000, riskPercent = 1, leverage = 1 } = opts;
  if (signal.direction === 'WAIT' || signal.entry == null || signal.stopLoss == null || signal.takeProfit1 == null) {
    return null;
  }
  const entry = signal.entry;
  const stopLoss = signal.stopLoss;
  const takeProfit1 = signal.takeProfit1;
  const takeProfit2 = signal.takeProfit2;
  const takeProfit3 = signal.takeProfit3;
  const riskDistance = Math.abs(entry - stopLoss);
  const rewardDistance = Math.abs(takeProfit1 - entry);
  if (riskDistance <= 0) return null;
  const riskReward = rewardDistance / riskDistance;
  const riskAmount = accountBalance * (riskPercent / 100);
  const positionSize = riskAmount / riskDistance; // base units
  const notional = positionSize * entry;
  const effectiveLeverage = leverage;
  const warnings: string[] = [];
  if (riskReward < 1.2) warnings.push('Risk/reward below 1.2R — setup quality is poor');
  if ((notional / accountBalance) * 100 > 100 * leverage) warnings.push('Position notional exceeds leverage allowance');
  if (riskPercent > 2) warnings.push('Risk above 2% per trade — aggressive');

  // Rough liquidation awareness for leveraged longs/shorts (linear perp approximation)
  let liquidationEstimate: number | null = null;
  if (leverage > 1) {
    const mmr = 0.005;
    const move = 1 / leverage - mmr;
    liquidationEstimate = signal.direction === 'LONG' ? entry * (1 - move) : entry * (1 + move);
    warnings.push(`Leverage ${leverage}x: liquidation approx near ${liquidationEstimate.toFixed(2)} (estimate, varies by exchange)`);
  }

  return {
    entry, stopLoss, takeProfit1, takeProfit2, takeProfit3,
    riskDistance, rewardDistance, riskReward, riskPercent,
    positionSize, notional, leverage: effectiveLeverage,
    liquidationEstimate, warnings,
    valid: riskReward >= 1.0,
  };
}
