import { describe, it, expect } from 'vitest';
import type { HyperliquidMarket } from '../src/types';
import { classifyMarket, marketIdFor, dexLabelFor, assetNameFor, aliasesFor } from '../src/hyperliquid/symbols';
import { filteredMarkets, availableDexes, isMarketStale } from '../src/store/useStore';
import { findMarket } from '../src/providers/market-data/hyperliquid';
import { buildAnalystUserMessage } from '../src/agents/aiContext';
import { analyzeTimeframe } from '../src/core/mtf';
import { computeConfluence } from '../src/core/confluence';
import { generateSignal } from '../src/core/signals';
import type { AIContext, Candle, DerivativesAnalysis } from '../src/types';

function mockMarket(over: Partial<HyperliquidMarket> & { internalSymbol: string; dex: string }): HyperliquidMarket {
  const { internalSymbol, dex, ...rest } = over;
  const display = internalSymbol.includes(':') ? internalSymbol.split(':')[1] : internalSymbol;
  const c = classifyMarket(internalSymbol, dex);
  return {
    marketId: marketIdFor(internalSymbol, dex),
    internalSymbol,
    displaySymbol: display,
    assetName: display,
    underlying: display,
    category: c.category,
    classificationSource: c.source,
    dex,
    dexLabel: dexLabelFor(dex),
    maxLeverage: 10,
    szDecimals: 3,
    onlyIsolated: false,
    isDelisted: false,
    classificationReason: c.reason,
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
    ctx: null,
    price: 100,
    priceChangePercent24h: 1,
    ...rest,
  };
}

const EMPTY_DERIV: DerivativesAnalysis = {
  fundingRate: null, openInterest: null, longShortRatio: null, basis: null,
  markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null,
  unavailable: [], bias: 'NEUTRAL', notes: [],
};

describe('market identity', () => {
  it('marketId is dex-qualified and dex labels never invented', () => {
    expect(marketIdFor('BTC', '')).toBe('BTC');
    expect(marketIdFor('xyz:TSLA', 'xyz')).toBe('xyz:TSLA');
    expect(marketIdFor('ABC', 'dexA')).toBe('dexA:ABC');
    expect(dexLabelFor('')).toBe('MAIN');
    expect(dexLabelFor('xyz')).toBe('XYZ');
  });

  it('identical symbols on different DEXes are distinct markets', () => {
    const a = mockMarket({ internalSymbol: 'ABC', dex: 'dexA' });
    const b = mockMarket({ internalSymbol: 'ABC', dex: 'dexB' });
    expect(a.marketId).not.toBe(b.marketId);
    const registry = [a, b];
    // Neither overwrites the other in a marketId-keyed registry
    const byId = new Map(registry.map((m) => [m.marketId, m]));
    expect(byId.size).toBe(2);
    expect(findMarket(registry, a.marketId)).toBe(a);
    expect(findMarket(registry, b.marketId)).toBe(b);
  });

  it('same display symbol on different DEXes keeps both (STX case)', () => {
    const stacks = mockMarket({ internalSymbol: 'STX', dex: '' });
    const seagate = mockMarket({ internalSymbol: 'para:STX', dex: 'para' });
    expect(stacks.category).toBe('CRYPTO');
    expect(seagate.category).toBe('STOCK');
    expect(stacks.marketId).not.toBe(seagate.marketId);
  });
});

describe('classification source hierarchy', () => {
  it('tracks METADATA/DEX/PATTERN/MAPPING/UNKNOWN provenance', () => {
    expect(classifyMarket('xyz:TSLA', 'xyz').source).toBe('MAPPING');
    expect(classifyMarket('BTC', '').source).toBe('MAPPING');
    expect(classifyMarket('EURUSD', 'xyz').source).toBe('MAPPING');
    expect(classifyMarket('SOMEFutureCoin123', '').source).toBe('DEX'); // main-dex venue evidence
    expect(classifyMarket('xyz:ZZZQ', 'xyz').source).toBe('UNKNOWN');
    expect(classifyMarket('SPX', '').source).toBe('UNKNOWN'); // ambiguous
  });

  it('never classifies dangerous tickers by weak match', () => {
    for (const s of ['SPX', 'GAS', 'XYZ100', 'USAR', 'DRAM']) {
      expect(classifyMarket(s.startsWith('xyz:') ? s : s, s.startsWith('xyz:') ? 'xyz' : '').category).toBe('UNKNOWN');
    }
    expect(classifyMarket('META', 'xyz').category).toBe('STOCK'); // reliable mapping, not a guess
  });
});

