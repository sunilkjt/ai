// ============================================================
// Sunil AI Hyperliquid Analyst — central data contracts
// Hyperliquid is the primary data source. Crypto is one category.
// Deterministic engine computes facts. AI reasons over them.
// ============================================================

export type Direction = 'LONG' | 'SHORT' | 'WAIT';
export type FinalDecision = 'LONG' | 'SHORT' | 'WAIT' | 'NO_TRADE';

export type MarketRegime =
  | 'TRENDING_BULLISH'
  | 'TRENDING_BEARISH'
  | 'RANGE'
  | 'BREAKOUT'
  | 'BREAKDOWN'
  | 'BULLISH_PULLBACK'
  | 'BEARISH_PULLBACK'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'UNCLEAR';

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

// ---- Hyperliquid-first asset model ----

export type AssetCategory =
  | 'STOCK'
  | 'COMMODITY'
  | 'INDEX'
  | 'FOREX'
  | 'CRYPTO'
  | 'OTHER'
  | 'UNKNOWN';

export const CATEGORY_ORDER: AssetCategory[] = [
  'STOCK',
  'COMMODITY',
  'INDEX',
  'FOREX',
  'CRYPTO',
  'OTHER',
  'UNKNOWN',
];

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  STOCK: 'Stocks',
  COMMODITY: 'Commodities',
  INDEX: 'Indices',
  FOREX: 'Forex',
  CRYPTO: 'Crypto',
  OTHER: 'Other',
  UNKNOWN: 'Unknown',
};

export type ClassificationSource = 'METADATA' | 'DEX' | 'PATTERN' | 'MAPPING' | 'UNKNOWN';

export interface HyperliquidMarketMeta {
  /** Unique market identity: `${dex}:${internalSymbol}` (main dex: internal symbol alone) */
  marketId: string;
  /** Raw coin name on Hyperliquid, e.g. "BTC" or "xyz:TSLA" */
  internalSymbol: string;
  /** Human display symbol, e.g. "TSLA" */
  displaySymbol: string;
  /** Display asset name enrichment (curated, e.g. "Apple", "Gold"); falls back to display symbol */
  assetName: string;
  /** Underlying reference where resolvable, e.g. "TSLA" / "GOLD" / "EURUSD" */
  underlying: string;
  category: AssetCategory;
  classificationSource: ClassificationSource;
  /** Which perp dex this market belongs to ("" = main dex) */
  dex: string;
  /** Human DEX label: "MAIN" for the main dex, else the actual dex identifier */
  dexLabel: string;
  maxLeverage: number;
  szDecimals: number;
  onlyIsolated: boolean;
  isDelisted: boolean;
  classificationReason: string;
  /** Discovery timestamps for stale-data protection */
  discoveredAt: number;
  updatedAt: number;
}

export interface HyperliquidAssetCtx {
  markPx: number | null;
  oraclePx: number | null;
  midPx: number | null;
  funding: number | null;
  openInterest: number | null;
  dayNtlVlm: number | null;
  prevDayPx: number | null;
  premium: number | null;
}

export interface HyperliquidMarket extends HyperliquidMarketMeta {
  ctx: HyperliquidAssetCtx | null;
  price: number | null;
  priceChangePercent24h: number | null;
}

/** Full market identity sent to the AI — never just a bare symbol. */
export interface MarketIdentity {
  marketId: string;
  dex: string;
  dexLabel: string;
  internalSymbol: string;
  displaySymbol: string;
  displayName: string;
  underlying: string;
  category: AssetCategory;
  classificationSource: ClassificationSource;
  instrument: 'PERP';
  venue: 'Hyperliquid';
  stale: boolean;
}

export interface HyperliquidSymbolInfo {
  internalSymbol: string;
  displaySymbol: string;
  assetClass: AssetCategory;
  underlying: string;
  marketType: 'PERP';
  dex: string;
}

