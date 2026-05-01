export type TradingMode = "off" | "dry-run" | "paper" | "live";
export type TradingRiskProfile = "active" | "balanced" | "cautious";

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
  weakHoldReduceScoreThreshold?: number | null;
  topRelativeStrengthPct: number;
  maxEntryPricePremiumPct: number;
  maxEntrySma20PremiumPct: number;
  maxEntryDayChangePct: number;
  minEntryRewardRiskRatio: number;
  neutralEntryScoreBuffer: number;
  unstableSignalScoreBuffer: number;
  minEntryScoreChange: number;
  minSignalStabilityAdjustment: number;
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
  riskProfile: TradingRiskProfile;
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
  weakHoldReduceScoreThreshold: null,
  topRelativeStrengthPct: 0.35,
  maxEntryPricePremiumPct: 0.03,
  maxEntrySma20PremiumPct: 0.08,
  maxEntryDayChangePct: 0.04,
  minEntryRewardRiskRatio: 1.5,
  neutralEntryScoreBuffer: 5,
  unstableSignalScoreBuffer: 3,
  minEntryScoreChange: 0,
  minSignalStabilityAdjustment: 0,
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
  riskProfile: "balanced",
  risk: DEFAULT_RISK_CONFIG
};

export const TRADING_RISK_PROFILE_OVERRIDES = {
  active: {
    riskPerTradePct: 0.0075,
    maxPositionPct: 0.1,
    maxDailyNewEntries: 5,
    maxDailyNotionalPct: 0.25,
    maxAtrPct: 0.1,
    minEntryScore: 65,
    addMinScore: 67,
    sellScoreThreshold: 50,
    severeSellExitScoreThreshold: 25,
    weakHoldReduceScoreThreshold: 55,
    topRelativeStrengthPct: 0.6,
    maxEntryPricePremiumPct: 0.06,
    maxEntrySma20PremiumPct: 0.12,
    maxEntryDayChangePct: 0.07,
    minEntryRewardRiskRatio: 1.1,
    neutralEntryScoreBuffer: 1,
    unstableSignalScoreBuffer: 0
  },
  balanced: {},
  cautious: {
    riskPerTradePct: 0.0035,
    maxPositionPct: 0.06,
    maxDailyNewEntries: 1,
    maxDailyNotionalPct: 0.08,
    maxAtrPct: 0.06,
    minEntryScore: 76,
    addMinScore: 78,
    sellScoreThreshold: 45,
    severeSellExitScoreThreshold: 15,
    weakHoldReduceScoreThreshold: null,
    topRelativeStrengthPct: 0.25,
    maxEntryPricePremiumPct: 0.015,
    maxEntrySma20PremiumPct: 0.05,
    maxEntryDayChangePct: 0.025,
    minEntryRewardRiskRatio: 2,
    neutralEntryScoreBuffer: 8,
    unstableSignalScoreBuffer: 5
  }
} satisfies Record<TradingRiskProfile, Partial<RiskConfig>>;

export function normalizeTradingConfig(input: TradingConfigInput = {}): TradingConfig {
  const riskProfile = normalizeRiskProfile(input.riskProfile);

  return {
    ...DEFAULT_TRADING_CONFIG,
    ...input,
    riskProfile,
    enabledSymbols: input.enabledSymbols === undefined ? DEFAULT_TRADING_CONFIG.enabledSymbols : normalizeSymbols(input.enabledSymbols),
    risk: {
      ...DEFAULT_RISK_CONFIG,
      ...TRADING_RISK_PROFILE_OVERRIDES[riskProfile],
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

function normalizeRiskProfile(value: TradingRiskProfile | undefined) {
  return value === "active" || value === "balanced" || value === "cautious" ? value : DEFAULT_TRADING_CONFIG.riskProfile;
}