describe('search + filters', () => {
  const registry = [
    mockMarket({ internalSymbol: 'xyz:GOLD', dex: 'xyz' }),
    mockMarket({ internalSymbol: 'xyz:AAPL', dex: 'xyz' }),
    mockMarket({ internalSymbol: 'BTC', dex: '' }),
    mockMarket({ internalSymbol: 'mkts:US500', dex: 'mkts' }),
  ];

  it('searches internal, display, asset name, underlying, aliases, dex', () => {
    expect(assetNameFor('GOLD')).toBe('Gold');
    expect(aliasesFor('AAPL')).toContain('apple');
    const byAlias = filteredMarkets({ markets: registry, category: 'ALL', search: 'apple' });
    expect(byAlias.map((m) => m.internalSymbol)).toContain('xyz:AAPL');
    const byName = filteredMarkets({ markets: registry, category: 'ALL', search: 'gold' });
    expect(byName.map((m) => m.internalSymbol)).toContain('xyz:GOLD');
    const byDex = filteredMarkets({ markets: registry, category: 'ALL', search: 'mkts' });
    expect(byDex.map((m) => m.internalSymbol)).toContain('mkts:US500');
    const byInternal = filteredMarkets({ markets: registry, category: 'ALL', search: 'xyz:AAPL' });
    expect(byInternal).toHaveLength(1);
  });

  it('DEX filter is dynamic and category filter never hides UNKNOWN', () => {
    expect(availableDexes(registry)).toEqual(['', 'mkts', 'xyz']);
    const xyzOnly = filteredMarkets({ markets: registry, category: 'ALL', search: '', dexFilter: 'xyz' });
    expect(xyzOnly).toHaveLength(2);
    expect(xyzOnly.every((m) => m.dex === 'xyz')).toBe(true);
    const unknown = mockMarket({ internalSymbol: 'xyz:ZZZQ', dex: 'xyz' });
    expect(unknown.category).toBe('UNKNOWN');
    const all = filteredMarkets({ markets: [...registry, unknown], category: 'ALL', search: '' });
    expect(all.map((m) => m.internalSymbol)).toContain('xyz:ZZZQ');
  });
});

describe('stale-data protection', () => {
  it('flags discovery older than the threshold', async () => {
    const { APP_CONFIG } = await import('../src/config/app');
    const fresh = mockMarket({ internalSymbol: 'BTC', dex: '' });
    expect(isMarketStale(fresh)).toBe(false);
    const old = { ...fresh, updatedAt: Date.now() - APP_CONFIG.marketStaleMs - 1000 };
    expect(isMarketStale(old)).toBe(true);
  });
});

describe('AI market identity', () => {
  it('analyst message carries full DEX/category/price-source identity', () => {
    const cs: Candle[] = Array.from({ length: 120 }, (_, i) => ({ openTime: i, open: 100, high: 101, low: 99, close: 100 + i * 0.05, volume: 100, closeTime: i }));
    const tf = analyzeTimeframe('15m', cs);
    const conf = computeConfluence([tf], EMPTY_DERIV);
    const sig = generateSignal({ symbol: 'GOLD', timeframe: '15m', price: 106, confluence: conf, regime: 'RANGE', atr: 1, swingHigh: null, swingLow: null, timeframeConflict: false });
    const ctx: AIContext = {
      symbol: 'GOLD', category: 'COMMODITY',
      identity: {
        marketId: 'xyz:GOLD', dex: 'xyz', dexLabel: 'XYZ', internalSymbol: 'xyz:GOLD',
        displaySymbol: 'GOLD', displayName: 'Gold', underlying: 'GOLD', category: 'COMMODITY',
        classificationSource: 'MAPPING', instrument: 'PERP', venue: 'Hyperliquid', stale: false,
      },
      price: 106, executionTimeframe: '15m', regime: 'RANGE', timeframes: [tf],
      confluence: conf, signal: sig,
      derivatives: { ...EMPTY_DERIV, markPrice: 106, oraclePrice: 105.5 },
      hyperliquid: null, assetInsights: [], risk: null,
    };
    const msg = buildAnalystUserMessage(ctx);
    expect(msg).toContain('xyz:GOLD');
    expect(msg).toContain('XYZ');
    expect(msg).toContain('COMMODITY');
    expect(msg).toContain('mark:');
    expect(msg).toContain('oracle:');
  });
});
