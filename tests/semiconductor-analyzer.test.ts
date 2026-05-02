import { describe, expect, it } from "vitest";

import {
  MINIMUM_BARS,
  applyEarningsRiskFilter,
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

  it("excludes stale symbol bars from same-run rankings", () => {
    const result = analyzeSemiconductors(
      {
        LEADER: makeBars(80, 0.72, { volumeMode: "rising" }),
        MID: makeBars(100, 0.07).slice(0, -3),
        LAGGARD: makeBars(180, -0.52, { volumeMode: "falling" })
      },
      universe
    );

    expect(result.recommendations.map((row) => row.symbol)).not.toContain("MID");
    expect(result.summary.excludedSymbols).toContain("MID");
    expect(result.recommendations.every((row) => row.asOf === result.asOf)).toBe(true);
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

  it("changes relativeStrengthScore according to composite 20/63/126-day momentum rank", () => {
    const result = analyzeSemiconductors(makeUniverseBars(), universe);
    const leader = find(result, "LEADER");
    const laggard = find(result, "LAGGARD");

    expect(leader.scoreBreakdown.relativeStrengthScore).toBeGreaterThan(laggard.scoreBreakdown.relativeStrengthScore);
    expect(leader.relativeStrengthRank).toBeLessThan(laggard.relativeStrengthRank);
  });

  it("does not let a single 63-day momentum spike dominate relative strength", () => {
    const result = analyzeSemiconductors(
      {
        LEADER: makeMomentumProfileBars({ momentum20: 0.08, momentum63: 0.18, momentum126: 0.28 }),
        MID: makeMomentumProfileBars({ momentum20: 0.02, momentum63: 0.3, momentum126: 0.02 }),
        LAGGARD: makeMomentumProfileBars({ momentum20: -0.04, momentum63: -0.08, momentum126: -0.12 })
      },
      universe
    );
    const leader = find(result, "LEADER");
    const singleHorizonSpike = find(result, "MID");

    expect(singleHorizonSpike.indicators.momentum63).toBeGreaterThan(leader.indicators.momentum63 ?? -Infinity);
    expect(leader.scoreBreakdown.relativeStrengthScore).toBeGreaterThan(
      singleHorizonSpike.scoreBreakdown.relativeStrengthScore
    );
    expect(leader.relativeStrengthRank).toBeLessThan(singleHorizonSpike.relativeStrengthRank);
  });

  it("records raw and risk-adjusted relative strength scores separately", () => {
    const result = analyzeSemiconductors(
      {
        LEADER: makeMomentumProfileBars({ momentum20: 0.08, momentum63: 0.18, momentum126: 0.28 }),
        MID: makeMomentumProfileBars({ momentum20: 0.02, momentum63: 0.3, momentum126: 0.02 }),
        LAGGARD: makeMomentumProfileBars({ momentum20: -0.04, momentum63: -0.08, momentum126: -0.12 })
      },
      universe
    );
    const leader = find(result, "LEADER");

    expect(leader.relativeStrengthRawScore).toEqual(expect.any(Number));
    expect(leader.relativeStrengthRiskAdjustedScore).toEqual(expect.any(Number));
    expect(leader.relativeStrengthRiskAdjustedScore).toBeLessThanOrEqual(leader.relativeStrengthRawScore ?? 100);
  });

  it("adds signal-stability adjustments when previous score context is provided", () => {
    const withoutHistory = analyzeSemiconductors(
      {
        LEADER: makeBars(80, 0.72, { volumeMode: "rising" })
      },
      [universe[0]]
    );
    const currentScore = find(withoutHistory, "LEADER").score;
    const withHistory = analyzeSemiconductors(
      {
        LEADER: makeBars(80, 0.72, { volumeMode: "rising" })
      },
      [universe[0]],
      {
        previousActions: { LEADER: "BUY" },
        previousScores: { LEADER: currentScore + 20 }
      }
    );

    expect(find(withHistory, "LEADER").scoreAdjustments).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "signal-stability" })])
    );
    expect(find(withHistory, "LEADER").scoreChange).toEqual(expect.any(Number));
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

  it("requires stronger scores for BUY actions when the market regime is neutral or defensive", () => {
    const baseResult = analyzeSemiconductors(makeUniverseBars(), universe, {
      marketBars: {
        semiconductor: makeBars(100, 0.4),
        qqq: makeBars(120, 0.3)
      }
    });
    const neutralResult = analyzeSemiconductors(makeUniverseBars(), universe, {
      marketBars: {
        semiconductor: makeBars(160, -0.25),
        qqq: makeBars(120, 0.3)
      }
    });
    const defensiveResult = analyzeSemiconductors(makeUniverseBars(), universe, {
      marketBars: {
        semiconductor: makeBars(160, -0.25),
        qqq: makeBars(200, -0.5)
      }
    });

    expect(baseResult.summary.marketRegime).toBe("bullish");
    expect(find(baseResult, "LEADER").action).toBe("BUY");

    expect(neutralResult.summary.marketRegime).toBe("neutral");
    expect(find(neutralResult, "LEADER").scoreAdjustments).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "market-regime", label: "Neutral market regime" })])
    );
    expect(find(neutralResult, "LEADER").score).toBeLessThan(find(baseResult, "LEADER").score);

    expect(defensiveResult.summary.marketRegime).toBe("defensive");
    expect(find(defensiveResult, "LEADER").scoreAdjustments).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "market-regime", label: "Defensive market regime" })])
    );
    expect(find(defensiveResult, "LEADER").action).not.toBe("BUY");
  });
});

