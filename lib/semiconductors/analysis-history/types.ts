import type { MarketAnalysisResult, MarketRegime, SecurityCategoryId, SignalAction, SignalRating } from "@/lib/semiconductors/types";

export type AnalysisSnapshotSource = "scheduled" | "manual" | "trading-run";

export interface AnalysisSnapshotRecord {
  id: string;
  snapshotKey: string;
  asOf: string;
  generatedAt: string;
  savedAt: string;
  updatedAt: string;
  revision: number;
  lookbackDays: number;
  analyzerVersion: string;
  universeHash: string;
  symbols: string[];
  summary: MarketAnalysisResult["summary"];
  result: MarketAnalysisResult;
  source: AnalysisSnapshotSource;
  notes: string[];
}

export interface AnalysisSnapshotListItem {
  id: string;
  snapshotKey: string;
  asOf: string;
  generatedAt: string;
  savedAt: string;
  updatedAt: string;
  revision: number;
  lookbackDays: number;
  analyzerVersion: string;
  universeHash: string;
  symbolCount: number;
  symbols: string[];
  summary: MarketAnalysisResult["summary"];
  source: AnalysisSnapshotSource;
  notes: string[];
}

export interface SaveAnalysisSnapshotInput {
  result: MarketAnalysisResult;
  lookbackDays: number;
  source: AnalysisSnapshotSource;
  analyzerVersion?: string;
  force?: boolean;
  savedAt?: string;
  notes?: string[];
}

export interface SaveAnalysisSnapshotResult {
  snapshot: AnalysisSnapshotRecord;
  created: boolean;
  updated: boolean;
}

export interface ListAnalysisSnapshotsOptions {
  limit?: number;
  from?: string;
  to?: string;
  symbol?: string;
  category?: SecurityCategoryId | string;
}

export interface FindAnalysisSnapshotAtOptions {
  symbol?: string;
  toleranceDays?: number;
}

export interface SymbolAnalysisHistoryOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export interface SymbolAnalysisHistoryItem {
  snapshotId: string;
  asOf: string;
  symbol: string;
  category: SecurityCategoryId | string | null;
  segment: string;
  rank: number;
  relativeStrengthRank: number;
  action: SignalAction;
  rating: SignalRating;
  score: number;
  scoreChange: number | null;
  close: number;
  dayChangePct: number;
  marketRegime: MarketRegime | null;
}
