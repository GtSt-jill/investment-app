import { NextResponse } from "next/server";

import { fetchPortfolioSnapshot } from "@/lib/semiconductors/portfolio";

export async function GET() {
  try {
    const snapshot = await fetchPortfolioSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch portfolio data.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
