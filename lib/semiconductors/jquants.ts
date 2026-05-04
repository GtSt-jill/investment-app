import type { PriceBar } from "@/lib/semiconductors/types";

const DEFAULT_JQUANTS_BASE_URL = "https://api.jquants.com";
const DEFAULT_JQUANTS_API_VERSION = "v2";
const DEFAULT_JQUANTS_MAX_RETRIES = 4;
const DEFAULT_JQUANTS_RETRY_DELAY_MS = 2500;

interface JQuantsAuthUserResponse {
  refreshToken?: string;
  idToken?: string;
  message?: string;
}

interface JQuantsAuthRefreshResponse {
  idToken?: string;
  message?: string;
}

interface JQuantsDailyQuote {
  Date?: string;
  Code?: string;
  Open?: number | null;
  High?: number | null;
  Low?: number | null;
  Close?: number | null;
  Volume?: number | null;
  AdjustmentOpen?: number | null;
  AdjustmentHigh?: number | null;
  AdjustmentLow?: number | null;
  AdjustmentClose?: number | null;
  AdjustmentVolume?: number | null;
  O?: number | null;
  H?: number | null;
  L?: number | null;
  C?: number | null;
  Vo?: number | null;
  AdjO?: number | null;
  AdjH?: number | null;
  AdjL?: number | null;
  AdjC?: number | null;
  AdjVo?: number | null;
}

interface JQuantsDailyQuotesResponse {
  data?: JQuantsDailyQuote[];
  daily_quotes?: JQuantsDailyQuote[];
  pagination_key?: string;
  message?: string;
}

interface JQuantsCredentials {
  apiKey?: string;
  idToken?: string;
  refreshToken?: string;
  mailAddress?: string;
  password?: string;
}

export function hasJQuantsCredentials() {
  const credentials = getJQuantsCredentials();
  return Boolean(credentials.apiKey || credentials.idToken || credentials.refreshToken || (credentials.mailAddress && credentials.password));
}

export async function fetchJQuantsDailyBars(symbols: string[], lookbackDays = 420) {
  const credentials = getJQuantsCredentials();
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);
  const entries: Array<readonly [string, PriceBar[]]> = [];

  for (const symbol of symbols) {
    entries.push([symbol, await fetchJQuantsDailyBarsForSymbol(symbol, credentials, startDate, endDate)] as const);
  }

  return Object.fromEntries(entries);
}

