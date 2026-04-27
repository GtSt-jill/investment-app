import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import { isSymbolEnabled, type TradingConfig } from "./config";
import type { OpenOrderSnapshot, SizingResult, TradeBlockReason, TradeIntentCandidate, TradePlan } from "./types";
import { blockReason } from "./utils";

export interface RiskEvaluationContext {
  portfolio: PortfolioSnapshot;
  config: TradingConfig;
  openOrders?: OpenOrderSnapshot[];
  plannedBefore?: TradePlan[];
}

export function evaluateTradeRisk(
  candidate: TradeIntentCandidate,
  sizing: SizingResult,
  context: RiskEvaluationContext
): TradeBlockReason[] {
  const { portfolio, config, openOrders = [], plannedBefore = [] } = context;
  const reasons: TradeBlockReason[] = [];

  reasons.push(...evaluateSystemRisk(config, candidate));
  reasons.push(...evaluateAccountRisk(portfolio, config, candidate, sizing));
  reasons.push(...evaluateSymbolRisk(candidate, config));
  reasons.push(...evaluatePortfolioRisk(candidate, sizing, portfolio, config, plannedBefore));
  reasons.push(...evaluateDuplicateOrderRisk(candidate, openOrders));

  return reasons;
}

function evaluateSystemRisk(config: TradingConfig, candidate: TradeIntentCandidate) {
  const reasons: TradeBlockReason[] = [];

  if (config.mode === "off") {
    reasons.push(blockReason("system", "AUTO_TRADING_MODE_OFF", "Auto-trading mode is off."));
  }

  if (config.killSwitch) {
    reasons.push(blockReason("system", "KILL_SWITCH_ACTIVE", "Auto-trading kill switch is active."));
  }

  if (config.mode === "live" && !config.liveTradingEnabled) {
    reasons.push(blockReason("system", "LIVE_TRADING_DISABLED", "Live trading is disabled by configuration."));
  }

  if (!isSymbolEnabled(candidate.symbol, config)) {
    reasons.push(blockReason("system", "SYMBOL_NOT_ENABLED", `${candidate.symbol} is not enabled for auto-trading.`));
  }

  return reasons;
}

function evaluateAccountRisk(
  portfolio: PortfolioSnapshot,
  config: TradingConfig,
  candidate: TradeIntentCandidate,
  sizing: SizingResult
) {
  const reasons: TradeBlockReason[] = [];
  const account = portfolio.account;

  if (account.tradingBlocked) {
    reasons.push(blockReason("account", "ACCOUNT_TRADING_BLOCKED", "Account trading is blocked."));
  }

  if (account.accountBlocked) {
    reasons.push(blockReason("account", "ACCOUNT_BLOCKED", "Account is blocked."));
  }

  if (candidate.side === "buy" && account.buyingPower < sizing.notional) {
    reasons.push(blockReason("account", "BUYING_POWER_INSUFFICIENT", `${candidate.symbol} order exceeds available buying power.`));
  }

  if (candidate.side === "buy" && account.patternDayTrader && !config.risk.allowPatternDayTraderBuys) {
    reasons.push(blockReason("account", "PATTERN_DAY_TRADER_BUY_BLOCKED", "Pattern day trader accounts are blocked from automated buys by configuration."));
  }

  return reasons;
}

function evaluateSymbolRisk(candidate: TradeIntentCandidate, config: TradingConfig) {
  const reasons: TradeBlockReason[] = [];
  const volume20 = candidate.recommendation.indicators.volume20;
  const atrPct = candidate.recommendation.indicators.atrPct;

  if (candidate.side !== "buy") {
    return reasons;
  }

  if (candidate.currentPrice < config.risk.minPrice) {
    reasons.push(blockReason("symbol", "PRICE_BELOW_MINIMUM", `${candidate.symbol} price is below the configured minimum.`));
  }

  if (volume20 === null || volume20 < config.risk.minVolume20) {
    reasons.push(blockReason("symbol", "VOLUME_BELOW_MINIMUM", `${candidate.symbol} 20-day average volume is unavailable or below the configured minimum.`));
  }

  if (atrPct === null || atrPct > config.risk.maxAtrPct) {
    reasons.push(blockReason("symbol", "ATR_TOO_HIGH", `${candidate.symbol} ATR percentage is unavailable or above the configured maximum.`));
  }

  return reasons;
}

