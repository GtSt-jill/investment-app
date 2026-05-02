import { NextResponse } from "next/server";

import { findAnalysisSnapshotAt } from "@/lib/semiconductors/analysis-history/repository";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const datetime = coerceDatetime(url.searchParams.get("datetime"));
    if (datetime === undefined) {
      return NextResponse.json({ error: "datetime query parameter is required." }, { status: 400 });
    }

    const snapshot = await findAnalysisSnapshotAt({
      datetime,
      symbol: coerceSymbol(url.searchParams.get("symbol")),
      toleranceDays: coerceToleranceDays(url.searchParams.get("toleranceDays"))
    });
    if (!snapshot) {
      return NextResponse.json({ error: "Analysis snapshot not found for the requested datetime." }, { status: 404 });
    }

    return NextResponse.json(splitAnalysisSnapshot(snapshot));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch analysis snapshot by datetime.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceDatetime(value: string | null) {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? trimmed : undefined;
}

function coerceSymbol(value: string | null) {
  return value === null || value.trim().length === 0 ? undefined : value.trim().toUpperCase();
}

function coerceToleranceDays(value: string | null) {
  if (value === null) {
    return 7;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(365, Math.round(parsed))) : 7;
}

function splitAnalysisSnapshot<T extends { result: unknown; symbols?: unknown[] }>(record: T) {
  const { result, ...snapshot } = record;

  return {
    snapshot: {
      ...snapshot,
      symbolCount: Array.isArray(record.symbols) ? record.symbols.length : 0
    },
    result
  };
}
