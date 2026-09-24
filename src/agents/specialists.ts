// Specialist agents — named, deterministic, wired to the real analysis systems.
// Each agent has: clear responsibility, structured input/output, allowed tools,
// data-completeness confidence (NOT profit odds), evidence, risks, error handling.
// No specialist is an LLM; AI reasoning happens only in analyst/critic stages.
import type {
  AgentName, ConfluenceResult, DerivativesAnalysis, HyperliquidContext,
  HyperliquidMarket, MarketRegime, RiskAnalysis, TimeframeAnalysis, TradingSignal,
} from '../types';
import { computeRisk } from '../core/risk';
import { evaluateLongSetup, evaluateShortSetup } from '../core/setups';
import { detectTraps, oiPriceRegime } from '../core/traps';
import { analyzeAsset } from '../analyzers/AssetAnalyzer';

export interface SpecialistInput {
  symbol: string;
  category: import('../types').AssetCategory;
  market: HyperliquidMarket | null;
  price: number;
  change24h: number | null;
  oiRising: boolean | null;
  regime: MarketRegime;
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  demo: boolean;
  stale: boolean;
  riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
}

export interface SpecialistOutput {
  agent: AgentName;
  ok: boolean;
  summary: string;
  /** 0-100 data/evidence completeness — NOT profit probability */
  confidence: number;
  evidence: string[];
  risks: string[];
  ms: number;
  error?: string;
  data?: unknown;
}

export interface Specialist {
  name: AgentName;
  responsibility: string;
  /** Allowed read-only tool names from the registry */
  tools: string[];
  run(input: SpecialistInput, trace: (tool: string, inputSummary: string, ms: number, ok: boolean) => void): SpecialistOutput;
}

function timed<T>(fn: () => T): { result: T | null; ms: number; error?: string } {
  const started = Date.now();
  try {
    return { result: fn(), ms: Date.now() - started };
  } catch (e) {
    return { result: null, ms: Date.now() - started, error: e instanceof Error ? e.message : 'agent failed' };
  }
}

function out(agent: AgentName, r: { result: unknown; ms: number; error?: string }, build: (v: unknown) => Omit<SpecialistOutput, 'agent' | 'ms' | 'error'> & { error?: string }): SpecialistOutput {
  if (r.error || r.result == null) {
    return { agent, ok: false, summary: 'agent failed', confidence: 0, evidence: [], risks: ['agent error — treated as missing data, never fabricated'], ms: r.ms, error: r.error ?? 'no result' };
  }
  const b = build(r.result);
  return { agent, ms: r.ms, ...b };
}

const execOf = (input: SpecialistInput): TimeframeAnalysis => input.timeframes[input.timeframes.length - 1];

export const MarketDataAgent: Specialist = {
  name: 'market-data',
  responsibility: 'Verify data completeness for the market; report what is unavailable instead of inventing it.',
  tools: ['getMarket', 'getCandles'],
  run(input, trace) {
    const t = Date.now();
    const evidence: string[] = [];
    const risks: string[] = [];
    if (input.market) evidence.push(`${input.market.marketId} on ${input.market.dexLabel}`);
    else risks.push('market not in discovery registry');
    evidence.push(Number.isFinite(input.price) ? `price ${input.price}` : 'price MISSING');
    if (!Number.isFinite(input.price)) risks.push('no live price');
    evidence.push(`${input.timeframes.length} timeframes analyzed`);
    if (input.timeframes.length < 6) risks.push(`only ${input.timeframes.length}/6 timeframes available`);
    if (input.demo) risks.push('DEMO DATA — not live');
    if (input.stale) risks.push('STALE discovery data');
    if (input.derivatives.unavailable.length) risks.push(`unavailable: ${input.derivatives.unavailable.join(', ')}`);
    trace('getMarket', input.symbol, Date.now() - t, true);
    const complete = evidence.length;
    const total = complete + risks.length;
    return {
      agent: 'market-data', ok: risks.filter((r) => r.includes('MISSING') || r.includes('DEMO')).length === 0,
      summary: `${complete}/${total} data checks pass${input.demo ? ' (DEMO)' : ''}`,
      confidence: total ? Math.round((complete / total) * 100) : 0,
      evidence, risks, ms: Date.now() - t,
    };
  },
};

