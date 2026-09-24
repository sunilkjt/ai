import { useCallback, useEffect, useRef } from 'react';
import { APP_CONFIG } from '../config/app';
import { analyzeSymbol } from '../services/marketService';
import { findMarket, getDiscoveredMarkets } from '../providers/market-data/hyperliquid';
import { useStore, filteredMarkets } from '../store/useStore';
import { getAIProvider } from '../providers/ai/factory';
import { evaluateSignalLifecycle, assessSignalStrength } from '../core/signals';
import { detectTraps } from '../core/traps';
import { log } from '../utils/logger';

/** Discover Hyperliquid markets on startup + refresh periodically. */
export function useMarketDiscovery(): void {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discover = useCallback(async () => {
    const store = useStore.getState();
    store.setMarketsLoading(true);
    try {
      const markets = await getDiscoveredMarkets(true);
      store.setMarkets(markets);
      store.setMarketsError(null);
    } catch (e) {
      store.setMarketsError(e instanceof Error ? e.message : 'discovery failed');
    } finally {
      store.setMarketsLoading(false);
    }
  }, []);

  useEffect(() => {
    void discover();
    timer.current = setInterval(() => { void discover(); }, APP_CONFIG.pollIntervalMs * 4);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [discover]);
}

/**
 * Poll a focused subset of markets (visible category + favorites + selected)
 * to keep Hyperliquid rate limits healthy. AI only when withAI=true.
 */
export function useMarketPolling(withAI = false, limit = 12): void {
  const executionTimeframe = useStore((s) => s.executionTimeframe);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const riskPercent = useStore((s) => s.riskPercent);
  const leverage = useStore((s) => s.leverage);
  const accountBalance = useStore((s) => s.accountBalance);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const store = useStore.getState();
    if (store.markets.length === 0) return;
    const { category, dexFilter, search, favorites, selectedSymbol } = store;
    // Poll the visible universe (category + DEX + search), honoring cache/refresh limits.
    let pool = filteredMarkets({ markets: store.markets, category, search, dexFilter });
    // Always include selected + favorites (all canonical marketIds; legacy internals resolve via findMarket)
    const must = new Set<string>([selectedSymbol, ...favorites].filter(Boolean));
    for (const f of must) {
      const m = findMarket(store.markets, f);
      if (m && !pool.some((x) => x.marketId === m.marketId)) pool.push(m);
    }
    pool = pool.slice(0, Math.max(limit, must.size));

    for (const m of pool) {
      const key = m.marketId;
      store.setLoading(key, true);
      try {
        const analysis = await analyzeSymbol(m.marketId, {
          executionTimeframe,
          withAI: withAI && aiEnabled && key === store.selectedSymbol,
          aiProvider: withAI && aiEnabled ? getAIProvider() : null,
          riskOpts: { accountBalance, riskPercent, leverage },
          markets: store.markets,
        });
        store.setAnalysis(key, analysis);
        if (withAI && analysis.full) store.setFull(key, analysis.full);
        const execFrame = analysis.timeframes[analysis.timeframes.length - 1];
        const trapNow = detectTraps({
          signal: analysis.signal, timeframes: analysis.timeframes,
          derivatives: analysis.derivatives, change24h: analysis.change24h, oiRising: null,
        });
        store.recordMemory(analysis.marketId, {
          at: Date.now(),
          marketId: analysis.marketId,
          display: analysis.symbol,
          decision: analysis.signal.direction,
          regime: analysis.regime,
          direction: analysis.signal.direction,
          confluence: analysis.signal.confluenceScore,
          confidence: analysis.full?.ai?.confidence ?? null,
          entry: analysis.signal.entry ?? null,
          stopLoss: analysis.signal.stopLoss ?? null,
          takeProfit1: analysis.signal.takeProfit1 ?? null,
          riskReward: analysis.signal.riskReward ?? null,
          structure: execFrame?.structure.trend ?? 'NEUTRAL',
          trapRisk: trapNow.risk,
          disagreement: 'n/a (polling path)',
          summary: '',
        });
        const sig = analysis.signal;
        // Demo data never yields tracked signals.
        if (!analysis.demo && sig.direction !== 'WAIT') {
          const exists = store.signals.some((x) => x.id === sig.id);
          if (!exists) {
            const dup = store.signals.some(
              (x) => x.symbol === sig.symbol && x.timeframe === sig.timeframe && x.direction === sig.direction && Math.abs(x.timestamp - sig.timestamp) < 1000 * 60 * 15,
            );
            if (!dup) {
              store.addSignal({
                ...sig,
                marketId: analysis.marketId,
                dex: analysis.dex,
                category: analysis.category,
              });
              log('SIGNAL', `${sig.symbol} ${sig.direction} @ ${sig.entry} (confluence ${sig.confluenceScore})`);
            }
          }
        }
        for (const open of useStore.getState().signals) {
          if ((open.marketId ?? open.symbol) !== (sig.marketId ?? sig.symbol)) continue;
          if (!['NEW', 'ACTIVE', 'STRENGTHENING', 'WEAKENING'].includes(open.status)) continue;
          const next = evaluateSignalLifecycle(open, analysis.price);
          if (next !== open.status) {
            useStore.getState().updateSignal(
              { ...open, status: next },
              `lifecycle on ${analysis.symbol} @ ${analysis.price}`,
            );
            continue;
          }
          // Analytic strength state (never overwrites price lifecycle history — appends).
          const strength = assessSignalStrength(open, sig.confluenceScore, sig.direction, trapNow.risk);
          if (strength && strength !== open.status) {
            useStore.getState().updateSignal(
              { ...open, status: strength },
              `confluence ${open.confluenceScore} → ${sig.confluenceScore}, trap ${trapNow.risk}`,
            );
          }
        }
      } catch (e) {
        store.setError(key, e instanceof Error ? e.message : 'fetch failed');
      } finally {
        store.setLoading(key, false);
      }
    }
  }, [executionTimeframe, withAI, aiEnabled, accountBalance, riskPercent, leverage, limit]);

  useEffect(() => {
    void poll();
    timer.current = setInterval(() => { void poll(); }, APP_CONFIG.pollIntervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);
}
