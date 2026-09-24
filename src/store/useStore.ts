import { create } from 'zustand';
import type { AnalysisMemoryEntry, AgentRun, AssetCategory, FinalTradeAnalysis, HyperliquidMarket, ScreenResult, ScreenerStats, TradingSignal } from '../types';
import type { SymbolAnalysis } from '../services/marketService';
import type { CategoryFilter } from '../config/app';
import { APP_CONFIG, resolveDefaultCategory } from '../config/app';
import { aliasesFor } from '../hyperliquid/symbols';
import { transitionSignal } from '../core/signals';
import { detectMeaningfulChange, summarizeMemoryEntry } from '../services/memory';

interface AppState {
  markets: HyperliquidMarket[];
  marketsLoading: boolean;
  marketsError: string | null;
  marketsUpdatedAt: number | null;
  /** marketIds seen in the latest discovery that were never seen before */
  newMarketIds: string[];
  category: CategoryFilter;
  /** DEX filter: 'ALL' or the actual dex identifier ('' = MAIN) */
  dexFilter: string;
  search: string;
  /** Canonical marketIds (DEX:SYMBOL). Migrated one-time from legacy internal symbols. */
  favorites: string[];
  executionTimeframe: string;
  analyses: Record<string, SymbolAnalysis>; // keyed by canonical marketId
  signals: TradingSignal[];
  /** Canonical marketId of the selected market */
  selectedSymbol: string;
  selectedSignalId: string | null;
  fullAnalyses: Record<string, FinalTradeAnalysis>; // keyed by canonical marketId
  aiEnabled: boolean;
  riskPercent: number;
  leverage: number;
  accountBalance: number;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  lastUpdated: number | null;
  // actions
  setMarkets: (m: HyperliquidMarket[]) => void;
  setMarketsLoading: (v: boolean) => void;
  setMarketsError: (e: string | null) => void;
  setCategory: (c: CategoryFilter) => void;
  setDexFilter: (d: string) => void;
  setSearch: (s: string) => void;
  toggleFavorite: (internal: string) => void;
  setAnalysis: (marketId: string, a: SymbolAnalysis) => void;
  setLoading: (symbol: string, v: boolean) => void;
  setError: (symbol: string, e: string) => void;
  addSignal: (s: TradingSignal) => void;
  updateSignal: (s: TradingSignal, reason?: string) => void;
  selectSymbol: (s: string) => void;
  selectSignal: (id: string | null) => void;
  setFull: (marketId: string, f: FinalTradeAnalysis) => void;
  /** Structured agent memory per marketId (capped, summaries only) */
  memory: Record<string, AnalysisMemoryEntry[]>;
  recordMemory: (marketId: string, e: AnalysisMemoryEntry) => void;
  // screener
  screenResults: ScreenResult[];
  screenStats: ScreenerStats | null;
  scanning: boolean;
  lastScanAt: number | null;
  autoScanMinutes: number;
  lastAgentLedger: AgentRun[];
  setScreener: (r: Partial<Pick<AppState, 'screenResults' | 'screenStats' | 'scanning' | 'lastScanAt' | 'autoScanMinutes' | 'lastAgentLedger'>>) => void;
  setExecutionTimeframe: (tf: string) => void;
  setRisk: (r: Partial<Pick<AppState, 'riskPercent' | 'leverage' | 'accountBalance' | 'aiEnabled'>>) => void;
  marketCategoryOf: (marketId: string) => AssetCategory;
}

const HISTORY_KEY = 'sunil-hl-signals-v1';
const FAV_KEY = 'sunil-hl-favorites-v1';
const PREF_KEY = 'sunil-hl-prefs-v1';
// v2: canonical DEX:SYMBOL ids (v1 used bare internal symbols).
const KNOWN_MARKETS_KEY = 'sunil-hl-known-markets-v2';
const FAV_MIGRATED_KEY = 'sunil-hl-favorites-migrated-v2';

