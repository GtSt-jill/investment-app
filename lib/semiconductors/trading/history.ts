import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TradeOrderSubmission, TradePlan, TradingDryRunResult, TradingPaperRunResult, TradingRunRecord, TradingRunSummary } from "./types";

export interface TradingRunHistoryRecord {
  savedAt: string;
  run: TradingRunRecord;
  summary: TradingRunSummary;
  plans: TradePlan[];
  submissions?: TradeOrderSubmission[];
  notes: string[];
}

export async function appendTradingRunHistory(result: TradingDryRunResult | TradingPaperRunResult, filePath = resolveHistoryPath()) {
  const record: TradingRunHistoryRecord = {
    savedAt: new Date().toISOString(),
    run: result.run,
    summary: result.summary,
    plans: result.plans,
    submissions: "submissions" in result ? result.submissions : undefined,
    notes: result.notes
  };

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readTradingRunHistory(limit = 20, filePath = resolveHistoryPath()) {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const records = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseHistoryLine)
    .filter((record): record is TradingRunHistoryRecord => record !== null)
    .reverse();

  return records.slice(0, Math.max(1, Math.min(100, limit)));
}

function parseHistoryLine(line: string): TradingRunHistoryRecord | null {
  try {
    const parsed = JSON.parse(line) as Partial<TradingRunHistoryRecord>;
    if (!parsed.run || !parsed.summary || !Array.isArray(parsed.plans)) {
      return null;
    }

    return {
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : parsed.run.generatedAt,
      run: parsed.run,
      summary: parsed.summary,
      plans: parsed.plans,
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : undefined,
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch {
    return null;
  }
}

function resolveHistoryPath() {
  return process.env.AUTO_TRADING_RUN_LOG_PATH ?? join(process.cwd(), "data", "trading-runs.jsonl");
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
