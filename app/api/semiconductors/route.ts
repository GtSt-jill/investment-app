import { NextResponse } from "next/server";

import { runMarketAnalysis } from "@/lib/semiconductors/analysis-service";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<{
      symbols: unknown;
      lookbackDays: unknown;
    }>;
    const { result } = await runMarketAnalysis({
      symbols: payload.symbols,
      lookbackDays: payload.lookbackDays
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze market universe.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  return POST(new Request("http://localhost/api/semiconductors", { method: "POST", body: "{}" }));
}
