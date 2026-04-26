import { loadMarketData } from "@/lib/market-data";
import { coerceSimulationInput } from "@/lib/simulator/defaults";
import type { StrategyInput } from "@/lib/simulator/types";
import { simulateAlignedStrategy } from "@/lib/simulator/engine";

export async function simulateStrategy(payload: Partial<StrategyInput>) {
  const input = coerceSimulationInput(payload as Partial<Record<string, unknown>>);
  const marketData = await loadMarketData();

  return simulateAlignedStrategy(marketData, input);
}
