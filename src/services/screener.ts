// Market screener engine: two-stage hierarchical filtering.
//   STAGE 0 — discovery-context filter (liquidity/volume sanity, per-category budgets)
//   STAGE 1 — fast deterministic screen (4H + 15M only, lite score)
//   STAGE 2 — full deterministic pipeline on shortlisted candidates
//   STAGE 3 — AI review on the TOP slice only (configurable budget)
// Demo markets are excluded from live results. No AI call per tick.
import type {
  AIProvider, AgentRun, Candle, HyperliquidMarket, ScreenResult, ScreenerStats,
} from '../types';
import { CATEGORY_ORDER } from '../types';
import { APP_CONFIG } from '../config/app';
import { fetchCandlesCached, analyzeSymbol } from './marketService';
import { analyzeTimeframe, higherTimeframeBias } from '../core/mtf';
import { computeConfluence } from '../core/confluence';
import { runPipeline } from '../agents/AgentOrchestrator';

// OI snapshots for rising/falling detection (in-memory, per session).
const oiSnapshots = new Map<string, { oi: number; at: number }>();

export function oiRising(marketId: string, currentOi: number | null): boolean | null {
  if (currentOi == null) return null;
  const prev = oiSnapshots.get(marketId);
  oiSnapshots.set(marketId, { oi: currentOi, at: Date.now() });
  if (!prev || prev.oi <= 0) return null;
  const chg = (currentOi - prev.oi) / prev.oi;
  if (chg > 0.03) return true;
  if (chg < -0.03) return false;
  return null; // flat → unknown-ish, caller treats as no signal
}

export interface FastCandidate {
  market: HyperliquidMarket;
  /** Stage-1 directional read from 4H/1H/15M trend + momentum */
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  /** Priority score — ranks shortlist order, never profit odds */
  priority: number;
  reasons: string[];
}

export interface Stage0Report {
  discovered: number;
  passed: number;
  rejected: { reason: string; count: number }[];
}

const MIN_NOTIONAL = 25000;

/** Stage 0 — data quality + liquidity validation with counted reasons. */
export function stage0(markets: HyperliquidMarket[]): { passed: HyperliquidMarket[]; report: Stage0Report } {
  const rejected = new Map<string, number>();
  const reject = (reason: string): void => {
    rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
  };
  const passed = markets.filter((m) => {
    if (m.isDelisted) {
      reject('delisted');
      return false;
    }
    if (!m.ctx) {
      reject('no derivatives context');
      return false;
    }
    if (m.price == null || !Number.isFinite(m.price) || m.price <= 0) {
      reject('no sane price');
      return false;
    }
    const vol = m.ctx.dayNtlVlm;
    if (vol != null && vol < MIN_NOTIONAL) {
      reject(`24h notional < $${MIN_NOTIONAL.toLocaleString()}`);
      return false;
    }
    return true;
  });
  return {
    passed,
    report: {
      discovered: markets.length,
      passed: passed.length,
      rejected: [...rejected.entries()].map(([reason, count]) => ({ reason, count })),
    },
  };
}

/**
 * Stage 1 — cheap fast scan over the COMPLETE stage-0 universe (no per-category caps).
 * Per market: price, volume, volatility, funding, open interest, momentum,
 * 4H/1H/15M trend, basic structure → bias LONG/SHORT/NEUTRAL + priority score.
 * No AI is called here — ever.
 */
