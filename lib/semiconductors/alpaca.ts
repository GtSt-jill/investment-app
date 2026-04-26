import type { PriceBar } from "@/lib/semiconductors/types";

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaBarsResponse {
  bars?: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
}

interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

export async function fetchDailyBars(symbols: string[], lookbackDays = 420) {
  const credentials = getAlpacaCredentials();
  const baseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
  const feed = process.env.ALPACA_DATA_FEED ?? "iex";
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);

  const barsBySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, [] as PriceBar[]]));
  let pageToken: string | null = null;

  do {
    const url = new URL("/v2/stocks/bars", baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("timeframe", "1Day");
    url.searchParams.set("start", toIsoDate(startDate));
    url.searchParams.set("end", toIsoDate(endDate));
    url.searchParams.set("adjustment", "all");
    url.searchParams.set("feed", feed);
    url.searchParams.set("limit", "10000");
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": credentials.keyId,
        "APCA-API-SECRET-KEY": credentials.secretKey
      },
      next: { revalidate: 60 * 10 }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Alpaca market data request failed (${response.status}): ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as AlpacaBarsResponse;
    for (const [symbol, bars] of Object.entries(payload.bars ?? {})) {
      barsBySymbol[symbol] = [
        ...(barsBySymbol[symbol] ?? []),
        ...bars.map((bar) => ({
          date: bar.t.slice(0, 10),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v
        }))
      ];
    }
    pageToken = payload.next_page_token ?? null;
  } while (pageToken);

  return barsBySymbol;
}

function getAlpacaCredentials(): AlpacaCredentials {
  const keyId =
    process.env.APCA_API_KEY_ID ?? process.env.ALPACA_API_KEY_ID ?? process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID;
  const secretKey =
    process.env.APCA_API_SECRET_KEY ??
    process.env.ALPACA_API_SECRET_KEY ??
    process.env.ALPACA_SECRET_KEY ??
    process.env.ALPACA_API_SECRET;

  if (!keyId || !secretKey) {
    throw new Error(
      "Alpaca API credentials are missing. Set APCA_API_KEY_ID and APCA_API_SECRET_KEY, or ALPACA_API_KEY and ALPACA_API_SECRET."
    );
  }

  return { keyId, secretKey };
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
