import { describe, expect, it } from "vitest";

import { analyzeSemiconductors } from "@/lib/semiconductors/analyzer";
import type { PriceBar, SymbolProfile } from "@/lib/semiconductors/types";

const universe: SymbolProfile[] = [
  { symbol: "GOOD", name: "Good Semiconductor", segment: "Test" },
  { symbol: "BAD", name: "Bad Semiconductor", segment: "Test" }
];

describe("analyzeSemiconductors", () => {
  it("ranks strong trend and momentum as a buy candidate", () => {
    const result = analyzeSemiconductors(
      {
        GOOD: makeBars("GOOD", 100, 0.72),
        BAD: makeBars("BAD", 150, -0.42)
      },
      universe
    );

    expect(result.recommendations[0]?.symbol).toBe("GOOD");
    expect(result.recommendations[0]?.action).toBe("BUY");
    expect(result.buyCandidates.map((row) => row.symbol)).toContain("GOOD");
  });

  it("marks weak trend and momentum as sell or avoidance", () => {
    const result = analyzeSemiconductors(
      {
        GOOD: makeBars("GOOD", 100, 0.72),
        BAD: makeBars("BAD", 150, -0.42)
      },
      universe
    );

    const bad = result.recommendations.find((row) => row.symbol === "BAD");
    expect(bad?.action).toBe("SELL");
    expect(bad?.risks.length).toBeGreaterThan(0);
  });
});

function makeBars(symbol: string, startPrice: number, slope: number): PriceBar[] {
  return Array.from({ length: 240 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    const wave = Math.sin(index / 7) * 1.4;
    const close = Math.max(5, startPrice + index * slope + wave);
    const open = close * (1 + Math.sin(index / 5) * 0.003);
    const high = Math.max(open, close) * 1.012;
    const low = Math.min(open, close) * 0.988;

    return {
      date,
      open,
      high,
      low,
      close,
      volume: symbol === "GOOD" ? 2_000_000 + index * 2_000 : 1_600_000 - index * 1_000
    };
  });
}
