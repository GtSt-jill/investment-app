import { NextResponse } from "next/server";

import { coerceSimulationInput } from "@/lib/simulator/defaults";
import { simulateStrategy } from "@/lib/simulator/service";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<Record<string, unknown>>;
    const input = coerceSimulationInput(payload);
    const result = await simulateStrategy(input);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
