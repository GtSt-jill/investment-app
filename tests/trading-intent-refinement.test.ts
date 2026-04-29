import { describe, expect, it } from "vitest";

import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import {
  createTradingDryRun,
  generateTradeIntents,
  normalizeTradingConfig,
  type TradePlan,
  type TradingConfigInput
} from "@/lib/semiconductors/trading";
import type { MarketAnalysisResult, RecommendationItem, SignalAction, SignalRating } from "@/lib/semiconductors/types";

describe("trading intent refinement semantics", () => {
  it("documents that SELL means avoid-new-buy when there is no current position", () => {
    const candidates = intents({
      recommendations: [recommendation({ symbol: "NVDA", action: "SELL", rating: "SELL", score: 20, close: 100, stopLoss: 92 })],
      portfolio: portfolio({ positions: [] })
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      symbol: "NVDA",
      action: "SELL",
      stance: "bearish",
      actionReason: "SELL_AVOID_NEW_BUY",
      exitReason: null,
      scoreGate: "not_applicable",
      intent: "NO_ACTION",
      side: null,
      position: null
    });
    expect(blockCodes(candidates[0])).toEqual(["SIGNAL_NOT_BUY"]);
  });

  it("documents that the same SELL action becomes a partial reduction only when a held position is weak but above stop", () => {
    const candidates = intents({
      recommendations: [recommendation({ symbol: "NVDA", action: "SELL", rating: "SELL", score: 20, close: 100, stopLoss: 92 })],
      portfolio: portfolio({ positions: [position({ symbol: "NVDA", quantity: 100, currentPrice: 100, allocationPct: 0.1 })] })
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      symbol: "NVDA",
      action: "SELL",
      stance: "bearish",
      actionReason: "WEAK_SELL_REDUCE",
      exitReason: "WEAK_SELL_SIGNAL",
      intent: "REDUCE_LONG",
      side: "sell"
    });
  });

  it("documents BUY/HOLD threshold churn: action gates intent before score and rating refinements", () => {
    const candidates = intents({
      recommendations: [
        recommendation({ symbol: "BUY69", action: "BUY", rating: "BUY", score: 69, close: 100, stopLoss: 94 }),
        recommendation({ symbol: "HOLD70", action: "HOLD", rating: "BUY", score: 70, close: 100, stopLoss: 94 })
      ],
      portfolio: portfolio({ positions: [] })
    });

    expect(candidateFor(candidates, "BUY69")).toMatchObject({
      action: "BUY",
      score: 69,
      stance: "bullish",
      actionReason: "BUY_SIGNAL",
      scoreGate: "blocked",
      entryScoreThreshold: 70,
      intent: "OPEN_LONG",
      side: "buy"
    });
    expect(blockCodes(candidateFor(candidates, "BUY69"))).toContain("SCORE_BELOW_THRESHOLD");

    expect(candidateFor(candidates, "HOLD70")).toMatchObject({
      action: "HOLD",
      score: 70,
      stance: "neutral",
      actionReason: "HOLD_SIGNAL",
      scoreGate: "not_applicable",
      intent: "NO_ACTION",
      side: null
    });
    expect(blockCodes(candidateFor(candidates, "HOLD70"))).toEqual(["SIGNAL_NOT_BUY"]);
  });

  it("closes severe SELL signals by default while ordinary weak SELL signals reduce", () => {
    const candidates = intents({
      recommendations: [
        recommendation({ symbol: "WEAK", action: "SELL", rating: "SELL", score: 20, close: 100, stopLoss: 92 }),
        recommendation({ symbol: "SEVERE", action: "SELL", rating: "STRONG_SELL", score: 0, close: 100, stopLoss: 92 }),
        recommendation({ symbol: "STOP", action: "SELL", rating: "SELL", score: 40, close: 90, stopLoss: 92 })
      ],
      portfolio: portfolio({
        positions: [
          position({ symbol: "WEAK", quantity: 100, currentPrice: 100, allocationPct: 0.1 }),
          position({ symbol: "SEVERE", quantity: 100, currentPrice: 100, allocationPct: 0.1 }),
          position({ symbol: "STOP", quantity: 100, currentPrice: 90, allocationPct: 0.09 })
        ]
      })
    });

    expect(candidateFor(candidates, "WEAK")).toMatchObject({
      action: "SELL",
      score: 20,
      intent: "REDUCE_LONG",
      actionReason: "WEAK_SELL_REDUCE",
      exitReason: "WEAK_SELL_SIGNAL",
      side: "sell"
    });
    expect(candidateFor(candidates, "SEVERE")).toMatchObject({
      action: "SELL",
      score: 0,
      intent: "CLOSE_LONG",
      actionReason: "SEVERE_SELL_EXIT",
      exitReason: "SEVERE_SELL_SIGNAL",
      severeSellExitScoreThreshold: 15,
      side: "sell"
    });
    expect(candidateFor(candidates, "STOP")).toMatchObject({
      action: "SELL",
      score: 40,
      intent: "CLOSE_LONG",
      actionReason: "STOP_LOSS_EXIT",
      exitReason: "STOP_LOSS",
      side: "sell"
    });
  });

  it("keeps severe SELL as a reduction when the full-exit policy is disabled", () => {
    const candidates = intents({
      recommendations: [recommendation({ symbol: "NVDA", action: "SELL", rating: "STRONG_SELL", score: 0, close: 100, stopLoss: 92 })],
      portfolio: portfolio({ positions: [position({ symbol: "NVDA", quantity: 100, currentPrice: 100, allocationPct: 0.1 })] }),
      config: {
        risk: {
          severeSellExitScoreThreshold: null
        }
      }
    });

    expect(candidateFor(candidates, "NVDA")).toMatchObject({
      intent: "REDUCE_LONG",
      actionReason: "WEAK_SELL_REDUCE",
      exitReason: "WEAK_SELL_SIGNAL",
      severeSellExitScoreThreshold: null
    });
  });

  it("documents reduce versus exit sizing through the dry-run public API", () => {
    const result = createTradingDryRun({
      mode: "dry-run",
      analysis: analysis([
        recommendation({ symbol: "TRIM", action: "SELL", rating: "SELL", score: 20, close: 100, stopLoss: 92 }),
        recommendation({ symbol: "EXIT", action: "SELL", rating: "SELL", score: 20, close: 90, stopLoss: 92 })
      ]),
      portfolio: portfolio({
        positions: [
          position({ symbol: "TRIM", quantity: 100, currentPrice: 100, allocationPct: 0.1 }),
          position({ symbol: "EXIT", quantity: 100, currentPrice: 90, allocationPct: 0.09 })
        ]
      }),
      config: {
        mode: "dry-run",
        risk: {
          ...riskConfig(),
          reducePositionPct: 0.25
        }
      }
    });

    expect(planFor(result.plans, "TRIM")).toMatchObject({
      intent: "REDUCE_LONG",
      side: "sell",
      quantity: 25,
      notional: 2500,
      status: "planned"
    });
    expect(planFor(result.plans, "EXIT")).toMatchObject({
      intent: "CLOSE_LONG",
      side: "sell",
      quantity: 100,
      notional: 9000,
      status: "planned"
    });
  });
});

