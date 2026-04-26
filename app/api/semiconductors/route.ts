import { NextResponse } from "next/server";

import { analyzeSemiconductors } from "@/lib/semiconductors/analyzer";
import { fetchDailyBars } from "@/lib/semiconductors/alpaca";
import { DEFAULT_SEMICONDUCTOR_UNIVERSE } from "@/lib/semiconductors/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<{
      symbols: unknown;
      lookbackDays: unknown;
    }>;
    const symbols = coerceSymbols(payload.symbols);
    const lookbackDays = coerceLookbackDays(payload.lookbackDays);
    const universe = DEFAULT_SEMICONDUCTOR_UNIVERSE.filter((profile) => symbols.includes(profile.symbol));
    const barsBySymbol = await fetchDailyBars(symbols, lookbackDays);
    const result = analyzeSemiconductors(barsBySymbol, universe);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze semiconductor stocks.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  return POST(new Request("http://localhost/api/semiconductors", { method: "POST", body: "{}" }));
}

function coerceSymbols(value: unknown) {
  const allowed = new Set<string>(DEFAULT_SEMICONDUCTOR_UNIVERSE.map((profile) => profile.symbol));
  if (!Array.isArray(value)) {
    return Array.from(allowed);
  }

  const symbols = value
    .filter((symbol): symbol is string => typeof symbol === "string")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => allowed.has(symbol));

  return symbols.length > 0 ? Array.from(new Set(symbols)) : Array.from(allowed);
}

function coerceLookbackDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 520;
  }

  return Math.min(900, Math.max(260, Math.round(value)));
}