async function fetchJQuantsDailyBarsForSymbol(
  symbol: string,
  credentials: JQuantsCredentials,
  startDate: Date,
  endDate: Date
): Promise<PriceBar[]> {
  const bars: PriceBar[] = [];
  const configuredRange = getConfiguredAvailableDateRange();
  let requestStartDate = configuredRange?.from && configuredRange.from > startDate ? configuredRange.from : startDate;
  let requestEndDate = configuredRange?.to && configuredRange.to < endDate ? configuredRange.to : endDate;
  let paginationKey: string | null = null;
  let retriedWithSubscriptionRange = false;

  if (requestStartDate > requestEndDate) {
    return [];
  }

  do {
    const url = new URL(getDailyBarsPath(), getJQuantsBaseUrl());
    url.searchParams.set("code", toJQuantsIssueCode(symbol));
    url.searchParams.set("from", toIsoDate(requestStartDate));
    url.searchParams.set("to", toIsoDate(requestEndDate));
    if (paginationKey) {
      url.searchParams.set("pagination_key", paginationKey);
    }

    const response = await fetchJQuantsWithRetry(url, credentials, symbol);

    if (!response.ok) {
      const body = await response.text();
      const subscriptionRange = parseSubscriptionDateRange(body);
      if (response.status === 400 && subscriptionRange && !retriedWithSubscriptionRange) {
        const clippedStartDate = subscriptionRange.from > requestStartDate ? subscriptionRange.from : requestStartDate;
        const clippedEndDate = subscriptionRange.to < requestEndDate ? subscriptionRange.to : requestEndDate;
        requestStartDate = clippedStartDate <= clippedEndDate ? clippedStartDate : subscriptionRange.from;
        requestEndDate = clippedStartDate <= clippedEndDate ? clippedEndDate : subscriptionRange.to;
        paginationKey = null;
        bars.length = 0;
        retriedWithSubscriptionRange = true;
        continue;
      }

      throw new Error(`J-Quants daily bars request failed for ${symbol} (${response.status}): ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as JQuantsDailyQuotesResponse;
    bars.push(...getDailyQuoteRows(payload).map(toPriceBar).filter((bar): bar is PriceBar => bar !== null));
    paginationKey = payload.pagination_key ?? null;
  } while (paginationKey);

  return bars.sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchJQuantsWithRetry(url: URL, credentials: JQuantsCredentials, symbol: string) {
  const maxRetries = getPositiveIntegerEnv("JQUANTS_MAX_RETRIES", DEFAULT_JQUANTS_MAX_RETRIES);
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      headers: await getJQuantsHeaders(credentials),
      next: { revalidate: 60 * 30 }
    });

    if (response.ok || !isRetryableStatus(response.status) || attempt === maxRetries) {
      return response;
    }

    lastResponse = response;
    await response.arrayBuffer().catch(() => undefined);
    await sleep(getRetryDelayMs(response, attempt));
  }

  return lastResponse ?? fetch(url, {
    headers: await getJQuantsHeaders(credentials),
    next: { revalidate: 60 * 30 }
  }).catch((error) => {
    throw new Error(`J-Quants daily bars request failed for ${symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
  });
}

async function getJQuantsHeaders(credentials: JQuantsCredentials): Promise<Record<string, string>> {
  if (credentials.apiKey) {
    return {
      "x-api-key": credentials.apiKey
    };
  }

  return {
    Authorization: `Bearer ${await getJQuantsIdToken(credentials)}`
  };
}

async function getJQuantsIdToken(credentials: JQuantsCredentials) {
  if (credentials.idToken) {
    return credentials.idToken;
  }

  const refreshToken = credentials.refreshToken ?? (await fetchJQuantsRefreshToken(credentials));
  if (!refreshToken) {
    throw new Error(
      "J-Quants credentials are missing. Set JQUANTS_API_KEY for V2, or legacy JQUANTS_ID_TOKEN, JQUANTS_REFRESH_TOKEN, or JQUANTS_MAIL_ADDRESS and JQUANTS_PASSWORD."
    );
  }

  const url = new URL("/v1/token/auth_refresh", getJQuantsBaseUrl());
  url.searchParams.set("refreshtoken", refreshToken);
  const response = await fetch(url, { method: "POST" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`J-Quants ID token request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = (await response.json()) as JQuantsAuthRefreshResponse;
  if (!payload.idToken) {
    throw new Error(`J-Quants ID token response did not include idToken: ${payload.message ?? "Unknown error."}`);
  }

  return payload.idToken;
}

async function fetchJQuantsRefreshToken(credentials: JQuantsCredentials) {
  if (!credentials.mailAddress || !credentials.password) {
    return undefined;
  }

  const response = await fetch(new URL("/v1/token/auth_user", getJQuantsBaseUrl()), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mailaddress: credentials.mailAddress,
      password: credentials.password
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`J-Quants refresh token request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = (await response.json()) as JQuantsAuthUserResponse;
  return payload.refreshToken;
}

function getDailyQuoteRows(payload: JQuantsDailyQuotesResponse) {
  return payload.data ?? payload.daily_quotes ?? [];
}

function toPriceBar(quote: JQuantsDailyQuote): PriceBar | null {
  const open = quote.AdjO ?? quote.AdjustmentOpen ?? quote.O ?? quote.Open;
  const high = quote.AdjH ?? quote.AdjustmentHigh ?? quote.H ?? quote.High;
  const low = quote.AdjL ?? quote.AdjustmentLow ?? quote.L ?? quote.Low;
  const close = quote.AdjC ?? quote.AdjustmentClose ?? quote.C ?? quote.Close;
  const volume = quote.AdjVo ?? quote.AdjustmentVolume ?? quote.Vo ?? quote.Volume;

  if (!quote.Date || open === null || open === undefined || high === null || high === undefined || low === null || low === undefined) {
    return null;
  }
  if (close === null || close === undefined || volume === null || volume === undefined) {
    return null;
  }

  return {
    date: quote.Date,
    open,
    high,
    low,
    close,
    volume
  };
}

function getDailyBarsPath() {
  return getJQuantsApiVersion() === "v1" ? "/v1/prices/daily_quotes" : "/v2/equities/bars/daily";
}

function toJQuantsIssueCode(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.T$/, "");
}

function getJQuantsCredentials(): JQuantsCredentials {
  return {
    apiKey: process.env.JQUANTS_API_KEY,
    idToken: process.env.JQUANTS_ID_TOKEN,
    refreshToken: process.env.JQUANTS_REFRESH_TOKEN ?? process.env.JQUANTS_API_REFRESH_TOKEN,
    mailAddress: process.env.JQUANTS_MAIL_ADDRESS ?? process.env.JQUANTS_EMAIL ?? process.env.JQUANTS_API_MAIL_ADDRESS,
    password: process.env.JQUANTS_PASSWORD ?? process.env.JQUANTS_API_PASSWORD
  };
}

function getJQuantsBaseUrl() {
  return process.env.JQUANTS_BASE_URL ?? DEFAULT_JQUANTS_BASE_URL;
}

function getJQuantsApiVersion() {
  return process.env.JQUANTS_API_VERSION === "v1" ? "v1" : DEFAULT_JQUANTS_API_VERSION;
}

function getConfiguredAvailableDateRange() {
  const from = parseIsoDate(process.env.JQUANTS_AVAILABLE_FROM);
  const to = parseIsoDate(process.env.JQUANTS_AVAILABLE_TO);
  return from || to ? { from, to } : null;
}

function parseSubscriptionDateRange(body: string) {
  const match = body.match(/covers the following dates:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  const from = parseIsoDate(match?.[1]);
  const to = parseIsoDate(match?.[2]);
  return from && to ? { from, to } : null;
}

function parseIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelayMs(response: Response, attempt: number) {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  const baseDelayMs = getPositiveIntegerEnv("JQUANTS_RETRY_DELAY_MS", DEFAULT_JQUANTS_RETRY_DELAY_MS);
  return baseDelayMs * 2 ** attempt;
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function getPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