export interface HyperliquidContext {
  /** Underlying market behavior vs Hyperliquid perp behavior, kept separate */
  underlyingTrend: TrendDirection;
  perpBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  openInterestTrend: 'RISING' | 'FALLING' | 'FLAT' | 'UNKNOWN';
  fundingState: 'ELEVATED_LONG' | 'ELEVATED_SHORT' | 'NEUTRAL' | 'UNKNOWN';
  premiumState: 'PREMIUM' | 'DISCOUNT' | 'FLAT' | 'UNKNOWN';
  crowdingRisk: boolean;
  interpretation: string;
  unavailable: string[];
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface Ticker {
  symbol: string;
  price: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  timestamp: number;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  timestamp: number;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  atr?: number;
}

export type TimeframeRole = 'MACRO' | 'STRUCTURE' | 'SETUP' | 'CONFIRMATION' | 'ENTRY' | 'EXECUTION';

export interface TimeframeConfig {
  id: string; // '1D' | '4H' ...
  minutes: number;
  role: TimeframeRole;
  label: string;
  /** Hyperliquid candle interval */
  hlInterval: string;
}

export interface MarketStructure {
  trend: TrendDirection;
  swingHighs: number[];
  swingLows: number[];
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  bos: 'BULLISH' | 'BEARISH' | null;
  choch: 'BULLISH' | 'BEARISH' | null;
  hh: boolean; hl: boolean; lh: boolean; ll: boolean;
  structurePoints: number;
  notes: string[];
}

export interface LiquidityAnalysis {
  equalHighs: boolean;
  equalLows: boolean;
  sweepHigh: boolean;
  sweepLow: boolean;
  nearestLiquidityAbove: number | null;
  nearestLiquidityBelow: number | null;
  notes: string[];
}

export interface FVG {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  mitigated: boolean;
  index: number;
}

export interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  index: number;
  mitigated: boolean;
}

export interface SMCAnalysis {
  liquiditySweep: 'HIGH' | 'LOW' | null;
  swept: boolean;
  fvg: FVG[];
  orderBlocks: OrderBlock[];
  premium: boolean;
  discount: boolean;
  equilibrium: number | null;
  displacement: 'BULLISH' | 'BEARISH' | null;
  points: number;
  notes: string[];
}

export interface ICTAnalysis {
  dealingRangeHigh: number | null;
  dealingRangeLow: number | null;
  premiumZone: boolean;
  discountZone: boolean;
  judasSwing: 'HIGH' | 'LOW' | null;
  marketMakerModel: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'UNCLEAR';
  sessionBias: string;
  points: number;
  notes: string[];
  reliable: boolean;
}

export interface DerivativesAnalysis {
  fundingRate: number | null;
  openInterest: number | null;
  longShortRatio: number | null;
  basis: number | null;
  markPrice: number | null;
  oraclePrice: number | null;
  premium: number | null;
  dayVolumeNotional: number | null;
  unavailable: string[];
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  notes: string[];
}

export interface IndicatorSnapshot {
  ema20: number | null;
  ema50: number | null;
  emaTrend: TrendDirection;
  priceAboveEma20: boolean | null;
  priceAboveEma50: boolean | null;
  rsi: number | null;
  rsiState: 'OVERBOUGHT' | 'OVERSOLD' | 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  atr: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  volumeState: 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN';
}

export interface TimeframeAnalysis {
  timeframe: string;
  role: TimeframeRole;
  price: number;
  indicators: IndicatorSnapshot;
  structure: MarketStructure;
  smc: SMCAnalysis;
  ict: ICTAnalysis;
  bias: TrendDirection;
  notes: string[];
}

export interface ConfluenceItem {
  block: 'SMC' | 'TREND' | 'MOMENTUM' | 'STRUCTURE' | 'CONDITIONS' | 'DERIVATIVES';
  score: number;
  max: number;
  direction: TrendDirection;
  reasons: string[];
}

export interface ConfluenceResult {
  total: number;
  band: 'WEAK' | 'DEVELOPING' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';
  direction: TrendDirection;
  items: ConfluenceItem[];
  supportingReasons: string[];
  opposingReasons: string[];
}

