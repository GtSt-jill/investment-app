import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "auto-trading-run.mjs");

describe("auto trading scheduled runner", () => {
  it("does not call the API when mode is off", async () => {
    const lockPath = await tempLockPath();
    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        AUTO_TRADING_API_URL: "http://127.0.0.1:1/should-not-be-called",
        AUTO_TRADING_MODE: "off",
        AUTO_TRADING_LOCK_PATH: lockPath,
        AUTO_TRADING_SKIP_MARKET_CLOSED: "false"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      status: "skipped",
      reason: "AUTO_TRADING_MODE is off."
    });
  });

  it("rejects scheduled live mode", async () => {
    const lockPath = await tempLockPath();

    await expect(
      execFileAsync(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          AUTO_TRADING_API_URL: "http://127.0.0.1:1/should-not-be-called",
          AUTO_TRADING_MODE: "live",
          AUTO_TRADING_LOCK_PATH: lockPath,
          AUTO_TRADING_SKIP_MARKET_CLOSED: "false"
        }
      })
    ).rejects.toMatchObject({ code: 1 });
  });

  it("posts to the trading run API and prints a compact summary", async () => {
    const { url, close } = await startTradingRunServer();
    const lockPath = await tempLockPath();
    try {
      const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          AUTO_TRADING_API_URL: url,
          AUTO_TRADING_MODE: "dry-run",
          AUTO_TRADING_LOCK_PATH: lockPath,
          AUTO_TRADING_SKIP_MARKET_CLOSED: "false"
        }
      });

      expect(JSON.parse(stdout)).toEqual({
        status: "completed",
        mode: "dry-run",
        runId: "run-1",
        planned: 1,
        blocked: 2,
        submitted: 0
      });
    } finally {
      await close();
    }
  });

  it("exits without calling the API when an active lock exists", async () => {
    const { url, close } = await startTradingRunServer();
    const lockPath = await tempLockPath();
    await writeFile(lockPath, JSON.stringify({ pid: 99999, createdAt: new Date().toISOString() }), "utf8");

    try {
      await expect(
        execFileAsync(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            AUTO_TRADING_API_URL: url,
            AUTO_TRADING_MODE: "dry-run",
            AUTO_TRADING_LOCK_PATH: lockPath,
            AUTO_TRADING_SKIP_MARKET_CLOSED: "false"
          }
        })
      ).rejects.toMatchObject({ code: 2 });
    } finally {
      await close();
    }
  });
});

async function tempLockPath() {
  const dir = await mkdtemp(join(tmpdir(), "auto-trading-lock-"));
  return join(dir, "run.lock");
}

async function startTradingRunServer() {
  const server = createServer((request, response) => {
    expect(request.method).toBe("POST");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      run: { id: "run-1", mode: "dry-run" },
      summary: { plannedCount: 1, blockedCount: 2 },
      submissions: []
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to bind test server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/api/trading/run`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
