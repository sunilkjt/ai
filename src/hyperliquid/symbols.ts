// HyperliquidSymbolResolver + asset classification layer.
// Never falsely classify: returns UNKNOWN when evidence is insufficient.
//
// Evidence order:
//  1. Explicit known-symbol sets (curated from the live Hyperliquid universe).
//  2. Ambiguity guard (e.g. bare "SPX" = SPX6900 memecoin vs S&P 500 → UNKNOWN).
//  3. Conservative shape heuristics (fiat pairs).
//  4. Venue default: the main Hyperliquid perp dex ("") is the crypto venue —
//     unrecognized main-dex listings are CRYPTO unless known otherwise.
//     HIP-3 builder dexes mix asset classes, so unknowns there stay UNKNOWN.
//  5. UNKNOWN fallback.
import type { AssetCategory, ClassificationSource, HyperliquidSymbolInfo } from '../types';

// ---- Known sets (display-symbol level, uppercase) ----

const CRYPTO_MAJORS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'ARB',
  'HYPE', 'SUI', 'APT', 'NEAR', 'ATOM', 'OP', 'INJ', 'TIA', 'SEI', 'JUP',
  'ONDO', 'ENA', 'WIF', 'PEPE', 'BONK', 'LDO', 'AAVE', 'UNI', 'MKR', 'STX',
  'FIL', 'AR', 'DOT', 'MATIC', 'POL', 'LTC', 'BCH', 'ETC', 'TRX', 'HBAR',
  'PURR', 'PENGU', 'FARTCOIN', 'POPCAT', 'MEW', 'PYTH', 'JASMY', 'RENDER',
  'TAO', 'FET', 'WLD', 'ARKM', 'CRV', 'SNX', 'DYDX', 'GMX', 'LRC', 'ZEC',
  'APE', 'CFX', 'TRB', 'KAS', 'BLUR', 'MINA', 'NEO', 'GALA', 'CAKE', 'ENS',
  'XAI', 'MANTA', 'UMA', 'ALT', 'ZETA', 'DYM', 'STRK', 'BOME', 'ETHFI', 'MNT',
  'SAGA', 'EIGEN', 'NOT', 'TURBO', 'BRETT', 'ZK', 'CELO', 'GOAT', 'GRASS',
  'PNUT', 'XLM', 'SAND', 'IOTA', 'ALGO', 'MOVE', 'VIRTUAL', 'AIXBT', 'BIO',
  'MORPHO', 'TRUMP', 'MELANIA', 'ANIME', 'BERA', 'KAITO', 'WCT', 'ZORA',
  'PUMP', 'XPL', 'WLFI', 'LINEA', 'SKY', 'ASTER', 'STBL', 'HEMI', 'APEX',
  'MON', 'MEGA', 'ICP', 'AERO', 'FOGO', 'LIT', 'XMR', 'AXS', 'DASH', 'AZTEC',
  'BANANA', 'BIGTIME', 'PENDLE', 'MEME', 'ORDI', 'ZEN', 'SUSHI', 'IMX', 'GMT',
  'SUPER', 'JTO', 'ACE', 'PEOPLE', 'RUNE', 'ZRO', 'BSV', 'POLYX', 'FET',
  'MERL', 'REZ', 'EIGEN', 'MOODENG', 'NEIRO', 'SHIB', 'FLOKI', 'LUNC',
  'YGG', 'COMP', 'LDO', 'MKR', 'LRC', 'RSR', 'TNSR', 'SOPH', 'RESOLV', 'SYRUP',
  'PROVE', 'AVNT', 'INIT', 'NXPC', 'BABY', 'HYPER', 'LAYER', 'NIL', 'VVV',
]);

// Ambiguous display symbols that must NEVER be auto-classified.
const AMBIGUOUS = new Set([
  'SPX', // SPX6900 memecoin (main dex) vs S&P 500 index
  'GAS', // Neo Gas token (main dex) vs natural gasoline/gasoline commodity
  'XYZ100',
  'SKHX', 'USAR', 'SMSN', 'KORU', 'KSTR', 'SKHY', 'SHAZ', 'GIGADEV', 'BOT',
  'STRC', 'ZHIPU', 'NCLD', 'LYTE', 'UNITREE', 'MINIMAX', 'BIRD', 'CBRS',
  'PURRDAT', 'LITE', 'SNXX', 'OURA', 'ANSEM', 'TREAD', 'DRAM',
]);

