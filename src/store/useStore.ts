import { create } from 'zustand';
import type { AssetCategory, FinalTradeAnalysis, HyperliquidMarket, TradingSignal } from '../types';
import type { SymbolAnalysis } from '../services/marketService';
import type { CategoryFilter } from '../config/app';
import { resolveDefaultCategory } from '../config/app';

interface AppState {
  markets: HyperliquidMarket[];
  marketsLoading: boolean;
  marketsError: string | null;
  marketsUpdatedAt: number | null;
  category: CategoryFilter;
  search: string;
  favorites: string[]; // internal symbols
  executionTimeframe: string;
  analyses: Record<string, SymbolAnalysis>; // keyed by internal symbol
  signals: TradingSignal[];
  selectedSymbol: string; // internal symbol
  selectedSignalId: string | null;
  fullAnalyses: Record<string, FinalTradeAnalysis>;
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
  setSearch: (s: string) => void;
  toggleFavorite: (internal: string) => void;
  setAnalysis: (internal: string, a: SymbolAnalysis) => void;
  setLoading: (symbol: string, v: boolean) => void;
  setError: (symbol: string, e: string) => void;
  addSignal: (s: TradingSignal) => void;
  updateSignal: (s: TradingSignal) => void;
  selectSymbol: (s: string) => void;
  selectSignal: (id: string | null) => void;
  setFull: (symbol: string, f: FinalTradeAnalysis) => void;
  setExecutionTimeframe: (tf: string) => void;
  setRisk: (r: Partial<Pick<AppState, 'riskPercent' | 'leverage' | 'accountBalance' | 'aiEnabled'>>) => void;
  marketCategoryOf: (internal: string) => AssetCategory;
}

const HISTORY_KEY = 'sunil-hl-signals-v1';
const FAV_KEY = 'sunil-hl-favorites-v1';
const PREF_KEY = 'sunil-hl-prefs-v1';

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

function loadPrefs(): { category?: CategoryFilter; executionTimeframe?: string } {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as { category?: CategoryFilter };
  } catch {
    return {};
  }
}

export const useStore = create<AppState>((set, get) => ({
  markets: [],
  marketsLoading: false,
  marketsError: null,
  marketsUpdatedAt: null,
  category: loadPrefs().category ?? resolveDefaultCategory(),
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
    let selectedSymbol = st.selectedSymbol;
    if (!selectedSymbol || !markets.some((m) => m.internalSymbol === selectedSymbol)) {
      // Prefer first STOCK, else first market
      const stock = markets.find((m) => m.category === 'STOCK');
      selectedSymbol = (stock ?? markets[0])?.internalSymbol ?? '';
    }
    set({ markets, marketsUpdatedAt: Date.now(), selectedSymbol });
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
  setSearch: (search) => set({ search }),
  toggleFavorite: (internal) =>
    set((s) => {
      const has = s.favorites.includes(internal);
      const favorites = has ? s.favorites.filter((x) => x !== internal) : [...s.favorites, internal];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch { /* ignore */ }
      return { favorites };
    }),
  setAnalysis: (internal, a) => set((s) => ({ analyses: { ...s.analyses, [internal]: a }, lastUpdated: Date.now() })),
  setLoading: (symbol, v) => set((s) => ({ loading: { ...s.loading, [symbol]: v } })),
  setError: (symbol, e) => set((s) => ({ errors: { ...s.errors, [symbol]: e } })),
  addSignal: (sig) =>
    set((s) => {
      const next = [...s.signals, sig].slice(-100);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { signals: next };
    }),
  updateSignal: (sig) =>
    set((s) => {
      const next = s.signals.map((x) => (x.id === sig.id ? sig : x));
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { signals: next };
    }),
  selectSymbol: (selectedSymbol) => set({ selectedSymbol }),
  selectSignal: (selectedSignalId) => set({ selectedSignalId }),
  setFull: (symbol, f) => set((s) => ({ fullAnalyses: { ...s.fullAnalyses, [symbol]: f } })),
  setExecutionTimeframe: (executionTimeframe) => {
    set({ executionTimeframe });
    try {
      const p = loadPrefs();
      localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, executionTimeframe }));
    } catch { /* ignore */ }
  },
  setRisk: (r) => set(r),
  marketCategoryOf: (internal) => get().markets.find((m) => m.internalSymbol === internal)?.category ?? 'UNKNOWN',
}));

export function filteredMarkets(state: Pick<AppState, 'markets' | 'category' | 'search'>): HyperliquidMarket[] {
  const q = state.search.trim().toLowerCase();
  return state.markets.filter((m) => {
    if (state.category !== 'ALL' && m.category !== state.category) return false;
    if (!q) return true;
    return (
      m.displaySymbol.toLowerCase().includes(q) ||
      m.internalSymbol.toLowerCase().includes(q) ||
      m.underlying.toLowerCase().includes(q)
    );
  });
}
