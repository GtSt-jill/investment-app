import { describe, expect, it } from "vitest";

import { MINIMUM_BARS } from "@/lib/semiconductors/analyzer";
import { runSignalBacktest } from "@/lib/semiconductors/backtest";
import type { PriceBar, SymbolProfile } from "@/lib/semiconductors/types";

const universe: SymbolProfile[] = [
  { symbol: "BUYER", name: "Buyer Semiconductor", segment: "Test" },
  { symbol: "SELLER", name: "Seller Semiconductor", segment: "Test" }
];

describe("runSignalBacktest", () => {
  it("shows BUY action buckets earning higher forward returns than SELL action buckets", () => {
    const result = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      { horizons: [20, 63] }
    );

    const buy = findAction(result.byAction, "BUY");
    const sell = findAction(result.byAction, "SELL");

    expect(buy.count).toBeGreaterThan(0);
    expect(sell.count).toBeGreaterThan(0);
    expect(buy.horizons[20].count).toBeGreaterThan(0);
    expect(sell.horizons[20].count).toBeGreaterThan(0);
    expect(buy.horizons[20].averageReturn).toBeGreaterThan(0);
    expect(sell.horizons[20].averageReturn).toBeLessThan(0);
    expect(buy.horizons[20].averageReturn).toBeGreaterThan(sell.horizons[20].averageReturn);
    expect(buy.horizons[20].winRate).toBeGreaterThan(sell.horizons[20].winRate);
    expect(result.groups.some((group) => group.action === "BUY" && group.scoreBucket)).toBe(true);
  });

  it("skips horizon outcomes when there is not enough future data", () => {
    const result = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: MINIMUM_BARS + 20, volumeMode: "rising" })
      },
      [universe[0]],
      { horizons: [20, 63] }
    );

    const horizon20Count = result.byAction.reduce((total, group) => total + group.horizons[20].count, 0);
    const horizon63Count = result.byAction.reduce((total, group) => total + group.horizons[63].count, 0);

    expect(horizon20Count).toBeGreaterThan(0);
    expect(horizon63Count).toBe(0);
    expect(result.summary.skippedByHorizon[63]).toBeGreaterThan(0);
    expect(result.summary.totalOutcomes).toBe(horizon20Count);
  });

  it("adds robust return distribution and adverse excursion metrics", () => {
    const result = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      { horizons: [20] }
    );

    const buy = findAction(result.byAction, "BUY");
    const metrics = buy.horizons[20];
    const outcomes = result.events
      .filter((event) => event.action === "BUY")
      .map((event) => event.outcomes.find((outcome) => outcome.horizon === 20))
      .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== undefined);
    const returns = outcomes.map((outcome) => outcome.forwardReturn);
    const maxDrawdowns = outcomes.map((outcome) => outcome.maxDrawdown);
    const adverseExcursions = outcomes.map((outcome) => outcome.maxAdverseExcursion);

    expect(outcomes.length).toBe(metrics.count);
    expect(metrics.losses).toBe(returns.filter((value) => value < 0).length);
    expect(metrics.lossRate).toBe(metrics.losses / metrics.count);
    expect(metrics.medianReturn).toBeCloseTo(percentile(returns, 0.5));
    expect(metrics.averageWin).toBeCloseTo(average(returns.filter((value) => value > 0)));
    expect(metrics.averageLoss).toBe(0);
    expect(metrics.grossProfit).toBeCloseTo(sum(returns.filter((value) => value > 0)));
    expect(metrics.grossLoss).toBe(0);
    expect(metrics.profitFactor).toBe(Number.POSITIVE_INFINITY);
    expect(metrics.payoffRatio).toBeNull();
    expect(metrics.returnPercentiles.p10).toBeCloseTo(percentile(returns, 0.1));
    expect(metrics.returnPercentiles.p25).toBeCloseTo(percentile(returns, 0.25));
    expect(metrics.returnPercentiles.p50).toBe(metrics.medianReturn);
    expect(metrics.returnPercentiles.p75).toBeCloseTo(percentile(returns, 0.75));
    expect(metrics.returnPercentiles.p90).toBeCloseTo(percentile(returns, 0.9));
    expect(metrics.medianMaxDrawdown).toBeCloseTo(percentile(maxDrawdowns, 0.5));
    expect(metrics.medianAdverseExcursion).toBeCloseTo(percentile(adverseExcursions, 0.5));
    expect(metrics.worstAdverseExcursion).toBe(Math.min(...adverseExcursions));
    expect(metrics.averageAdverseCapture).toBeNull();
  });

  it("uses next open execution by default and subtracts round-trip trading friction", () => {
    const noCost = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      { horizons: [20], transactionCostBps: 0, slippageBps: 0 }
    );
    const withCost = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      { horizons: [20], transactionCostBps: 5, slippageBps: 10 }
    );

    const noCostOutcome = noCost.events[0].outcomes[0];
    const withCostOutcome = withCost.events[0].outcomes[0];

    expect(noCost.summary.executionPrice).toBe("nextOpen");
    expect(noCostOutcome.entryDate > noCost.events[0].asOf).toBe(true);
    expect(withCostOutcome.totalCostBps).toBe(30);
    expect(withCostOutcome.forwardReturn).toBeCloseTo(withCostOutcome.grossForwardReturn - 0.003);
    expect(withCostOutcome.forwardReturn).toBeCloseTo(noCostOutcome.forwardReturn - 0.003);
  });

  it("groups backtest results by market regime", () => {
    const result = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      {
        horizons: [20],
        marketBars: {
          semiconductor: makeBars(100, 0.4, { length: 340 }),
          qqq: makeBars(120, 0.3, { length: 340 })
        }
      }
    );

    expect(result.byMarketRegime.some((group) => group.group === "bullish")).toBe(true);
    expect(result.events.every((event) => event.marketRegime === "bullish")).toBe(true);
  });

  it("calculates loss-side metrics and adverse capture for losing buckets", () => {
    const result = runSignalBacktest(
      {
        BUYER: makeBars(70, 0.64, { length: 340, volumeMode: "rising" }),
        SELLER: makeBars(190, -0.5, { length: 340, volumeMode: "falling" })
      },
      universe,
      { horizons: [20] }
    );

    const sell = findAction(result.byAction, "SELL");
    const metrics = sell.horizons[20];
    const outcomes = result.events
      .filter((event) => event.action === "SELL")
      .map((event) => event.outcomes.find((outcome) => outcome.horizon === 20))
      .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== undefined);
    const returns = outcomes.map((outcome) => outcome.forwardReturn);
    const losses = returns.filter((value) => value < 0);
    const adverseCaptures = outcomes
      .filter((outcome) => outcome.forwardReturn < 0 && outcome.maxAdverseExcursion < 0)
      .map((outcome) => Math.abs(outcome.forwardReturn) / Math.abs(outcome.maxAdverseExcursion));

    expect(metrics.losses).toBe(losses.length);
    expect(metrics.averageWin).toBe(0);
    expect(metrics.averageLoss).toBeCloseTo(average(losses));
    expect(metrics.grossProfit).toBe(0);
    expect(metrics.grossLoss).toBeCloseTo(Math.abs(sum(losses)));
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.payoffRatio).toBeNull();
    expect(metrics.averageDownsideReturn).toBeCloseTo(sum(losses) / metrics.count);
    expect(metrics.downsideDeviation).toBeCloseTo(
      Math.sqrt(sum(returns.map((value) => Math.min(value, 0) ** 2)) / metrics.count)
    );
    expect(metrics.averageAdverseCapture).toBeCloseTo(average(adverseCaptures));
  });
});

function findAction(result: ReturnType<typeof runSignalBacktest>["byAction"], action: "BUY" | "HOLD" | "SELL") {
  const group = result.find((item) => item.action === action);
  expect(group).toBeDefined();
  return group!;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function makeBars(
  startPrice: number,
  slope: number,
  options: { length: number; volumeMode?: "normal" | "rising" | "falling" }
): PriceBar[] {
  const volumeMode = options.volumeMode ?? "normal";

  return Array.from({ length: options.length }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    const wave = Math.sin(index / 7) * 0.8;
    const close = Math.max(5, startPrice + index * slope + wave);
    const open = close * (1 + Math.sin(index / 5) * 0.002);
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.99;
    const volume =
      volumeMode === "rising"
        ? 1_000_000 + index * 8_000
        : volumeMode === "falling"
          ? 2_800_000 - index * 5_000
          : 1_600_000 + Math.sin(index / 6) * 40_000;

    return {
      date,
      open,
      high,
      low,
      close,
      volume: Math.max(250_000, volume)
    };
  });
}
