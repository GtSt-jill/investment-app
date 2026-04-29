import { describe, expect, it } from "vitest";

import {
  historicalAtrPercentile,
  historicalMomentumPercentile,
  normalizeSymbolSnapshot,
  rollingPercentileRank,
  rollingZScore
} from "@/lib/semiconductors/normalization";
import type { PriceBar } from "@/lib/semiconductors/types";

describe("rollingPercentileRank", () => {
  it("uses the full 0-100 rank range for unique values", () => {
    expect(rollingPercentileRank([1, 2, 3, 4], { window: 4 })).toBe(100);
    expect(rollingPercentileRank([4, 3, 2, 1], { window: 4 })).toBe(0);
  });

  it("uses mid-rank tie handling so flat windows are neutral", () => {
    expect(rollingPercentileRank([5, 5, 5, 5], { window: 4 })).toBe(50);
    expect(rollingPercentileRank([1, 2, 2, 4], { window: 4, minSamples: 3, endIndex: 2 })).toBe(75);
  });

  it("ignores missing samples but requires a finite current value and enough data", () => {
    expect(rollingPercentileRank([1, null, 3, 4], { window: 4, minSamples: 3 })).toBe(100);
    expect(rollingPercentileRank([1, null, 3, 4], { window: 4, minSamples: 4 })).toBeNull();
    expect(rollingPercentileRank([1, 2, null], { window: 3, minSamples: 2 })).toBeNull();
  });
});

describe("rollingZScore", () => {
  it("returns deterministic z-scores for finite rolling windows", () => {
    expect(rollingZScore([1, 2, 3], { window: 3 })).toBeCloseTo(1.224744871, 9);
    expect(rollingZScore([1, 2, 3, 4], { window: 3 })).toBeCloseTo(1.224744871, 9);
  });

  it("returns 0 when variance is zero", () => {
    expect(rollingZScore([7, 7, 7], { window: 3 })).toBe(0);
  });

  it("ignores missing samples and returns null for missing current values", () => {
    expect(rollingZScore([1, null, 3], { window: 3, minSamples: 2 })).toBe(1);
    expect(rollingZScore([1, 2, null], { window: 3, minSamples: 2 })).toBeNull();
    expect(rollingZScore([1, null, 3], { window: 3, minSamples: 3 })).toBeNull();
  });
});

describe("historical symbol normalization", () => {
  it("computes ATR and momentum percentiles from a symbol's own history", () => {
    const bars = makeBars(90);

    expect(historicalAtrPercentile(bars, { atrLength: 3, lookback: 20, minSamples: 10 })).not.toBeNull();
    expect(historicalMomentumPercentile(bars, 5, { lookback: 20, minSamples: 10 })).toBeGreaterThan(50);
  });

  it("returns a null-heavy snapshot when history is insufficient", () => {
    const snapshot = normalizeSymbolSnapshot(makeBars(10), {
      atrLength: 14,
      lookback: 20,
      minSamples: 20,
      zScoreWindow: 20
    });

    expect(snapshot.asOf).toBe("2025-01-10");
    expect(snapshot.close).toBeGreaterThan(0);
    expect(snapshot.closePercentileRank).toBeNull();
    expect(snapshot.closeZScore).toBeNull();
    expect(snapshot.atrPct).toBeNull();
    expect(snapshot.atrPercentile).toBeNull();
    expect(snapshot.momentum20).toBeNull();
    expect(snapshot.momentum20Percentile).toBeNull();
  });

  it("builds a normalized snapshot with close, ATR, and standard momentum fields", () => {
    const snapshot = normalizeSymbolSnapshot(makeBars(180), {
      atrLength: 14,
      lookback: 60,
      minSamples: 30,
      zScoreWindow: 60
    });

    expect(snapshot.asOf).toBe("2025-06-29");
    expect(snapshot.closePercentileRank).toBeGreaterThan(50);
    expect(snapshot.closeZScore).toBeGreaterThan(0);
    expect(snapshot.atrPct).not.toBeNull();
    expect(snapshot.atrPercentile).not.toBeNull();
    expect(snapshot.momentum20).toBeGreaterThan(0);
    expect(snapshot.momentum20Percentile).not.toBeNull();
    expect(snapshot.momentum63).toBeGreaterThan(0);
    expect(snapshot.momentum63Percentile).not.toBeNull();
    expect(snapshot.momentum126).toBeGreaterThan(0);
    expect(snapshot.momentum126Percentile).not.toBeNull();
    expect(snapshot.sampleSizes.close).toBe(60);
  });
});

function makeBars(length: number): PriceBar[] {
  return Array.from({ length }, (_, index) => {
    const close = 100 * Math.exp(index ** 2 * 0.00005);
    const range = 1 + index * 0.015;

    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + range,
      low: close - range,
      close,
      volume: 1_000_000 + index * 1_000
    };
  });
}
