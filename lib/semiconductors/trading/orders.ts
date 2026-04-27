import type { TradingConfig } from "./config";
import type { AlpacaOrderRequest, OrderType, SizingResult, TradeBlockReason, TradeIntentCandidate, TradePlan } from "./types";
import { compactBlockReasonMessages, roundMoney } from "./utils";

export function buildTradePlan(
  runId: string,
  planId: string,
  candidate: TradeIntentCandidate,
  sizing: SizingResult,
  riskReasons: TradeBlockReason[],
  config: TradingConfig
): TradePlan {
  const blockReasonDetails = dedupeBlockReasons([
    ...candidate.blockReasons,
    ...sizing.blockReasons,
    ...riskReasons
  ]);
  const hasBlockingError = blockReasonDetails.some((reason) => reason.severity === "error");
  const status = candidate.intent === "NO_ACTION" || sizing.quantity <= 0 || hasBlockingError ? "blocked" : "planned";
  const quantity = status === "planned" ? sizing.quantity : 0;
  const notional = status === "planned" ? sizing.notional : 0;
  const orderType = chooseOrderType(candidate, config);

  return {
    id: planId,
    runId,
    symbol: candidate.symbol,
    intent: candidate.intent,
    side: candidate.side,
    action: candidate.action,
    score: candidate.score,
    quantity,
    notional,
    orderType,
    limitPrice: sizing.limitPrice === null ? undefined : sizing.limitPrice,
    stopLoss: sizing.stopLoss === null ? undefined : sizing.stopLoss,
    takeProfit: sizing.takeProfit === null ? undefined : sizing.takeProfit,
    status,
    blockReasons: compactBlockReasonMessages(blockReasonDetails),
    blockReasonDetails,
    reasons: candidate.reasons,
    recommendationRank: candidate.recommendation.rank,
    relativeStrengthRank: candidate.recommendation.relativeStrengthRank
  };
}

export function buildAlpacaOrderRequest(plan: TradePlan): AlpacaOrderRequest | null {
  if (plan.status !== "planned" || plan.side === null || plan.quantity <= 0) {
    return null;
  }

  const request: AlpacaOrderRequest = {
    symbol: plan.symbol,
    side: plan.side,
    type: plan.orderType === "stop_limit" ? "stop_limit" : "limit",
    time_in_force: "day",
    qty: String(plan.quantity),
    client_order_id: plan.id
  };

  if (plan.limitPrice !== undefined) {
    request.limit_price = formatPrice(plan.limitPrice);
  }

  if (plan.orderType === "stop_limit" && plan.stopLoss !== undefined) {
    request.stop_price = formatPrice(plan.stopLoss);
  }

  if (plan.orderType === "bracket" && plan.side === "buy" && plan.takeProfit !== undefined && plan.stopLoss !== undefined) {
    request.order_class = "bracket";
    request.take_profit = {
      limit_price: formatPrice(plan.takeProfit)
    };
    request.stop_loss = {
      stop_price: formatPrice(plan.stopLoss)
    };
  } else {
    request.order_class = "simple";
  }

  return request;
}

function chooseOrderType(candidate: TradeIntentCandidate, config: TradingConfig): OrderType {
  if (candidate.intent === "CLOSE_LONG") {
    return "limit";
  }

  if (
    config.useBracketOrders &&
    candidate.side === "buy" &&
    candidate.stopLoss !== null &&
    candidate.takeProfit !== null &&
    (candidate.intent === "OPEN_LONG" || candidate.intent === "ADD_LONG")
  ) {
    return "bracket";
  }

  return "limit";
}

function dedupeBlockReasons(reasons: TradeBlockReason[]) {
  const seen = new Set<string>();
  const deduped: TradeBlockReason[] = [];

  for (const reason of reasons) {
    const key = `${reason.source}:${reason.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(reason);
    }
  }

  return deduped;
}

function formatPrice(value: number) {
  return roundMoney(value).toFixed(2);
}
