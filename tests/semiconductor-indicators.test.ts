import { describe, expect, it } from "vitest";

import { averageTrueRange, averageTrueRangePct, momentum, simpleMovingAverage } from "@/lib/semiconductors/indicators";
import type { PriceBar } from "@/lib/semiconductors/types";

describe("semiconductor indicators", () => {
  it("returns null when SMA does not have enough data", () => {
    expect(simpleMovingAverage([1, 2, 3], 20)).toBeNull();
    expect(simpleMovingAverage(Array.from({ length: 49 }, (_, index) => index + 1), 50)).toBeNull();
    expect(simpleMovingAverage(Array.from({ length: 199 }, (_, index) => index + 1), 200)).toBeNull();
  });

  it("computes SMA when enough data exists", () => {
    const values = Array.from({ length: 200 }, (_, index) => index + 1);

    expect(simpleMovingAverage(values, 20)).toBe(190.5);
    expect(simpleMovingAverage(values, 50)).toBe(175.5);
    expect(simpleMovingAverage(values, 200)).toBe(100.5);
  });

  it("computes ATR ratio", () => {
    const bars = makeAtrBars();

    expect(averageTrueRange(bars, 14)).toBeCloseTo(4, 5);
    expect(averageTrueRangePct(bars, 14)).toBeCloseTo(4 / bars[bars.length - 1].close, 5);
  });

  it("computes momentum", () => {
    expect(momentum([100, 105, 110, 121], 3)).toBeCloseTo(0.21, 5);
  });
});

function makeAtrBars(): PriceBar[] {
  return Array.from({ length: 16 }, (_, index) => {
    const close = 100 + index;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000
    };
  });
}
