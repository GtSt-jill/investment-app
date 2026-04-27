import type { AlpacaOrderRequest, OpenOrderSnapshot, TradeSide } from "./types";

const DEFAULT_ALPACA_TRADING_BASE_URL = "https://paper-api.alpaca.markets";
const LIVE_ALPACA_TRADING_HOST = "api.alpaca.markets";
const ERROR_BODY_SLICE_LENGTH = 240;

interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

type AlpacaOrderResponse = Record<string, unknown>;

export interface AlpacaTradingClientOptions {
  baseUrl?: string;
  allowLive?: boolean;
}

export type SubmitAlpacaOrderOptions = AlpacaTradingClientOptions;

export interface AlpacaSubmittedOrderSnapshot {
  id?: string;
  clientOrderId?: string;
  symbol: string;
  side?: TradeSide;
  type?: string;
  orderClass?: string;
  status?: string;
  quantity?: number;
  notional?: number;
  limitPrice?: number;
  stopPrice?: number;
  submittedAt?: string;
}

export interface AlpacaOrderSubmissionLog {
  id: string;
  alpacaOrderId?: string;
  clientOrderId: string;
  symbol: string;
  side: TradeSide;
  status?: string;
  submittedAt?: string;
  createdAt: string;
  request: AlpacaOrderRequest;
  response: AlpacaSubmittedOrderSnapshot;
}

export async function fetchOpenAlpacaOrders(options: AlpacaTradingClientOptions = {}): Promise<OpenOrderSnapshot[]> {
  const baseUrl = getTradingBaseUrl(options);
  if (isLiveTradingBaseUrl(baseUrl) && options.allowLive !== true) {
    throw new Error("Refusing to fetch Alpaca open orders from live trading API. Pass allowLive: true to use the live base URL.");
  }
  const payload = await fetchAlpacaTradingApi<unknown>("/v2/orders?status=open&nested=false", {
    method: "GET",
    baseUrl
  });

  if (!Array.isArray(payload)) {
    throw new Error("Alpaca open orders response was not an array.");
  }

  return payload.map((order) => normalizeOpenOrder(order)).filter((order) => order.symbol.length > 0);
}

export async function submitAlpacaOrder(
  request: AlpacaOrderRequest,
  options: SubmitAlpacaOrderOptions = {}
): Promise<AlpacaOrderSubmissionLog> {
  validateAlpacaOrderRequest(request);
  const baseUrl = getTradingBaseUrl(options);
  if (isLiveTradingBaseUrl(baseUrl) && options.allowLive !== true) {
    throw new Error("Refusing to submit Alpaca order to live trading API. Pass allowLive: true to submit to the live base URL.");
  }

  const payload = await fetchAlpacaTradingApi<unknown>("/v2/orders", {
    method: "POST",
    baseUrl,
    body: JSON.stringify(request)
  });
  if (!isRecord(payload)) {
    throw new Error("Alpaca submitted order response was not an object.");
  }

  const response = normalizeSubmittedOrder(payload, request);
  const clientOrderId = response.clientOrderId ?? request.client_order_id;

  return {
    id: clientOrderId,
    alpacaOrderId: response.id,
    clientOrderId,
    symbol: response.symbol,
    side: response.side ?? request.side,
    status: response.status,
    submittedAt: response.submittedAt,
    createdAt: new Date().toISOString(),
    request: normalizeOrderRequest(request),
    response
  };
}

export function validateAlpacaOrderRequest(request: AlpacaOrderRequest) {
  if (!request.symbol || !request.side || !request.type || !request.qty || Number(request.qty) <= 0) {
    throw new Error("Invalid Alpaca order request: symbol, side, type, and positive qty are required.");
  }
  if ((request.type === "limit" || request.type === "stop_limit") && !request.limit_price) {
    throw new Error("Invalid Alpaca order request: limit orders require limit_price.");
  }
  if (request.type === "stop_limit" && !request.stop_price) {
    throw new Error("Invalid Alpaca order request: stop_limit orders require stop_price.");
  }
  if (request.order_class === "bracket" && (!request.take_profit?.limit_price || !request.stop_loss?.stop_price)) {
    throw new Error("Invalid Alpaca order request: bracket orders require take_profit.limit_price and stop_loss.stop_price.");
  }
}

async function fetchAlpacaTradingApi<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    baseUrl: string;
    body?: string;
  }
): Promise<T> {
  const credentials = getAlpacaCredentials();
  const url = new URL(path, init.baseUrl);
  const response = await fetch(url, {
    method: init.method,
    headers: {
      "APCA-API-KEY-ID": credentials.keyId,
      "APCA-API-SECRET-KEY": credentials.secretKey,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: init.body,
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const bodySlice = body.slice(0, ERROR_BODY_SLICE_LENGTH) || "<empty body>";
    throw new Error(`Alpaca trading ${init.method} ${url.pathname}${url.search} failed (${response.status}): ${bodySlice}`);
  }

  return response.json() as Promise<T>;
}

function normalizeOpenOrder(payload: unknown): OpenOrderSnapshot {
  const order = isRecord(payload) ? payload : {};
  const symbol = toOptionalString(order.symbol)?.toUpperCase() ?? "";

  return {
    id: toOptionalString(order.id),
    clientOrderId: toOptionalString(order.client_order_id),
    symbol,
    side: toTradeSide(order.side),
    status: toOptionalString(order.status),
    quantity: toOptionalNumber(order.qty),
    notional: toOptionalNumber(order.notional),
    submittedAt: toOptionalString(order.submitted_at)
  };
}

function normalizeSubmittedOrder(payload: AlpacaOrderResponse, request: AlpacaOrderRequest): AlpacaSubmittedOrderSnapshot {
  return {
    id: toOptionalString(payload.id),
    clientOrderId: toOptionalString(payload.client_order_id) ?? request.client_order_id,
    symbol: toOptionalString(payload.symbol)?.toUpperCase() ?? request.symbol.toUpperCase(),
    side: toTradeSide(payload.side) ?? request.side,
    type: toOptionalString(payload.type),
    orderClass: toOptionalString(payload.order_class),
    status: toOptionalString(payload.status),
    quantity: toOptionalNumber(payload.qty),
    notional: toOptionalNumber(payload.notional),
    limitPrice: toOptionalNumber(payload.limit_price),
    stopPrice: toOptionalNumber(payload.stop_price),
    submittedAt: toOptionalString(payload.submitted_at)
  };
}

function normalizeOrderRequest(request: AlpacaOrderRequest): AlpacaOrderRequest {
  return {
    symbol: request.symbol,
    side: request.side,
    type: request.type,
    time_in_force: request.time_in_force,
    qty: request.qty,
    ...(request.limit_price === undefined ? {} : { limit_price: request.limit_price }),
    ...(request.stop_price === undefined ? {} : { stop_price: request.stop_price }),
    ...(request.order_class === undefined ? {} : { order_class: request.order_class }),
    ...(request.take_profit === undefined ? {} : { take_profit: { ...request.take_profit } }),
    ...(request.stop_loss === undefined ? {} : { stop_loss: { ...request.stop_loss } }),
    client_order_id: request.client_order_id
  };
}

function getTradingBaseUrl(options: AlpacaTradingClientOptions) {
  return options.baseUrl ?? process.env.ALPACA_TRADING_BASE_URL ?? DEFAULT_ALPACA_TRADING_BASE_URL;
}

function isLiveTradingBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname === LIVE_ALPACA_TRADING_HOST;
  } catch {
    return false;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toTradeSide(value: unknown): TradeSide | undefined {
  return value === "buy" || value === "sell" ? value : undefined;
}
