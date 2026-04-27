import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TradeOrderLog } from "./types";

export async function appendTradeOrderLogs(logs: TradeOrderLog[], filePath = process.env.AUTO_TRADING_LOG_PATH) {
  if (!filePath || logs.length === 0) {
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, logs.map((log) => JSON.stringify(log)).join("\n") + "\n", "utf8");
}
