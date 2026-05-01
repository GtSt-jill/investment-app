import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { appendTradingRunHistory, readTradingRunHistory } from "@/lib/semiconductors/trading/history";
import type { TradingDryRunResult } from "@/lib/semiconductors/trading";

describe("trading run history", () => {
  it("appends and reads recent records newest first", async () => {
    const filePath = await tempHistoryPath();
    await appendTradingRunHistory(result("first", "2026-04-24T20:00:00.000Z"), filePath);
    await appendTradingRunHistory(result("second", "2026-04-24T21:00:00.000Z"), filePath);

    const records = await readTradingRunHistory(10, filePath);

    expect(records.map((record) => record.run.id)).toEqual(["second", "first"]);
  });

  it("ignores corrupt jsonl lines", async () => {
    const filePath = await tempHistoryPath();
    await writeFile(filePath, `not-json\n${JSON.stringify(historyLine("valid"))}\n`, "utf8");

    const records = await readTradingRunHistory(10, filePath);

    expect(records.map((record) => record.run.id)).toEqual(["valid"]);
  });
});

async function tempHistoryPath() {
  const dir = await mkdtemp(join(tmpdir(), "trading-history-"));
  return join(dir, "runs.jsonl");
}

function historyLine(id: string) {
  const payload = result(id, "2026-04-24T20:00:00.000Z");
  return {
    savedAt: payload.run.generatedAt,
    run: payload.run,
    summary: payload.summary,
    plans: payload.plans,
    notes: payload.notes
  };
}

function result(id: string, generatedAt: string): TradingDryRunResult {
  return {
    run: {
      id,
      mode: "dry-run",
      asOf: "2026-04-24",
      generatedAt,
      status: "completed",
      marketRegime: "bullish",
      portfolioValue: 100_000,
      notes: []
    },
    config: {
      mode: "dry-run",
      enabledSymbols: null,
      killSwitch: false,
      paperTradingEnabled: false,
      liveTradingEnabled: false,
      useBracketOrders: true,
      risk: {
        riskPerTradePct: 0.005,
        maxPositionPct: 0.08,
        maxSectorPct: 0.5,
        maxDailyNewEntries: 3,
        maxDailyNotionalPct: 0.15,
        minOrderNotional: 100,
        maxPositions: 20,
        minCashPct: 0.05,
        maxAtrPct: 0.075,
        minPrice: 5,
        minVolume20: 300_000,
        earningsBlackoutDays: 7,
        minEntryScore: 70,
        addMinScore: 72,
        sellScoreThreshold: 45,
        topRelativeStrengthPct: 0.35,
        maxEntryPricePremiumPct: 0.03,
        maxEntrySma20PremiumPct: 0.08,
        maxEntryDayChangePct: 0.04,
        minEntryRewardRiskRatio: 1.5,
        neutralEntryScoreBuffer: 5,
        unstableSignalScoreBuffer: 3,
        minEntryScoreChange: 0,
        minSignalStabilityAdjustment: 0,
        reducePositionPct: 0.5,
        allowAddToLosingPositions: false,
        allowPatternDayTraderBuys: false
      }
    },
    portfolio: {
      generatedAt,
      summary: {
        positionCount: 0,
        openOrderCount: 0,
        longExposure: 0,
        shortExposure: 0,
        cashAllocationPct: 1,
        largestPositionSymbol: null,
        largestPositionAllocationPct: null,
        totalUnrealizedPnl: 0,
        totalUnrealizedPnlPct: null
      }
    },
    plans: [],
    orders: [],
    summary: {
      planCount: 0,
      plannedCount: 0,
      blockedCount: 0,
      buyNotional: 0,
      sellNotional: 0,
      newEntryCount: 0
    },
    notes: []
  };
}