const STOCK_TICKERS = new Set([
  // US mega/large cap equity perps (xyz / para / io dexes)
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO',
  'BRK', 'JPM', 'V', 'XOM', 'LLY', 'UNH', 'MA', 'HD', 'PG', 'NFLX', 'COST',
  'ORCL', 'CRM', 'AMD', 'COIN', 'MSTR', 'PLTR', 'HOOD', 'SHOP', 'SQ', 'PYPL',
  'DIS', 'NKE', 'MRNA', 'PFE', 'JNJ', 'ABBV', 'KO', 'PEP', 'WMT', 'BAC',
  'GS', 'MS', 'C', 'INTC', 'QCOM', 'ADBE', 'NOW', 'INTU', 'AMAT', 'MU',
  'TSM', 'ASML', 'BABA', 'JD', 'PDD', 'UBER', 'ABNB', 'SNOW', 'DDOG',
  'CRWD', 'PANW', 'ARM', 'SMCI', 'DELL', 'GME', 'AMC', 'DJT',
  // Additional listed equities observed on Hyperliquid HIP-3 dexes
  'COHR', 'GLW', 'CRDO', 'LRCX', 'VST', 'TER', 'CIEN', 'MELI', 'SOFI',
  'TTWO', 'CIFR', 'IREN', 'NET', 'RDDT', 'AAOI', 'IGV', 'IONQ', 'NBIS',
  'SNDK', 'GPRO', 'OAI', 'ANTH', 'CRWV', 'HIMS', 'DKNG', 'MRVL', 'RKLB',
  'ZM', 'EBAY', 'BB', 'IBM', 'WDC', 'NOK', 'BE', 'CVX', 'SOFTBANK',
  'HYUNDAI', 'KIOXIA', 'GEV', 'RIVN', 'CRCL', 'SPCX', 'SHEIN', 'BMNR',
  // Equity ETFs / baskets trading as equity exposure
  'EWY', 'EWJ', 'EWZ', 'EWT', 'XLE', 'SMH', 'SOXL', 'MAGS', 'URNM', 'XBI',
]);

const COMMODITY_SYMBOLS = new Set([
  'GOLD', 'XAU', 'PAXG', 'SILVER', 'XAG', 'OIL', 'WTI', 'BRENT', 'BRENTOIL',
  'NATGAS', 'NGAS', 'NG', 'COPPER', 'HG', 'PLATINUM', 'PL', 'PALLADIUM', 'PA',
  'WHEAT', 'ZW', 'CORN', 'ZC', 'SOY', 'ZS', 'COFFEE', 'KC', 'SUGAR', 'SB',
  'COTTON', 'CT', 'COCOA', 'CC', 'OJ', 'CL', 'GC', 'SI', 'ALUMINIUM',
  'XAUUSD', 'XAGUSD',
]);

const INDEX_SYMBOLS = new Set([
  'SPX500', 'SP500', 'US500', 'SPY', 'ES', 'NASDAQ', 'NDX', 'QQQ', 'NQ',
  'USTECH', 'DOW', 'DJIA', 'YM', 'DIA', 'RUSSELL', 'RTY', 'IWM', 'SMALL2000',
  'VIX', 'NIKKEI', 'N225', 'JP225', 'KR200', 'FTSE', 'DAX', 'CAC', 'HSI',
  'STOXX', 'ASX', 'TOTAL2', 'OTHERS', 'BTCD',
]);

const OTHER_SYMBOLS = new Set([
  'TLT', 'USBOND', '10Y', // rates / bond markets — neither equity, commodity, FX nor crypto
]);

const FOREX_SINGLES = new Set(['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'USD']);

const FOREX_PAIRS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY',
  'EUR/USD', 'GBP/USD', 'USD/JPY',
]);

