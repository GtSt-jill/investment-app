import { analyzeMarketUniverse } from "@/lib/semiconductors/analyzer";
import { fetchDailyBars } from "@/lib/semiconductors/alpaca";
import { DEFAULT_MARKET_UNIVERSE, type MarketAnalysisResult, type SymbolProfile } from "@/lib/semiconductors/types";

export const DEFAULT_ANALYSIS_LOOKBACK_DAYS = 520;
export const MIN_ANALYSIS_LOOKBACK_DAYS = 260;
export const MAX_ANALYSIS_LOOKBACK_DAYS = 900;
export const MARKET_CONTEXT_SYMBOLS = ["SMH", "QQQ"] as const;

export interface AnalysisExecutionInput {
  symbols?: unknown;
  lookbackDays?: unknown;
}

export interface AnalysisExecution {
  result: MarketAnalysisResult;
  symbols: string[];
  lookbackDays: number;
  universe: SymbolProfile[];
}

export async function runMarketAnalysis(input: AnalysisExecutionInput = {}): Promise<AnalysisExecution> {
  const symbols = coerceAnalysisSymbols(input.symbols);
  const lookbackDays = coerceAnalysisLookbackDays(input.lookbackDays);
  const universe = DEFAULT_MARKET_UNIVERSE.filter((profile) => symbols.includes(profile.symbol));
  const fetchSymbols = Array.from(new Set([...symbols, ...MARKET_CONTEXT_SYMBOLS]));
  const barsBySymbol = await fetchDailyBars(fetchSymbols, lookbackDays);
  const result = analyzeMarketUniverse(barsBySymbol, universe, {
    marketBars: {
      semiconductor: barsBySymbol.SMH,
      qqq: barsBySymbol.QQQ
    }
  });

  return {
    result,
    symbols,
    lookbackDays,
    universe
  };
}

export function coerceAnalysisSymbols(value: unknown) {
  const allowed = new Set<string>(DEFAULT_MARKET_UNIVERSE.map((profile) => profile.symbol));
  if (!Array.isArray(value)) {
    return Array.from(allowed);
  }

  const symbols = value
    .filter((symbol): symbol is string => typeof symbol === "string")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => allowed.has(symbol));

  return symbols.length > 0 ? Array.from(new Set(symbols)) : Array.from(allowed);
}

export function coerceAnalysisLookbackDays(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_ANALYSIS_LOOKBACK_DAYS;
  }

  return Math.min(MAX_ANALYSIS_LOOKBACK_DAYS, Math.max(MIN_ANALYSIS_LOOKBACK_DAYS, Math.round(parsed)));
}
