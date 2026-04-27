import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult } from "@/lib/semiconductors/types";
import type { AlpacaOrderSubmissionLog } from "./alpaca-trading";
import type { TradingConfigInput } from "./config";
import { runTradingDryRun } from "./runner";
import type {
  AlpacaOrderRequest,
  OpenOrderSnapshot,
  TradeOrderLog,
  TradeOrderSubmission,
  TradingDryRunResult,
  TradingPaperRunResult
} from "./types";
import { stableId } from "./utils";

export interface RunTradingPaperOptions {
  config?: TradingConfigInput;
  openOrders?: OpenOrderSnapshot[];
  fetchOpenOrders?: () => Promise<OpenOrderSnapshot[]>;
  submitOrder?: (order: AlpacaOrderRequest) => Promise<AlpacaOrderSubmissionLog>;
  continueOnError?: boolean;
}

export interface CreateTradingRunInput extends RunTradingPaperOptions {
  mode: "dry-run" | "paper";
  analysis: MarketAnalysisResult;
  portfolio: PortfolioSnapshot;
}

export async function createTradingRun(input: CreateTradingRunInput): Promise<TradingDryRunResult | TradingPaperRunResult> {
  if (input.mode === "dry-run") {
    return runTradingDryRun(input.analysis, input.portfolio, {
      config: {
        ...input.config,
        mode: "dry-run"
      },
      openOrders: input.openOrders ?? []
    });
  }

  return runTradingPaper(input.analysis, input.portfolio, input);
}

export async function runTradingPaper(
  analysis: MarketAnalysisResult,
  portfolio: PortfolioSnapshot,
  options: RunTradingPaperOptions = {}
): Promise<TradingPaperRunResult> {
  const openOrders = options.fetchOpenOrders ? await options.fetchOpenOrders() : (options.openOrders ?? []);
  const dryRun = runTradingDryRun(analysis, portfolio, {
    config: {
      ...options.config,
      mode: "paper"
    },
    openOrders
  });

  if (!dryRun.config.paperTradingEnabled) {
    return withSkippedSubmissions(dryRun, "Paper trading submission is disabled. Set AUTO_TRADING_PAPER_ENABLED=true.");
  }

  if (dryRun.config.killSwitch) {
    return withSkippedSubmissions(dryRun, "Kill switch is active.");
  }

  if (!options.submitOrder) {
    throw new Error("Paper trading requires a submitOrder implementation.");
  }

  const submissions: TradeOrderSubmission[] = [];
  const orderLogs: TradeOrderLog[] = [];

  for (const order of dryRun.orders) {
    const planId = order.client_order_id;
    const createdAt = new Date().toISOString();

    try {
      const submitted = await options.submitOrder(order);
      submissions.push({
        planId,
        clientOrderId: order.client_order_id,
        symbol: order.symbol,
        side: order.side,
        status: "submitted",
        alpacaOrderId: submitted.alpacaOrderId,
        alpacaStatus: submitted.status
      });
      orderLogs.push({
        id: stableId("orderlog", [dryRun.run.id, planId, submitted.alpacaOrderId, createdAt]),
        planId,
        runId: dryRun.run.id,
        alpacaOrderId: submitted.alpacaOrderId,
        request: order,
        response: submitted.response,
        createdAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Alpaca paper order submission failed.";
      submissions.push({
        planId,
        clientOrderId: order.client_order_id,
        symbol: order.symbol,
        side: order.side,
        status: "failed",
        error: message
      });
      orderLogs.push({
        id: stableId("orderlog", [dryRun.run.id, planId, message, createdAt]),
        planId,
        runId: dryRun.run.id,
        request: order,
        error: message,
        createdAt
      });

      if (options.continueOnError !== true) {
        break;
      }
    }
  }

  return {
    ...dryRun,
    run: {
      ...dryRun.run,
      status: submissions.some((submission) => submission.status === "failed") ? "failed" : "completed",
      notes: [...dryRun.run.notes, "Paper mode submitted planned orders to the configured Alpaca paper account."]
    },
    submissions,
    orderLogs
  };
}

function withSkippedSubmissions(
  dryRun: ReturnType<typeof runTradingDryRun>,
  error: string
): TradingPaperRunResult {
  return {
    ...dryRun,
    run: {
      ...dryRun.run,
      status: "failed",
      notes: [...dryRun.run.notes, error]
    },
    submissions: dryRun.orders.map((order) => ({
      planId: order.client_order_id,
      clientOrderId: order.client_order_id,
      symbol: order.symbol,
      side: order.side,
      status: "skipped",
      error
    })),
    orderLogs: []
  };
}
