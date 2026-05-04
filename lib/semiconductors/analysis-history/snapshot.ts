import { createHash } from "node:crypto";

import type { MarketAnalysisResult, SymbolProfile } from "@/lib/semiconductors/types";

export const DEFAULT_ANALYZER_VERSION = "technical-v1";

export interface SnapshotKeyInput {
  asOf: string;
  savedOn?: string;
  universeHash: string;
  lookbackDays: number;
  analyzerVersion?: string;
}

export function createUniverseHash(universe: readonly SymbolProfile[] | readonly string[]) {
  const normalized = universe
    .map((item) => {
      if (typeof item === "string") {
        return {
          symbol: normalizeSymbol(item),
          category: null,
          segment: ""
        };
      }

      return {
        symbol: normalizeSymbol(item.symbol),
        category: item.category ?? null,
        segment: item.segment ?? ""
      };
    })
    .filter((item) => item.symbol.length > 0)
    .sort((left, right) => {
      const symbolOrder = left.symbol.localeCompare(right.symbol);
      if (symbolOrder !== 0) {
        return symbolOrder;
      }

      const categoryOrder = String(left.category ?? "").localeCompare(String(right.category ?? ""));
      return categoryOrder !== 0 ? categoryOrder : left.segment.localeCompare(right.segment);
    });

  return sha256(JSON.stringify(normalized)).slice(0, 32);
}

export function createSnapshotKey(input: SnapshotKeyInput) {
  const analyzerVersion = input.analyzerVersion ?? DEFAULT_ANALYZER_VERSION;
  const saveDateSegment = input.savedOn ? `${input.savedOn}:` : "";
  return `analysis:${input.asOf}:${saveDateSegment}${input.lookbackDays}:${analyzerVersion}:${input.universeHash}`;
}

export function createSnapshotId(snapshotKey: string) {
  return `analysis_${sha256(snapshotKey).slice(0, 24)}`;
}

export function createSnapshotSaveDate(savedAt: string, timeZone = process.env.ANALYSIS_HISTORY_TIME_ZONE ?? process.env.TZ ?? "Asia/Tokyo") {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid analysis snapshot savedAt: ${savedAt}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Invalid analysis snapshot time zone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function symbolsForResult(result: MarketAnalysisResult) {
  const symbols = result.universe.length > 0 ? result.universe.map((profile) => profile.symbol) : result.recommendations.map((row) => row.symbol);
  return [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].sort();
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
