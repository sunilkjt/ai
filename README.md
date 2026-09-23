# Sunil AI Hyperliquid Analyst

Hyperliquid-first, AI-powered market analysis terminal for **stocks, commodities, indices, forex and crypto perpetuals**. **Deterministic engine computes facts; AI reasons over them; a critic validates; a deterministic risk engine prices the trade.**

> AI assessment confidence is not probability of profit. Informational only — not financial advice. No auto-trading in v1.

Independent project — inspired by reusable concepts from `sunilsignal1`, with its own Hyperliquid-first architecture and source code.

## Product pipeline

```
Hyperliquid Market Data → Asset Discovery → Multi-Timeframe Analysis →
Technical Analysis → SMC/ICT → Market Structure → Confluence Engine →
Signal Engine → AI Market Analyst → AI Critic → Risk Engine → Final Trade Analysis
```

## Quick start

```bash
npm install
npm run dev      # http://localhost:5174
npm test         # vitest
npm run build    # typecheck + production build
```

## Hyperliquid integration

- `src/hyperliquid/client.ts` — POST `/info` transport (public data, no key)
- `src/hyperliquid/markets.ts` — discovery via `allPerpMetas` (+`metaAndAssetCtxs` fallback)
- `src/hyperliquid/symbols.ts` — `HyperliquidSymbolResolver` + classification (STOCK/COMMODITY/INDEX/FOREX/CRYPTO/OTHER/UNKNOWN, never falsely classified)
- `src/hyperliquid/candles.ts` — per-coin candles (`1m/5m/15m/1h/4h/1d`)
- `src/hyperliquid/derivatives.ts` — funding/OI/mark/oracle/premium + `HyperliquidContext` (underlying vs perp behavior)
- `src/providers/market-data/hyperliquid.ts` — `HyperliquidProvider` (primary `MarketDataProvider`)

## AI configuration (optional)

The app works without keys via a deterministic local-fallback analyst (clearly labeled).
For live LLM reasoning, create `.env` from `.env.example` (never commit `.env`).
Production should proxy AI calls server-side; keys must never ship in client bundles.
AI is called only on user request / new signal / structure change / volatility event / refresh interval, with a 5-minute structure-hash cache.

## Project layout

- `src/types` — data contracts (Hyperliquid markets, SMC/ICT, signals, risk, AI I/O)
- `src/hyperliquid` — client, markets, candles, derivatives, symbols
- `src/analyzers` — `AssetAnalyzer` (Stock/Commodity/Index/Forex/Crypto) over shared structure/trend/momentum/liquidity/SMC/ICT/risk
- `src/core` — indicators, structure, SMC/ICT, MTF, confluence, signals, risk, backtest
- `src/agents` — prompts, context builder, orchestrator (context→analyst→critic→risk→final)
- `src/providers` — Hyperliquid market data, OpenAI-compatible AI + local fallback
- `src/pages` — Dashboard, Markets, AI Analyst, Signals, Watchlist, Backtest, History, Settings
- `src/components`, `src/hooks`, `src/store`, `src/services`, `src/utils`, `src/config`

## Notes

- Asset universe is discovered live from Hyperliquid — never hard-coded.
- Confluence 0–100 measures setup quality, never profit probability.
- Backtest page is strictly separated from live tracked performance.
- Signals: NEW → ACTIVE → TP1/TP2_HIT / SL_HIT / EXPIRED / INVALIDATED.
- v1 never places orders, changes leverage, or moves funds.
