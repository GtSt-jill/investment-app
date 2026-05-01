export const SECURITY_CATEGORIES = [
  { id: "semiconductors", label: "半導体", description: "半導体、製造装置、EDA、サプライチェーン" },
  { id: "mega-tech", label: "大型テック", description: "プラットフォーム、クラウド、消費者向けテック" },
  { id: "software-ai", label: "AI・ソフトウェア", description: "AI、SaaS、データ分析、サイバーセキュリティ" },
  { id: "cloud-data", label: "クラウド・データ", description: "ストレージ、ネットワーク、データ基盤" },
  { id: "clean-energy", label: "クリーンエネルギー", description: "太陽光、EV、電力・蓄電関連" },
  { id: "industrials", label: "産業・自動化", description: "産業テック、計測、製造自動化" }
] as const;

export type SecurityCategoryId = (typeof SECURITY_CATEGORIES)[number]["id"];

type SecurityUniverseInput = Readonly<{
  category: SecurityCategoryId;
  symbols: readonly string[];
}>;

const SECURITY_UNIVERSE_INPUTS = [
  {
    category: "semiconductors",
    symbols: [
      "AAOI",
      "ACLS",
      "ADI",
      "AEIS",
      "ALAB",
      "ALGM",
      "AMAT",
      "AMBA",
      "AMD",
      "AMKR",
      "ARM",
      "ASML",
      "ASX",
      "AVGO",
      "CAMT",
      "COHR",
      "COHU",
      "CRUS",
      "DIOD",
      "ENTG",
      "FN",
      "FORM",
      "GFS",
      "HIMX",
      "IIVI",
      "IMOS",
      "INTC",
      "KLAC",
      "LASR",
      "LITE",
      "LRCX",
      "LSCC",
      "MCHP",
      "MKSI",
      "MPWR",
      "MRVL",
      "MTSI",
      "MU",
      "MXL",
      "NVDA",
      "NVTS",
      "NXPI",
      "ONTO",
      "ON",
      "PI",
      "POWI",
      "QCOM",
      "QRVO",
      "RMBS",
      "SIMO",
      "SITM",
      "SLAB",
      "SMCI",
      "SMTC",
      "STM",
      "SWKS",
      "SYNA",
      "TER",
      "TSEM",
      "TSM",
      "TXN",
      "UMC",
      "VECO",
      "VSH",
      "WOLF"
    ]
  },
  {
    category: "mega-tech",
    symbols: ["AAPL", "AMZN", "GOOGL", "META", "MSFT", "NFLX", "ORCL", "CRM", "ADBE", "SHOP", "UBER", "ABNB"]
  },
  {
    category: "software-ai",
    symbols: ["PLTR", "SNOW", "DDOG", "NET", "CRWD", "PANW", "ZS", "MDB", "TEAM", "NOW", "APP", "PATH"]
  },
  {
    category: "cloud-data",
    symbols: ["NTAP", "PSTG", "STX", "WDC", "ANET", "CSCO", "DELL", "HPE", "CLS", "SANM", "OUST", "VIAV"]
  },
  {
    category: "clean-energy",
    symbols: ["CSIQ", "DQ", "ENPH", "FSLR", "JKS", "RUN", "SPWR", "SEDG", "NXT", "TSLA", "RIVN", "BE"]
  },
  {
    category: "industrials",
    symbols: ["TEL", "TRMB", "NOVT", "IPGP", "COHR", "ROK", "HON", "ETN", "AME", "KEYS", "APH", "GLW"]
  }
] as const satisfies readonly SecurityUniverseInput[];

const CATEGORY_BY_ID = new Map(SECURITY_CATEGORIES.map((category) => [category.id, category]));

function buildDefaultUniverse() {
  const seen = new Set<string>();

  return SECURITY_UNIVERSE_INPUTS.flatMap((group) => {
    const category = CATEGORY_BY_ID.get(group.category);
    const segment = category?.label ?? group.category;

    return group.symbols
      .filter((symbol) => {
        if (seen.has(symbol)) {
          return false;
        }

        seen.add(symbol);
        return true;
      })
      .map((symbol) => ({
        symbol,
        name: symbol,
        segment,
        category: group.category
      }));
  });
}

export const DEFAULT_MARKET_UNIVERSE = buildDefaultUniverse();
export const TARGET_SYMBOLS = DEFAULT_MARKET_UNIVERSE.map((profile) => profile.symbol);
export const DEFAULT_SEMICONDUCTOR_UNIVERSE = DEFAULT_MARKET_UNIVERSE.filter((profile) => profile.category === "semiconductors");

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
  category?: SecurityCategoryId;
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
  category?: SecurityCategoryId;
  asOf: string;
  rating: SignalRating;
  action: SignalAction;
  previousAction?: SignalAction;
  signalChange: SignalChange;
  score: number;
  scoreChange?: number;
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
