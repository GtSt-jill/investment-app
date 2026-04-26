export const OFFENSIVE_SYMBOLS = ["SPY", "QQQ", "VTI"] as const;
export const DEFENSIVE_SYMBOLS = ["IEF", "GLD", "SHY"] as const;
export const ALL_SYMBOLS = [...OFFENSIVE_SYMBOLS, ...DEFENSIVE_SYMBOLS] as const;

export type UniverseSymbol = (typeof ALL_SYMBOLS)[number];
export type Regime = "risk-on" | "risk-off";
export type TradeSide = "BUY" | "SELL";

export interface StrategyInput {
  initialCapital: number;
  years: number;
  riskOnMaDays: number;
  momentumDays: number;
  topAssets: number;
  stopLossPct: number;
  trailingStopPct: number;
  feePerTrade: number;
  maxAssetWeight: number;
}

export interface PriceBar {
  date: string;
  close: number;
}

export interface AlignedMarketData {
  dates: string[];
  pricesBySymbol: Record<UniverseSymbol, number[]>;
}

export interface PositionState {
  symbol: UniverseSymbol;
  quantity: number;
  entryPrice: number;
  peakPrice: number;
  openedAt: string;
}

export interface TradeRecord {
  date: string;
  symbol: UniverseSymbol;
  side: TradeSide;
  quantity: number;
  price: number;
  grossValue: number;
  fee: number;
  reason: string;
  regime: Regime;
}

export interface EquityPoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  cash: number;
  regime: Regime;
}

export interface AllocationSegment {
  startDate: string;
  endDate: string;
  symbols: UniverseSymbol[];
  regime: Regime;
}

export interface RecommendationAction {
  symbol: UniverseSymbol;
  action: "BUY" | "SELL" | "HOLD";
  reason: string;
}

export interface Recommendation {
  asOf: string;
  regime: Regime;
  targets: UniverseSymbol[];
  actions: RecommendationAction[];
  rationale: string;
}

export interface SimulationSummary {
  startDate: string;
  endDate: string;
  finalValue: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  benchmarkFinalValue: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  winRatePct: number;
  totalTrades: number;
  latestRegime: Regime;
}

export interface SimulationResult {
  input: StrategyInput;
  summary: SimulationSummary;
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  allocationTimeline: AllocationSegment[];
  recommendation: Recommendation;
  universe: {
    offensive: UniverseSymbol[];
    defensive: UniverseSymbol[];
  };
  strategyNotes: string[];
}