export const MultiTimeframeAgent: Specialist = {
  name: 'mtf',
  responsibility: 'Read macro, higher-TF, setup and execution trends across 1D/4H/1H/15M/5M/1M.',
  tools: ['getMultiTimeframeData'],
  run(input, trace) {
    return out('mtf', timed(() => {
      const t = Date.now();
      const rows = input.timeframes.map((f) => `${f.timeframe}:${f.bias}`);
      trace('getMultiTimeframeData', `${input.symbol} 6TF`, Date.now() - t, true);
      return rows;
    }), (rows) => {
      const list = rows as string[];
      const bulls = list.filter((r) => r.endsWith('BULLISH')).length;
      const bears = list.filter((r) => r.endsWith('BEARISH')).length;
      return {
        ok: true,
        summary: list.join(' · '),
        confidence: Math.round(((bulls >= 4 || bears >= 4) ? 85 : bulls >= 3 || bears >= 3 ? 65 : 40)),
        evidence: list,
        risks: bulls > 0 && bears > 0 ? ['timeframes disagree — conflict noted, not hidden'] : [],
      };
    });
  },
};

export const MarketStructureAgent: Specialist = {
  name: 'structure',
  responsibility: 'HH/HL/LH/LL, BOS/CHoCH per timeframe → BULLISH/BEARISH/RANGE/TRANSITION/UNCLEAR.',
  tools: ['getMarketStructure'],
  run(input, trace) {
    return out('structure', timed(() => {
      const t = Date.now();
      const exec = execOf(input);
      trace('getMarketStructure', `${input.symbol} exec`, Date.now() - t, true);
      let verdict = 'UNCLEAR';
      if (exec.structure.trend === 'BULLISH' && !exec.structure.choch) verdict = 'BULLISH';
      else if (exec.structure.trend === 'BEARISH' && !exec.structure.choch) verdict = 'BEARISH';
      else if (exec.structure.trend === 'NEUTRAL' && !exec.structure.bos && !exec.structure.choch) verdict = 'RANGE';
      else if (exec.structure.choch || (exec.structure.bos && exec.structure.trend === 'NEUTRAL')) verdict = 'TRANSITION';
      else verdict = exec.structure.trend === 'NEUTRAL' ? 'RANGE' : exec.structure.trend;
      return { verdict, notes: exec.structure.notes, bos: exec.structure.bos, choch: exec.structure.choch };
    }), (v) => {
      const d = v as { verdict: string; notes: string[]; bos: string | null; choch: string | null };
      return {
        ok: true, summary: `${d.verdict}${d.bos ? ` BOS-${d.bos}` : ''}${d.choch ? ` CHoCH-${d.choch}` : ''}`,
        confidence: d.verdict === 'UNCLEAR' ? 30 : d.verdict === 'TRANSITION' ? 55 : 75,
        evidence: d.notes.slice(0, 4),
        risks: d.verdict === 'TRANSITION' ? ['structure in transition — breakouts fail often here'] : d.verdict === 'UNCLEAR' ? ['structure unclear — no call'] : [],
      };
    });
  },
};

export const SMCAgent: Specialist = {
  name: 'smc',
  responsibility: 'Liquidity sweeps, equal highs/lows, order blocks, FVG, displacement, premium/discount.',
  tools: ['getSMC', 'getLiquidity'],
  run(input, trace) {
    return out('smc', timed(() => {
      const t = Date.now();
      const exec = execOf(input);
      trace('getSMC', `${input.symbol} SMC`, Date.now() - t, true);
      return exec.smc;
    }), (smc) => {
      const s = smc as TimeframeAnalysis['smc'];
      const evidence = [...s.notes.slice(0, 5)];
      const risks: string[] = [];
      if (!s.swept && !s.fvg.length && !s.orderBlocks.length) risks.push('no active SMC features — nothing to trade off');
      return {
        ok: true,
        summary: s.swept ? `sweep ${s.liquiditySweep}` : `${s.fvg.length} FVG / ${s.orderBlocks.length} OB active`,
        confidence: s.swept || s.fvg.length || s.orderBlocks.length ? 70 : 40,
        evidence, risks,
      };
    });
  },
};

export const ICTAgent: Specialist = {
  name: 'ict',
  responsibility: 'ICT concepts only where data supports them; never claim unconfirmed setups.',
  tools: ['getICT'],
  run(input, trace) {
    return out('ict', timed(() => {
      const t = Date.now();
      const exec = execOf(input);
      trace('getICT', `${input.symbol} ICT`, Date.now() - t, true);
      return exec.ict;
    }), (ict) => {
      const c = ict as TimeframeAnalysis['ict'];
      if (!c.reliable) {
        return { ok: true, summary: 'ICT unconfirmed — insufficient data', confidence: 20, evidence: [], risks: ['ICT confirmation unavailable — excluded from decision'] };
      }
      return {
        ok: true,
        summary: `${c.marketMakerModel}${c.judasSwing ? ` · Judas ${c.judasSwing}` : ''}`,
        confidence: 65, evidence: c.notes.slice(0, 4), risks: [],
      };
    });
  },
};

