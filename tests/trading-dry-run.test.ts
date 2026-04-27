import { describe, expect, it } from "vitest";

import { createTradingDryRun } from "@/lib/semiconductors/trading";
import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketAnalysisResult, RecommendationItem, SignalAction, SignalRating } from "@/lib/semiconductors/types";

describe("auto-trading dry-run core", () => {
  it("creates an OPEN_LONG submittable plan for an unheld BUY when risk allows", () => {
    const result = createResult({
      recommendations: [recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 })],
      portfolio: portfolio({ positions: [] })
    });
    const plan = planFor(result.plans, "NVDA");

    expect(plan).toMatchObject({
      symbol: "NVDA",
      intent: "OPEN_LONG",
      action: "BUY",
      status: "planned",
      blockReasons: []
    });
    expect(plan.quantity).toBeGreaterThan(0);
    expect(plan.notional).toBeGreaterThanOrEqual(100);
    expect(orderFor(result.orders, "NVDA")).toMatchObject({ symbol: "NVDA", side: "buy" });
  });

  it("turns HOLD into a blocked NO_ACTION plan without an order", () => {
    const result = createResult({
      recommendations: [recommendation({ symbol: "NVDA", action: "HOLD", rating: "WATCH", score: 58, close: 100, stopLoss: 94 })],
      portfolio: portfolio({ positions: [] })
    });
    const plan = planFor(result.plans, "NVDA");

    expect(plan).toMatchObject({
      symbol: "NVDA",
      intent: "NO_ACTION",
      action: "HOLD",
      status: "blocked",
      quantity: 0,
      notional: 0
    });
    expect(blockCodes(plan)).toContain("SIGNAL_NOT_BUY");
    expect(result.orders.some((order) => order.symbol === "NVDA")).toBe(false);
  });

  it("blocks every plan when account trading is blocked", () => {
    const result = createResult({
      recommendations: [
        recommendation({ symbol: "NVDA", action: "BUY", rating: "STRONG_BUY", score: 88, close: 100, stopLoss: 95 }),
        recommendation({ symbol: "AMD", action: "BUY", rating: "BUY", score: 75, close: 50, stopLoss: 47.5 })
      ],
      portfolio: portfolio({ account: { tradingBlocked: true }, positions: [] })
    });

    expect(result.plans).toHaveLength(2);
    expect(result.orders).toEqual([]);
    for (const plan of result.plans) {
      expect(plan).toMatchObject({
        status: "blocked",
        quantity: 0,
        notional: 0
      });
      expect(blockCodes(plan)).toContain("ACCOUNT_TRADING_BLOCKED");
    }
  });

  it("sizes orders by the tighter of per-trade risk and max position value", () => {
    const result = createResult({
      recommendations: [
        recommendation({ symbol: "RISK", action: "BUY", rating: "BUY", score: 80, close: 100, stopLoss: 90 }),
        recommendation({ symbol: "ALLOC", action: "BUY", rating: "BUY", score: 80, close: 100, stopLoss: 99 })
      ],
      portfolio: portfolio({ positions: [] })
    });

    expect(planFor(result.plans, "RISK")).toMatchObject({
      quantity: 50,
      notional: 5_000,
      status: "planned"
    });
    expect(planFor(result.plans, "ALLOC")).toMatchObject({
      quantity: 80,
      notional: 8_000,
      status: "planned"
    });
    expect(result.orders.map((order) => order.symbol).sort()).toEqual(["ALLOC", "RISK"]);
  });

  it("blocks an otherwise valid BUY when a duplicate open order exists", () => {
    const result = createResult({
      recommendations: [recommendation({ symbol: "NVDA", action: "BUY", rating: "BUY", score: 78, close: 100, stopLoss: 95 })],
      portfolio: portfolio({ positions: [] }),
      openOrders: [{ id: "order-1", symbol: "NVDA", side: "buy", status: "accepted" }]
    });
    const plan = planFor(result.plans, "NVDA");

    expect(plan).toMatchObject({
      symbol: "NVDA",
      intent: "OPEN_LONG",
      status: "blocked",
      quantity: 0,
      notional: 0
    });
    expect(blockCodes(plan)).toContain("DUPLICATE_OPEN_ORDER");
    expect(result.orders.some((order) => order.symbol === "NVDA")).toBe(false);
  });

  it("does not block stop-loss exits with entry-only symbol filters", () => {
    const result = createResult({
      recommendations: [
        recommendation({
          symbol: "EXIT",
          action: "SELL",
          rating: "SELL",
          score: 20,
          close: 4,
          stopLoss: 5,
          volume20: 25_000,
          atrPct: 0.2
        })
      ],
      portfolio: portfolio({ positions: [position({ symbol: "EXIT", quantity: 100, currentPrice: 4, allocationPct: 0.004 })] })
    });
    const plan = planFor(result.plans, "EXIT");

    expect(plan).toMatchObject({
      symbol: "EXIT",
      intent: "CLOSE_LONG",
      side: "sell",
      orderType: "limit",
      status: "planned",
      quantity: 100,
      notional: 400
    });
    expect(blockCodes(plan)).not.toContain("PRICE_BELOW_MINIMUM");
    expect(blockCodes(plan)).not.toContain("VOLUME_BELOW_MINIMUM");
    expect(blockCodes(plan)).not.toContain("ATR_TOO_HIGH");
    expect(orderFor(result.orders, "EXIT")).toMatchObject({ symbol: "EXIT", side: "sell", type: "limit", limit_price: "4.00" });
  });

  it("blocks a sell exit when an active sell order already exists", () => {
    const result = createResult({
      recommendations: [
        recommendation({
          symbol: "EXIT",
          action: "SELL",
          rating: "SELL",
          score: 20,
          close: 4,
          stopLoss: 5
        })
      ],
      portfolio: portfolio({ positions: [position({ symbol: "EXIT", quantity: 100, currentPrice: 4, allocationPct: 0.004 })] }),
      openOrders: [{ id: "open-exit", symbol: "EXIT", side: "sell", status: "accepted" }]
    });
    const plan = planFor(result.plans, "EXIT");

    expect(plan).toMatchObject({
      intent: "CLOSE_LONG",
      status: "blocked",
      quantity: 0,
      notional: 0
    });
    expect(blockCodes(plan)).toContain("DUPLICATE_OPEN_ORDER");
  });
});

