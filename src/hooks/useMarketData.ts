import { useCallback, useEffect, useRef } from 'react';
import { APP_CONFIG } from '../config/app';
import { analyzeSymbol } from '../services/marketService';
import { findMarket, getDiscoveredMarkets } from '../providers/market-data/hyperliquid';
import { useStore, filteredMarkets } from '../store/useStore';
import { getAIProvider } from '../providers/ai/factory';
import { evaluateSignalLifecycle } from '../core/signals';
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
    // Always include selected + favorites
    const must = new Set<string>([selectedSymbol, ...favorites].filter(Boolean));
    for (const f of must) {
      const m = findMarket(store.markets, f);
      if (m && !pool.some((x) => x.internalSymbol === m.internalSymbol)) pool.push(m);
    }
    pool = pool.slice(0, Math.max(limit, must.size));

    for (const m of pool) {
      const key = m.internalSymbol;
      store.setLoading(key, true);
      try {
        const analysis = await analyzeSymbol(key, {
          executionTimeframe,
          withAI: withAI && aiEnabled && key === store.selectedSymbol,
          aiProvider: withAI && aiEnabled ? getAIProvider() : null,
          riskOpts: { accountBalance, riskPercent, leverage },
          markets: store.markets,
        });
        store.setAnalysis(key, analysis);
        if (withAI && analysis.full) store.setFull(key, analysis.full);
        const sig = analysis.signal;
        if (sig.direction !== 'WAIT') {
          const exists = store.signals.some((x) => x.id === sig.id);
          if (!exists) {
            const dup = store.signals.some(
              (x) => x.symbol === sig.symbol && x.timeframe === sig.timeframe && x.direction === sig.direction && Math.abs(x.timestamp - sig.timestamp) < 1000 * 60 * 15,
            );
            if (!dup) {
              store.addSignal(sig);
              log('SIGNAL', `${sig.symbol} ${sig.direction} @ ${sig.entry} (confluence ${sig.confluenceScore})`);
            }
          }
        }
        for (const open of useStore.getState().signals) {
          if (open.symbol !== sig.symbol) continue;
          if (!['NEW', 'ACTIVE'].includes(open.status)) continue;
          const next = evaluateSignalLifecycle(open, analysis.price);
          if (next !== open.status) useStore.getState().updateSignal({ ...open, status: next });
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
