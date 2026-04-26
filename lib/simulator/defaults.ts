import { type StrategyInput } from "@/lib/simulator/types";

export const DEFAULT_SIMULATION_INPUT: StrategyInput = {
  initialCapital: 100_000,
  years: 5,
  riskOnMaDays: 200,
  momentumDays: 90,
  topAssets: 2,
  stopLossPct: 0.08,
  trailingStopPct: 0.1,
  feePerTrade: 1,
  maxAssetWeight: 0.5
};

const numericFields = Object.keys(DEFAULT_SIMULATION_INPUT) as Array<keyof StrategyInput>;

export function coerceSimulationInput(payload: Partial<Record<string, unknown>>): StrategyInput {
  const merged: StrategyInput = { ...DEFAULT_SIMULATION_INPUT };

  for (const field of numericFields) {
    const raw = payload[field];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      merged[field] = raw;
    }
  }

  return {
    initialCapital: clamp(merged.initialCapital, 1_000, 10_000_000),
    years: clamp(Math.round(merged.years), 1, 6),
    riskOnMaDays: clamp(Math.round(merged.riskOnMaDays), 50, 250),
    momentumDays: clamp(Math.round(merged.momentumDays), 20, 180),
    topAssets: clamp(Math.round(merged.topAssets), 1, 2),
    stopLossPct: clamp(merged.stopLossPct, 0.02, 0.2),
    trailingStopPct: clamp(merged.trailingStopPct, 0.03, 0.25),
    feePerTrade: clamp(merged.feePerTrade, 0, 25),
    maxAssetWeight: clamp(merged.maxAssetWeight, 0.25, 1)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
