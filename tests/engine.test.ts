import { describe, expect, it } from "vitest";

import { simulateAlignedStrategy } from "@/lib/simulator/engine";
import type { AlignedMarketData, StrategyInput } from "@/lib/simulator/types";

const dates = [
  "2025-01-01",
  "2025-01-02",
  "2025-01-03",
  "2025-01-04",
  "2025-01-05",
  "2025-01-06",
  "2025-01-07",
  "2025-01-08"
];

const marketData: AlignedMarketData = {
  dates,
  pricesBySymbol: {
    SPY: [100, 102, 104, 106, 108, 95, 94, 93],
    QQQ: [100, 103, 106, 109, 112, 113, 114, 115],
    VTI: [100, 101, 102, 103, 104, 100, 99, 98],
    IEF: [100, 100, 100, 100, 101, 102, 103, 104],
    GLD: [100, 100, 101, 101, 102, 103, 103, 104],
    SHY: [100, 100, 100, 100, 100.2, 100.4, 100.6, 100.8]
  }
};

const input: StrategyInput = {
  initialCapital: 100_000,
  years: 1,
  riskOnMaDays: 3,
  momentumDays: 2,
  topAssets: 1,
  stopLossPct: 0.08,
  trailingStopPct: 0.1,
  feePerTrade: 0,
  maxAssetWeight: 1
};

describe("simulateAlignedStrategy", () => {
  it("executes trades on the session after the signal", () => {
    const result = simulateAlignedStrategy(marketData, input);

    expect(result.trades[0]?.date).toBe("2025-01-05");
    expect(result.trades[0]?.symbol).toBe("QQQ");
  });

  it("switches to a defensive recommendation after the regime breaks down", () => {
    const result = simulateAlignedStrategy(marketData, input);

    expect(result.recommendation.regime).toBe("risk-off");
    expect(["IEF", "GLD", "SHY"]).toContain(result.recommendation.targets[0]);
  });

  it("returns an equity curve covering the requested period", () => {
    const result = simulateAlignedStrategy(marketData, input);

    expect(result.equityCurve).toHaveLength(dates.length - input.riskOnMaDays);
    expect(result.summary.finalValue).toBeGreaterThan(0);
  });
});
