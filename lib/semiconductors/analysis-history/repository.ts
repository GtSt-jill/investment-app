import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeAnalysisHistorySchema, type AnalysisHistoryDatabase, type SqliteValue } from "@/lib/semiconductors/analysis-history/schema";
import {
  DEFAULT_ANALYZER_VERSION,
  createSnapshotId,
  createSnapshotKey,
  createUniverseHash,
  symbolsForResult
} from "@/lib/semiconductors/analysis-history/snapshot";
import type {
  AnalysisSnapshotListItem,
  AnalysisSnapshotRecord,
  AnalysisSnapshotSource,
  FindAnalysisSnapshotAtOptions as FindAnalysisSnapshotAtQueryOptions,
  ListAnalysisSnapshotsOptions,
  SaveAnalysisSnapshotInput,
  SaveAnalysisSnapshotResult,
  SymbolAnalysisHistoryItem,
  SymbolAnalysisHistoryOptions
} from "@/lib/semiconductors/analysis-history/types";
import type { MarketAnalysisResult, SecurityCategoryId, SignalAction, SignalRating } from "@/lib/semiconductors/types";

type DatabaseConstructor = new (path: string) => AnalysisHistoryDatabase & { close(): void };
const AnalysisHistoryDatabaseSync = DatabaseSync as DatabaseConstructor;

export interface AnalysisSnapshotRepositoryOptions {
  dbPath?: string;
  dbUrl?: string;
  database?: AnalysisHistoryDatabase & { close?: () => void };
}

export function saveAnalysisSnapshot(input: SaveAnalysisSnapshotRequest): Promise<SaveAnalysisSnapshotResult> {
  return withDefaultRepository((repository) => repository.upsert(input));
}

export function listAnalysisSnapshots(options: ListAnalysisSnapshotsOptions = {}): Promise<AnalysisSnapshotListItem[]> {
  return withDefaultRepository((repository) => repository.list(options));
}

export function getAnalysisSnapshotById(id: string): Promise<AnalysisSnapshotRecord | null> {
  return withDefaultRepository((repository) => repository.findById(id));
}

export function findAnalysisSnapshotAt(options: FindAnalysisSnapshotAtRequest): Promise<AnalysisSnapshotRecord | null> {
  return withDefaultRepository((repository) => repository.findAt(options.datetime, options));
}

export function getAnalysisSymbolHistory(
  symbol: string,
  options: SymbolAnalysisHistoryOptions = {}
): Promise<SymbolAnalysisHistoryItem[]> {
  return withDefaultRepository((repository) => repository.symbolHistory(symbol, options));
}

export type SaveAnalysisSnapshotRequest = SaveAnalysisSnapshotInput & {
  symbols?: readonly string[];
};

export interface FindAnalysisSnapshotAtRequest extends FindAnalysisSnapshotAtQueryOptions {
  datetime: string;
}

interface SnapshotRow {
  id: string;
  snapshot_key: string;
  as_of: string;
  generated_at: string;
  saved_at: string;
  updated_at: string;
  revision: number;
  lookback_days: number;
  analyzer_version: string;
  universe_hash: string;
  symbols: string;
  summary_json: string;
  result_json: string;
  source: AnalysisSnapshotSource;
  notes_json: string;
}

interface SymbolHistoryRow {
  snapshot_id: string;
  as_of: string;
  symbol: string;
  category: SecurityCategoryId | string | null;
  segment: string;
  rank: number;
  relative_strength_rank: number;
  action: SignalAction;
  rating: SignalRating;
  score: number;
  score_change: number | null;
  close: number;
  day_change_pct: number;
  market_regime: SymbolAnalysisHistoryItem["marketRegime"];
}

export class AnalysisSnapshotRepository {
  private readonly db: AnalysisHistoryDatabase & { close?: () => void };
  private readonly ownsDatabase: boolean;

  constructor(options: AnalysisSnapshotRepositoryOptions = {}) {
    if (options.database) {
      this.db = options.database;
      this.ownsDatabase = false;
    } else {
      const dbPath = resolveAnalysisHistoryDbPath(options.dbPath ?? options.dbUrl);
      if (dbPath !== ":memory:" && !dbPath.startsWith("file:")) {
        mkdirSync(dirname(dbPath), { recursive: true });
      }
      this.db = new AnalysisHistoryDatabaseSync(dbPath);
      this.db.exec("PRAGMA busy_timeout = 5000");
      if (dbPath !== ":memory:") {
        this.db.exec("PRAGMA journal_mode = WAL");
      }
      this.ownsDatabase = true;
    }

    initializeAnalysisHistorySchema(this.db);
  }

  close() {
    if (this.ownsDatabase) {
      this.db.close?.();
    }
  }

