export const ANALYSIS_HISTORY_SCHEMA_VERSION = 1;

export interface AnalysisHistoryDatabase {
  exec(sql: string): void;
  prepare(sql: string): AnalysisHistoryStatement;
}

export interface AnalysisHistoryStatement {
  get(...params: SqliteValue[]): unknown;
  all(...params: SqliteValue[]): unknown[];
  run(...params: SqliteValue[]): { changes: number; lastInsertRowid: number | bigint };
}

export type SqliteValue = string | number | bigint | null | Uint8Array;

export function initializeAnalysisHistorySchema(db: AnalysisHistoryDatabase) {
  const version = readUserVersion(db);
  if (version > ANALYSIS_HISTORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported analysis history schema version ${version}.`);
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_snapshots (
        id TEXT PRIMARY KEY,
        snapshot_key TEXT NOT NULL UNIQUE,
        as_of TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        lookback_days INTEGER NOT NULL,
        analyzer_version TEXT NOT NULL,
        universe_hash TEXT NOT NULL,
        symbols TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        source TEXT NOT NULL,
        notes_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_as_of
        ON analysis_snapshots(as_of DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_generated_at
        ON analysis_snapshots(generated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_source_as_of
        ON analysis_snapshots(source, as_of DESC);

      CREATE TABLE IF NOT EXISTS analysis_snapshot_symbols (
        snapshot_id TEXT NOT NULL,
        as_of TEXT NOT NULL,
        symbol TEXT NOT NULL,
        category TEXT,
        segment TEXT NOT NULL,
        rank INTEGER NOT NULL,
        relative_strength_rank INTEGER NOT NULL,
        action TEXT NOT NULL,
        rating TEXT NOT NULL,
        score REAL NOT NULL,
        score_change REAL,
        close REAL NOT NULL,
        day_change_pct REAL NOT NULL,
        market_regime TEXT,
        PRIMARY KEY(snapshot_id, symbol),
        FOREIGN KEY(snapshot_id) REFERENCES analysis_snapshots(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_snapshot_symbols_symbol_as_of
        ON analysis_snapshot_symbols(symbol, as_of DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_snapshot_symbols_action_as_of
        ON analysis_snapshot_symbols(action, as_of DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_snapshot_symbols_category_as_of
        ON analysis_snapshot_symbols(category, as_of DESC);
    `);
    db.exec(`PRAGMA user_version = ${ANALYSIS_HISTORY_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readUserVersion(db: AnalysisHistoryDatabase) {
  const row = db.prepare("PRAGMA user_version").get();
  return row && typeof row === "object" && "user_version" in row && typeof row.user_version === "number" ? row.user_version : 0;
}
