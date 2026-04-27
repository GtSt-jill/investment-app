import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/trading/run/route";
import * as trading from "@/lib/semiconductors/trading";
import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult, RecommendationItem, SignalAction, SignalRating } from "@/lib/semiconductors/types";
import type { AlpacaOrderRequest, OpenOrderSnapshot, TradingConfigInput, TradingDryRunResult } from "@/lib/semiconductors/trading";

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

  it("rejects live mode before any trading API work is attempted", async () => {
    const response = await POST(
      new Request("http://localhost/api/trading/run", {
        method: "POST",
        body: JSON.stringify({ mode: "live" })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
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
