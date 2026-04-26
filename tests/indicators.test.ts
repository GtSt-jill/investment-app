import { describe, expect, it } from "vitest";

import { annualizedReturn, maxDrawdown, momentum, simpleMovingAverage } from "@/lib/simulator/indicators";

describe("indicators", () => {
  it("computes a simple moving average", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 4, 3)).toBe(4);
  });

  it("computes momentum", () => {
    expect(momentum([100, 110, 121], 2, 2)).toBeCloseTo(0.21, 5);
  });

  it("computes max drawdown", () => {
    expect(maxDrawdown([100, 120, 90, 140, 126])).toBeCloseTo(-0.25, 5);
  });

  it("computes annualized return", () => {
    expect(annualizedReturn(100, 121, 2)).toBeCloseTo(0.1, 5);
  });
});
