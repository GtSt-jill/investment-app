import { readFile } from "node:fs/promises";
import path from "node:path";

import { ALL_SYMBOLS, type AlignedMarketData, type PriceBar, type UniverseSymbol } from "@/lib/simulator/types";

const DATA_DIRECTORY = path.join(process.cwd(), "data");

let cachedMarketData: AlignedMarketData | null = null;

export async function loadMarketData() {
  if (cachedMarketData) {
    return cachedMarketData;
  }

  const entries = await Promise.all(ALL_SYMBOLS.map(async (symbol) => [symbol, await loadSymbolData(symbol)] as const));
  const series = Object.fromEntries(entries) as Record<UniverseSymbol, PriceBar[]>;

  const commonDates = intersectDates(Object.values(series));
  if (commonDates.length === 0) {
    throw new Error("No common trading dates were found across the ETF universe.");
  }

  const pricesBySymbol = {} as Record<UniverseSymbol, number[]>;

  for (const symbol of ALL_SYMBOLS) {
    const valueByDate = new Map(series[symbol].map((bar) => [bar.date, bar.close]));
    pricesBySymbol[symbol] = commonDates.map((date) => {
      const close = valueByDate.get(date);
      if (close === undefined) {
        throw new Error(`Missing price for ${symbol} on ${date}.`);
      }

      return close;
    });
  }

  cachedMarketData = {
    dates: commonDates,
    pricesBySymbol
  };

  return cachedMarketData;
}

async function loadSymbolData(symbol: UniverseSymbol) {
  const filePath = path.join(DATA_DIRECTORY, `${symbol}.csv`);
  const contents = await readFile(filePath, "utf-8");

  return parseCsv(contents);
}

function parseCsv(contents: string) {
  const lines = contents.trim().split(/\r?\n/);
  const rows = lines.slice(1);

  return rows
    .map((row) => row.split(","))
    .map(([date, close]) => ({
      date,
      close: Number(close)
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function intersectDates(seriesList: PriceBar[][]) {
  const [first, ...rest] = seriesList;
  const baseDates = new Set(first.map((bar) => bar.date));

  for (const series of rest) {
    const seriesDates = new Set(series.map((bar) => bar.date));
    for (const date of Array.from(baseDates)) {
      if (!seriesDates.has(date)) {
        baseDates.delete(date);
      }
    }
  }

  return Array.from(baseDates).sort((left, right) => left.localeCompare(right));
}
