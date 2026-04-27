import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult } from "@/lib/semiconductors/types";
import { normalizeTradingConfig, type TradingConfigInput } from "./config";
import { generateTradeIntents } from "./intent";
import { buildAlpacaOrderRequest, buildTradePlan } from "./orders";
import { evaluateTradeRisk } from "./risk";
import { calculateOrderSizing } from "./sizing";
import type { OpenOrderSnapshot, TradePlan, TradingDryRunResult } from "./types";
import { stableId } from "./utils";

export interface RunTradingDryRunOptions {
  config?: TradingConfigInput;
  openOrders?: OpenOrderSnapshot[];
}

export interface CreateTradingDryRunInput {
  mode?: "dry-run";
  analysis: MarketAnalysisResult;
  portfolio: PortfolioSnapshot;
  config?: TradingConfigInput;
  openOrders?: Array<OpenOrderSnapshot | Record<string, unknown>>;
}

export function createTradingDryRun(input: CreateTradingDryRunInput): TradingDryRunResult {
  return runTradingDryRun(input.analysis, input.portfolio, {
    config: {
      ...input.config,
      mode: input.mode ?? input.config?.mode ?? "dry-run"
    },
    openOrders: coerceOpenOrders(input.openOrders ?? [])
  });
}

export function runTradingDryRun(
  analysis: MarketAnalysisResult,
  portfolio: PortfolioSnapshot,
  options: RunTradingDryRunOptions = {}
): TradingDryRunResult {
  const config = normalizeTradingConfig({
    ...options.config,
    mode: options.config?.mode ?? "dry-run"
  });
  const openOrders = options.openOrders ?? [];
  const runId = stableId("dryrun", [
    analysis.asOf,
    config,
    [...analysis.recommendations].sort((left, right) => left.symbol.localeCompare(right.symbol)).map((row) => ({
      symbol: row.symbol,
      action: row.action,
      score: row.score,
      rank: row.rank,
      relativeStrengthRank: row.relativeStrengthRank,
      close: row.indicators.close,
      stopLoss: row.buyZone.stopLoss,
      takeProfit: row.buyZone.takeProfit
    })),
    [...portfolio.positions].sort((left, right) => left.symbol.localeCompare(right.symbol)).map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      marketValue: position.marketValue,
      allocationPct: position.allocationPct
    })),
    [...openOrders].sort((left, right) => left.symbol.localeCompare(right.symbol)).map((order) => ({
      symbol: order.symbol,
      side: order.side,
      status: order.status,
      quantity: order.quantity,
      notional: order.notional
    }))
  ]);
  const candidates = generateTradeIntents(analysis, portfolio, config, openOrders);
  const plans: TradePlan[] = [];

  for (const candidate of candidates) {
    const sizing = calculateOrderSizing(candidate, portfolio, config);
    const riskReasons = evaluateTradeRisk(candidate, sizing, {
      portfolio,
      config,
      openOrders,
      plannedBefore: plans
    });
    const planId = stableId("plan", [
      analysis.asOf,
      candidate.symbol,
      candidate.intent,
      candidate.action,
      candidate.score,
      sizing.quantity,
      sizing.limitPrice,
      sizing.stopLoss,
      sizing.takeProfit
    ]);
    const plan = buildTradePlan(
      runId,
      planId,
      candidate,
      sizing,
      riskReasons,
      config
    );
    plans.push(plan);
  }

  const orders = plans.map((plan) => buildAlpacaOrderRequest(plan)).filter((order): order is NonNullable<typeof order> => order !== null);
  const summary = summarizePlans(plans);

  return {
    run: {
      id: runId,
      mode: config.mode,
      asOf: analysis.asOf,
      generatedAt: analysis.generatedAt,
      status: "completed",
      marketRegime: analysis.summary.marketRegime,
      portfolioValue: portfolio.account.portfolioValue,
      notes: [
        "Dry-run only: no orders were submitted.",
        "Order plans are deterministic for the supplied analysis, portfolio, open orders, and config."
      ]
    },
    config,
    portfolio: {
      generatedAt: portfolio.generatedAt,
      summary: portfolio.summary
    },
    plans,
    orders,
    summary,
    notes: [
      ...analysis.notes,
      ...portfolio.notes,
      "The dry-run library is pure and does not call Alpaca or any external network service."
    ]
  };
}

function summarizePlans(plans: TradePlan[]) {
  return {
    planCount: plans.length,
    plannedCount: plans.filter((plan) => plan.status === "planned").length,
    blockedCount: plans.filter((plan) => plan.status === "blocked").length,
    buyNotional: sumNotional(plans, "buy"),
    sellNotional: sumNotional(plans, "sell"),
    newEntryCount: plans.filter((plan) => plan.status === "planned" && plan.intent === "OPEN_LONG").length
  };
}

function sumNotional(plans: TradePlan[], side: "buy" | "sell") {
  return plans
    .filter((plan) => plan.status === "planned" && plan.side === side)
    .reduce((total, plan) => total + plan.notional, 0);
}

function coerceOpenOrders(orders: Array<OpenOrderSnapshot | Record<string, unknown>>): OpenOrderSnapshot[] {
  return orders
    .map((order): OpenOrderSnapshot => {
      const side = order.side === "buy" || order.side === "sell" ? order.side : undefined;

      return {
        id: typeof order.id === "string" ? order.id : undefined,
        clientOrderId: typeof order.clientOrderId === "string" ? order.clientOrderId : undefined,
        symbol: typeof order.symbol === "string" ? order.symbol : "",
        side,
        status: typeof order.status === "string" ? order.status : undefined,
        quantity: typeof order.quantity === "number" ? order.quantity : undefined,
        notional: typeof order.notional === "number" ? order.notional : undefined,
        submittedAt: typeof order.submittedAt === "string" ? order.submittedAt : undefined
      };
    })
    .filter((order) => order.symbol.length > 0);
}
