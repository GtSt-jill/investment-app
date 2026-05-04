import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJQuantsDailyBars } from "@/lib/semiconductors/jquants";
import { fetchMarketDailyBars } from "@/lib/semiconductors/market-data";
import type { SymbolProfile } from "@/lib/semiconductors/types";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("fetchMarketDailyBars", () => {
  it("keeps J-Quants symbols empty with a clear note when credentials are missing", async () => {
    vi.stubEnv("JQUANTS_ID_TOKEN", "");
    vi.stubEnv("JQUANTS_API_KEY", "");
    vi.stubEnv("JQUANTS_REFRESH_TOKEN", "");
    vi.stubEnv("JQUANTS_MAIL_ADDRESS", "");
    vi.stubEnv("JQUANTS_EMAIL", "");
    vi.stubEnv("JQUANTS_PASSWORD", "");

    const universe: SymbolProfile[] = [
      {
        symbol: "7203",
        name: "トヨタ自動車",
        segment: "日本主要株",
        category: "japan-core",
        dataProvider: "jquants"
      }
    ];

    const result = await fetchMarketDailyBars(["7203"], universe, 520, []);

    expect(result.barsBySymbol["7203"]).toEqual([]);
    expect(result.notes).toContain(
      "J-Quants credentials are not configured, so Japanese TSE symbols were excluded from this analysis."
    );
  });
});

describe("fetchJQuantsDailyBars", () => {
  it("uses J-Quants V2 API key auth and maps adjusted daily bar fields", async () => {
    vi.stubEnv("JQUANTS_API_KEY", "test-api-key");
    vi.stubEnv("JQUANTS_API_VERSION", "v2");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              Date: "2026-04-24",
              Code: "72030",
              AdjO: 3000,
              AdjH: 3050,
              AdjL: 2980,
              AdjC: 3040,
              AdjVo: 1_200_000
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJQuantsDailyBars(["7203"], 5000);

    expect(result["7203"]).toEqual([
      {
        date: "2026-04-24",
        open: 3000,
        high: 3050,
        low: 2980,
        close: 3040,
        volume: 1_200_000
      }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/v2/equities/bars/daily"
      }),
      expect.objectContaining({
        headers: {
          "x-api-key": "test-api-key"
        }
      })
    );
  });

  it("retries a rate-limited J-Quants request before failing the symbol", async () => {
    vi.stubEnv("JQUANTS_API_KEY", "test-api-key");
    vi.stubEnv("JQUANTS_API_VERSION", "v2");
    vi.stubEnv("JQUANTS_MAX_RETRIES", "1");
    vi.stubEnv("JQUANTS_RETRY_DELAY_MS", "0");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Rate limit exceeded. Please try again later." }), { status: 429 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                Date: "2026-04-24",
                Code: "67580",
                AdjO: 15000,
                AdjH: 15100,
                AdjL: 14900,
                AdjC: 15050,
                AdjVo: 2_300_000
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJQuantsDailyBars(["6758"], 10);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result["6758"]?.[0]).toMatchObject({
      date: "2026-04-24",
      close: 15050
    });
  });

  it("requests multiple Japanese symbols sequentially to avoid burst rate limits", async () => {
    vi.stubEnv("JQUANTS_API_KEY", "test-api-key");
    vi.stubEnv("JQUANTS_API_VERSION", "v2");
    const requestedCodes: string[] = [];
    const fetchMock = vi.fn(async (url: URL) => {
      requestedCodes.push(url.searchParams.get("code") ?? "");
      return new Response(
        JSON.stringify({
          data: [
            {
              Date: "2026-04-24",
              Code: `${url.searchParams.get("code")}0`,
              AdjO: 100,
              AdjH: 101,
              AdjL: 99,
              AdjC: 100,
              AdjVo: 1000
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchJQuantsDailyBars(["7203", "6758"], 10);

    expect(requestedCodes).toEqual(["7203", "6758"]);
  });

  it("uses configured J-Quants availability bounds before requesting data", async () => {
    vi.stubEnv("JQUANTS_API_KEY", "test-api-key");
    vi.stubEnv("JQUANTS_API_VERSION", "v2");
    vi.stubEnv("JQUANTS_AVAILABLE_FROM", "2024-02-09");
    vi.stubEnv("JQUANTS_AVAILABLE_TO", "2026-02-09");
    const requestedDates: Array<{ from: string; to: string }> = [];
    const fetchMock = vi.fn(async (url: URL) => {
      requestedDates.push({
        from: url.searchParams.get("from") ?? "",
        to: url.searchParams.get("to") ?? ""
      });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchJQuantsDailyBars(["7203"], 520);

    expect(requestedDates[0]?.to).toBe("2026-02-09");
  });
});
