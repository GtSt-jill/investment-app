import { fetchDailyBars } from "@/lib/semiconductors/alpaca";
import { fetchJQuantsDailyBars, hasJQuantsCredentials } from "@/lib/semiconductors/jquants";
import type { PriceBar, SymbolProfile } from "@/lib/semiconductors/types";

export interface MarketDailyBarsResult {
  barsBySymbol: Record<string, PriceBar[]>;
  notes: string[];
}

export async function fetchMarketDailyBars(
  symbols: string[],
  universe: SymbolProfile[],
  lookbackDays: number,
  marketContextSymbols: readonly string[]
): Promise<MarketDailyBarsResult> {
  const selected = new Set(symbols);
  const profiles = universe.filter((profile) => selected.has(profile.symbol));
  const alpacaSymbols = Array.from(
    new Set([...profiles.filter((profile) => (profile.dataProvider ?? "alpaca") === "alpaca").map((profile) => profile.symbol), ...marketContextSymbols])
  );
  const jquantsSymbols = Array.from(
    new Set(profiles.filter((profile) => profile.dataProvider === "jquants").map((profile) => profile.symbol))
  );
  const notes: string[] = [];
  const barsBySymbol: Record<string, PriceBar[]> = Object.fromEntries([...symbols, ...marketContextSymbols].map((symbol) => [symbol, []]));

  const [alpacaBars, jquantsBars] = await Promise.all([
    alpacaSymbols.length > 0 ? fetchDailyBars(alpacaSymbols, lookbackDays) : Promise.resolve({}),
    fetchJQuantsBarsIfConfigured(jquantsSymbols, lookbackDays, notes)
  ]);

  return {
    barsBySymbol: {
      ...barsBySymbol,
      ...alpacaBars,
      ...jquantsBars
    },
    notes
  };
}

async function fetchJQuantsBarsIfConfigured(symbols: string[], lookbackDays: number, notes: string[]) {
  if (symbols.length === 0) {
    return {};
  }

  if (!hasJQuantsCredentials()) {
    notes.push("J-Quants credentials are not configured, so Japanese TSE symbols were excluded from this analysis.");
    return Object.fromEntries(symbols.map((symbol) => [symbol, [] as PriceBar[]]));
  }

  return fetchJQuantsDailyBars(symbols, lookbackDays);
}
