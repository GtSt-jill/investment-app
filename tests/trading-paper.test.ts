import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/trading/run/route";
import * as trading from "@/lib/semiconductors/trading";
import { appendTradingRunHistory } from "@/lib/semiconductors/trading/history";
import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult, RecommendationItem, SignalAction, SignalRating } from "@/lib/semiconductors/types";
import type { AlpacaOrderRequest, OpenOrderSnapshot, TradingConfigInput, TradingDryRunResult, TradingPaperRunResult } from "@/lib/semiconductors/trading";

type TradingRunMode = "dry-run" | "paper";

interface CreateTradingRunInput {
  mode: TradingRunMode;
  analysis: MarketAnalysisResult;
  portfolio: PortfolioSnapshot;
  config?: TradingConfigInput;
  openOrders?: Array<OpenOrderSnapshot | Record<string, unknown>>;
  fetchOpenOrders?: () => Promise<OpenOrderSnapshot[]>;
  submitOrder?: (order: AlpacaOrderRequest) => Promise<any>;
}

type CreateTradingRun = (input: CreateTradingRunInput) => Promise<TradingDryRunResult>;

describe("auto-trading paper execution", () => {
  it("paper mode submits only planned orders", async () => {
    const createTradingRun = intendedCreateTradingRun();
    const fetchOpenOrders = vi.fn(async () => []);
    const submitOrder = vi.fn(async (order: AlpacaOrderRequest) => paperOrderResponse(order));

    const result = await createTradingRun({
      mode: "paper",
      analysis: analysis([
        recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 }),
        recommendation({ symbol: "AMD", action: "HOLD", rating: "WATCH", score: 58, close: 50, stopLoss: 47.5 })
      ]),
      portfolio: portfolio({ positions: [] }),
      config: paperConfig(),
      fetchOpenOrders,
      submitOrder
    });

    expect(result.run.mode).toBe("paper");
    expect(planFor(result.plans, "NVDA").status).not.toBe("blocked");
    expect(planFor(result.plans, "AMD").status).toBe("blocked");
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(submitOrder.mock.calls[0][0]).toMatchObject({ symbol: "NVDA", side: "buy" });
  });

  it("paper mode re-fetches open orders and uses them for duplicate blocking before submit", async () => {
    const createTradingRun = intendedCreateTradingRun();
    const fetchOpenOrders = vi.fn(async () => [
      { id: "open-nvda", symbol: "NVDA", side: "buy", status: "accepted" } satisfies OpenOrderSnapshot
    ]);
    const submitOrder = vi.fn(async (order: AlpacaOrderRequest) => paperOrderResponse(order));

    const result = await createTradingRun({
      mode: "paper",
      analysis: analysis([
        recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 })
      ]),
      portfolio: portfolio({ positions: [] }),
      openOrders: [],
      config: paperConfig(),
      fetchOpenOrders,
      submitOrder
    });

    expect(fetchOpenOrders).toHaveBeenCalledTimes(1);
    expect(blockCodes(planFor(result.plans, "NVDA"))).toContain("DUPLICATE_OPEN_ORDER");
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("paper mode stops submitting after the first submit error", async () => {
    const createTradingRun = intendedCreateTradingRun();
    const fetchOpenOrders = vi.fn(async () => []);
    const submitOrder = vi.fn(async (order: AlpacaOrderRequest) => {
      if (order.symbol === "NVDA") {
        throw new Error("submit NVDA failed");
      }

      return paperOrderResponse(order);
    });

    const result = await createTradingRun({
        mode: "paper",
        analysis: analysis([
          recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 }),
          recommendation({ symbol: "AMD", action: "BUY", rating: "BUY", score: 76, close: 50, stopLoss: 47.5 })
        ]),
        portfolio: portfolio({ positions: [] }),
        config: paperConfig(),
        fetchOpenOrders,
        submitOrder
      });

    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(submitOrder.mock.calls[0][0]).toMatchObject({ symbol: "NVDA" });
    expect((result as any).submissions).toEqual([
      expect.objectContaining({ symbol: "NVDA", status: "failed", error: "submit NVDA failed" })
    ]);
  });

  it("dry-run mode still submits nothing when using the trading run executor", async () => {
    const createTradingRun = intendedCreateTradingRun();
    const fetchOpenOrders = vi.fn(async () => []);
    const submitOrder = vi.fn(async (order: AlpacaOrderRequest) => paperOrderResponse(order));

    const result = await createTradingRun({
      mode: "dry-run",
      analysis: analysis([
        recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 })
      ]),
      portfolio: portfolio({ positions: [] }),
      config: dryRunConfig(),
      fetchOpenOrders,
      submitOrder
    });

    expect(result.run.mode).toBe("dry-run");
    expect(planFor(result.plans, "NVDA")).toMatchObject({ status: "planned" });
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe("trading run route mode guards", () => {
  it("does not allow request body config to enable paper trading", async () => {
    const previous = process.env.AUTO_TRADING_PAPER_ENABLED;
    delete process.env.AUTO_TRADING_PAPER_ENABLED;
    try {
      const response = await POST(
        new Request("http://localhost/api/trading/run", {
          method: "POST",
          body: JSON.stringify({ mode: "paper", config: { paperTradingEnabled: true } })
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Paper trading is disabled") });
    } finally {
      if (previous === undefined) {
        delete process.env.AUTO_TRADING_PAPER_ENABLED;
      } else {
        process.env.AUTO_TRADING_PAPER_ENABLED = previous;
      }
    }
  });

  it("returns live readiness blockers before any trading API work is attempted", async () => {
    const response = await POST(
      new Request("http://localhost/api/trading/run", {
        method: "POST",
        body: JSON.stringify({ mode: "live" })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Live trading approval requirements are not met.",
      readiness: {
        ready: false,
        paper: expect.objectContaining({ ready: false }),
        approval: expect.objectContaining({ ready: false })
      }
    });
  });

  it("requires paper review and explicit token approval before live can pass gates", async () => {
    const previousPath = process.env.AUTO_TRADING_RUN_LOG_PATH;
    const previousLiveEnabled = process.env.AUTO_TRADING_LIVE_ENABLED;
    const previousToken = process.env.AUTO_TRADING_LIVE_CONFIRMATION_TOKEN;
    const filePath = await tempHistoryPath();

    process.env.AUTO_TRADING_RUN_LOG_PATH = filePath;
    process.env.AUTO_TRADING_LIVE_ENABLED = "true";
    process.env.AUTO_TRADING_LIVE_CONFIRMATION_TOKEN = "confirm-live";

    try {
      await appendTradingRunHistory(tradingRunResult("dry-latest", "dry-run", "2026-04-30"), filePath);
      for (let index = 0; index < 20; index += 1) {
        await appendTradingRunHistory(tradingRunResult(`paper-${index}`, "paper", dateAt(index)), filePath);
      }

      const response = await POST(
        new Request("http://localhost/api/trading/run", {
          method: "POST",
          body: JSON.stringify({
            mode: "live",
            liveApproval: {
              approvedDryRunId: "dry-latest",
              confirmationToken: "confirm-live"
            }
          })
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "Live approval gates passed, but live order submission is still disabled in this build.",
        readiness: {
          ready: true,
          paper: expect.objectContaining({ ready: true, completedPaperDays: 20 }),
          approval: expect.objectContaining({ ready: true })
        }
      });
    } finally {
      restoreEnv("AUTO_TRADING_RUN_LOG_PATH", previousPath);
      restoreEnv("AUTO_TRADING_LIVE_ENABLED", previousLiveEnabled);
      restoreEnv("AUTO_TRADING_LIVE_CONFIRMATION_TOKEN", previousToken);
    }
  });
});

function intendedCreateTradingRun(): CreateTradingRun {
  const candidate = (trading as { createTradingRun?: unknown }).createTradingRun;
  if (typeof candidate !== "function") {
    throw new Error("Expected @/lib/semiconductors/trading to export createTradingRun for Phase 2 paper trading.");
  }

  return candidate as CreateTradingRun;
}

function paperOrderResponse(order: AlpacaOrderRequest) {
  return {
    id: `paper-${order.symbol.toLowerCase()}`,
    client_order_id: order.client_order_id,
    symbol: order.symbol,
    status: "accepted"
  };
}

async function tempHistoryPath() {
  const dir = await mkdtemp(join(tmpdir(), "trading-live-readiness-"));
  return join(dir, "runs.jsonl");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function dateAt(index: number) {
  return new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10);
}

function tradingRunResult(id: string, mode: "dry-run" | "paper", asOf: string): TradingDryRunResult | TradingPaperRunResult {
  const base: TradingDryRunResult = {
    run: {
      id,
      mode,
      asOf,
      generatedAt: `${asOf}T21:00:00.000Z`,
      status: "completed",
      marketRegime: "bullish",
      portfolioValue: 100_000,
      notes: []
    },
    config: {
      mode,
      enabledSymbols: null,
      killSwitch: false,
      paperTradingEnabled: mode === "paper",
      liveTradingEnabled: false,
      useBracketOrders: true,
      riskProfile: "balanced",
      risk: {
        ...trading.DEFAULT_RISK_CONFIG,
        ...riskConfig(),
        maxPositions: 20,
        minCashPct: 0.05,
        minPrice: 5,
        minVolume20: 300_000,
        earningsBlackoutDays: 7,
        addMinScore: 72,
        sellScoreThreshold: 45,
        severeSellExitScoreThreshold: 15,
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
      }
    },
    portfolio: {
      generatedAt: `${asOf}T21:00:00.000Z`,
      summary: {
        positionCount: 0,
        openOrderCount: 0,
        longExposure: 0,
        shortExposure: 0,
        cashAllocationPct: 1,
        largestPositionSymbol: null,
        largestPositionAllocationPct: null,
        totalUnrealizedPnl: 0,
        totalUnrealizedPnlPct: null
      }
    },
    plans: [],
    orders: [],
    summary: {
      planCount: 1,
      plannedCount: mode === "paper" ? 1 : 0,
      blockedCount: 0,
      buyNotional: mode === "paper" ? 1000 : 0,
      sellNotional: 0,
      newEntryCount: mode === "paper" ? 1 : 0
    },
    notes: []
  };

  if (mode === "dry-run") {
    return base;
  }

  return {
    ...base,
    submissions: [
      {
        planId: `plan-${id}`,
        clientOrderId: `plan-${id}`,
        symbol: "NVDA",
        side: "buy",
        status: "submitted",
        alpacaOrderId: `alpaca-${id}`,
        alpacaStatus: "accepted"
      }
    ],
    orderLogs: []
  };
}

function dryRunConfig(): TradingConfigInput {
  return {
    mode: "dry-run",
    risk: riskConfig()
  };
}

function paperConfig(): TradingConfigInput {
  return {
    mode: "paper",
    paperTradingEnabled: true,
    risk: riskConfig()
  };
}

function riskConfig(): TradingConfigInput["risk"] {
  return {
    riskPerTradePct: 0.005,
    maxPositionPct: 0.08,
    maxSectorPct: 0.5,
    maxDailyNewEntries: 3,
    maxDailyNotionalPct: 0.15,
    minOrderNotional: 100,
    maxAtrPct: 0.08,
    minEntryScore: 70,
    topRelativeStrengthPct: 1,
    maxEntryPricePremiumPct: 0.03
  };
}

function planFor(plans: Array<Record<string, any>>, symbol: string) {
  const plan = plans.find((item) => item.symbol === symbol);
  expect(plan).toBeDefined();
  return plan!;
}

function blockCodes(plan: Record<string, any>) {
  return (plan.blockReasonDetails ?? []).map((reason: { code: string }) => reason.code);
}

function analysis(recommendations: RecommendationItem[]): MarketAnalysisResult {
  return {
    asOf: "2026-04-24",
    generatedAt: "2026-04-24T21:00:00.000Z",
    universe: recommendations.map((item) => ({ symbol: item.symbol, name: item.name, segment: item.segment })),
    recommendations,
    buyCandidates: recommendations.filter((item) => item.action === "BUY"),
    sellCandidates: recommendations.filter((item) => item.action === "SELL"),
    watchlist: recommendations.filter((item) => item.action === "HOLD"),
    summary: {
      analyzedSymbols: recommendations.length,
      averageScore: recommendations.reduce((total, item) => total + item.score, 0) / recommendations.length,
      strongestSymbol: recommendations[0]?.symbol ?? null,
      weakestSymbol: recommendations[recommendations.length - 1]?.symbol ?? null,
      marketBias: "bullish",
      marketRegime: "bullish",
      excludedSymbols: []
    },
    notes: []
  };
}

function recommendation(input: {
  symbol: string;
  action: SignalAction;
  rating: SignalRating;
  score: number;
  close: number;
  stopLoss: number;
}): RecommendationItem {
  return {
    symbol: input.symbol,
    name: input.symbol,
    segment: "Semiconductor Watchlist",
    asOf: "2026-04-24",
    rating: input.rating,
    action: input.action,
    signalChange: input.action === "BUY" ? "NEW_BUY" : "NO_CHANGE",
    score: input.score,
    scoreBreakdown: {
      trendScore: input.score,
      momentumScore: input.score,
      relativeStrengthScore: input.score,
      riskScore: input.score,
      volumeScore: input.score
    },
    rank: 1,
    relativeStrengthRank: 1,
    marketRegime: "bullish",
    indicators: {
      close: input.close,
      previousClose: input.close * 0.99,
      dayChangePct: 0.01,
      sma20: input.close * 0.98,
      sma50: input.close * 0.95,
      sma200: input.close * 0.9,
      rsi14: 58,
      macd: 1,
      macdSignal: 0.7,
      macdHistogram: 0.3,
      macdHistogramPrevious: 0.2,
      bollingerUpper: input.close * 1.08,
      bollingerLower: input.close * 0.92,
      atr14: input.close * 0.03,
      atrPct: 0.03,
      volume5: 2_000_000,
      volume20: 1_800_000,
      volumeRatio: 1.1,
      volume5To20Ratio: 1.1,
      momentum20: 0.08,
      momentum63: 0.18,
      momentum126: 0.24,
      drawdownFromHigh: -0.04,
      longTermTrendUnavailable: false
    },
    reasons: ["Fixture recommendation for paper trading tests"],
    risks: [],
    buyZone: {
      idealEntry: input.close,
      pullbackEntry: input.close * 0.98,
      stopLoss: input.stopLoss,
      takeProfit: input.close * 1.18
    },
    chart: [
      {
        date: "2026-04-24",
        open: input.close * 0.99,
        high: input.close * 1.01,
        low: input.close * 0.98,
        close: input.close,
        volume: 2_000_000,
        sma20: input.close * 0.98,
        sma50: input.close * 0.95
      }
    ]
  };
}

function portfolio(input: {
  account?: Partial<PortfolioSnapshot["account"]>;
  positions: PortfolioSnapshot["positions"];
}): PortfolioSnapshot {
  const account: PortfolioSnapshot["account"] = {
    id: "acct-1",
    accountNumber: "PAPER123",
    status: "ACTIVE",
    currency: "USD",
    buyingPower: 100_000,
    cash: 100_000,
    portfolioValue: 100_000,
    equity: 100_000,
    lastEquity: 99_500,
    longMarketValue: input.positions.reduce((total, position) => total + Math.max(position.marketValue, 0), 0),
    shortMarketValue: 0,
    initialMargin: 0,
    maintenanceMargin: 0,
    dayPnl: 500,
    dayPnlPct: 500 / 99_500,
    tradingBlocked: false,
    transfersBlocked: false,
    accountBlocked: false,
    patternDayTrader: false,
    ...input.account
  };

  return {
    generatedAt: "2026-04-24T21:00:00.000Z",
    account,
    positions: input.positions,
    openOrders: [],
    summary: {
      positionCount: input.positions.length,
      openOrderCount: 0,
      longExposure: input.positions.reduce((total, position) => total + Math.max(position.marketValue, 0), 0),
      shortExposure: input.positions.reduce((total, position) => total + Math.abs(Math.min(position.marketValue, 0)), 0),
      cashAllocationPct: account.portfolioValue > 0 ? account.cash / account.portfolioValue : null,
      largestPositionSymbol: input.positions[0]?.symbol ?? null,
      largestPositionAllocationPct: input.positions[0]?.allocationPct ?? null,
      totalUnrealizedPnl: input.positions.reduce((total, position) => total + position.unrealizedPnl, 0),
      totalUnrealizedPnlPct: null
    },
    notes: []
  };
}