export const LiquidityAgent: Specialist = {
  name: 'liquidity',
  responsibility: 'Liquidity pools, sweeps and grabs from swing levels; grab vs sweep distinguished by reclaim.',
  tools: ['getLiquidity'],
  run(input, trace) {
    return out('liquidity', timed(() => {
      const t = Date.now();
      const exec = execOf(input);
      const liq = analyzeLiquidityLike(exec);
      trace('getLiquidity', `${input.symbol} liquidity`, Date.now() - t, true);
      return liq;
    }), (liq) => {
      const l = liq as { sweep: string | null; above: number | null; below: number | null; grabs: string[] };
      const evidence = [
        ...(l.sweep ? [`liquidity sweep of ${l.sweep === 'HIGH' ? 'highs' : 'lows'} (wick + reclaim)`] : ['no fresh sweep']),
        ...(l.above != null ? [`nearest liquidity above ${l.above}`] : []),
        ...(l.below != null ? [`nearest liquidity below ${l.below}`] : []),
        ...l.grabs,
      ];
      return { ok: true, summary: l.sweep ? `grab/sweep ${l.sweep}` : 'no sweep in progress', confidence: l.sweep ? 70 : 45, evidence, risks: [] };
    });
  },
};

function analyzeLiquidityLike(exec: TimeframeAnalysis): { sweep: string | null; above: number | null; below: number | null; grabs: string[] } {
  // Liquidity grab = sweep WITHOUT reclaim (poke holds); sweep = poke + close back inside.
  // exec.smc reports confirmed sweeps; a grab proxy: equal-high/low extremes with displacement toward them.
  const grabs: string[] = [];
  if (!exec.smc.swept && exec.smc.displacement) {
    grabs.push(`displacement ${exec.smc.displacement} into extremes without confirmed sweep — possible grab in progress, unconfirmed`);
  }
  return {
    sweep: exec.smc.liquiditySweep,
    above: exec.structure.lastSwingHigh,
    below: exec.structure.lastSwingLow,
    grabs,
  };
}

export const DerivativesAgent: Specialist = {
  name: 'derivatives',
  responsibility: 'Hyperliquid OI/funding/volume/mark/oracle/premium regimes — context only, never auto direction.',
  tools: ['getDerivatives'],
  run(input, trace) {
    return out('derivatives', timed(() => {
      const t = Date.now();
      trace('getDerivatives', `${input.symbol} derivatives`, Date.now() - t, true);
      return oiPriceRegime(input.change24h, input.oiRising, input.derivatives.fundingRate);
    }), (regime) => {
      const d = input.derivatives;
      const evidence = [...d.notes.slice(0, 5)];
      const risks: string[] = [];
      if (d.fundingRate != null && Math.abs(d.fundingRate) > 0.001) risks.push('funding extreme — crowded positioning');
      if (d.unavailable.length) risks.push(`unavailable: ${d.unavailable.join(', ')}`);
      return { ok: true, summary: regime as string, confidence: d.unavailable.length >= 3 ? 35 : 70, evidence, risks };
    });
  },
};

export const MarketRegimeAgent: Specialist = {
  name: 'regime',
  responsibility: 'Regime classification with higher-TF vs execution agreement stats.',
  tools: ['getMultiTimeframeData'],
  run(input, trace) {
    return out('regime', timed(() => {
      const t = Date.now();
      const bulls = input.timeframes.filter((f) => f.bias === 'BULLISH').length;
      const bears = input.timeframes.filter((f) => f.bias === 'BEARISH').length;
      trace('getMultiTimeframeData', `${input.symbol} regime`, Date.now() - t, true);
      return { bulls, bears, total: input.timeframes.length };
    }), (v) => {
      const d = v as { bulls: number; bears: number; total: number };
      return {
        ok: true, summary: `${input.regime} (${d.bulls} bull / ${d.bears} bear / ${d.total} TF)`,
        confidence: 70, evidence: [`regime ${input.regime}`, `agreement ${Math.max(d.bulls, d.bears)}/${d.total}`],
        risks: d.bulls > 0 && d.bears > 0 ? ['mixed regime — partial agreement only'] : [],
      };
    });
  },
};