function evaluatePortfolioRisk(
  candidate: TradeIntentCandidate,
  sizing: SizingResult,
  portfolio: PortfolioSnapshot,
  config: TradingConfig,
  plannedBefore: TradePlan[]
) {
  const reasons: TradeBlockReason[] = [];

  if (candidate.intent === "NO_ACTION") {
    reasons.push(blockReason("signal", "NO_ACTION_INTENT", `${candidate.symbol} has no actionable trading intent.`, "info"));
    return reasons;
  }

  if (sizing.quantity <= 0) {
    reasons.push(blockReason("sizing", "ZERO_QUANTITY", `${candidate.symbol} calculated quantity is zero.`));
  }

  if (candidate.side !== "buy") {
    return reasons;
  }

  const approvedBuys = plannedBefore.filter((plan) => plan.status === "planned" && plan.side === "buy");
  const approvedNewEntries = approvedBuys.filter((plan) => plan.intent === "OPEN_LONG").length;
  const approvedBuyNotional = approvedBuys.reduce((total, plan) => total + plan.notional, 0);
  const portfolioValue = portfolio.account.portfolioValue;
  const positionCountAfterEntry = portfolio.summary.positionCount + approvedNewEntries + (candidate.isNewEntry ? 1 : 0);
  const buyNotionalAfterOrder = approvedBuyNotional + sizing.notional;
  const sectorExposureAfterOrder = portfolio.summary.longExposure + approvedBuyNotional + sizing.notional;
  const cashAfterOrder = portfolio.account.cash - buyNotionalAfterOrder;
  const currentPositionValue = Math.max(0, candidate.position?.marketValue ?? 0);
  const positionValueAfterOrder = currentPositionValue + sizing.notional;

  if (candidate.isNewEntry && approvedNewEntries >= config.risk.maxDailyNewEntries) {
    reasons.push(blockReason("portfolio", "DAILY_NEW_ENTRY_LIMIT_REACHED", "Daily new entry limit has already been reached."));
  }

  if (candidate.isNewEntry && positionCountAfterEntry > config.risk.maxPositions) {
    reasons.push(blockReason("portfolio", "MAX_POSITION_COUNT_EXCEEDED", "Planned entry would exceed the configured maximum position count."));
  }

  if (portfolioValue > 0 && buyNotionalAfterOrder > portfolioValue * config.risk.maxDailyNotionalPct) {
    reasons.push(blockReason("portfolio", "DAILY_NOTIONAL_LIMIT_EXCEEDED", "Planned buy notional would exceed the daily notional cap."));
  }

  if (portfolioValue > 0 && sectorExposureAfterOrder > portfolioValue * config.risk.maxSectorPct) {
    reasons.push(blockReason("portfolio", "SECTOR_ALLOCATION_LIMIT_EXCEEDED", "Planned semiconductor exposure would exceed the sector allocation cap."));
  }

  if (portfolioValue > 0 && cashAfterOrder / portfolioValue < config.risk.minCashPct) {
    reasons.push(blockReason("portfolio", "MIN_CASH_ALLOCATION_BREACHED", "Planned buy would breach the minimum cash allocation."));
  }

  if (portfolioValue > 0 && positionValueAfterOrder > portfolioValue * config.risk.maxPositionPct) {
    reasons.push(blockReason("portfolio", "POSITION_ALLOCATION_LIMIT_EXCEEDED", `${candidate.symbol} would exceed the single-position allocation cap.`));
  }

  return reasons;
}

function evaluateDuplicateOrderRisk(candidate: TradeIntentCandidate, openOrders: OpenOrderSnapshot[]) {
  if (candidate.side === null) {
    return [];
  }

  const hasDuplicate = openOrders.some((order) => {
    const status = order.status?.toLowerCase();
    const isActive = status === undefined || ["new", "accepted", "pending_new", "partially_filled", "held", "open"].includes(status);
    if (!isActive || order.symbol.toUpperCase() !== candidate.symbol.toUpperCase()) {
      return false;
    }

    return candidate.side === "buy" || order.side === "sell";
  });

  return hasDuplicate
    ? [blockReason("orders", "DUPLICATE_OPEN_ORDER", `${candidate.symbol} already has an active open order.`)]
    : [];
}
