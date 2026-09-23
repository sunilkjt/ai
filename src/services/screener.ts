// Market screener engine: two-stage hierarchical filtering.
//   STAGE 0 — discovery-context filter (liquidity/volume sanity, per-category budgets)
//   STAGE 1 — fast deterministic screen (4H + 15M only, lite score)
//   STAGE 2 — full deterministic pipeline on shortlisted candidates
//   STAGE 3 — AI review on the TOP slice only (configurable budget)
// Demo markets are excluded from live results. No AI call per tick.
import type {
  AIProvider, AgentRun, AssetCategory, Candle, HyperliquidMarket, ScreenResult, ScreenerStats,
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
  liteScore: number;
  reasons: string[];
}

const MIN_NOTIONAL = 25000;

function stage0(markets: HyperliquidMarket[]): HyperliquidMarket[] {
  return markets.filter((m) => {
    if (m.isDelisted) return false;
    const vol = m.ctx?.dayNtlVlm;
    if (vol == null) return true; // unknown liquidity passes stage 0, scored later
    return vol >= MIN_NOTIONAL;
  });
}

function categoryBudget(perCategory: number): Map<AssetCategory, number> {
  const m = new Map<AssetCategory, number>();
  for (const c of CATEGORY_ORDER) m.set(c, perCategory);
  return m;
}

export async function fastScan(
  markets: HyperliquidMarket[],
  opts: { perCategory?: number; maxCandidates?: number } = {},
): Promise<FastCandidate[]> {
  const pool = stage0(markets);
  const budget = categoryBudget(opts.perCategory ?? 10);
  const out: FastCandidate[] = [];
  // Priority order: STOCKS → COMMODITIES → INDICES → FOREX → CRYPTO → rest
  const ordered = [...pool].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  for (const m of ordered) {
    const left = budget.get(m.category) ?? 0;
    if (left <= 0) continue;
    budget.set(m.category, left - 1);
    try {
      const [h4, m15] = await Promise.all([
        fetchCandlesCached(m.internalSymbol, '4H', 120).catch(() => null),
        fetchCandlesCached(m.internalSymbol, '15m', 120).catch(() => null),
      ]);
      if (!h4 || !m15 || h4.demo || m15.demo) continue;
      if (h4.candles.length < 60 || m15.candles.length < 60) continue;
      const a4 = analyzeTimeframe('4H', h4.candles);
      const a15 = analyzeTimeframe('15m', m15.candles);
      const reasons: string[] = [];
      let lite = 0;
      if (a4.bias !== 'NEUTRAL' && a4.bias === a15.bias) {
        lite += 40;
        reasons.push(`4H+15M aligned ${a4.bias}`);
      } else if (a4.bias !== 'NEUTRAL' || a15.bias !== 'NEUTRAL') {
        lite += 15;
        reasons.push('single-TF bias only');
      }
      const chg = Math.abs(m.priceChangePercent24h ?? 0);
      if (chg > 30) {
        lite -= 20;
        reasons.push('extreme 24H move — possible bad print or blow-off');
      }
      const atrp = a15.indicators.atrPercent ?? 0;
      if (atrp > 0 && atrp < 8) {
        lite += 10;
      } else if (atrp >= 8) {
        lite -= 10;
        reasons.push('volatility extreme');
      }
      if (a15.structure.bos) {
        lite += 15;
        reasons.push(`${a15.structure.bos} BOS on 15M`);
      }
      if (a15.smc.swept) {
        lite += 15;
        reasons.push(`liquidity sweep ${a15.smc.liquiditySweep}`);
      }
      const vol = m.ctx?.dayNtlVlm ?? 0;
      if (vol >= 1000000) lite += 10;
      out.push({ market: m, liteScore: lite, reasons });
    } catch {
      continue; // one market failing never kills the scan
    }
  }
  out.sort((a, b) => b.liteScore - a.liteScore);
  return out.slice(0, opts.maxCandidates ?? APP_CONFIG.screenerMaxCandidates);
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
  // Rank deterministically, AI-review only the top slice
  analyzed.sort((x, y) => y.analysis.signal.confluenceScore - x.analysis.signal.confluenceScore);
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
        memory: opts.memoryOf?.(analysis.symbol) ?? [],
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
  opts: Parameters<typeof scanFull>[1] & { perCategory?: number; maxCandidates?: number } = {},
): Promise<{ results: ScreenResult[]; stats: ScreenerStats; ledger: AgentRun[] }> {
  const startedAt = Date.now();
  const fast = await fastScan(markets, opts);
  const { results, aiReviewed, ledger } = await scanFull(fast, { ...opts, markets });
  const finishedAt = Date.now();
  const longCount = results.filter((r) => r.aiDirection === 'LONG' && (r.status === 'CONFIRMED' || r.status === 'CONDITIONAL')).length;
  const shortCount = results.filter((r) => r.aiDirection === 'SHORT' && (r.status === 'CONFIRMED' || r.status === 'CONDITIONAL')).length;
  const waitCount = results.filter((r) => r.status === 'WATCHING' || r.aiDirection === 'WAIT').length;
  const rejected = results.filter((r) => r.status === 'REJECTED' || r.status === 'INVALIDATED').length;
  return {
    results,
    ledger,
    stats: {
      scanned: markets.length,
      skippedDemo: 0,
      fastCandidates: fast.length,
      aiReviewed,
      longCount, shortCount, waitCount, rejected,
      startedAt, finishedAt, durationMs: finishedAt - startedAt,
    },
  };
}

export type { Candle };