export type SignalStatus =
  | 'NEW' | 'ACTIVE' | 'STRENGTHENING' | 'WEAKENING' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED'
  | 'WATCHING' | 'CANDIDATE' | 'AI_REVIEW' | 'CONFIRMED' | 'CONDITIONAL';

export type TrapRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SignalEvent {
  at: number;
  from: SignalStatus | 'NONE';
  to: SignalStatus;
  reason: string;
}

export interface TradingSignal {
  id: string;
  symbol: string;
  marketId?: string;
  dex?: string;
  category?: AssetCategory;
  direction: Direction;
  timeframe: string;
  entry?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  riskReward?: number;
  confluenceScore: number;
  /** Transparent setup-quality score (0-100) — NOT profit probability */
  setupQuality?: number;
  trapRisk?: TrapRisk;
  aiConfidence?: number | null;
  supportingReasons: string[];
  opposingReasons: string[];
  invalidation?: string;
  marketRegime: MarketRegime;
  status: SignalStatus;
  /** Recorded lifecycle transitions (candidate → review → confirmed → …) */
  history: SignalEvent[];
  timestamp: number;
  expiresAt: number;
}

export interface RiskAnalysis {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  riskDistance: number;
  rewardDistance: number;
  riskReward: number;
  riskPercent: number;
  positionSize: number;
  notional: number;
  leverage: number;
  liquidationEstimate?: number | null;
  warnings: string[];
  valid: boolean;
}

export interface AIAnalysis {
  symbol: string;
  category?: AssetCategory;
  decision: FinalDecision;
  direction: Direction;
  marketRegime: MarketRegime;
  confidence: number; // AI assessment confidence — NOT profit probability
  supportingFactors: string[];
  opposingFactors: string[];
  invalidation: string;
  explanation: string;
  provider: string;
  cached: boolean;
  timestamp: number;
}

export interface AICritique {
  symbol: string;
  verdict: Direction;
  /** APPROVE = setup stands · CONDITIONAL = only with stated conditions · REJECT = do not take */
  approval: 'APPROVE' | 'CONDITIONAL' | 'REJECT';
  risks: string[];
  critique: string;
  downgraded: boolean;
  timestamp: number;
}

export interface FinalTradeAnalysis {
  symbol: string;
  category: AssetCategory;
  executionTimeframe: string;
  price: number;
  regime: MarketRegime;
  deterministic: TradingSignal;
  confluence: ConfluenceResult;
  timeframes: TimeframeAnalysis[];
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  assetInsights: string[];
  ai: AIAnalysis | null;
  critique: AICritique | null;
  risk: RiskAnalysis | null;
  finalDecision: FinalDecision;
  tradePlan: string[];
  timestamp: number;
  aiAvailable: boolean;
}

// ---- Multi-agent screener contracts ----

export type AgentName =
  | 'discovery' | 'market-data' | 'mtf' | 'technical' | 'structure'
  | 'smc' | 'ict' | 'derivatives' | 'asset-class' | 'confluence'
  | 'long' | 'short' | 'contrarian' | 'trap' | 'critic' | 'risk' | 'final';

export interface AgentRun {
  agent: AgentName;
  status: 'ok' | 'skipped' | 'failed';
  summary: string;
  durationMs: number;
  at: number;
}

export interface ComponentScores {
  trend: number; mtf: number; structure: number; momentum: number;
  volume: number; smc: number; ict: number; liquidity: number;
  derivatives: number; risk: number;
}

export interface SetupCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SetupEvaluation {
  side: 'LONG' | 'SHORT';
  candidate: boolean;
  checks: SetupCheck[];
  /** Human-readable blockers, e.g. "Waiting for: 15M BOS confirmation" */
  missing: string[];
}

export type ScreenStatus =
  | 'WATCHING' | 'CANDIDATE' | 'AI_REVIEW' | 'CONFIRMED' | 'CONDITIONAL'
  | 'INVALIDATED' | 'EXPIRED' | 'REJECTED';

