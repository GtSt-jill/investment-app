export const TARGET_SYMBOLS = [
  "AAOI",
  "AAPL",
  "ACLS",
  "ADI",
  "AEIS",
  "ALAB",
  "ALGM",
  "AMAT",
  "AMBA",
  "AMD",
  "AMKR",
  "AMZN",
  "ARM",
  "ASML",
  "ASX",
  "AVGO",
  "CAMT",
  "CLS",
  "COHR",
  "COHU",
  "CRUS",
  "CSIQ",
  "DIOD",
  "DQ",
  "ENPH",
  "ENTG",
  "FN",
  "FORM",
  "FSLR",
  "GFS",
  "GOOGL",
  "HIMX",
  "IIVI",
  "IMOS",
  "INTC",
  "IPGP",
  "JKS",
  "KLAC",
  "LASR",
  "LITE",
  "LRCX",
  "LSCC",
  "MCHP",
  "META",
  "MKSI",
  "MPWR",
  "MRVL",
  "MSFT",
  "MSTR",
  "MTSI",
  "MU",
  "MXL",
  "NOVT",
  "NTAP",
  "NVDA",
  "NVTS",
  "NXPI",
  "ONTO",
  "ON",
  "OUST",
  "PI",
  "PLTR",
  "POWI",
  "PSTG",
  "QCOM",
  "QRVO",
  "RMBS",
  "RUN",
  "SANM",
  "SIMO",
  "SITM",
  "SLAB",
  "SMCI",
  "SMTC",
  "SPWR",
  "STM",
  "STX",
  "SWKS",
  "SYNA",
  "TEL",
  "TER",
  "TRMB",
  "TSEM",
  "TSLA",
  "TSM",
  "TXN",
  "UMC",
  "VECO",
  "VIAV",
  "VSH",
  "WDC",
  "WOLF"
] as const;

export const DEFAULT_SEMICONDUCTOR_UNIVERSE = TARGET_SYMBOLS.map((symbol) => ({
  symbol,
  name: symbol,
  segment: "Semiconductor Watchlist"
}));

export type SignalAction = "BUY" | "HOLD" | "SELL";
export type SignalRating = "STRONG_BUY" | "BUY" | "WATCH" | "SELL" | "STRONG_SELL";
export type SignalChange =
  | "NEW_BUY"
  | "BUY_CONTINUATION"
  | "BUY_TO_HOLD"
  | "HOLD_TO_BUY"
  | "NEW_SELL"
  | "SELL_CONTINUATION"
  | "SELL_TO_HOLD"
  | "NO_CHANGE";
export type MarketRegime = "bullish" | "neutral" | "defensive";

export interface ScoreBreakdown {
  trendScore: number;
  momentumScore: number;
  relativeStrengthScore: number;
  riskScore: number;
  volumeScore: number;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolProfile {
  symbol: string;
  name: string;
  segment: string;
  earningsDate?: string;
}

export interface IndicatorSnapshot {
  close: number;
  previousClose: number;
  dayChangePct: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdHistogramPrevious: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  atrPct: number | null;
  volume5: number | null;
  volume20: number | null;
  volumeRatio: number | null;
  volume5To20Ratio: number | null;
  momentum20: number | null;
  momentum63: number | null;
  momentum126: number | null;
  drawdownFromHigh: number | null;
  longTermTrendUnavailable: boolean;
}

export interface RecommendationItem {
  symbol: string;
  name: string;
  segment: string;
  asOf: string;
  rating: SignalRating;
  action: SignalAction;
  previousAction?: SignalAction;
  signalChange: SignalChange;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  scoreAdjustments?: ScoreAdjustment[];
  rank: number;
  relativeStrengthRank: number;
  marketRegime?: MarketRegime;
  earningsDate?: string;
  indicators: IndicatorSnapshot;
  normalizedTechnicals?: NormalizedTechnicalSnapshot;
  factorAnalysis?: FactorAnalysisSnapshot;
  reasons: string[];
  risks: string[];
  buyZone: {
    idealEntry: number;
    pullbackEntry: number;
    stopLoss: number;
    takeProfit: number;
  };
  chart: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    sma20: number | null;
    sma50: number | null;
  }>;
}

export type ScoreAdjustmentSource = "normalization" | "factor" | "market-regime" | "earnings" | "signal-stability";

export interface ScoreAdjustment {
  source: ScoreAdjustmentSource;
  label: string;
  value: number;
}

export interface NormalizedTechnicalSnapshot {
  closePercentileRank: number | null;
  closeZScore: number | null;
  atrPctPercentile: number | null;
  momentum63Percentile: number | null;
  momentum126Percentile: number | null;
  momentum20Percentile: number | null;
}

export interface FactorAnalysisSnapshot {
  marketBeta: number | null;
  sectorBeta: number | null;
  alpha: number | null;
  residualVolatility: number | null;
  factorScore: number | null;
  observations: number;
}

export interface MarketAnalysisResult {
  asOf: string;
  generatedAt: string;
  universe: SymbolProfile[];
  recommendations: RecommendationItem[];
  buyCandidates: RecommendationItem[];
  sellCandidates: RecommendationItem[];
  watchlist: RecommendationItem[];
  summary: {
    analyzedSymbols: number;
    averageScore: number;
    strongestSymbol: string | null;
    weakestSymbol: string | null;
    marketBias: MarketRegime;
    marketRegime: MarketRegime;
    excludedSymbols: string[];
  };
  notes: string[];
}