  upsert(input: SaveAnalysisSnapshotInput): SaveAnalysisSnapshotResult {
    const analyzerVersion = input.analyzerVersion ?? DEFAULT_ANALYZER_VERSION;
    const universeHash = createUniverseHash(input.result.universe);
    const snapshotKey = createSnapshotKey({
      asOf: input.result.asOf,
      universeHash,
      lookbackDays: input.lookbackDays,
      analyzerVersion
    });
    const existing = this.findRowBySnapshotKey(snapshotKey);

    if (existing && !input.force) {
      return {
        snapshot: rowToRecord(existing),
        created: false,
        updated: false
      };
    }

    const now = input.savedAt ?? new Date().toISOString();
    const symbols = symbolsForResult(input.result);
    const notes = input.notes ?? input.result.notes ?? [];
    const id = existing?.id ?? createSnapshotId(snapshotKey);
    const savedAt = existing?.saved_at ?? now;
    const revision = existing ? existing.revision + 1 : 1;

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
          INSERT INTO analysis_snapshots (
            id, snapshot_key, as_of, generated_at, saved_at, updated_at, revision,
            lookback_days, analyzer_version, universe_hash, symbols, summary_json,
            result_json, source, notes_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(snapshot_key) DO UPDATE SET
            as_of = excluded.as_of,
            generated_at = excluded.generated_at,
            updated_at = excluded.updated_at,
            revision = excluded.revision,
            lookback_days = excluded.lookback_days,
            analyzer_version = excluded.analyzer_version,
            universe_hash = excluded.universe_hash,
            symbols = excluded.symbols,
            summary_json = excluded.summary_json,
            result_json = excluded.result_json,
            source = excluded.source,
            notes_json = excluded.notes_json
        `
        )
        .run(
          id,
          snapshotKey,
          input.result.asOf,
          input.result.generatedAt,
          savedAt,
          now,
          revision,
          input.lookbackDays,
          analyzerVersion,
          universeHash,
          JSON.stringify(symbols),
          JSON.stringify(input.result.summary),
          JSON.stringify(input.result),
          input.source,
          JSON.stringify(notes)
        );

      this.replaceSymbolRows(id, input.result);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const snapshot = this.findById(id);
    if (!snapshot) {
      throw new Error(`Saved analysis snapshot ${id} could not be read back.`);
    }

    return {
      snapshot,
      created: existing === null,
      updated: existing !== null
    };
  }

  list(options: ListAnalysisSnapshotsOptions = {}): AnalysisSnapshotListItem[] {
    const conditions: string[] = [];
    const params: SqliteValue[] = [];

    if (options.from) {
      conditions.push("s.as_of >= ?");
      params.push(options.from);
    }
    if (options.to) {
      conditions.push("s.as_of <= ?");
      params.push(options.to);
    }
    if (options.symbol) {
      conditions.push("EXISTS (SELECT 1 FROM analysis_snapshot_symbols ss WHERE ss.snapshot_id = s.id AND ss.symbol = ?)");
      params.push(normalizeSymbol(options.symbol));
    }
    if (options.category) {
      conditions.push("EXISTS (SELECT 1 FROM analysis_snapshot_symbols ss WHERE ss.snapshot_id = s.id AND ss.category = ?)");
      params.push(options.category);
    }

    params.push(clampLimit(options.limit, 30, 365));
    const rows = this.db
      .prepare(
        `
        SELECT s.*
        FROM analysis_snapshots s
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY s.as_of DESC, s.generated_at DESC
        LIMIT ?
      `
      )
      .all(...params) as SnapshotRow[];

    return rows.map(rowToListItem);
  }

  findById(id: string): AnalysisSnapshotRecord | null {
    const row = this.db.prepare("SELECT * FROM analysis_snapshots WHERE id = ?").get(id) as SnapshotRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  findAt(datetime: string, options: FindAnalysisSnapshotAtQueryOptions = {}): AnalysisSnapshotRecord | null {
    const toleranceDays = options.toleranceDays ?? 7;
    const symbol = options.symbol ? normalizeSymbol(options.symbol) : undefined;
    const scoped = symbol ? this.findAtCandidate(datetime, toleranceDays, symbol) : null;
    if (scoped) {
      return scoped;
    }

    return this.findAtCandidate(datetime, toleranceDays);
  }

  symbolHistory(symbol: string, options: SymbolAnalysisHistoryOptions = {}): SymbolAnalysisHistoryItem[] {
    const conditions = ["symbol = ?"];
    const params: SqliteValue[] = [normalizeSymbol(symbol)];

    if (options.from) {
      conditions.push("as_of >= ?");
      params.push(options.from);
    }
    if (options.to) {
      conditions.push("as_of <= ?");
      params.push(options.to);
    }

    params.push(clampLimit(options.limit, 252, 1000));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM analysis_snapshot_symbols
        WHERE ${conditions.join(" AND ")}
        ORDER BY as_of DESC, snapshot_id DESC
        LIMIT ?
      `
      )
      .all(...params) as SymbolHistoryRow[];

    return rows.map((row) => ({
      snapshotId: row.snapshot_id,
      asOf: row.as_of,
      symbol: row.symbol,
      category: row.category,
      segment: row.segment,
      rank: row.rank,
      relativeStrengthRank: row.relative_strength_rank,
      action: row.action,
      rating: row.rating,
      score: row.score,
      scoreChange: row.score_change,
      close: row.close,
      dayChangePct: row.day_change_pct,
      marketRegime: row.market_regime
    }));
  }