function loadKnownMarketIds(): string[] {
  try {
    const raw = localStorage.getItem(KNOWN_MARKETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function loadHistory(): TradingSignal[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as TradingSignal[];
    return Array.isArray(arr) ? arr.slice(-100) : [];
  } catch {
    return [];
  }
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function loadPrefs(): { category?: CategoryFilter; executionTimeframe?: string; dexFilter?: string } {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as { category?: CategoryFilter; executionTimeframe?: string; dexFilter?: string };
  } catch {
    return {};
  }
}

export const useStore = create<AppState>((set, get) => ({
  markets: [],
  marketsLoading: false,
  marketsError: null,
  marketsUpdatedAt: null,
  newMarketIds: [],
  category: loadPrefs().category ?? resolveDefaultCategory(),
  dexFilter: loadPrefs().dexFilter ?? 'ALL',
  search: '',
  favorites: typeof localStorage !== 'undefined' ? loadFavorites() : [],
  executionTimeframe: loadPrefs().executionTimeframe ?? '15m',
  analyses: {},
  signals: typeof localStorage !== 'undefined' ? loadHistory() : [],
  selectedSymbol: '',
  selectedSignalId: null,
  fullAnalyses: {},
  aiEnabled: true,
  riskPercent: 1,
  leverage: 1,
  accountBalance: 10000,
  loading: {},
  errors: {},
  lastUpdated: null,
  setMarkets: (markets) => {
    const st = get();
    // One-time favorites migration: legacy internal symbols → canonical marketIds.
    let favorites = st.favorites;
    try {
      if (typeof localStorage !== 'undefined' && !localStorage.getItem(FAV_MIGRATED_KEY) && favorites.length) {
        const migrated = favorites.flatMap((f) => {
          const hit = markets.find((m) => m.marketId === f || m.internalSymbol === f);
          return hit ? [hit.marketId] : [];
        });
        favorites = [...new Set(migrated)];
        localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
        localStorage.setItem(FAV_MIGRATED_KEY, '1');
      } else if (typeof localStorage !== 'undefined' && !localStorage.getItem(FAV_MIGRATED_KEY)) {
        localStorage.setItem(FAV_MIGRATED_KEY, '1');
      }
    } catch { /* ignore — never break discovery */ }
    let selectedSymbol = st.selectedSymbol;
    if (!selectedSymbol || !markets.some((m) => m.marketId === selectedSymbol || m.internalSymbol === selectedSymbol)) {
      // Prefer first STOCK, else first market
      const stock = markets.find((m) => m.category === 'STOCK');
      selectedSymbol = (stock ?? markets[0])?.marketId ?? '';
    } else {
      // Normalize legacy internal selection to canonical marketId.
      const hit = markets.find((m) => m.marketId === selectedSymbol || m.internalSymbol === selectedSymbol);
      if (hit) selectedSymbol = hit.marketId;
    }
    // NEW-market detection: ids never seen in any previous discovery.
    // First-ever discovery establishes the baseline (nothing flagged NEW).
    let newMarketIds: string[] = st.newMarketIds;
    try {
      const known = loadKnownMarketIds();
      if (known.length === 0) {
        try { localStorage.setItem(KNOWN_MARKETS_KEY, JSON.stringify(markets.map((m) => m.marketId))); } catch { /* ignore */ }
        newMarketIds = [];
      } else {
        const knownSet = new Set(known);
        newMarketIds = markets.filter((m) => !knownSet.has(m.marketId)).map((m) => m.marketId);
        try { localStorage.setItem(KNOWN_MARKETS_KEY, JSON.stringify(markets.map((m) => m.marketId))); } catch { /* ignore */ }
      }
    } catch { /* ignore — never break discovery */ }
    // Drop DEX filter if the dex vanished from the universe
    let dexFilter = st.dexFilter;
    if (dexFilter !== 'ALL' && !markets.some((m) => m.dex === dexFilter)) dexFilter = 'ALL';
    set({ markets, marketsUpdatedAt: Date.now(), selectedSymbol, favorites, newMarketIds, dexFilter });
  },
  setMarketsLoading: (marketsLoading) => set({ marketsLoading }),
  setMarketsError: (marketsError) => set({ marketsError }),
  setCategory: (category) => {
    set({ category });
    try {
      const p = loadPrefs();
      localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, category }));
    } catch { /* ignore */ }
  },
  setDexFilter: (dexFilter) => {
    set({ dexFilter });
    try {
      const p = loadPrefs();
      localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, dexFilter }));
    } catch { /* ignore */ }
  },
  setSearch: (search) => set({ search }),
  toggleFavorite: (marketId) =>
    set((s) => {
      const has = s.favorites.includes(marketId);
      const favorites = has ? s.favorites.filter((x) => x !== marketId) : [...s.favorites, marketId];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch { /* ignore */ }
      return { favorites };
    }),
  setAnalysis: (marketId, a) => set((s) => ({ analyses: { ...s.analyses, [marketId]: a }, lastUpdated: Date.now() })),
  setLoading: (symbol, v) => set((s) => ({ loading: { ...s.loading, [symbol]: v } })),
  setError: (symbol, e) => set((s) => ({ errors: { ...s.errors, [symbol]: e } })),
  addSignal: (sig) =>
    set((s) => {
      const next = [...s.signals, sig].slice(-100);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { signals: next };
    }),
  updateSignal: (sig, reason = 'status update') =>
    set((s) => {
      const next = s.signals.map((x) => {
        if (x.id !== sig.id) return x;
        const withStatus = { ...sig, history: x.history?.length ? x.history : sig.history ?? [] };
        return transitionSignal(withStatus, sig.status, reason);
      });
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { signals: next };
    }),
  selectSymbol: (selectedSymbol) => set({ selectedSymbol }),
  selectSignal: (selectedSignalId) => set({ selectedSignalId }),
  setFull: (symbol, f) => set((s) => ({ fullAnalyses: { ...s.fullAnalyses, [symbol]: f } })),
  memory: {},
  recordMemory: (marketId, e) =>
    set((s) => {
      const prev = s.memory[marketId] ?? [];
      const last = prev[prev.length - 1];
      // Persistent memory keeps the first entry and every MEANINGFUL change only.
      const delta = detectMeaningfulChange(last, { ...e, marketId });
      if (!delta.remember) return s;
      const full = { ...e, marketId };
      const entry = { ...full, summary: `${summarizeMemoryEntry(full)} — ${delta.reasons.join('; ')}` };
      return { memory: { ...s.memory, [marketId]: [...prev, entry].slice(-20) } };
    }),
  screenResults: [],
  screenStats: null,
  scanning: false,
  lastScanAt: null,
  autoScanMinutes: 0,
  lastAgentLedger: [],
  setScreener: (r) => set(r),
  setExecutionTimeframe: (executionTimeframe) => {
    set({ executionTimeframe });
    try {
      const p = loadPrefs();
      localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, executionTimeframe }));
    } catch { /* ignore */ }
  },
  setRisk: (r) => set(r),
  marketCategoryOf: (marketId) => get().markets.find((m) => m.marketId === marketId || m.internalSymbol === marketId)?.category ?? 'UNKNOWN',
}));

