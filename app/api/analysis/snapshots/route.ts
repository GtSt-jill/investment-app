import { NextResponse } from "next/server";

import { runMarketAnalysis } from "@/lib/semiconductors/analysis-service";
import { listAnalysisSnapshots, saveAnalysisSnapshot } from "@/lib/semiconductors/analysis-history/repository";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<{
      symbols: unknown;
      lookbackDays: unknown;
      source: unknown;
      force: unknown;
    }>;
    const execution = await runMarketAnalysis({
      symbols: payload.symbols,
      lookbackDays: payload.lookbackDays
    });
    const saved = await saveAnalysisSnapshot({
      result: execution.result,
      lookbackDays: execution.lookbackDays,
      source: coerceSnapshotSource(payload.source),
      force: payload.force === true
    });
    const response = splitAnalysisSnapshot(saved.snapshot);

    return NextResponse.json({
      snapshot: response.snapshot,
      created: saved.created,
      updated: saved.updated,
      result: response.result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save analysis snapshot.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const snapshots = await listAnalysisSnapshots({
      limit: coerceLimit(url.searchParams.get("limit"), 30, 365),
      from: coerceDate(url.searchParams.get("from")),
      to: coerceDate(url.searchParams.get("to")),
      symbol: coerceSymbol(url.searchParams.get("symbol")),
      category: coerceString(url.searchParams.get("category"))
    });

    return NextResponse.json({ snapshots });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch analysis snapshots.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceSnapshotSource(value: unknown) {
  if (value === "manual" || value === "scheduled" || value === "trading-run") {
    return value;
  }

  return "manual";
}

function coerceLimit(value: string | null, defaultValue: number, maxValue: number) {
  if (value === null) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maxValue, Math.round(parsed))) : defaultValue;
}

function coerceDate(value: string | null) {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function coerceSymbol(value: string | null) {
  return value === null || value.trim().length === 0 ? undefined : value.trim().toUpperCase();
}

function coerceString(value: string | null) {
  return value === null || value.trim().length === 0 ? undefined : value.trim();
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
