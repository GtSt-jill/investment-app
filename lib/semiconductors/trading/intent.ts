import type { AlpacaPositionSnapshot, PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult, RecommendationItem } from "@/lib/semiconductors/types";
import { isSymbolEnabled, type TradingConfig } from "./config";
import type { OpenOrderSnapshot, TradeBlockReason, TradeIntent, TradeIntentCandidate, TradeSide } from "./types";
import { blockReason, roundMoney } from "./utils";

export function generateTradeIntents(
  analysis: MarketAnalysisResult,
  portfolio: PortfolioSnapshot,
  config: TradingConfig,
  openOrders: OpenOrderSnapshot[] = []
): TradeIntentCandidate[] {
  const positionsBySymbol = new Map(portfolio.positions.map((position) => [position.symbol.toUpperCase(), position]));
  const activeOpenOrders = openOrders.filter(isActiveOpenOrder);
  const relativeStrengthCutoff = Math.max(
    1,
    Math.ceil(Math.max(analysis.summary.analyzedSymbols, analysis.recommendations.length) * config.risk.topRelativeStrengthPct)
  );

  return analysis.recommendations
    .map((recommendation) =>
      buildIntentCandidate(
        recommendation,
        positionsBySymbol.get(recommendation.symbol.toUpperCase()) ?? null,
        analysis,
        config,
        activeOpenOrders,
        relativeStrengthCutoff
      )
    )
    .filter((candidate) => candidate.intent !== "NO_ACTION" || candidate.blockReasons.length > 0)
    .sort(compareIntentCandidates);
}

function buildIntentCandidate(
  recommendation: RecommendationItem,
  position: AlpacaPositionSnapshot | null,
  analysis: MarketAnalysisResult,
  config: TradingConfig,
  activeOpenOrders: OpenOrderSnapshot[],
  relativeStrengthCutoff: number
): TradeIntentCandidate {
  const symbol = recommendation.symbol.toUpperCase();
  const currentPrice = recommendation.indicators.close;
  const existingAllocationPct = position?.allocationPct ?? 0;
  const baseReasons = [...recommendation.reasons];
  const blockReasons: TradeBlockReason[] = [];

  if (!isSymbolEnabled(symbol, config)) {
    blockReasons.push(blockReason("system", "SYMBOL_NOT_ENABLED", `${symbol} is not enabled for auto-trading.`));
  }

  if (recommendation.action === "BUY" && activeOpenOrders.some((order) => order.symbol.toUpperCase() === symbol)) {
    blockReasons.push(blockReason("orders", "DUPLICATE_OPEN_ORDER", `${symbol} already has an active open order.`));
  }

  if (recommendation.action === "BUY") {
    const intendedIntent = position === null ? "OPEN_LONG" : "ADD_LONG";
    blockReasons.push(...evaluateBuySignal(recommendation, position, analysis, config, relativeStrengthCutoff));

    return createCandidate(recommendation, position, intendedIntent, "buy", currentPrice, blockReasons, [
      ...baseReasons,
      position === null ? "BUY signal can become a new long entry if all risk checks pass." : "BUY signal can add to an existing long if sizing and risk checks pass."
    ]);
  }

  if (position !== null && shouldReducePosition(recommendation, position, analysis, config)) {
    const stopLoss = validPositivePrice(recommendation.buyZone.stopLoss);
    const intent: TradeIntent = stopLoss !== null && currentPrice <= stopLoss ? "CLOSE_LONG" : "REDUCE_LONG";

    return createCandidate(recommendation, position, intent, "sell", currentPrice, blockReasons, [
      ...baseReasons,
      intent === "CLOSE_LONG" ? "Current price is at or below the technical stop loss." : "Position should be reduced under the configured sell or portfolio risk rules."
    ]);
  }

  blockReasons.push(
    blockReason(
      "signal",
      "SIGNAL_NOT_BUY",
      `${recommendation.symbol} action is ${recommendation.action}; no automated buy intent was generated.`,
      "info"
    )
  );

  return createCandidate(recommendation, position, "NO_ACTION", null, currentPrice, blockReasons, [
    ...baseReasons,
    "No actionable trading intent was generated for this symbol."
  ]);
}