function stripDexPrefix(internal: string): { dex: string; base: string } {
  const idx = internal.indexOf(':');
  if (idx === -1) return { dex: '', base: internal };
  return { dex: internal.slice(0, idx), base: internal.slice(idx + 1) };
}

/** Normalize display symbol: strip dex prefix, strip PERP suffix, uppercase. */
export function toDisplaySymbol(internal: string): string {
  const { base } = stripDexPrefix(internal);
  return base.replace(/-?PERP$/i, '').toUpperCase();
}

export function toUnderlying(internal: string): string {
  return toDisplaySymbol(internal);
}

export interface Classification {
  category: AssetCategory;
  reason: string;
  /**
   * Classification hierarchy (spec §7):
   *  METADATA — Hyperliquid-provided asset metadata (reserved for future use;
   *    current info endpoints expose no explicit asset class, so no live
   *    classification claims METADATA yet)
   *  DEX      — venue evidence (main dex = crypto venue; dex-qualified tickers)
   *  PATTERN  — conservative symbol-shape evidence (fiat pairs only)
   *  MAPPING  — curated reliable ticker mapping
   *  UNKNOWN  — insufficient evidence; never a false positive
   */
  source: ClassificationSource;
}

/**
 * Classify a Hyperliquid market. Conservative: UNKNOWN unless confident.
 */
export function classifyMarket(internalSymbol: string, dex = ''): Classification {
  const { base } = stripDexPrefix(internalSymbol);
  const display = toDisplaySymbol(internalSymbol);
  const upper = display.toUpperCase();
  const baseUpper = base.toUpperCase();

  // 0. Ambiguity guard — never guess on collision-prone names.
  if (AMBIGUOUS.has(upper)) {
    return { category: 'UNKNOWN', reason: `ambiguous symbol ${display} — not auto-classified`, source: 'UNKNOWN' };
  }

  // Seagate (para:STX equity) vs Stacks (bare STX crypto) disambiguation.
  if (upper === 'STX') {
    if (dex === 'para') return { category: 'STOCK', reason: 'Seagate equity perp (para dex)', source: 'DEX' };
    return { category: 'CRYPTO', reason: 'Stacks crypto asset (main dex)', source: 'DEX' };
  }

  // 1. Known crypto (incl. Hyperliquid "k" = 1000-unit memecoin variants: kPEPE → PEPE)
  const kStripped = upper.startsWith('K') && upper.length > 2 ? upper.slice(1) : null;
  if (CRYPTO_MAJORS.has(upper) || CRYPTO_MAJORS.has(baseUpper) || (kStripped && CRYPTO_MAJORS.has(kStripped))) {
    return { category: 'CRYPTO', reason: `known crypto asset ${display}`, source: 'MAPPING' };
  }
  if (STOCK_TICKERS.has(upper) || STOCK_TICKERS.has(baseUpper)) {
    return { category: 'STOCK', reason: `known equity ticker ${display}`, source: 'MAPPING' };
  }
  if (COMMODITY_SYMBOLS.has(upper)) {
    return { category: 'COMMODITY', reason: `known commodity ${display}`, source: 'MAPPING' };
  }
  if (INDEX_SYMBOLS.has(upper)) {
    return { category: 'INDEX', reason: `known index ${display}`, source: 'MAPPING' };
  }
  if (OTHER_SYMBOLS.has(upper)) {
    return { category: 'OTHER', reason: `rates/bond market ${display}`, source: 'MAPPING' };
  }
  if (FOREX_PAIRS.has(upper) || FOREX_SINGLES.has(upper)) {
    return { category: 'FOREX', reason: `known FX market ${display}`, source: 'MAPPING' };
  }

  // 2. Shape heuristics (conservative, fiat-only pairs)
  if (display.includes('/')) {
    const parts = display.split('/');
    if (parts.length === 2 && parts.every((p) => FOREX_SINGLES.has(p))) {
      return { category: 'FOREX', reason: `fiat pair shape ${display}`, source: 'PATTERN' };
    }
  }
  if (/^(EUR|GBP|AUD|NZD|CAD|CHF)[_-]?(USD|JPY|GBP|EUR)$/.test(upper) && upper.length <= 8) {
    return { category: 'FOREX', reason: `FX pair shape ${display}`, source: 'PATTERN' };
  }

  // 3. Venue default: main perp dex is the crypto venue.
  if (dex === '') {
    return { category: 'CRYPTO', reason: `main Hyperliquid perp listing (${display})`, source: 'DEX' };
  }

  // 4. HIP-3 unknowns stay UNKNOWN — never falsely classify.
  return { category: 'UNKNOWN', reason: `unrecognized ${dex ? dex + ' dex ' : ''}market ${internalSymbol}`, source: 'UNKNOWN' };
}