  private findAtCandidate(datetime: string, toleranceDays: number, symbol?: string) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(datetime);
    const params: SqliteValue[] = [datetime];
    const symbolFilter = symbol
      ? "AND EXISTS (SELECT 1 FROM analysis_snapshot_symbols ss WHERE ss.snapshot_id = s.id AND ss.symbol = ?)"
      : "";
    if (symbol) {
      params.push(symbol);
    }

    const row = this.db
      .prepare(
        `
        SELECT s.*
        FROM analysis_snapshots s
        WHERE s.${dateOnly ? "as_of" : "generated_at"} <= ?
        ${symbolFilter}
        ORDER BY s.${dateOnly ? "as_of" : "generated_at"} DESC
        LIMIT 1
      `
      )
      .get(...params) as SnapshotRow | undefined;

    if (!row || !withinTolerance(row, datetime, toleranceDays, dateOnly)) {
      return null;
    }

    return rowToRecord(row);
  }

  private findRowBySnapshotKey(snapshotKey: string) {
    return (this.db.prepare("SELECT * FROM analysis_snapshots WHERE snapshot_key = ?").get(snapshotKey) as SnapshotRow | undefined) ?? null;
  }

  private replaceSymbolRows(snapshotId: string, result: MarketAnalysisResult) {
    this.db.prepare("DELETE FROM analysis_snapshot_symbols WHERE snapshot_id = ?").run(snapshotId);
    const insert = this.db.prepare(`
      INSERT INTO analysis_snapshot_symbols (
        snapshot_id, as_of, symbol, category, segment, rank, relative_strength_rank,
        action, rating, score, score_change, close, day_change_pct, market_regime
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of result.recommendations) {
      insert.run(
        snapshotId,
        result.asOf,
        normalizeSymbol(row.symbol),
        row.category ?? null,
        row.segment,
        row.rank,
        row.relativeStrengthRank,
        row.action,
        row.rating,
        row.score,
        row.scoreChange ?? null,
        row.indicators.close,
        row.indicators.dayChangePct,
        row.marketRegime ?? result.summary.marketRegime ?? null
      );
    }
  }
}

export function resolveAnalysisHistoryDbPath(input = process.env.ANALYSIS_HISTORY_DB_URL) {
  const dbPath = input ?? join(process.cwd(), "data", "investment-app.sqlite");
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) {
    if (dbPath.startsWith("file://")) {
      return fileURLToPath(dbPath);
    }

    if (dbPath.startsWith("file:./") || dbPath.startsWith("file:../")) {
      return resolve(process.cwd(), dbPath.slice("file:".length));
    }

    return dbPath;
  }

  return isAbsolute(dbPath) ? dbPath : resolve(process.cwd(), dbPath);
}

function rowToRecord(row: SnapshotRow): AnalysisSnapshotRecord {
  return {
    id: row.id,
    snapshotKey: row.snapshot_key,
    asOf: row.as_of,
    generatedAt: row.generated_at,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    lookbackDays: row.lookback_days,
    analyzerVersion: row.analyzer_version,
    universeHash: row.universe_hash,
    symbols: parseJson<string[]>(row.symbols, []),
    summary: parseJson<MarketAnalysisResult["summary"]>(row.summary_json),
    result: parseJson<MarketAnalysisResult>(row.result_json),
    source: row.source,
    notes: parseJson<string[]>(row.notes_json, [])
  };
}

function rowToListItem(row: SnapshotRow): AnalysisSnapshotListItem {
  const symbols = parseJson<string[]>(row.symbols, []);
  return {
    id: row.id,
    snapshotKey: row.snapshot_key,
    asOf: row.as_of,
    generatedAt: row.generated_at,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    lookbackDays: row.lookback_days,
    analyzerVersion: row.analyzer_version,
    universeHash: row.universe_hash,
    symbolCount: symbols.length,
    symbols,
    summary: parseJson<MarketAnalysisResult["summary"]>(row.summary_json),
    source: row.source,
    notes: parseJson<string[]>(row.notes_json, [])
  };
}

function withinTolerance(row: SnapshotRow, datetime: string, toleranceDays: number, dateOnly: boolean) {
  const target = dateOnly ? Date.parse(`${datetime}T00:00:00.000Z`) : Date.parse(datetime);
  const candidate = dateOnly ? Date.parse(`${row.as_of}T00:00:00.000Z`) : Date.parse(row.generated_at);
  if (!Number.isFinite(target) || !Number.isFinite(candidate)) {
    return false;
  }

  return target - candidate <= toleranceDays * 24 * 60 * 60 * 1000;
}

function parseJson<T>(value: string, fallback?: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("Stored analysis snapshot JSON could not be parsed.");
  }
}

function clampLimit(limit: number | undefined, defaultValue: number, max: number) {
  if (!Number.isFinite(limit)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(max, Math.trunc(limit ?? defaultValue)));
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

async function withDefaultRepository<T>(callback: (repository: AnalysisSnapshotRepository) => T): Promise<T> {
  const repository = new AnalysisSnapshotRepository();
  try {
    return callback(repository);
  } finally {
    repository.close();
  }
}
