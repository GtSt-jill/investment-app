import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { TradingConfig } from "./config";
import type { SizingResult, TradeIntentCandidate } from "./types";
import { blockReason, roundMoney, roundQuantity } from "./utils";

export function calculateOrderSizing(
  candidate: TradeIntentCandidate,
  portfolio: PortfolioSnapshot,
  config: TradingConfig
): SizingResult {
  if (candidate.intent === "NO_ACTION" || candidate.side === null) {
    return emptySizing();
  }

  if (candidate.side === "sell") {
    return calculateSellSizing(candidate, config);
  }

  return calculateBuySizing(candidate, portfolio, config);
}

function calculateBuySizing(
  candidate: TradeIntentCandidate,
  portfolio: PortfolioSnapshot,
  config: TradingConfig
): SizingResult {
  const blockReasons = [];
  const portfolioValue = portfolio.account.portfolioValue;
  const limitPrice = candidate.targetEntryPrice ?? candidate.currentPrice;
  const stopLoss = candidate.stopLoss;
  const takeProfit = candidate.takeProfit;
  const riskAmount = portfolioValue * config.risk.riskPerTradePct;
  const riskPerShare = stopLoss === null ? null : limitPrice - stopLoss;

  if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
    blockReasons.push(blockReason("sizing", "INVALID_LIMIT_PRICE", `${candidate.symbol} has no valid buy limit price.`));
  }

  if (stopLoss === null || riskPerShare === null || riskPerShare <= 0) {
    blockReasons.push(blockReason("sizing", "INVALID_RISK_PER_SHARE", `${candidate.symbol} stop loss must be below the planned entry price.`));
  }

  const currentPositionValue = Math.max(0, candidate.position?.marketValue ?? 0);
  const maxPositionValue = portfolioValue * config.risk.maxPositionPct;
  const remainingPositionValue = Math.max(0, maxPositionValue - currentPositionValue);
  const quantityByRisk = riskPerShare !== null && riskPerShare > 0 ? roundQuantity(riskAmount / riskPerShare) : null;
  const quantityByAllocation = roundQuantity(remainingPositionValue / limitPrice);
  const quantityByBuyingPower = roundQuantity(portfolio.account.buyingPower / limitPrice);
  const availableQuantities = [quantityByRisk, quantityByAllocation, quantityByBuyingPower].filter(
    (quantity): quantity is number => quantity !== null
  );
  const quantity = availableQuantities.length > 0 ? Math.min(...availableQuantities) : 0;
  const notional = roundMoney(quantity * limitPrice);

  if (quantity <= 0) {
    blockReasons.push(blockReason("sizing", "ZERO_QUANTITY", `${candidate.symbol} calculated buy quantity is zero.`));
  }

  if (notional > 0 && notional < config.risk.minOrderNotional) {
    blockReasons.push(
      blockReason(
        "sizing",
        "ORDER_NOTIONAL_BELOW_MINIMUM",
        `${candidate.symbol} notional ${formatUsd(notional)} is below minimum ${formatUsd(config.risk.minOrderNotional)}.`
      )
    );
  }

  return {
    quantity,
    notional,
    limitPrice: roundMoney(limitPrice),
    stopLoss,
    takeProfit,
    riskAmount: roundMoney(riskAmount),
    riskPerShare: riskPerShare === null ? null : roundMoney(riskPerShare),
    quantityByRisk,
    quantityByAllocation,
    quantityByBuyingPower,
    blockReasons
  };
}

function calculateSellSizing(candidate: TradeIntentCandidate, config: TradingConfig): SizingResult {
  const blockReasons = [];
  const positionQuantity = candidate.position?.quantity ?? 0;
  const limitPrice = candidate.currentPrice;

  if (positionQuantity <= 0) {
    blockReasons.push(blockReason("sizing", "NO_LONG_POSITION", `${candidate.symbol} has no long position quantity to sell.`));
  }

  const quantity =
    candidate.intent === "CLOSE_LONG"
      ? roundQuantity(positionQuantity)
      : roundQuantity(positionQuantity * config.risk.reducePositionPct);
  const notional = roundMoney(quantity * limitPrice);

  if (quantity <= 0) {
    blockReasons.push(blockReason("sizing", "ZERO_QUANTITY", `${candidate.symbol} calculated sell quantity is zero.`));
  }

  return {
    quantity,
    notional,
    limitPrice: roundMoney(limitPrice),
    stopLoss: candidate.stopLoss,
    takeProfit: candidate.takeProfit,
    riskAmount: 0,
    riskPerShare: null,
    quantityByRisk: null,
    quantityByAllocation: null,
    quantityByBuyingPower: null,
    blockReasons
  };
}

function emptySizing(): SizingResult {
  return {
    quantity: 0,
    notional: 0,
    limitPrice: null,
    stopLoss: null,
    takeProfit: null,
    riskAmount: 0,
    riskPerShare: null,
    quantityByRisk: null,
    quantityByAllocation: null,
    quantityByBuyingPower: null,
    blockReasons: []
  };
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}
