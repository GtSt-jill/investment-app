import { NextResponse } from "next/server";

import { readTradingRunHistory } from "@/lib/semiconductors/trading/history";
import { evaluatePaperTradingReadiness } from "@/lib/semiconductors/trading/readiness";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = coerceLimit(url.searchParams.get("limit"));
    const requiredPaperDays = coerceRequiredPaperDays(url.searchParams.get("requiredPaperDays"));
    const runs = await readTradingRunHistory(limit);
    const readinessRecords = await readTradingRunHistory(100);
    const readiness = {
      paper: evaluatePaperTradingReadiness(readinessRecords, requiredPaperDays)
    };

    return NextResponse.json({ runs, readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch trading run history.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceRequiredPaperDays(value: string | null) {
  if (value === null) {
    return 20;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(252, Math.round(parsed))) : 20;
}

function coerceLimit(value: string | null) {
  if (value === null) {
    return 20;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 20;
}