function evaluateBuySignal(
  recommendation: RecommendationItem,
  position: AlpacaPositionSnapshot | null,
  analysis: MarketAnalysisResult,
  config: TradingConfig,
  relativeStrengthCutoff: number
) {
  const reasons: TradeBlockReason[] = [];
  const currentPrice = recommendation.indicators.close;
  const stopLoss = validPositivePrice(recommendation.buyZone.stopLoss);
  const takeProfit = validPositivePrice(recommendation.buyZone.takeProfit);
  const idealEntry = validPositivePrice(recommendation.buyZone.idealEntry);

  if (recommendation.score < (position === null ? config.risk.minEntryScore : config.risk.addMinScore)) {
    reasons.push(
      blockReason(
        "signal",
        "SCORE_BELOW_THRESHOLD",
        `${recommendation.symbol} score ${recommendation.score} is below the configured threshold.`
      )
    );
  }

  if (recommendation.rating !== "BUY" && recommendation.rating !== "STRONG_BUY") {
    reasons.push(blockReason("signal", "RATING_NOT_BUY", `${recommendation.symbol} rating is ${recommendation.rating}.`));
  }

  if ((recommendation.marketRegime ?? analysis.summary.marketRegime) === "defensive") {
    reasons.push(blockReason("signal", "DEFENSIVE_MARKET_REGIME", "New and add-on buys are blocked in a defensive market regime."));
  }

  if (recommendation.relativeStrengthRank <= 0 || recommendation.relativeStrengthRank > relativeStrengthCutoff) {
    reasons.push(
      blockReason(
        "signal",
        "RELATIVE_STRENGTH_NOT_TOP_GROUP",
        `${recommendation.symbol} relative strength rank ${recommendation.relativeStrengthRank} is outside the top group cutoff ${relativeStrengthCutoff}.`
      )
    );
  }

  if (stopLoss === null || takeProfit === null || currentPrice <= stopLoss || currentPrice >= takeProfit) {
    reasons.push(
      blockReason(
        "signal",
        "PRICE_OUTSIDE_BUY_ZONE",
        `${recommendation.symbol} price must be above stop loss and below take profit.`
      )
    );
  }

  if (idealEntry !== null && currentPrice > idealEntry * (1 + config.risk.maxEntryPricePremiumPct)) {
    reasons.push(
      blockReason(
        "signal",
        "ENTRY_PRICE_EXTENDED",
        `${recommendation.symbol} price is more than ${formatPct(config.risk.maxEntryPricePremiumPct)} above ideal entry.`
      )
    );
  }

  if (recommendation.indicators.atrPct === null || recommendation.indicators.atrPct > config.risk.maxAtrPct) {
    reasons.push(
      blockReason(
        "symbol",
        "ATR_TOO_HIGH",
        `${recommendation.symbol} ATR percentage is unavailable or above ${formatPct(config.risk.maxAtrPct)}.`
      )
    );
  }

  if (position !== null) {
    if (!config.risk.allowAddToLosingPositions && position.unrealizedPnl <= 0) {
      reasons.push(blockReason("portfolio", "ADD_TO_LOSER_BLOCKED", `${recommendation.symbol} add-on buy is blocked because the current position is not profitable.`));
    }

    if ((position.allocationPct ?? 0) >= config.risk.maxPositionPct) {
      reasons.push(
        blockReason(
          "portfolio",
          "POSITION_ALREADY_AT_MAX_ALLOCATION",
          `${recommendation.symbol} allocation ${formatPct(position.allocationPct ?? 0)} is already at or above the configured cap.`
        )
      );
    }
  }

  const earningsReason = evaluateEarningsBlackout(recommendation, analysis.asOf, config.risk.earningsBlackoutDays);
  if (earningsReason !== null) {
    reasons.push(earningsReason);
  }

  return reasons;
}