export function resolveSymbol(internalSymbol: string, dex = ''): HyperliquidSymbolInfo {
  const { category } = classifyMarket(internalSymbol, dex);
  return {
    internalSymbol,
    displaySymbol: toDisplaySymbol(internalSymbol),
    assetClass: category,
    underlying: toUnderlying(internalSymbol),
    marketType: 'PERP',
    dex,
  };
}

/**
 * Canonical market identity: DEX + ":" + SYMBOL.
 *   main dex  → "main:BTC"
 *   HIP-3 dex → "xyz:TSLA" (dex + base coin name)
 * The DEX qualifier guarantees identical symbols on different DEXes
 * (main:STX vs para:STX) never collide or overwrite each other.
 */
export function marketIdFor(internalSymbol: string, dex = ''): string {
  const { base } = stripDexPrefix(internalSymbol);
  const dexPart = dex === '' ? 'main' : dex;
  return `${dexPart}:${base.toUpperCase()}`;
}

/** Inverse of marketIdFor: split "dex:SYMBOL" back into parts. Returns null when not parseable. */
export function parseMarketId(marketId: string): { dex: string; symbol: string } | null {
  const idx = marketId.indexOf(':');
  if (idx <= 0 || idx === marketId.length - 1) return null;
  const dexPart = marketId.slice(0, idx);
  const symbol = marketId.slice(idx + 1);
  if (!/^[A-Za-z0-9._/-]+$/.test(dexPart) || !/^[A-Za-z0-9._/-]+$/.test(symbol)) return null;
  return { dex: dexPart.toLowerCase() === 'main' ? '' : dexPart, symbol: symbol.toUpperCase() };
}

/** Human DEX label — never invents a name: "MAIN" for the main dex, else the actual dex identifier. */
export function dexLabelFor(dex: string): string {
  return dex === '' ? 'MAIN' : dex.toUpperCase();
}

// ---- Display-name enrichment + search aliases (curated metadata only) ----
// These NEVER determine existence or category — Hyperliquid discovery does.

