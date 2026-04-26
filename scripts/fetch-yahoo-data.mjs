import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SYMBOLS = ["SPY", "QQQ", "VTI", "IEF", "GLD", "SHY"];
const OUTPUT_DIR = path.join(process.cwd(), "data");
const BASE_URL = "https://query2.finance.yahoo.com/v8/finance/chart";

await mkdir(OUTPUT_DIR, { recursive: true });

for (const symbol of SYMBOLS) {
  const url = `${BASE_URL}/${symbol}?range=6y&interval=1d&includeAdjustedClose=true`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${symbol}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? [];

  if (!timestamps.length || !closes.length) {
    throw new Error(`No usable price data returned for ${symbol}.`);
  }

  const rows = ["date,close"];

  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number" || !Number.isFinite(close)) {
      return;
    }

    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    rows.push(`${date},${close.toFixed(4)}`);
  });

  await writeFile(path.join(OUTPUT_DIR, `${symbol}.csv`), rows.join("\n"));
  console.log(`Wrote ${symbol}.csv (${rows.length - 1} rows)`);
}
