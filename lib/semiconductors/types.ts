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
  bollingerUpper: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  atrPct: number | null;
  volume20: number | null;
  volumeRatio: number | null;
  momentum20: number | null;
  momentum63: number | null;
  momentum126: number | null;
  drawdownFromHigh: number | null;
}

export interface RecommendationItem {
  symbol: string;
  name: string;
  segment: string;
  asOf: string;
  rating: SignalRating;
  action: SignalAction;
  score: number;
  rank: number;
  relativeStrengthRank: number;
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
    marketBias: "bullish" | "neutral" | "defensive";
  };
  notes: string[];
}