export const AssetClassAgent: Specialist = {
  name: 'asset-class',
  responsibility: 'Apply the asset-class lens (stock/commodity/index/forex/crypto) to shared findings.',
  tools: [],
  run(input, trace) {
    return out('asset-class', timed(() => {
      const t = Date.now();
      const insights = analyzeAsset({
        category: input.category,
        displaySymbol: input.symbol,
        timeframes: input.timeframes,
        derivatives: input.derivatives,
      });
      trace('asset-lens', `${input.symbol} ${input.category}`, Date.now() - t, true);
      return insights;
    }), (insights) => ({
      ok: true,
      summary: `${(insights as string[]).length} asset notes`,
      confidence: 65, evidence: (insights as string[]).slice(0, 5), risks: [],
    }));
  },
};

export const ConfluenceAgent: Specialist = {
  name: 'confluence',
  responsibility: 'Combine deterministic blocks into the confluence read with per-block evidence.',
  tools: ['getConfluence'],
  run(input, trace) {
    return out('confluence', timed(() => {
      const t = Date.now();
      trace('getConfluence', `${input.symbol} confluence`, Date.now() - t, true);
      return input.confluence;
    }), (c) => {
      const c2 = c as SpecialistInput['confluence'];
      return {
        ok: true, summary: `${c2.total}/100 ${c2.band} ${c2.direction} (setup quality, not profit odds)`,
        confidence: Math.min(90, 40 + c2.total / 2),
        evidence: c2.items.map((i) => `${i.block} ${i.score}/${i.max} ${i.direction}`),
        risks: c2.opposingReasons.slice(0, 4),
      };
    });
  },
};

export const LongSetupAgent: Specialist = {
  name: 'long',
  responsibility: 'Independently evaluate LONG candidacy against the 10-point checklist (never invert SHORT).',
  tools: ['getMarketStructure', 'getSMC', 'getIndicators', 'getDerivatives'],
  run(input, trace) {
    return out('long', timed(() => {
      const t = Date.now();
      const ev = evaluateLongSetup(input.timeframes, input.derivatives);
      trace('checklist', `${input.symbol} LONG ${ev.checks.filter((c) => c.pass).length}/10`, Date.now() - t, true);
      return ev;
    }), (ev) => {
      const e = ev as ReturnType<typeof evaluateLongSetup>;
      const passed = e.checks.filter((c) => c.pass).length;
      return {
        ok: true,
        summary: e.candidate ? `LONG CANDIDATE (${passed}/10 checks)` : `no LONG (${e.missing.length} blockers)`,
        confidence: Math.round((passed / 10) * 100),
        evidence: e.checks.filter((c) => c.pass).map((c) => `${c.name}: ${c.detail}`),
        risks: e.missing,
      };
    });
  },
};

export const ShortSetupAgent: Specialist = {
  name: 'short',
  responsibility: 'Independently evaluate SHORT candidacy against the 10-point checklist (never invert LONG).',
  tools: ['getMarketStructure', 'getSMC', 'getIndicators', 'getDerivatives'],
  run(input, trace) {
    return out('short', timed(() => {
      const t = Date.now();
      const ev = evaluateShortSetup(input.timeframes, input.derivatives);
      trace('checklist', `${input.symbol} SHORT ${ev.checks.filter((c) => c.pass).length}/10`, Date.now() - t, true);
      return ev;
    }), (ev) => {
      const e = ev as ReturnType<typeof evaluateShortSetup>;
      const passed = e.checks.filter((c) => c.pass).length;
      return {
        ok: true,
        summary: e.candidate ? `SHORT CANDIDATE (${passed}/10 checks)` : `no SHORT (${e.missing.length} blockers)`,
        confidence: Math.round((passed / 10) * 100),
        evidence: e.checks.filter((c) => c.pass).map((c) => `${c.name}: ${c.detail}`),
        risks: e.missing,
      };
    });
  },
};

