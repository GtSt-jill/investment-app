import { NextResponse } from "next/server";

import { getAnalysisSnapshotById } from "@/lib/semiconductors/analysis-history/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const snapshot = await getAnalysisSnapshotById(decodeURIComponent(id));
    if (!snapshot) {
      return NextResponse.json({ error: "Analysis snapshot not found." }, { status: 404 });
    }

    return NextResponse.json(splitAnalysisSnapshot(snapshot));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch analysis snapshot.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
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
