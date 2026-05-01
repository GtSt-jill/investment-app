import { NextResponse } from "next/server";

import { analyzeMarketUniverse } from "@/lib/semiconductors/analyzer";
import { fetchDailyBars } from "@/lib/semiconductors/alpaca";
import { DEFAULT_MARKET_UNIVERSE } from "@/lib/semiconductors/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<{
      symbols: unknown;
      lookbackDays: unknown;
    }>;
    const symbols = coerceSymbols(payload.symbols);
    const lookbackDays = coerceLookbackDays(payload.lookbackDays);
    const universe = DEFAULT_MARKET_UNIVERSE.filter((profile) => symbols.includes(profile.symbol));
    const marketSymbols = ["SMH", "QQQ"];
    const fetchSymbols = Array.from(new Set([...symbols, ...marketSymbols]));
    const barsBySymbol = await fetchDailyBars(fetchSymbols, lookbackDays);
    const result = analyzeMarketUniverse(barsBySymbol, universe, {
      marketBars: {
        semiconductor: barsBySymbol.SMH,
        qqq: barsBySymbol.QQQ
      }
    });

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

function coerceLookbackDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 520;
  }

  return Math.min(900, Math.max(260, Math.round(value)));
}
