#!/usr/bin/env node

import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_API_URL = "http://localhost:3000/api/analysis/snapshots";
const DEFAULT_LOCK_PATH = join(process.cwd(), "data", "analysis-history.lock");
const DEFAULT_LOCK_TTL_MS = 45 * 60 * 1000;
const ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function main() {
  const config = readConfig();

  const lock = await acquireLock(config.lockPath, config.lockTtlMs);
  if (lock.lockPath === null) {
    return;
  }

  try {
    if (config.skipClosedMarket && !isUsMarketOpenDate(new Date())) {
      console.log(JSON.stringify({ status: "skipped", reason: "US market calendar guard blocked this run." }));
      return;
    }

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(config))
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(JSON.stringify({ status: "failed", statusCode: response.status, payload }));
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify({
        status: "completed",
        snapshotId: payload.snapshot?.id,
        asOf: payload.snapshot?.asOf,
        created: payload.created,
        revision: payload.snapshot?.revision,
        symbolCount: payload.snapshot?.symbolCount
      })
    );
  } finally {
    await releaseLock(lock);
  }
}

function readConfig() {
  return {
    apiUrl: process.env.ANALYSIS_HISTORY_API_URL ?? DEFAULT_API_URL,
    symbols: parseSymbols(process.env.ANALYSIS_HISTORY_SCHEDULE_SYMBOLS),
    lookbackDays: parseNumber(process.env.ANALYSIS_HISTORY_LOOKBACK_DAYS, 520),
    lockPath: process.env.ANALYSIS_HISTORY_LOCK_PATH ?? DEFAULT_LOCK_PATH,
    lockTtlMs: parseNumber(process.env.ANALYSIS_HISTORY_LOCK_TTL_MS, DEFAULT_LOCK_TTL_MS),
    skipClosedMarket: process.env.ANALYSIS_HISTORY_SKIP_MARKET_CLOSED !== "false",
    force: process.env.ANALYSIS_HISTORY_FORCE === "true"
  };
}

function buildRequestBody(config) {
  return {
    source: "scheduled",
    ...(config.symbols.length > 0 ? { symbols: config.symbols } : {}),
    lookbackDays: config.lookbackDays,
    force: config.force
  };
}

async function acquireLock(lockPath, ttlMs) {
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, ownerToken, createdAt: new Date().toISOString() }));
    await handle.close();
    return { lockPath };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existingLock = await readLock(lockPath);
    if (!isStaleLock(existingLock, ttlMs)) {
      console.error(JSON.stringify({ status: "skipped", reason: "Another analysis snapshot run is already active.", lockPath }));
      process.exitCode = 2;
      return { lockPath: null };
    }

    const latestLock = await readLock(lockPath);
    if (latestLock.ownerToken !== existingLock.ownerToken || latestLock.createdAt !== existingLock.createdAt) {
      console.error(JSON.stringify({ status: "skipped", reason: "Lock changed while checking staleness.", lockPath }));
      process.exitCode = 2;
      return { lockPath: null };
    }

    await rm(lockPath, { force: true });
    return acquireLock(lockPath, ttlMs);
  }
}

async function releaseLock(lock) {
  if (lock.lockPath) {
    const currentLock = await readLock(lock.lockPath);
    if (currentLock.ownerToken === ownerToken) {
      await rm(lock.lockPath, { force: true });
    }
  }
}

async function readLock(lockPath) {
  try {
    const payload = JSON.parse(await readFile(lockPath, "utf8"));
    return {
      ownerToken: typeof payload.ownerToken === "string" ? payload.ownerToken : "",
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : ""
    };
  } catch {
    return { ownerToken: "", createdAt: "" };
  }
}

function isStaleLock(lock, ttlMs) {
  const createdAt = Date.parse(lock.createdAt);
  return !Number.isFinite(createdAt) || Date.now() - createdAt > ttlMs;
}

function isUsMarketOpenDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;

  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  return !marketHolidays(year).has(dateKey(year, month, day));
}

function marketHolidays(year) {
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    goodFriday(year),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ]);
}

function observedFixedHoliday(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  } else if (weekday === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (occurrence - 1) * 7);
  return dateKey(year, month, date.getUTCDate());
}

function lastWeekdayOfMonth(year, month, weekday) {
  const date = new Date(Date.UTC(year, month, 0));
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return dateKey(year, month, date.getUTCDate());
}

function goodFriday(year) {
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  return dateKey(year, easter.getUTCMonth() + 1, easter.getUTCDate());
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSymbols(value) {
  if (!value) {
    return [];
  }

  return Array.from(new Set(value.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown scheduler error." }));
  process.exitCode = 1;
});