function createResult(input: {
  recommendations: RecommendationItem[];
  portfolio: PortfolioSnapshot;
  openOrders?: Array<Record<string, unknown>>;
}) {
  return createTradingDryRun({
    mode: "dry-run",
    analysis: analysis(input.recommendations),
    portfolio: input.portfolio,
    openOrders: input.openOrders ?? [],
    config: {
      mode: "dry-run",
      risk: {
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
      }
    }
  });
}

function planFor(plans: Array<Record<string, any>>, symbol: string) {
  const plan = plans.find((item) => item.symbol === symbol);
  expect(plan).toBeDefined();
  return plan!;
}

function orderFor(orders: Array<Record<string, any>>, symbol: string) {
  const order = orders.find((item) => item.symbol === symbol);
  expect(order).toBeDefined();
  return order!;
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
  volume20?: number;
  atrPct?: number;
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
      atrPct: input.atrPct ?? 0.03,
      volume5: 2_000_000,
      volume20: input.volume20 ?? 1_800_000,
      volumeRatio: 1.1,
      volume5To20Ratio: 1.1,
      momentum20: 0.08,
      momentum63: 0.18,
      momentum126: 0.24,
      drawdownFromHigh: -0.04,
      longTermTrendUnavailable: false
    },
    reasons: ["Fixture recommendation for dry-run planning tests"],
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

function position(input: {
  symbol: string;
  quantity: number;
  currentPrice: number;
  allocationPct: number;
}): PortfolioSnapshot["positions"][number] {
  const marketValue = input.quantity * input.currentPrice;

  return {
    symbol: input.symbol,
    assetClass: "us_equity",
    side: "long",
    quantity: input.quantity,
    marketValue,
    costBasis: marketValue * 1.1,
    averageEntryPrice: input.currentPrice * 1.1,
    currentPrice: input.currentPrice,
    lastDayPrice: input.currentPrice * 1.02,
    unrealizedPnl: -marketValue * 0.1,
    unrealizedPnlPct: -0.1,
    unrealizedIntradayPnl: -marketValue * 0.02,
    unrealizedIntradayPnlPct: -0.02,
    allocationPct: input.allocationPct
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
    summary: {
      positionCount: input.positions.length,
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
