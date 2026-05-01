import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { appendTradingRunHistory, readTradingRunHistory } from "@/lib/semiconductors/trading/history";
import { evaluateLiveTradingReadiness, evaluatePaperTradingReadiness } from "@/lib/semiconductors/trading/readiness";
import type { TradeOrderSubmission, TradingDryRunResult, TradingPaperRunResult } from "@/lib/semiconductors/trading";

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

  it("requires 20 completed paper trading days with submitted orders before paper readiness passes", async () => {
    const records = Array.from({ length: 19 }, (_, index) =>
      historyLine(`paper-${index}`, {
        mode: "paper",
        asOf: dateAt(index),
        submissions: [submission(`plan-${index}`, "submitted")]
      })
    );

    expect(evaluatePaperTradingReadiness(records).ready).toBe(false);
    expect(evaluatePaperTradingReadiness(records).blockers).toContain("Need 20 completed paper trading days; found 19.");

    const readyRecords = [
      ...records,
      historyLine("paper-20", {
        mode: "paper",
        asOf: dateAt(19),
        submissions: [submission("plan-20", "submitted")]
      })
    ];
    const readiness = evaluatePaperTradingReadiness(readyRecords);

    expect(readiness).toMatchObject({
      ready: true,
      completedPaperDays: 20,
      completedPaperRuns: 20,
      failedPaperRuns: 0,
      failedSubmissions: 0,
      submittedOrders: 20
    });
  });

  it("blocks live readiness until paper review and explicit approval both pass", async () => {
    const records = [
      historyLine("dry-latest", { mode: "dry-run", asOf: "2026-04-30" }),
      ...Array.from({ length: 20 }, (_, index) =>
        historyLine(`paper-${index}`, {
          mode: "paper",
          asOf: dateAt(index),
          submissions: [submission(`plan-${index}`, "submitted")]
        })
      )
    ];

    expect(
      evaluateLiveTradingReadiness(records, {
        liveEnabled: true,
        expectedConfirmationToken: "confirm-live",
        confirmationToken: "confirm-live",
        approvedDryRunId: "dry-latest"
      })
    ).toMatchObject({ ready: true });

    expect(
      evaluateLiveTradingReadiness(records, {
        liveEnabled: true,
        expectedConfirmationToken: "confirm-live",
        confirmationToken: "wrong",
        approvedDryRunId: "dry-latest"
      }).approval.blockers
    ).toContain("Live confirmation token did not match.");
  });
});

async function tempHistoryPath() {
  const dir = await mkdtemp(join(tmpdir(), "trading-history-"));
  return join(dir, "runs.jsonl");
}

function historyLine(
  id: string,
  options: {
    mode?: "dry-run" | "paper";
    asOf?: string;
    status?: "completed" | "failed";
    submissions?: TradeOrderSubmission[];
  } = {}
) {
  const payload = result(id, "2026-04-24T20:00:00.000Z", options);
  return {
    savedAt: payload.run.generatedAt,
    run: payload.run,
    summary: payload.summary,
    plans: payload.plans,
    submissions: "submissions" in payload ? payload.submissions : undefined,
    notes: payload.notes
  };
}

function result(
  id: string,
  generatedAt: string,
  options: {
    mode?: "dry-run" | "paper";
    asOf?: string;
    status?: "completed" | "failed";
    submissions?: TradeOrderSubmission[];
  } = {}
): TradingDryRunResult | TradingPaperRunResult {
  const mode = options.mode ?? "dry-run";
  const base: TradingDryRunResult = {
    run: {
      id,
      mode,
      asOf: options.asOf ?? "2026-04-24",
      generatedAt,
      status: options.status ?? "completed",
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
      riskProfile: "balanced",
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

  if (mode !== "paper") {
    return base;
  }

  return {
    ...base,
    submissions: options.submissions ?? [],
    orderLogs: []
  };
}

function submission(planId: string, status: TradeOrderSubmission["status"]): TradeOrderSubmission {
  return {
    planId,
    clientOrderId: planId,
    symbol: "NVDA",
    side: "buy",
    status,
    alpacaOrderId: status === "submitted" ? `alpaca-${planId}` : undefined,
    alpacaStatus: status === "submitted" ? "accepted" : undefined,
    error: status === "failed" ? "paper submit failed" : undefined
  };
}

function dateAt(index: number) {
  return new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10);
}
