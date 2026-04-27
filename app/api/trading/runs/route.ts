import { NextResponse } from "next/server";

import { readTradingRunHistory } from "@/lib/semiconductors/trading/history";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = coerceLimit(url.searchParams.get("limit"));
    const runs = await readTradingRunHistory(limit);

    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch trading run history.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceLimit(value: string | null) {
  if (value === null) {
    return 20;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 20;
}