function intents(input: {
  recommendations: RecommendationItem[];
  portfolio: PortfolioSnapshot;
  config?: TradingConfigInput;
}) {
  return generateTradeIntents(analysis(input.recommendations), input.portfolio, normalizeTradingConfig({ risk: riskConfig(), ...input.config }));
}

function candidateFor(candidates: ReturnType<typeof generateTradeIntents>, symbol: string) {
  const candidate = candidates.find((item) => item.symbol === symbol);
  expect(candidate).toBeDefined();
  return candidate!;
}

function planFor(plans: TradePlan[], symbol: string) {
  const plan = plans.find((item) => item.symbol === symbol);
  expect(plan).toBeDefined();
  return plan!;
}

function blockCodes(candidate: { blockReasons: Array<{ code: string }> }) {
  return candidate.blockReasons.map((reason) => reason.code);
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
    addMinScore: 72,
    sellScoreThreshold: 45,
    topRelativeStrengthPct: 1,
    maxEntryPricePremiumPct: 0.03,
    reducePositionPct: 0.5
  };
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
      averageScore: recommendations.length === 0 ? 0 : recommendations.reduce((total, item) => total + item.score, 0) / recommendations.length,
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
    signalChange: input.action === "BUY" ? "NEW_BUY" : input.action === "SELL" ? "NEW_SELL" : "NO_CHANGE",
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
    reasons: ["Fixture recommendation for trading intent refinement tests"],
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
    longMarketValue: input.positions.reduce((total, item) => total + Math.max(item.marketValue, 0), 0),
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
      longExposure: input.positions.reduce((total, item) => total + Math.max(item.marketValue, 0), 0),
      shortExposure: input.positions.reduce((total, item) => total + Math.abs(Math.min(item.marketValue, 0)), 0),
      cashAllocationPct: account.portfolioValue > 0 ? account.cash / account.portfolioValue : null,
      largestPositionSymbol: input.positions[0]?.symbol ?? null,
      largestPositionAllocationPct: input.positions[0]?.allocationPct ?? null,
      totalUnrealizedPnl: input.positions.reduce((total, item) => total + item.unrealizedPnl, 0),
      totalUnrealizedPnlPct: null
    },
    notes: []
  };
}
