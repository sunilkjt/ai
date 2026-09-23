// TradingAgentOrchestrator: 4 agents — Market Context → Signal Analyst →
// AI Critic → Risk — with deterministic risk engine as source of truth.
// Workflow: market → candles → derivatives → MTF → TA → SMC/ICT →
// confluence → deterministic signal → AI context → analyst → critic →
// risk engine → validation → final analysis.
// AI cost control: in-memory cache, trigger-gated calls, graceful fallback.
import type {
  AIAnalysis, AICritique, AIContext, AIProvider, AssetCategory, DerivativesAnalysis,
  FinalDecision, FinalTradeAnalysis, HyperliquidContext, MarketRegime, RiskAnalysis,
  TimeframeAnalysis, TradingSignal,
} from '../types';
import { APP_CONFIG } from '../config/app';
import { computeRisk } from '../core/risk';
import { LocalFallbackProvider } from '../providers/ai/providers';

interface CacheEntry { at: number; analysis: FinalTradeAnalysis; key: string; }

const cache = new Map<string, CacheEntry>();

export function analysisCacheKey(symbol: string, tf: string, signalId: string, structureHash: string): string {
  return `${symbol}|${tf}|${signalId}|${structureHash}`;
}

export function structureHash(frames: TimeframeAnalysis[]): string {
  return frames.map((f) => `${f.bias}:${f.structure.bos ?? '-'}:${f.structure.choch ?? '-'}:${f.smc.points}`).join('/');
}

export function getCached(key: string): FinalTradeAnalysis | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > APP_CONFIG.aiCacheMs) {
    cache.delete(key);
    return null;
  }
  return { ...hit.analysis, ai: hit.analysis.ai ? { ...hit.analysis.ai, cached: true } : null };
}

// Final decision engine: deterministic signal + AI analysis + critic + risk validation.
export function decideFinal(signal: TradingSignal, ai: AIAnalysis | null, critique: AICritique | null, risk: RiskAnalysis | null): FinalDecision {
  if (!ai) {
    if (signal.direction === 'WAIT') return 'WAIT';
    return signal.confluenceScore >= 60 ? signal.direction : 'WAIT';
  }
  let decision: FinalDecision = ai.decision;
  if (critique?.verdict === 'WAIT' && (decision === 'LONG' || decision === 'SHORT')) {
    decision = 'WAIT';
  }
  if (risk && !risk.valid && (decision === 'LONG' || decision === 'SHORT')) {
    decision = 'WAIT';
  }
  if (signal.direction === 'WAIT' && (decision === 'LONG' || decision === 'SHORT')) {
    decision = 'WAIT';
  }
  return decision;
}

export async function runFullAnalysis(params: {
  symbol: string;
  category: AssetCategory;
  executionTimeframe: string;
  price: number;
  regime: MarketRegime;
  timeframes: TimeframeAnalysis[];
  confluence: import('../types').ConfluenceResult;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  assetInsights: string[];
  provider: AIProvider | null;
  riskOpts?: { accountBalance?: number; riskPercent?: number; leverage?: number };
  forceRefresh?: boolean;
}): Promise<FinalTradeAnalysis> {
  const { symbol, category, executionTimeframe, price, regime, timeframes, confluence, signal, derivatives, hyperliquid, assetInsights, provider, riskOpts } = params;
  const risk = computeRisk(signal, riskOpts);
  const hash = structureHash(timeframes);
  const key = analysisCacheKey(symbol, executionTimeframe, signal.id, hash);
  if (!params.forceRefresh) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const active: AIProvider = provider ?? new LocalFallbackProvider();
  const ctx: AIContext = { symbol, category, price, executionTimeframe, regime, timeframes, confluence, signal, derivatives, hyperliquid, assetInsights, risk };

  let ai: AIAnalysis | null = null;
  let critique: AICritique | null = null;
  let aiAvailable = true;
  try {
    ai = await active.analyze(ctx);
    critique = await active.critique({ ...ctx, analystSummary: ai.explanation });
  } catch {
    aiAvailable = active.name !== 'local-fallback';
    try {
      const fb = new LocalFallbackProvider();
      ai = await fb.analyze(ctx);
      critique = await fb.critique({ ...ctx, analystSummary: ai.explanation });
    } catch {
      ai = null;
      critique = null;
    }
  }

  const finalDecision = decideFinal(signal, ai, critique, risk);
  const tradePlan: string[] = [];
  if (risk && (finalDecision === 'LONG' || finalDecision === 'SHORT')) {
    tradePlan.push(`Entry ${risk.entry.toFixed(2)}`, `SL ${risk.stopLoss.toFixed(2)}`, `TP1 ${risk.takeProfit1.toFixed(2)}`);
    if (risk.takeProfit2) tradePlan.push(`TP2 ${risk.takeProfit2.toFixed(2)}`);
    tradePlan.push(`R:R ${risk.riskReward.toFixed(2)}`);
  } else {
    tradePlan.push(finalDecision === 'WAIT' ? 'WAIT — no entry until confirmation' : 'NO TRADE');
  }

  const result: FinalTradeAnalysis = {
    symbol, category, executionTimeframe, price, regime,
    deterministic: signal, confluence, timeframes, derivatives,
    hyperliquid, assetInsights,
    ai, critique, risk, finalDecision, tradePlan,
    timestamp: Date.now(), aiAvailable,
  };
  cache.set(key, { at: Date.now(), analysis: result, key });
  return result;
}

export function clearAnalysisCache(): void {
  cache.clear();
}