export interface ScreenResult {
  marketId: string;
  displaySymbol: string;
  assetName: string;
  dex: string;
  dexLabel: string;
  category: AssetCategory;
  price: number | null;
  change24h: number | null;
  trend: string;
  mtfBias: string;
  confluence: number;
  setupQuality: number | null;
  scores: ComponentScores | null;
  trapRisk: TrapRisk | null;
  trapNotes: string[];
  longSetup: SetupEvaluation | null;
  shortSetup: SetupEvaluation | null;
  aiDirection: Direction;
  aiConfidence: number | null;
  aiProvider: string | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  status: ScreenStatus;
  statusReason: string;
  why: string[];
  against: string[];
  invalidation: string;
  criticSummary: string | null;
  explanation: string | null;
  demo: boolean;
  stale: boolean;
  updatedAt: number;
}

export interface ScreenerStats {
  /** Markets discovered on Hyperliquid at scan time */
  discovered: number;
  /** Markets that passed stage-0 validation and entered the stage-1 scan */
  scanned: number;
  /** Rejected at stage 0 (data quality / liquidity), with counted reasons */
  stage0Rejected: number;
  stage0Reasons: { reason: string; count: number }[];
  skippedDemo: number;
  fastCandidates: number;
  aiReviewed: number;
  longCount: number;
  shortCount: number;
  waitCount: number;
  rejected: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

/** Validated final AI signal output (§54) */
export interface AISignal {
  marketId: string;
  dex: string;
  category: AssetCategory;
  decision: FinalDecision;
  status: ScreenStatus;
  aiConfidence: number;
  setupQuality: number;
  trapRisk: TrapRisk;
  confluence: number;
  timeframeAlignment: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  supportingFactors: string[];
  opposingFactors: string[];
  invalidation: string;
  critic: string;
  explanation: string;
}

/** Persistent per-marketId analysis memory (structured summaries, never raw history). */
export interface AnalysisMemoryEntry {
  at: number;
  marketId: string;
  display: string;
  decision: string;
  regime: MarketRegime;
  direction: Direction;
  confluence: number;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  riskReward: number | null;
  structure: string;
  trapRisk: TrapRisk | null;
  /** e.g. "LONG 2 / SHORT 0 / WAIT 4" — agent disagreement snapshot */
  disagreement: string;
  summary: string;
}

// ---- AI provider abstraction ----

export interface AIContext {
  symbol: string;
  category: AssetCategory;
  /** Full Hyperliquid market identity — the AI must know exactly which market this is */
  identity: MarketIdentity | null;
  price: number;
  executionTimeframe: string;
  regime: MarketRegime;
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  signal: TradingSignal;
  derivatives: DerivativesAnalysis;
  hyperliquid: HyperliquidContext | null;
  assetInsights: string[];
  risk: RiskAnalysis | null;
}

export interface AICritiqueContext extends AIContext {
  analystSummary: string;
}

export interface AIProvider {
  readonly name: string;
  analyze(context: AIContext): Promise<AIAnalysis>;
  critique(context: AICritiqueContext): Promise<AICritique>;
  chat?(system: string, user: string): Promise<string>;
}

// ---- Market data provider abstraction (Hyperliquid-first) ----

export interface FundingData {
  symbol: string;
  fundingRate: number | null;
  nextFundingTime: number | null;
}

export interface OpenInterestData {
  symbol: string;
  openInterest: number | null;
}

export interface MarketDataProvider {
  readonly name: string;
  getTicker(symbol: string): Promise<Ticker>;
  getCandles(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;
  getFunding(symbol: string): Promise<FundingData>;
  getOpenInterest(symbol: string): Promise<OpenInterestData>;
  discoverMarkets?(): Promise<HyperliquidMarket[]>;
}

// ---- Backtest ----

export interface BacktestTrade {
  index: number;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  exit: number;
  result: 'WIN' | 'LOSS' | 'EXPIRED';
  rMultiple: number;
  entryTime: number;
  exitTime: number;
}

export interface BacktestResult {
  symbol: string;
  timeframe: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownR: number;
  netR: number;
  trades: BacktestTrade[];
}
