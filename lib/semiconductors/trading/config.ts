export type TradingMode = "off" | "dry-run" | "paper" | "live";

export interface RiskConfig {
  riskPerTradePct: number;
  maxPositionPct: number;
  maxSectorPct: number;
  maxDailyNewEntries: number;
  maxDailyNotionalPct: number;
  minOrderNotional: number;
  maxPositions: number;
  minCashPct: number;
  maxAtrPct: number;
  minPrice: number;
  minVolume20: number;
  earningsBlackoutDays: number;
  minEntryScore: number;
  addMinScore: number;
  sellScoreThreshold: number;
  severeSellExitScoreThreshold?: number | null;
  topRelativeStrengthPct: number;
  maxEntryPricePremiumPct: number;
  reducePositionPct: number;
  allowAddToLosingPositions: boolean;
  allowPatternDayTraderBuys: boolean;
}

export interface TradingConfig {
  mode: TradingMode;
  enabledSymbols: string[] | null;
  killSwitch: boolean;
  paperTradingEnabled: boolean;
  liveTradingEnabled: boolean;
  useBracketOrders: boolean;
  risk: RiskConfig;
}

export type TradingConfigInput = Partial<Omit<TradingConfig, "risk">> & {
  risk?: Partial<RiskConfig>;
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPerTradePct: 0.005,
  maxPositionPct: 0.08,
  maxSectorPct: 0.5,
  maxDailyNewEntries: 3,
  maxDailyNotionalPct: 0.15,
  minOrderNotional: 100,
  maxPositions: 20,
  minCashPct: 0.05,
  maxAtrPct: 0.075,
  minPrice: 5,
  minVolume20: 300_000,
  earningsBlackoutDays: 7,
  minEntryScore: 70,
  addMinScore: 72,
  sellScoreThreshold: 45,
  severeSellExitScoreThreshold: 15,
  topRelativeStrengthPct: 0.35,
  maxEntryPricePremiumPct: 0.03,
  reducePositionPct: 0.5,
  allowAddToLosingPositions: false,
  allowPatternDayTraderBuys: false
};

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  mode: "off",
  enabledSymbols: null,
  killSwitch: false,
  paperTradingEnabled: false,
  liveTradingEnabled: false,
  useBracketOrders: true,
  risk: DEFAULT_RISK_CONFIG
};

export function normalizeTradingConfig(input: TradingConfigInput = {}): TradingConfig {
  return {
    ...DEFAULT_TRADING_CONFIG,
    ...input,
    enabledSymbols: input.enabledSymbols === undefined ? DEFAULT_TRADING_CONFIG.enabledSymbols : normalizeSymbols(input.enabledSymbols),
    risk: {
      ...DEFAULT_RISK_CONFIG,
      ...input.risk
    }
  };
}

export function isSymbolEnabled(symbol: string, config: TradingConfig) {
  return config.enabledSymbols === null || config.enabledSymbols.includes(symbol.toUpperCase());
}

function normalizeSymbols(symbols: string[] | null) {
  if (symbols === null) {
    return null;
  }

  const normalized = symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(normalized)).sort();
}