export async function fastScan(
  markets: HyperliquidMarket[],
  opts: { maxCandidates?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ candidates: FastCandidate[]; stage0: Stage0Report; scanned: number }> {
  const { passed: pool, report } = stage0(markets);
  const out: FastCandidate[] = [];
  let scanned = 0;
  // Fetch order follows category priority; every passing market is analyzed.
  const ordered = [...pool].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  for (const m of ordered) {
    try {
      const [h4, h1, m15] = await Promise.all([
        fetchCandlesCached(m.internalSymbol, '4H', 120, m.marketId).catch(() => null),
        fetchCandlesCached(m.internalSymbol, '1H', 120, m.marketId).catch(() => null),
        fetchCandlesCached(m.internalSymbol, '15m', 120, m.marketId).catch(() => null),
      ]);
      scanned += 1;
      opts.onProgress?.(scanned, ordered.length);
      if (!h4 || !h1 || !m15 || h4.demo || h1.demo || m15.demo) continue;
      if (h4.candles.length < 60 || h1.candles.length < 60 || m15.candles.length < 60) continue;
      const a4 = analyzeTimeframe('4H', h4.candles);
      const a1 = analyzeTimeframe('1H', h1.candles);
      const a15 = analyzeTimeframe('15m', m15.candles);
      const reasons: string[] = [];
      let priority = 0;

      // Trend votes across 4H / 1H / 15M
      const bullVotes = [a4.bias, a1.bias, a15.bias].filter((b) => b === 'BULLISH').length;
      const bearVotes = [a4.bias, a1.bias, a15.bias].filter((b) => b === 'BEARISH').length;
      const bias: FastCandidate['bias'] =
        bullVotes >= 2 && bearVotes === 0 ? 'LONG'
        : bearVotes >= 2 && bullVotes === 0 ? 'SHORT'
        : 'NEUTRAL';
      if (bullVotes === 3 || bearVotes === 3) {
        priority += 50;
        reasons.push(`4H+1H+15M aligned ${bullVotes === 3 ? 'BULLISH' : 'BEARISH'}`);
      } else if (bias !== 'NEUTRAL') {
        priority += 30;
        reasons.push(`2-TF ${bias === 'LONG' ? 'bullish' : 'bearish'} alignment`);
      } else if (bullVotes === 1 || bearVotes === 1) {
        priority += 10;
        reasons.push('single-TF bias only');
      }

      // Momentum (RSI sweet band, not stretched)
      const rsi = a15.indicators.rsi;
      if (rsi != null) {
        if (bias === 'LONG' && rsi >= 55 && rsi < 70) {
          priority += 10;
          reasons.push(`15M momentum supportive (RSI ${rsi.toFixed(0)})`);
        } else if (bias === 'SHORT' && rsi > 30 && rsi <= 45) {
          priority += 10;
          reasons.push(`15M momentum supportive (RSI ${rsi.toFixed(0)})`);
        } else if ((bias === 'LONG' && rsi >= 70) || (bias === 'SHORT' && rsi <= 30)) {
          priority -= 10;
          reasons.push(`15M momentum stretched (RSI ${rsi.toFixed(0)}) — late-entry risk`);
        }
      }

      // Volatility sanity (ATR%)
      const atrp = a15.indicators.atrPercent ?? 0;
      if (atrp > 0 && atrp < 8) {
        priority += 5;
      } else if (atrp >= 8) {
        priority -= 10;
        reasons.push('volatility extreme');
      }

      // Basic structure: BOS / sweep / displacement on 15M
      if (a15.structure.bos) {
        priority += 10;
        reasons.push(`${a15.structure.bos} BOS on 15M`);
      }
      if (a15.smc.swept) {
        priority += 10;
        reasons.push(`liquidity sweep ${a15.smc.liquiditySweep}`);
      }
      if (a15.smc.displacement) {
        priority += 5;
        reasons.push(`${a15.smc.displacement} displacement`);
      }

      // Derivatives context: funding extremes penalize, OI presence informs
      const f = m.ctx?.funding;
      if (f != null && Math.abs(f) > 0.001) {
        priority -= 10;
        reasons.push(`funding extreme (${(f * 100).toFixed(3)}%) — crowded positioning risk`);
      }
      if (m.ctx?.openInterest != null && m.ctx.openInterest > 0) {
        priority += 5;
        reasons.push(`OI ${m.ctx.openInterest.toLocaleString()}`);
      }

      // Volume tiers (24h notional)
      const vol = m.ctx?.dayNtlVlm ?? 0;
      if (vol >= 1000000) {
        priority += 10;
        reasons.push('high 24h liquidity');
      } else if (vol >= 100000) {
        priority += 5;
      }

      // 24h move sanity
      const chg = Math.abs(m.priceChangePercent24h ?? 0);
      if (chg > 30) {
        priority -= 20;
        reasons.push('extreme 24H move — possible bad print or blow-off');
      }

      out.push({ market: m, bias, priority, reasons });
    } catch {
      scanned += 1;
      opts.onProgress?.(scanned, ordered.length);
      continue; // one market failing never kills the scan
    }
  }
  out.sort((a, b) => b.priority - a.priority);
  return { candidates: out.slice(0, opts.maxCandidates ?? APP_CONFIG.screenerMaxCandidates), stage0: report, scanned };
}

export async function scanFull(
  candidates: FastCandidate[],
  opts: {
    executionTimeframe?: string;
    aiProvider?: AIProvider | null;
    aiEnabled?: boolean;
    maxAI?: number;
    riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
    memoryOf?: (symbol: string) => import('../types').AnalysisMemoryEntry[];
    markets?: HyperliquidMarket[];
  } = {},
): Promise<{ results: ScreenResult[]; aiReviewed: number; ledger: AgentRun[] }> {
  const results: ScreenResult[] = [];
  const ledger: AgentRun[] = [];
  const maxAI = opts.maxAI ?? APP_CONFIG.screenerMaxAI;
  // Full deterministic analysis for every candidate first (for setup-quality ranking)
  const analyzed = [];
  for (const c of candidates) {
    try {
      const a = await analyzeSymbol(c.market.internalSymbol, {
        executionTimeframe: opts.executionTimeframe ?? '15m',
        withAI: false,
        riskOpts: opts.riskOpts,
        markets: opts.markets,
      });
      if (a.demo) continue; // never screen demo data as live
      analyzed.push({ candidate: c, analysis: a });
    } catch {
      continue;
    }
  }
  // Rank deterministically (stage-1 priority first), AI-review only the top slice
  analyzed.sort((x, y) => (y.candidate.priority - x.candidate.priority) || (y.analysis.signal.confluenceScore - x.analysis.signal.confluenceScore));
  let aiReviewed = 0;
  for (let i = 0; i < analyzed.length; i++) {
    const { candidate, analysis } = analyzed[i];
    const useAI = (opts.aiEnabled ?? true) && i < maxAI;
    try {
      const out = await runPipeline({
        identity: analysis.identity,
        symbol: analysis.symbol,
        category: analysis.category,
        executionTimeframe: opts.executionTimeframe ?? '15m',
        price: analysis.price,
        change24h: analysis.change24h,
        oiRising: oiRising(analysis.marketId, analysis.openInterest),
        regime: analysis.regime,
        timeframes: analysis.timeframes,
        confluence: computeConfluence(analysis.timeframes, analysis.derivatives),
        signal: analysis.signal,
        derivatives: analysis.derivatives,
        hyperliquid: analysis.hyperliquid,
        assetInsights: analysis.assetInsights,
        demo: analysis.demo,
        stale: analysis.stale,
        provider: useAI ? (opts.aiProvider ?? null) : null,
        aiEnabled: useAI,
        riskOpts: opts.riskOpts,
        memory: opts.memoryOf?.(analysis.marketId) ?? [],
        maxAiCalls: 2,
      });
      if (useAI && out.ai) aiReviewed += 1;
      for (const entry of out.ledger) {
        if (ledger.length < 500) ledger.push({ ...entry, summary: `${analysis.symbol}: ${entry.summary}` });
      }
      const execBias = analysis.timeframes[analysis.timeframes.length - 1]?.bias ?? 'NEUTRAL';
      const htf = higherTimeframeBias(analysis.timeframes);
      const status = out.status;
      results.push({
        marketId: analysis.marketId,
        displaySymbol: analysis.symbol,
        assetName: analysis.assetName,
        dex: analysis.dex,
        dexLabel: analysis.dexLabel,
        category: analysis.category,
        price: Number.isFinite(analysis.price) ? analysis.price : null,
        change24h: analysis.change24h,
        trend: execBias,
        mtfBias: htf,
        confluence: analysis.signal.confluenceScore,
        setupQuality: out.quality,
        scores: out.scores,
        trapRisk: out.trap.risk,
        trapNotes: out.trap.flags,
        longSetup: out.longSetup,
        shortSetup: out.shortSetup,
        aiDirection: out.ai?.direction ?? out.direction,
        aiConfidence: out.ai?.confidence ?? null,
        aiProvider: out.ai?.provider ?? null,
        entry: out.risk?.entry ?? analysis.signal.entry ?? null,
        stopLoss: out.risk?.stopLoss ?? analysis.signal.stopLoss ?? null,
        takeProfit1: out.risk?.takeProfit1 ?? analysis.signal.takeProfit1 ?? null,
        takeProfit2: out.risk?.takeProfit2 ?? analysis.signal.takeProfit2 ?? null,
        riskReward: out.risk?.riskReward ?? analysis.signal.riskReward ?? null,
        status,
        statusReason: out.statusReason,
        why: out.why.slice(0, 6),
        against: out.against.slice(0, 6),
        invalidation: analysis.signal.invalidation ?? out.ai?.invalidation ?? 'Structure break against the setup',
        criticSummary: out.critique ? `${out.critique.approval}: ${out.critique.critique.slice(0, 220)}` : null,
        explanation: out.ai?.explanation ?? `${analysis.symbol} shows ${analysis.regime} with confluence ${analysis.signal.confluenceScore}/100 — ${status}.`,
        demo: analysis.demo,
        stale: analysis.stale,
        updatedAt: Date.now(),
      });
    } catch {
      continue;
    }
  }
  // Rank: setup quality first (never expected profit)
  results.sort((a, b) => (b.setupQuality ?? b.confluence) - (a.setupQuality ?? a.confluence));
  return { results, aiReviewed, ledger };
}

export async function scanUniverse(
  markets: HyperliquidMarket[],
  opts: Parameters<typeof scanFull>[1] & { maxCandidates?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ results: ScreenResult[]; stats: ScreenerStats; ledger: AgentRun[] }> {
  const startedAt = Date.now();
  const fast = await fastScan(markets, opts);
  const { results, aiReviewed, ledger } = await scanFull(fast.candidates, { ...opts, markets });
  const finishedAt = Date.now();
  const longCount = results.filter((r) => r.aiDirection === 'LONG' && (r.status === 'CONFIRMED' || r.status === 'CONDITIONAL')).length;
  const shortCount = results.filter((r) => r.aiDirection === 'SHORT' && (r.status === 'CONFIRMED' || r.status === 'CONDITIONAL')).length;
  const waitCount = results.filter((r) => r.status === 'WATCHING' || r.aiDirection === 'WAIT').length;
  const rejected = results.filter((r) => r.status === 'REJECTED' || r.status === 'INVALIDATED').length;
  // Honest accounting: discovered → stage-0 → stage-1 scanned → shortlisted → AI reviewed.
  const stage0Rejected = fast.stage0.rejected.reduce((a, r) => a + r.count, 0);
  return {
    results,
    ledger,
    stats: {
      discovered: fast.stage0.discovered,
      scanned: fast.scanned,
      stage0Rejected,
      stage0Reasons: fast.stage0.rejected,
      skippedDemo: 0,
      fastCandidates: fast.candidates.length,
      aiReviewed,
      longCount, shortCount, waitCount, rejected,
      startedAt, finishedAt, durationMs: finishedAt - startedAt,
    },
  };
}

export type { Candle };