const ASSET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  GOLD: 'Gold', SILVER: 'Silver', COPPER: 'Copper',
  PLATINUM: 'Platinum', PALLADIUM: 'Palladium', PAXG: 'PAX Gold',
  CL: 'Crude Oil (WTI)', BRENTOIL: 'Brent Crude Oil', BRENT: 'Brent Crude Oil',
  WTI: 'Crude Oil (WTI)', OIL: 'Crude Oil', NATGAS: 'Natural Gas',
  ALUMINIUM: 'Aluminium',
  SP500: 'S&P 500', US500: 'S&P 500', USTECH: 'Nasdaq-100 Tech',
  SMALL2000: 'Russell 2000', JP225: 'Nikkei 225', KR200: 'KOSPI 200',
  TOTAL2: 'Crypto Total Ex-BTC', OTHERS: 'Crypto Others Index', BTCD: 'Bitcoin Dominance',
  EUR: 'Euro', JPY: 'Japanese Yen', GBP: 'British Pound',
  EURUSD: 'Euro / US Dollar', GBPUSD: 'British Pound / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen',
  AAPL: 'Apple', TSLA: 'Tesla', NVDA: 'Nvidia', MSFT: 'Microsoft',
  AMZN: 'Amazon', GOOGL: 'Alphabet (Google)', META: 'Meta',
  NFLX: 'Netflix', AMD: 'AMD', INTC: 'Intel', ORCL: 'Oracle',
  COIN: 'Coinbase', HOOD: 'Robinhood', PLTR: 'Palantir', MSTR: 'MicroStrategy',
  BABA: 'Alibaba', TSM: 'TSMC', LLY: 'Eli Lilly', COST: 'Costco',
  MU: 'Micron', SNDK: 'SanDisk', AVGO: 'Broadcom', ASML: 'ASML',
  ARM: 'Arm', DELL: 'Dell', IBM: 'IBM', QCOM: 'Qualcomm', NOW: 'ServiceNow',
  AMAT: 'Applied Materials', MRNA: 'Moderna', CVX: 'Chevron',
  GME: 'GameStop', RIVN: 'Rivian', CRWV: 'CoreWeave', HIMS: 'Hims & Hers',
  DKNG: 'DraftKings', MRVL: 'Marvell', RKLB: 'Rocket Lab', ZM: 'Zoom',
  EBAY: 'eBay', BB: 'BlackBerry', WDC: 'Western Digital', NOK: 'Nokia',
  BE: 'Bloom Energy', MELI: 'MercadoLibre', SOFI: 'SoFi', TTWO: 'Take-Two',
  CIFR: 'Cipher Mining', IREN: 'Iris Energy', NET: 'Cloudflare',
  CRWD: 'CrowdStrike', RDDT: 'Reddit', AAOI: 'Applied Optoelectronics',
  COHR: 'Coherent', GLW: 'Corning', LRCX: 'Lam Research', TER: 'Teradyne',
  CIEN: 'Ciena', VST: 'Vistra', CRDO: 'Credo', IONQ: 'IonQ', NBIS: 'Nebius',
  GPRO: 'GoPro', OAI: 'OpenAI (pre-IPO)', ANTH: 'Anthropic (pre-IPO)',
  SPCX: 'SpaceX (pre-IPO)', SHEIN: 'Shein (pre-IPO)', BMNR: 'BitMine',
  SOFTBANK: 'SoftBank', HYUNDAI: 'Hyundai', KIOXIA: 'Kioxia', GEV: 'GE Vernova',
  CRCL: 'Circle',
  TLT: '20Y Treasury Bond', USBOND: 'US Bond', '10Y': '10Y Treasury Yield',
};

/** Lowercase search aliases: display symbol → extra terms (e.g. "apple" → AAPL). */
const ASSET_ALIASES: Record<string, string[]> = {
  AAPL: ['apple'], TSLA: ['tesla'], NVDA: ['nvidia'], MSFT: ['microsoft'],
  AMZN: ['amazon'], GOOGL: ['google', 'alphabet'], META: ['facebook'],
  GOLD: ['gold', 'xau'], SILVER: ['silver', 'xag'], PAXG: ['gold'],
  CL: ['oil', 'crude', 'wti'], BRENTOIL: ['oil', 'brent', 'crude'],
  NATGAS: ['gas', 'natural gas'], COPPER: ['copper'],
  PLATINUM: ['platinum'], PALLADIUM: ['palladium'],
  SP500: ['sp500', 's&p', 's&p 500', 'spy', 'spx'],
  US500: ['sp500', 's&p', 's&p 500', 'spy'],
  USTECH: ['nasdaq', 'nasdaq 100', 'qqq'],
  SMALL2000: ['russell', 'russell 2000', 'iwm'],
  JP225: ['nikkei', 'nikkei 225'], KR200: ['kospi'],
  EURUSD: ['eurusd', 'eur/usd', 'euro dollar', 'fiber'],
  GBPUSD: ['gbpusd', 'cable'], USDJPY: ['usdjpy'],
  EUR: ['euro'], JPY: ['yen'], GBP: ['pound', 'sterling'],
  BTC: ['bitcoin'], ETH: ['ethereum'], SOL: ['solana'],
  NFLX: ['netflix'], COIN: ['coinbase'], HOOD: ['robinhood'],
  PLTR: ['palantir'], BABA: ['alibaba'],
};

export function assetNameFor(displaySymbol: string): string {
  return ASSET_NAMES[displaySymbol.toUpperCase()] ?? displaySymbol;
}

export function aliasesFor(displaySymbol: string): string[] {
  return ASSET_ALIASES[displaySymbol.toUpperCase()] ?? [];
}
