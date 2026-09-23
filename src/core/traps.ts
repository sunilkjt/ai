// Trap detector + contrarian flags + OI/price regime analysis.
// Deterministic only. Flags traps — never auto-reverses a signal.
import type { DerivativesAnalysis, TimeframeAnalysis, TradingSignal, TrapRisk } from '../types';

export interface TrapReport {
  risk: TrapRisk;
  /** Points contributing to the verdict, highest first */
  flags: string[];
  /** Contrarian lens: reasons the obvious direction may be exhausted */
  contrarian: string[];
  /** OI × price regime, contextual only — never auto bullish/bearish */
  oiPriceRegime: string;
}

function pushUnique(arr: string[], s: string): void {
  if (!arr.includes(s)) arr.push(s);
}

export function oiPriceRegime(change24h: number | null, oiRising: boolean | null, funding: number | null): string {
  const dir = change24h == null ? 'flat' : change24h > 0.5 ? 'rising' : change24h < -0.5 ? 'falling' : 'flat';
  const oi = oiRising == null ? 'OI trend unknown' : oiRising ? 'OI rising' : 'OI falling';
  let s = `Price ${dir}, ${oi}`;
  if (funding != null && Math.abs(funding) > 0.0005) {
    s += funding > 0 ? ' — longs pay elevated funding (crowded-long risk, not a direction call)' : ' — shorts pay (crowded-short risk, not a direction call)';
  }
  return s + '.';
}

export function detectTraps(params: {
  signal: TradingSignal;
  timeframes: TimeframeAnalysis[];
  derivatives: DerivativesAnalysis;
  change24h: number | null;
  oiRising: boolean | null;
}): TrapReport {
  const { signal, timeframes, derivatives, change24h, oiRising } = params;
  const flags: string[] = [];
  const contrarian: string[] = [];
  const exec = timeframes.find((t) => t.timeframe === signal.timeframe) ?? timeframes[timeframes.length - 1];

  // Weak volume on a directional signal
  if (signal.direction !== 'WAIT' && exec?.indicators.volumeState === 'LOW') {
    pushUnique(flags, 'Weak volume — move lacks participation');
  }
  // Momentum stretched into the signal direction (late entry risk)
  const rsi = exec?.indicators.rsi;
  if (signal.direction === 'LONG' && rsi != null && rsi >= 70) {
    pushUnique(flags, 'RSI overbought — late LONG entry risk');
    pushUnique(contrarian, 'Momentum stretched while setup says LONG — exhaustion possible');
  }
  if (signal.direction === 'SHORT' && rsi != null && rsi <= 30) {
    pushUnique(flags, 'RSI oversold — late SHORT entry risk');
    pushUnique(contrarian, 'Momentum stretched while setup says SHORT — exhaustion possible');
  }
  // Excessive funding against chase direction
  const f = derivatives.fundingRate;
  if (signal.direction === 'LONG' && f != null && f > 0.001) {
    pushUnique(flags, 'Funding excessively positive — crowded longs, chasing is risky');
    pushUnique(contrarian, 'Most factors LONG but funding shows the crowd is already long');
  }
  if (signal.direction === 'SHORT' && f != null && f < -0.001) {
    pushUnique(flags, 'Funding excessively negative — crowded shorts, chasing is risky');
    pushUnique(contrarian, 'Most factors SHORT but funding shows the crowd is already short');
  }
  // OI rising fast against price (leverage divergence)
  if (oiRising && change24h != null) {
    if (signal.direction === 'LONG' && change24h < 0) {
      pushUnique(flags, 'OI rising while price falls — leverage building against longs');
    }
    if (signal.direction === 'SHORT' && change24h > 0) {
      pushUnique(flags, 'OI rising while price rises — leverage building against shorts');
    }
  }
  // Premium/discount extremes
  const prem = derivatives.premium;
  if (signal.direction === 'LONG' && prem != null && prem > 0.002) {
    pushUnique(flags, 'Perp at steep premium — long chase pays up');
  }
  if (signal.direction === 'SHORT' && prem != null && prem < -0.002) {
    pushUnique(flags, 'Perp at steep discount — short chase pays up');
  }
  // Poor R:R
  if (signal.riskReward != null && signal.direction !== 'WAIT' && signal.riskReward < 1.2) {
    pushUnique(flags, `Poor R:R ${signal.riskReward.toFixed(2)} — setup quality is poor even if direction is right`);
  }
  // Timeframe conflict remnants
  if (signal.opposingReasons.some((r) => r.includes('TIMEFRAME CONFLICT'))) {
    pushUnique(flags, 'Higher-timeframe conflict — breakout failure risk');
    pushUnique(contrarian, 'Execution TF disagrees with higher TF — obvious direction may be the trap');
  }
  // CHoCH against the signal = potential false-break structure
  if (exec) {
    if (signal.direction === 'LONG' && exec.structure.choch === 'BEARISH') {
      pushUnique(flags, 'Bearish CHoCH on execution TF — possible false-breakout top');
    }
    if (signal.direction === 'SHORT' && exec.structure.choch === 'BULLISH') {
      pushUnique(flags, 'Bullish CHoCH on execution TF — possible false-breakdown bottom');
    }
  }
  // Contrarian: resistance/support proximity is noted via opposing reasons
  if (signal.direction !== 'WAIT' && signal.opposingReasons.length >= 2) {
    pushUnique(contrarian, `${signal.opposingReasons.length} opposing factors against a ${signal.direction} consensus — weigh them before acting`);
  }

  const risk: TrapRisk = flags.length >= 3 ? 'HIGH' : flags.length >= 1 ? 'MEDIUM' : 'LOW';
  return {
    risk,
    flags,
    contrarian,
    oiPriceRegime: oiPriceRegime(change24h, oiRising, derivatives.fundingRate),
  };
}