export const ContrarianAgent: Specialist = {
  name: 'contrarian',
  responsibility: 'Challenge the primary thesis (exhaustion, traps forming); never auto-reverse the signal.',
  tools: ['getIndicators', 'getDerivatives', 'getLiquidity'],
  run(input, trace) {
    return out('contrarian', timed(() => {
      const t = Date.now();
      const rep = detectTraps({
        signal: input.signal, timeframes: input.timeframes,
        derivatives: input.derivatives, change24h: input.change24h, oiRising: input.oiRising,
      });
      trace('challenge', `${input.symbol} thesis=${input.signal.direction}`, Date.now() - t, true);
      return rep.contrarian;
    }), (flags) => {
      const f = flags as string[];
      return {
        ok: true,
        summary: f.length ? `${f.length} challenges to ${input.signal.direction} thesis` : `no challenge to ${input.signal.direction} thesis`,
        confidence: f.length ? 65 : 50,
        evidence: f,
        risks: f,
      };
    });
  },
};

export const TrapDetectionAgent: Specialist = {
  name: 'trap',
  responsibility: 'Detect fake breakouts/breakdowns, grabs, crowding, funding extremes, OI divergence, exhaustion, weak breaks → LOW/MEDIUM/HIGH.',
  tools: ['getLiquidity', 'getDerivatives', 'getMarketStructure', 'getSignal'],
  run(input, trace) {
    return out('trap', timed(() => {
      const t = Date.now();
      const rep = detectTraps({
        signal: input.signal, timeframes: input.timeframes,
        derivatives: input.derivatives, change24h: input.change24h, oiRising: input.oiRising,
      });
      trace('trap-scan', `${input.symbol} ${rep.risk}`, Date.now() - t, true);
      return rep;
    }), (rep) => {
      const r = rep as ReturnType<typeof detectTraps>;
      return {
        ok: true, summary: `trap risk ${r.risk} (${r.flags.length} flags)`,
        confidence: r.risk === 'LOW' ? 70 : r.risk === 'MEDIUM' ? 60 : 75,
        evidence: r.flags, risks: r.flags,
      };
    });
  },
};

export const RiskAgent: Specialist = {
  name: 'risk',
  responsibility: 'Calculate entry/SL/TP/R:R/size/leverage/liquidation deterministically; validate the math.',
  tools: ['calculateRisk'],
  run(input, trace) {
    return out('risk', timed(() => {
      const t = Date.now();
      const risk = computeRisk(input.signal, input.riskOpts);
      trace('calculateRisk', `${input.symbol} R:R ${risk?.riskReward?.toFixed(2) ?? 'n/a'}`, Date.now() - t, true);
      return risk;
    }), (risk) => {
      const r = risk as RiskAnalysis | null;
      if (!r) {
        return { ok: true, summary: 'no trade — risk uncomputable', confidence: 50, evidence: [], risks: ['no valid entry/SL/TP — WAIT'] };
      }
      return {
        ok: r.valid,
        summary: `R:R ${r.riskReward.toFixed(2)}${r.valid ? '' : ' — INVALID'}`,
        confidence: r.valid ? 80 : 40,
        evidence: [`entry ${r.entry}`, `SL ${r.stopLoss}`, `TP1 ${r.takeProfit1}`, `R:R ${r.riskReward.toFixed(2)}`],
        risks: r.warnings,
      };
    });
  },
};

export const ALL_SPECIALISTS: Specialist[] = [
  MarketDataAgent, MultiTimeframeAgent, MarketStructureAgent, SMCAgent, ICTAgent,
  LiquidityAgent, DerivativesAgent, MarketRegimeAgent, AssetClassAgent, ConfluenceAgent,
  LongSetupAgent, ShortSetupAgent, ContrarianAgent, TrapDetectionAgent, RiskAgent,
];

/** Deterministic signal critic (rule layer): challenge the setup before any LLM sees it. */
export const SignalCriticAgent: Specialist = {
  name: 'critic',
  responsibility: 'Rule-based challenge: conflicts, weak confirmation, bad math, crowded derivatives → challenge list.',
  tools: ['getSignal', 'getConfluence', 'getDerivatives'],
  run(input, trace) {
    return out('critic', timed(() => {
      const t = Date.now();
      const rep = detectTraps({
        signal: input.signal, timeframes: input.timeframes,
        derivatives: input.derivatives, change24h: input.change24h, oiRising: input.oiRising,
      });
      trace('challenge-rules', `${input.symbol} ${rep.flags.length} challenges`, Date.now() - t, true);
      return rep;
    }), (rep) => {
      const r = rep as ReturnType<typeof detectTraps>;
      const challenges = [...r.flags, ...r.contrarian];
      return {
        ok: true,
        summary: challenges.length ? `${challenges.length} deterministic challenges` : 'no deterministic challenges',
        confidence: 60, evidence: challenges, risks: challenges,
      };
    });
  },
};
