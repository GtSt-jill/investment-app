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
});

function findAction(result: ReturnType<typeof runSignalBacktest>["byAction"], action: "BUY" | "HOLD" | "SELL") {
  const group = result.find((item) => item.action === action);
  expect(group).toBeDefined();
  return group!;
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