export function filteredMarkets(
  state: Pick<AppState, 'markets' | 'category' | 'search'> & { dexFilter?: string },
): HyperliquidMarket[] {
  const q = state.search.trim().toLowerCase();
  const dexFilter = state.dexFilter ?? 'ALL';
  return state.markets.filter((m) => {
    if (state.category !== 'ALL' && m.category !== state.category) return false;
    if (dexFilter !== 'ALL' && m.dex !== dexFilter) return false;
    if (!q) return true;
    // Search across the full market identity: internal, display, asset name,
    // underlying, aliases, market id, and DEX.
    if (
      m.displaySymbol.toLowerCase().includes(q) ||
      m.internalSymbol.toLowerCase().includes(q) ||
      m.marketId.toLowerCase().includes(q) ||
      m.assetName.toLowerCase().includes(q) ||
      m.underlying.toLowerCase().includes(q) ||
      m.dex.toLowerCase().includes(q) ||
      m.dexLabel.toLowerCase().includes(q)
    ) return true;
    return aliasesFor(m.displaySymbol).some((a) => a.includes(q) || q.includes(a));
  });
}

/** Distinct DEX identifiers present in the universe ('' = MAIN), sorted with MAIN first. */
export function availableDexes(markets: HyperliquidMarket[]): string[] {
  const set = new Set(markets.map((m) => m.dex));
  return [...set].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}

/** Stale-data protection: discovery older than the threshold must not be presented as live. */
export function isMarketStale(m: HyperliquidMarket, now = Date.now()): boolean {
  return now - m.updatedAt > APP_CONFIG.marketStaleMs;
}
