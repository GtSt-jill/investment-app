import { NextResponse } from "next/server";

import { getAnalysisSymbolHistory } from "@/lib/semiconductors/analysis-history/repository";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: rawSymbol } = await context.params;
    const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();
    if (symbol.length === 0) {
      return NextResponse.json({ error: "symbol route parameter is required." }, { status: 400 });
    }

    const url = new URL(request.url);
    const history = await getAnalysisSymbolHistory(symbol, {
      from: coerceDate(url.searchParams.get("from")),
      to: coerceDate(url.searchParams.get("to")),
      limit: coerceLimit(url.searchParams.get("limit"))
    });

    return NextResponse.json({ symbol, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch analysis symbol history.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceDate(value: string | null) {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function coerceLimit(value: string | null) {
  if (value === null) {
    return 252;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(1000, Math.round(parsed))) : 252;
}
