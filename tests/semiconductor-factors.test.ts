import { describe, expect, it } from "vitest";

import {
  buildFactorScore,
  calculateBetaFromReturns,
  calculateCapmExposure,
  calculateCovariance,
  calculateExcessReturns,
  calculateMultiFactorExposure,
  calculateReturns,
  calculateVariance,
  type FactorObservation
} from "@/lib/semiconductors/factors";
import type { PriceBar } from "@/lib/semiconductors/types";

describe("factor return utilities", () => {
  it("calculates close-to-close returns after sorting bars by date", () => {
    const bars = [
      makeBar("2025-01-03", 121),
      makeBar("2025-01-01", 100),
      makeBar("2025-01-02", 110)
    ];

    const returns = calculateReturns(bars);

    expect(returns.map((row) => row.date)).toEqual(["2025-01-02", "2025-01-03"]);
    expect(returns[0].value).toBeCloseTo(0.1, 10);
    expect(returns[1].value).toBeCloseTo(0.1, 10);
  });

  it("calculates excess returns from a scalar or aligned risk-free series", () => {
    const returns = [
      { date: "2025-01-02", value: 0.02 },
      { date: "2025-01-03", value: 0.03 }
    ];

    expect(calculateExcessReturns(returns, 0.005)).toEqual([
      { date: "2025-01-02", value: 0.015 },
      { date: "2025-01-03", value: 0.024999999999999998 }
    ]);
    expect(
      calculateExcessReturns(returns, [
        { date: "2025-01-03", value: 0.01 },
        { date: "2025-01-04", value: 0.01 }
      ])
    ).toEqual([{ date: "2025-01-03", value: 0.019999999999999997 }]);
  });

  it("computes sample covariance, sample variance, and beta from aligned dates", () => {
    const asset = [
      { date: "2025-01-02", value: 0.02 },
      { date: "2025-01-03", value: 0.04 },
      { date: "2025-01-04", value: 0.06 }
    ];
    const market = [
      { date: "2025-01-02", value: 0.01 },
      { date: "2025-01-03", value: 0.02 },
      { date: "2025-01-04", value: 0.03 },
      { date: "2025-01-05", value: 0.99 }
    ];

    expect(calculateVariance([0.01, 0.02, 0.03])).toBeCloseTo(0.0001, 8);
    expect(calculateCovariance([0.02, 0.04, 0.06], [0.01, 0.02, 0.03])).toBeCloseTo(0.0002, 8);
    expect(calculateBetaFromReturns(asset, market)).toBeCloseTo(2, 8);
  });
});

describe("factor exposure models", () => {
  it("calculates CAPM alpha, beta, residual volatility, and date-aligned observation counts", () => {
    const riskFreeRate = 0.001;
    const alpha = 0.002;
    const beta = 1.4;
    const marketExcessReturns = [0.01, -0.005, 0.02, 0.0, -0.01, 0.015, 0.007, -0.003];
    const marketBars = barsFromReturns("2025-01-01", marketExcessReturns.map((value) => value + riskFreeRate));
    const assetBars = barsFromReturns(
      "2025-01-01",
      marketExcessReturns.map((value) => riskFreeRate + alpha + beta * value)
    );

    const exposure = calculateCapmExposure(assetBars, marketBars, { riskFreeRate, minObservations: 4 });

    expect(exposure.observations).toBe(marketExcessReturns.length);
    expect(exposure.startDate).toBe("2025-01-02");
    expect(exposure.endDate).toBe("2025-01-09");
    expect(exposure.alpha).toBeCloseTo(alpha, 10);
    expect(exposure.annualizedAlpha).toBeCloseTo(alpha * 252, 10);
    expect(exposure.beta).toBeCloseTo(beta, 10);
    expect(exposure.rSquared).toBeCloseTo(1, 10);
    expect(exposure.residualVolatility).toBeCloseTo(0, 10);
    expect(exposure.factorScore).toBeGreaterThan(50);
  });

  it("uses intersection by return date instead of positional alignment", () => {
    const riskFreeRate = 0.001;
    const marketExcessReturns = [0.01, -0.005, 0.02, 0.0, -0.01, 0.015];
    const marketBars = barsFromReturns("2025-01-01", marketExcessReturns.map((value) => value + riskFreeRate));
    const assetBars = [
      makeBar("2024-12-31", 40),
      ...barsFromReturns(
        "2025-01-01",
        marketExcessReturns.map((value) => riskFreeRate + 0.001 + 2 * value),
        45
      )
    ];

    const exposure = calculateCapmExposure(assetBars, marketBars, { riskFreeRate });

    expect(exposure.observations).toBe(marketExcessReturns.length);
    expect(exposure.beta).toBeCloseTo(2, 10);
  });

  it("calculates deterministic multi-factor exposures from aligned factor return series", () => {
    const riskFreeRate = 0.001;
    const factors = {
      momentum: factorSeries("2025-01-02", [0.01, -0.02, 0.03, 0.0, 0.015, -0.005, 0.02, -0.01]),
      quality: factorSeries("2025-01-02", [-0.005, 0.01, 0.015, -0.01, 0.0, 0.02, -0.015, 0.005])
    };
    const assetReturns = factors.momentum.map((row, index) => riskFreeRate + 0.0015 + 1.2 * row.value - 0.7 * factors.quality[index].value);
    const assetBars = barsFromReturns("2025-01-01", assetReturns);

    const exposure = calculateMultiFactorExposure(assetBars, factors, { riskFreeRate });

    expect(exposure.model).toBe("MULTI_FACTOR");
    expect(exposure.observations).toBe(assetReturns.length);
    expect(exposure.alpha).toBeCloseTo(0.0015, 10);
    expect(exposure.exposures.momentum).toBeCloseTo(1.2, 10);
    expect(exposure.exposures.quality).toBeCloseTo(-0.7, 10);
    expect(exposure.rSquared).toBeCloseTo(1, 10);
    expect(exposure.factorMeans.momentum).toBeCloseTo(0.005, 10);
  });

  it("builds a higher score for positive alpha and lower residual risk", () => {
    const strongScore = buildFactorScore({
      annualizedAlpha: 0.18,
      beta: 1.05,
      rSquared: 0.82,
      annualizedResidualVolatility: 0.12
    });
    const weakScore = buildFactorScore({
      annualizedAlpha: -0.12,
      beta: 1.8,
      rSquared: 0.15,
      annualizedResidualVolatility: 0.55
    });

    expect(strongScore).toBeGreaterThan(weakScore);
    expect(strongScore).toBeLessThanOrEqual(100);
    expect(weakScore).toBeGreaterThanOrEqual(0);
  });
});

function makeBar(date: string, close: number): PriceBar {
  return {
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000
  };
}

function barsFromReturns(startDate: string, returns: number[], startClose = 100): PriceBar[] {
  const bars = [makeBar(startDate, startClose)];
  let close = startClose;

  for (let index = 0; index < returns.length; index += 1) {
    close *= 1 + returns[index];
    bars.push(makeBar(addDays(startDate, index + 1), close));
  }

  return bars;
}

function factorSeries(startDate: string, values: number[]): FactorObservation[] {
  return values.map((value, index) => ({
    date: addDays(startDate, index),
    value
  }));
}

function addDays(startDate: string, days: number) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