function shouldReducePosition(
  recommendation: RecommendationItem,
  position: AlpacaPositionSnapshot,
  analysis: MarketAnalysisResult,
  config: TradingConfig
) {
  const currentPrice = recommendation.indicators.close;
  const stopLoss = validPositivePrice(recommendation.buyZone.stopLoss);

  return (
    (recommendation.action === "SELL" && recommendation.score < config.risk.sellScoreThreshold) ||
    (stopLoss !== null && currentPrice <= stopLoss) ||
    ((recommendation.marketRegime ?? analysis.summary.marketRegime) === "defensive" && recommendation.score < config.risk.minEntryScore) ||
    (position.allocationPct ?? 0) > config.risk.maxPositionPct
  );
}

function createCandidate(
  recommendation: RecommendationItem,
  position: AlpacaPositionSnapshot | null,
  intent: TradeIntent,
  side: TradeSide | null,
  currentPrice: number,
  blockReasons: TradeBlockReason[],
  reasons: string[]
): TradeIntentCandidate {
  return {
    symbol: recommendation.symbol,
    recommendation,
    position,
    intent,
    side,
    action: recommendation.action,
    score: recommendation.score,
    currentPrice,
    stopLoss: validPositivePrice(recommendation.buyZone.stopLoss),
    takeProfit: validPositivePrice(recommendation.buyZone.takeProfit),
    targetEntryPrice: chooseTargetEntryPrice(recommendation),
    existingAllocationPct: position?.allocationPct ?? 0,
    isNewEntry: intent === "OPEN_LONG",
    reasons,
    blockReasons
  };
}

function chooseTargetEntryPrice(recommendation: RecommendationItem) {
  const currentPrice = validPositivePrice(recommendation.indicators.close);
  const idealEntry = validPositivePrice(recommendation.buyZone.idealEntry);
  const pullbackEntry = validPositivePrice(recommendation.buyZone.pullbackEntry);

  if (currentPrice === null) {
    return idealEntry;
  }

  if (idealEntry === null) {
    return currentPrice;
  }

  if (currentPrice <= idealEntry) {
    return roundMoney(currentPrice);
  }

  return roundMoney(pullbackEntry ?? idealEntry);
}

function evaluateEarningsBlackout(recommendation: RecommendationItem, asOf: string, blackoutDays: number) {
  if (!recommendation.earningsDate || blackoutDays <= 0) {
    return null;
  }

  const asOfDate = parseDateOnly(asOf);
  const earningsDate = parseDateOnly(recommendation.earningsDate);
  if (asOfDate === null || earningsDate === null) {
    return blockReason("symbol", "EARNINGS_DATE_UNPARSEABLE", `${recommendation.symbol} earnings date could not be parsed.`);
  }

  const daysUntilEarnings = Math.floor((earningsDate.getTime() - asOfDate.getTime()) / 86_400_000);
  if (daysUntilEarnings >= 0 && daysUntilEarnings <= blackoutDays) {
    return blockReason(
      "symbol",
      "EARNINGS_BLACKOUT",
      `${recommendation.symbol} earnings are within ${blackoutDays} calendar days.`
    );
  }

  return null;
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validPositivePrice(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isActiveOpenOrder(order: OpenOrderSnapshot) {
  const status = order.status?.toLowerCase();
  return status === undefined || ["new", "accepted", "pending_new", "partially_filled", "held", "open"].includes(status);
}

function compareIntentCandidates(left: TradeIntentCandidate, right: TradeIntentCandidate) {
  const priority = intentPriority(right.intent) - intentPriority(left.intent);
  if (priority !== 0) {
    return priority;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.symbol.localeCompare(right.symbol);
}

function intentPriority(intent: TradeIntent) {
  switch (intent) {
    case "CLOSE_LONG":
      return 5;
    case "REDUCE_LONG":
      return 4;
    case "OPEN_LONG":
      return 3;
    case "ADD_LONG":
      return 2;
    case "NO_ACTION":
      return 1;
  }
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