describe("risk helpers", () => {
  it("uses a defensive stopLoss line with max(current - ATR * 2.2, sma50 * 0.96)", () => {
    expect(defensiveStopLoss(100, 4, 98)).toBeCloseTo(Math.max(100 - 4 * 2.2, 98 * 0.96), 5);
  });

  it("uses ATR fallback when ATR is unavailable", () => {
    expect(defensiveStopLoss(100, null, null)).toBeCloseTo(100 - 4 * 2.2, 5);
  });

  it("keeps the defensive stop below the current price when the 50-day line is stale above price", () => {
    expect(defensiveStopLoss(100, 4, 140)).toBeCloseTo(100 - 4 * 2.2, 5);
  });
});

describe("applyEarningsRiskFilter", () => {
  it("downgrades near-term BUY signals and records the earnings adjustment visibly", () => {
    const row = find(
      analyzeSemiconductors(
        {
          LEADER: makeBars(80, 0.72, { volumeMode: "rising" })
        },
        [universe[0]]
      ),
      "LEADER"
    );

    const filtered = applyEarningsRiskFilter(row, "2025-11-20", row.asOf);

    expect(filtered.action).toBe("HOLD");
    expect(filtered.rating).toBe("WATCH");
    expect(filtered.score).toBeLessThan(65);
    expect(filtered.scoreAdjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "earnings",
          label: "Upcoming earnings blackout"
        })
      ])
    );
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

  it("stays neutral when only one market proxy loses its 50-day trend", () => {
    expect(
      calculateMarketRegime({
        semiconductor: makeBars(180, -0.25),
        qqq: makeBars(120, 0.3)
      })
    ).toBe("neutral");
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

function makeMomentumProfileBars(profile: { momentum20: number; momentum63: number; momentum126: number }): PriceBar[] {
  const length = 320;
  const latestClose = 100;
  const closes = interpolateAnchors(
    length,
    new Map([
      [0, latestClose / (1 + profile.momentum126) * 0.94],
      [length - 1 - 126, latestClose / (1 + profile.momentum126)],
      [length - 1 - 63, latestClose / (1 + profile.momentum63)],
      [length - 1 - 20, latestClose / (1 + profile.momentum20)],
      [length - 1, latestClose]
    ])
  );

  return closes.map((close, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);

    return {
      date,
      open: close * 0.997,
      high: close * 1.012,
      low: close * 0.988,
      close,
      volume: 1_500_000 + index * 500
    };
  });
}

function interpolateAnchors(length: number, anchors: Map<number, number>) {
  const closes = Array.from({ length }, () => 0);
  const anchorPoints = [...anchors.entries()].sort(([left], [right]) => left - right);

  for (let index = 0; index < anchorPoints.length - 1; index += 1) {
    const [startIndex, startClose] = anchorPoints[index];
    const [endIndex, endClose] = anchorPoints[index + 1];
    const span = endIndex - startIndex;

    for (let cursor = startIndex; cursor <= endIndex; cursor += 1) {
      const progress = span === 0 ? 0 : (cursor - startIndex) / span;
      closes[cursor] = startClose + (endClose - startClose) * progress;
    }
  }

  return closes;
}
