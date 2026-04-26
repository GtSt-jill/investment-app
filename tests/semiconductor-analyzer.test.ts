import { describe, expect, it } from "vitest";

import {
  MINIMUM_BARS,
  analyzeSemiconductors,
  calculateMarketRegime,
  calculateSignalChange,
  defensiveStopLoss
} from "@/lib/semiconductors/analyzer";
import type { PriceBar, SignalAction, SymbolProfile } from "@/lib/semiconductors/types";

const universe: SymbolProfile[] = [
  { symbol: "LEADER", name: "Leader Semiconductor", segment: "Test" },
  { symbol: "MID", name: "Middle Semiconductor", segment: "Test" },
  { symbol: "LAGGARD", name: "Laggard Semiconductor", segment: "Test" }
];

describe("analyzeSemiconductors", () => {
  it("excludes symbols without enough data instead of applying a false 200-day penalty", () => {
    const result = analyzeSemiconductors(
      {
        LEADER: makeBars(100, 0.5, { length: 220 }),
        MID: makeBars(100, 0.1, { length: MINIMUM_BARS }),
        LAGGARD: makeBars(150, -0.35, { length: MINIMUM_BARS })
      },
      universe
    );

    expect(result.recommendations.map((row) => row.symbol)).not.toContain("LEADER");
    expect(result.summary.excludedSymbols).toContain("LEADER");
  });

  it("returns scoreBreakdown and clamps final scores to 0-100", () => {
    const result = analyzeSemiconductors(makeUniverseBars(), universe);

    for (const row of result.recommendations) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      expect(row.scoreBreakdown).toEqual({
        trendScore: expect.any(Number),
        momentumScore: expect.any(Number),
        relativeStrengthScore: expect.any(Number),
        riskScore: expect.any(Number),
        volumeScore: expect.any(Number)
      });
    }
  });

  it("changes relativeStrengthScore according to 63-day momentum rank", () => {
    const result = analyzeSemiconductors(makeUniverseBars(), universe);
    const leader = find(result, "LEADER");
    const laggard = find(result, "LAGGARD");

    expect(leader.scoreBreakdown.relativeStrengthScore).toBeGreaterThan(laggard.scoreBreakdown.relativeStrengthScore);
    expect(leader.relativeStrengthRank).toBeLessThan(laggard.relativeStrengthRank);
  });

  it("produces BUY / HOLD / SELL actions from category scores", () => {
    const result = analyzeSemiconductors(
      {
        LEADER: makeBars(80, 0.72, { volumeMode: "rising" }),
        MID: makeBars(100, 0),
        LAGGARD: makeBars(180, -0.52, { volumeMode: "falling" })
      },
      universe
    );

    expect(find(result, "LEADER").action).toBe("BUY");
    expect(find(result, "MID").action).toBe("HOLD");
    expect(find(result, "LAGGARD").action).toBe("SELL");
  });

  it("keeps signalChange ready for persisted previous actions", () => {
    const previousActions: Record<string, SignalAction> = {
      LEADER: "HOLD",
      MID: "HOLD",
      LAGGARD: "SELL"
    };
    const result = analyzeSemiconductors(makeUniverseBars(), universe, { previousActions });

    expect(find(result, "LEADER").signalChange).toBe("HOLD_TO_BUY");
    expect(find(result, "LAGGARD").signalChange).toBe("SELL_CONTINUATION");
  });
});

describe("risk helpers", () => {
  it("uses a defensive stopLoss line with max(current - ATR * 2.2, sma50 * 0.96)", () => {
    expect(defensiveStopLoss(100, 4, 98)).toBeCloseTo(Math.max(100 - 4 * 2.2, 98 * 0.96), 5);
  });

  it("uses ATR fallback when ATR is unavailable", () => {
    expect(defensiveStopLoss(100, null, null)).toBeCloseTo(100 - 4 * 2.2, 5);
  });
});

describe("calculateSignalChange", () => {
  it("maps previous and current actions", () => {
    expect(calculateSignalChange(undefined, "BUY")).toBe("NEW_BUY");
    expect(calculateSignalChange("BUY", "BUY")).toBe("BUY_CONTINUATION");
    expect(calculateSignalChange("BUY", "HOLD")).toBe("BUY_TO_HOLD");
    expect(calculateSignalChange("HOLD", "BUY")).toBe("HOLD_TO_BUY");
    expect(calculateSignalChange(undefined, "SELL")).toBe("NEW_SELL");
    expect(calculateSignalChange("SELL", "SELL")).toBe("SELL_CONTINUATION");
    expect(calculateSignalChange("SELL", "HOLD")).toBe("SELL_TO_HOLD");
    expect(calculateSignalChange("HOLD", "HOLD")).toBe("NO_CHANGE");
  });
});

describe("calculateMarketRegime", () => {
  it("detects bullish and defensive market regimes", () => {
    expect(
      calculateMarketRegime({
        semiconductor: makeBars(100, 0.4),
        qqq: makeBars(120, 0.3)
      })
    ).toBe("bullish");

    expect(
      calculateMarketRegime({
        semiconductor: makeBars(180, -0.35),
        qqq: makeBars(200, -0.5)
      })
    ).toBe("defensive");
  });
});

function makeUniverseBars() {
  return {
    LEADER: makeBars(80, 0.72, { volumeMode: "rising" }),
    MID: makeBars(100, 0.07),
    LAGGARD: makeBars(180, -0.52, { volumeMode: "falling" })
  };
}

function find(result: ReturnType<typeof analyzeSemiconductors>, symbol: string) {
  const row = result.recommendations.find((item) => item.symbol === symbol);
  expect(row).toBeDefined();
  return row!;
}

function makeBars(
  startPrice: number,
  slope: number,
  options: { length?: number; volumeMode?: "normal" | "rising" | "falling" } = {}
): PriceBar[] {
  const length = options.length ?? 320;
  const volumeMode = options.volumeMode ?? "normal";

  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    const wave = Math.sin(index / 8) * 1.2;
    const close = Math.max(5, startPrice + index * slope + wave);
    const open = close * (1 + Math.sin(index / 5) * 0.003);
    const high = Math.max(open, close) * 1.012;
    const low = Math.min(open, close) * 0.988;
    const volume =
      volumeMode === "rising"
        ? 1_000_000 + index * 7_000
        : volumeMode === "falling"
          ? 2_600_000 - index * 4_000
          : 1_600_000 + Math.sin(index / 6) * 60_000;

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
