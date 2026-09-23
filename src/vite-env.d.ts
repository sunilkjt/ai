/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HYPERLIQUID_API?: string;
  readonly VITE_POLL_INTERVAL_MS?: string;
  readonly VITE_MARKET_CACHE_MS?: string;
  readonly VITE_AI_API_KEY?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_AI_BASE_URL?: string;
  readonly VITE_DEFAULT_CATEGORY?: string;
  readonly VITE_DEFAULT_TIMEFRAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __SUNIL_AI__?: { apiKey?: string; model?: string; baseUrl?: string };
}
