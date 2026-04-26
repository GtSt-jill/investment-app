export const DEFAULT_SEMICONDUCTOR_UNIVERSE = [
  { symbol: "NVDA", name: "NVIDIA", segment: "AI GPU / Data Center" },
  { symbol: "AMD", name: "Advanced Micro Devices", segment: "CPU / GPU" },
  { symbol: "AVGO", name: "Broadcom", segment: "Networking / ASIC" },
  { symbol: "TSM", name: "Taiwan Semiconductor", segment: "Foundry" },
  { symbol: "ASML", name: "ASML", segment: "Lithography" },
  { symbol: "QCOM", name: "Qualcomm", segment: "Mobile / Edge AI" },
  { symbol: "INTC", name: "Intel", segment: "CPU / Foundry" },
  { symbol: "TXN", name: "Texas Instruments", segment: "Analog" },
  { symbol: "MU", name: "Micron", segment: "Memory" },
  { symbol: "AMAT", name: "Applied Materials", segment: "Equipment" },
  { symbol: "LRCX", name: "Lam Research", segment: "Equipment" },
  { symbol: "KLAC", name: "KLA", segment: "Process Control" },
  { symbol: "MRVL", name: "Marvell", segment: "Data Infrastructure" },
  { symbol: "ARM", name: "Arm Holdings", segment: "IP / Architecture" }
] as const;

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
  rank: number;
  relativeStrengthRank: number;
  marketRegime?: MarketRegime;
  earningsDate?: string;
  indicators: IndicatorSnapshot;
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
    close: number;
    sma20: number | null;
    sma50: number | null;
  }>;
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
