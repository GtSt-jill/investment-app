import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "save-analysis-snapshot.mjs");

describe("analysis snapshot scheduled runner", () => {
  it("posts to the snapshot API with scheduled source and prints a compact summary", async () => {
    const requests: unknown[] = [];
    const { url, close } = await startSnapshotServer(requests);
    const lockPath = await tempLockPath();

    try {
      const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          ANALYSIS_HISTORY_API_URL: url,
          ANALYSIS_HISTORY_LOCK_PATH: lockPath,
          ANALYSIS_HISTORY_SKIP_MARKET_CLOSED: "false",
          ANALYSIS_HISTORY_SCHEDULE_SYMBOLS: " nvda, AMD,nvda ",
          ANALYSIS_HISTORY_LOOKBACK_DAYS: "390",
          ANALYSIS_HISTORY_FORCE: "true"
        }
      });

      expect(requests).toEqual([
        {
          source: "scheduled",
          symbols: ["NVDA", "AMD"],
          lookbackDays: 390,
          force: true
        }
      ]);
      expect(JSON.parse(stdout)).toEqual({
        status: "completed",
        snapshotId: "analysis_1",
        asOf: "2026-05-01",
        created: true,
        revision: 1,
        symbolCount: 2
      });
    } finally {
      await close();
    }
  });

  it("exits without calling the API when an active lock exists", async () => {
    const requests: unknown[] = [];
    const { url, close } = await startSnapshotServer(requests);
    const lockPath = await tempLockPath();
    await writeFile(lockPath, JSON.stringify({ pid: 99999, ownerToken: "active", createdAt: new Date().toISOString() }), "utf8");

    try {
      await expect(
        execFileAsync(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            ANALYSIS_HISTORY_API_URL: url,
            ANALYSIS_HISTORY_LOCK_PATH: lockPath,
            ANALYSIS_HISTORY_SKIP_MARKET_CLOSED: "false"
          }
        })
      ).rejects.toMatchObject({ code: 2 });
      expect(requests).toEqual([]);
    } finally {
      await close();
    }
  });

  it("returns a failed exit code when the snapshot API rejects the request", async () => {
    const { url, close } = await startSnapshotServer([], 500);
    const lockPath = await tempLockPath();

    try {
      await expect(
        execFileAsync(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            ANALYSIS_HISTORY_API_URL: url,
            ANALYSIS_HISTORY_LOCK_PATH: lockPath,
            ANALYSIS_HISTORY_SKIP_MARKET_CLOSED: "false"
          }
        })
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await close();
    }
  });
});

async function tempLockPath() {
  const dir = await mkdtemp(join(tmpdir(), "analysis-history-lock-"));
  return join(dir, "run.lock");
}

async function startSnapshotServer(requests: unknown[], statusCode = 200) {
  const server = createServer((request, response) => {
    expect(request.method).toBe("POST");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.writeHead(statusCode, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        snapshot: {
          id: "analysis_1",
          asOf: "2026-05-01",
          revision: 1,
          symbolCount: 2
        },
        created: true,
        result: {}
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to bind test server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/api/analysis/snapshots`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
