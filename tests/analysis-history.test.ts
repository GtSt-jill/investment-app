import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AnalysisSnapshotRepository } from "@/lib/semiconductors/analysis-history/repository";
import { createSnapshotKey, createSnapshotSaveDate, createUniverseHash } from "@/lib/semiconductors/analysis-history/snapshot";
import type { MarketAnalysisResult, RecommendationItem, SymbolProfile } from "@/lib/semiconductors/types";

describe("analysis snapshot history", () => {
  it("creates stable universe hashes and snapshot keys for equivalent inputs", () => {
    const firstUniverse: SymbolProfile[] = [
      { symbol: "NVDA", name: "NVDA", segment: "半導体", category: "semiconductors" },
      { symbol: "AMD", name: "AMD", segment: "半導体", category: "semiconductors" }
    ];
    const secondUniverse: SymbolProfile[] = [
      { symbol: " amd ", name: "AMD", segment: "半導体", category: "semiconductors" },
      { symbol: "nvda", name: "NVDA", segment: "半導体", category: "semiconductors" }
    ];

    const firstHash = createUniverseHash(firstUniverse);
    const secondHash = createUniverseHash(secondUniverse);

    expect(firstHash).toBe(secondHash);
    expect(
      createSnapshotKey({
        asOf: "2026-05-01",
        savedOn: "2026-05-02",
        universeHash: firstHash,
        lookbackDays: 520,
        analyzerVersion: "technical-v1"
      })
    ).toBe(
      createSnapshotKey({
        asOf: "2026-05-01",
        savedOn: "2026-05-02",
        universeHash: secondHash,
        lookbackDays: 520,
        analyzerVersion: "technical-v1"
      })
    );
    expect(createSnapshotSaveDate("2026-05-02T23:30:00.000Z", "Asia/Tokyo")).toBe("2026-05-03");
  });

  it("upserts duplicate snapshot keys without creating another row", async () => {
    const repo = await tempRepository();
    try {
      const first = repo.upsert({
        result: result("2026-05-01", "2026-05-02T08:30:00.000+09:00"),
        lookbackDays: 520,
        source: "scheduled",
        savedAt: "2026-05-02T08:30:05.000+09:00"
      });
      const duplicate = repo.upsert({
        result: result("2026-05-01", "2026-05-02T09:30:00.000+09:00", { nvdaScore: 99 }),
        lookbackDays: 520,
        source: "manual",
        savedAt: "2026-05-02T09:30:05.000+09:00"
      });

      expect(first.created).toBe(true);
      expect(duplicate).toMatchObject({ created: false, updated: false });
      expect(duplicate.snapshot.id).toBe(first.snapshot.id);
      expect(duplicate.snapshot.revision).toBe(1);
      expect(duplicate.snapshot.result.recommendations[0].score).toBe(first.snapshot.result.recommendations[0].score);
      expect(repo.list()).toHaveLength(1);
    } finally {
      repo.close();
    }
  });

  it("creates another snapshot when the same market asOf is saved on the next local date", async () => {
    const repo = await tempRepository();
    try {
      const first = repo.upsert({
        result: result("2026-05-01", "2026-05-02T08:30:00.000+09:00", { nvdaScore: 70 }),
        lookbackDays: 520,
        source: "manual",
        savedAt: "2026-05-02T08:30:05.000+09:00"
      });
      const nextDay = repo.upsert({
        result: result("2026-05-01", "2026-05-03T08:30:00.000+09:00", { nvdaScore: 82 }),
        lookbackDays: 520,
        source: "manual",
        savedAt: "2026-05-03T08:30:05.000+09:00"
      });

      expect(first.created).toBe(true);
      expect(nextDay.created).toBe(true);
      expect(nextDay.snapshot.id).not.toBe(first.snapshot.id);
      expect(nextDay.snapshot.snapshotKey).toContain("2026-05-03");
      expect(repo.list()).toHaveLength(2);
    } finally {
      repo.close();
    }
  });

  it("increments revision and replaces result when force is true", async () => {
    const repo = await tempRepository();
    try {
      const first = repo.upsert({
        result: result("2026-05-01", "2026-05-02T08:30:00.000+09:00", { nvdaScore: 70 }),
        lookbackDays: 520,
        source: "scheduled",
        savedAt: "2026-05-02T08:30:05.000+09:00"
      });
      const updated = repo.upsert({
        result: result("2026-05-01", "2026-05-02T09:30:00.000+09:00", { nvdaScore: 82 }),
        lookbackDays: 520,
        source: "manual",
        force: true,
        savedAt: "2026-05-02T09:30:05.000+09:00"
      });

      expect(updated).toMatchObject({ created: false, updated: true });
      expect(updated.snapshot.id).toBe(first.snapshot.id);
      expect(updated.snapshot.revision).toBe(2);
      expect(updated.snapshot.savedAt).toBe("2026-05-02T08:30:05.000+09:00");
      expect(updated.snapshot.updatedAt).toBe("2026-05-02T09:30:05.000+09:00");
      expect(updated.snapshot.result.recommendations[0].score).toBe(82);
    } finally {
      repo.close();
    }
  });

  it("lists, finds by id, and filters by symbol/category", async () => {
    const repo = await tempRepository();
    try {
      const older = repo.upsert({
        result: result("2026-04-30", "2026-05-01T08:30:00.000+09:00"),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;
      const newer = repo.upsert({
        result: result("2026-05-01", "2026-05-02T08:30:00.000+09:00"),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;

      expect(repo.list().map((snapshot) => snapshot.id)).toEqual([newer.id, older.id]);
      expect(repo.list({ symbol: "nvda" }).map((snapshot) => snapshot.id)).toEqual([newer.id, older.id]);
      expect(repo.list({ category: "semiconductors" }).map((snapshot) => snapshot.id)).toEqual([newer.id, older.id]);
      expect(repo.findById(newer.id)?.result.asOf).toBe("2026-05-01");
    } finally {
      repo.close();
    }
  });

  it("findAt returns the nearest snapshot before a date or datetime within tolerance", async () => {
    const repo = await tempRepository();
    try {
      const older = repo.upsert({
        result: result("2026-04-29", "2026-04-30T22:30:00.000Z"),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;
      const newer = repo.upsert({
        result: result("2026-05-01", "2026-05-02T22:30:00.000Z"),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;

      expect(repo.findAt("2026-05-02")?.id).toBe(newer.id);
      expect(repo.findAt("2026-05-01T23:00:00.000Z")?.id).toBe(older.id);
      expect(repo.findAt("2026-05-10", { toleranceDays: 3 })).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("returns symbol history newest first with denormalized values", async () => {
    const repo = await tempRepository();
    try {
      const older = repo.upsert({
        result: result("2026-04-30", "2026-05-01T08:30:00.000+09:00", { nvdaScore: 68, nvdaAction: "HOLD" }),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;
      const newer = repo.upsert({
        result: result("2026-05-01", "2026-05-02T08:30:00.000+09:00", { nvdaScore: 76, nvdaAction: "BUY" }),
        lookbackDays: 520,
        source: "scheduled"
      }).snapshot;

      expect(repo.symbolHistory("nvda")).toEqual([
        expect.objectContaining({
          snapshotId: newer.id,
          asOf: "2026-05-01",
          symbol: "NVDA",
          action: "BUY",
          score: 76,
          close: 112.3,
          dayChangePct: 0.018
        }),
        expect.objectContaining({
          snapshotId: older.id,
          asOf: "2026-04-30",
          symbol: "NVDA",
          action: "HOLD",
          score: 68
        })
      ]);
    } finally {
      repo.close();
    }
  });
});

async function tempRepository() {
  const dir = await mkdtemp(join(tmpdir(), "analysis-history-"));
  return new AnalysisSnapshotRepository({ dbPath: join(dir, "history.sqlite") });
}

function result(
  asOf: string,
  generatedAt: string,
  options: {
    nvdaScore?: number;
    nvdaAction?: "BUY" | "HOLD" | "SELL";
  } = {}
): MarketAnalysisResult {
  const universe: SymbolProfile[] = [
    { symbol: "NVDA", name: "NVDA", segment: "半導体", category: "semiconductors" },
    { symbol: "AMD", name: "AMD", segment: "半導体", category: "semiconductors" }
  ];
  const recommendations = [
    recommendation("NVDA", asOf, 1, options.nvdaScore ?? 74, options.nvdaAction ?? "BUY", 112.3, 0.018),
    recommendation("AMD", asOf, 2, 61, "HOLD", 141.2, -0.004)
  ];

  return {
    asOf,
    generatedAt,
    universe,
    recommendations,
    buyCandidates: recommendations.filter((row) => row.action === "BUY"),
    sellCandidates: recommendations.filter((row) => row.action === "SELL"),
    watchlist: recommendations.filter((row) => row.action === "HOLD"),
    summary: {
      analyzedSymbols: recommendations.length,
      averageScore: recommendations.reduce((total, row) => total + row.score, 0) / recommendations.length,
      strongestSymbol: recommendations[0].symbol,
      weakestSymbol: recommendations[recommendations.length - 1].symbol,
      marketBias: "neutral",
      marketRegime: "neutral",
      excludedSymbols: []
    },
    notes: ["fixture"]
  };
}

function recommendation(
  symbol: string,
  asOf: string,
  rank: number,
  score: number,
  action: "BUY" | "HOLD" | "SELL",
  close: number,
  dayChangePct: number
): RecommendationItem {
  return {
    symbol,
    name: symbol,
    segment: "半導体",
    category: "semiconductors",
    asOf,
    rating: action === "BUY" ? "BUY" : action === "SELL" ? "SELL" : "WATCH",
    action,
    signalChange: action === "BUY" ? "NEW_BUY" : action === "SELL" ? "NEW_SELL" : "NO_CHANGE",
    score,
    scoreChange: rank === 1 ? 2.5 : undefined,
    scoreBreakdown: {
      trendScore: score,
      momentumScore: score,
      relativeStrengthScore: score,
      riskScore: score,
      volumeScore: score
    },
    rank,
    relativeStrengthRank: rank,
    marketRegime: "neutral",
    indicators: {
      close,
      previousClose: close / (1 + dayChangePct),
      dayChangePct,
      sma20: close * 0.98,
      sma50: close * 0.95,
      sma200: close * 0.9,
      rsi14: 55,
      macd: 1,
      macdSignal: 0.8,
      macdHistogram: 0.2,
      macdHistogramPrevious: 0.1,
      bollingerUpper: close * 1.1,
      bollingerLower: close * 0.9,
      atr14: 3,
      atrPct: 0.02,
      volume5: 1_000_000,
      volume20: 900_000,
      volumeRatio: 1.2,
      volume5To20Ratio: 1.1,
      momentum20: 0.05,
      momentum63: 0.1,
      momentum126: 0.2,
      drawdownFromHigh: -0.03,
      longTermTrendUnavailable: false
    },
    reasons: [],
    risks: [],
    buyZone: {
      idealEntry: close,
      pullbackEntry: close * 0.97,
      stopLoss: close * 0.9,
      takeProfit: close * 1.15
    },
    chart: []
  };
}
