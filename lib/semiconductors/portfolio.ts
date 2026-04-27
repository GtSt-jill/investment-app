export interface AlpacaAccountSnapshot {
  id?: string;
  accountNumber?: string;
  status?: string;
  currency: string;
  buyingPower: number;
  cash: number;
  portfolioValue: number;
  equity: number;
  lastEquity: number;
  longMarketValue: number;
  shortMarketValue: number;
  initialMargin: number;
  maintenanceMargin: number;
  dayPnl: number;
  dayPnlPct: number | null;
  tradingBlocked: boolean;
  transfersBlocked: boolean;
  accountBlocked: boolean;
  patternDayTrader: boolean;
}

export interface AlpacaPositionSnapshot {
  symbol: string;
  assetClass?: string;
  side: string;
  quantity: number;
  marketValue: number;
  costBasis: number;
  averageEntryPrice: number;
  currentPrice: number;
  lastDayPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  unrealizedIntradayPnl: number;
  unrealizedIntradayPnlPct: number | null;
  allocationPct: number | null;
}

export interface PortfolioSnapshot {
  generatedAt: string;
  account: AlpacaAccountSnapshot;
  positions: AlpacaPositionSnapshot[];
  summary: {
    positionCount: number;
    longExposure: number;
    shortExposure: number;
    cashAllocationPct: number | null;
    largestPositionSymbol: string | null;
    largestPositionAllocationPct: number | null;
    totalUnrealizedPnl: number;
    totalUnrealizedPnlPct: number | null;
  };
  notes: string[];
}

interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

type AlpacaAccountResponse = Record<string, unknown>;
type AlpacaPositionResponse = Record<string, unknown>;

export async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const [accountPayload, positionsPayload] = await Promise.all([
    fetchTradingApi<AlpacaAccountResponse>("/v2/account"),
    fetchTradingApi<AlpacaPositionResponse[]>("/v2/positions")
  ]);
  const account = normalizeAccount(accountPayload);
  const positions = positionsPayload
    .map((position) => normalizePosition(position, account.portfolioValue))
    .sort((left, right) => Math.abs(right.marketValue) - Math.abs(left.marketValue));
  const totalUnrealizedPnl = positions.reduce((total, position) => total + position.unrealizedPnl, 0);
  const totalCostBasis = positions.reduce((total, position) => total + Math.abs(position.costBasis), 0);
  const largestPosition = positions[0];

  return {
    generatedAt: new Date().toISOString(),
    account,
    positions,
    summary: {
      positionCount: positions.length,
      longExposure: positions.filter((position) => position.marketValue > 0).reduce((total, position) => total + position.marketValue, 0),
      shortExposure: positions.filter((position) => position.marketValue < 0).reduce((total, position) => total + Math.abs(position.marketValue), 0),
      cashAllocationPct: account.portfolioValue > 0 ? account.cash / account.portfolioValue : null,
      largestPositionSymbol: largestPosition?.symbol ?? null,
      largestPositionAllocationPct: largestPosition?.allocationPct ?? null,
      totalUnrealizedPnl,
      totalUnrealizedPnlPct: totalCostBasis > 0 ? totalUnrealizedPnl / totalCostBasis : null
    },
    notes: [
      "Alpaca Trading API の account / positions エンドポイントから取得した口座情報です。",
      "ポジション価格は Alpaca 側の現在値フィールドに基づきます。約定可能価格とは異なる場合があります。"
    ]
  };
}

async function fetchTradingApi<T>(path: string): Promise<T> {
  const credentials = getAlpacaCredentials();
  const baseUrl = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets";
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": credentials.keyId,
      "APCA-API-SECRET-KEY": credentials.secretKey
    },
    next: { revalidate: 60 }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Alpaca trading request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  return response.json() as Promise<T>;
}

function normalizeAccount(payload: AlpacaAccountResponse): AlpacaAccountSnapshot {
  const equity = toNumber(payload.equity);
  const lastEquity = toNumber(payload.last_equity);
  const dayPnl = equity - lastEquity;

  return {
    id: toOptionalString(payload.id),
    accountNumber: toOptionalString(payload.account_number),
    status: toOptionalString(payload.status),
    currency: toOptionalString(payload.currency) ?? "USD",
    buyingPower: toNumber(payload.buying_power),
    cash: toNumber(payload.cash),
    portfolioValue: toNumber(payload.portfolio_value),
    equity,
    lastEquity,
    longMarketValue: toNumber(payload.long_market_value),
    shortMarketValue: toNumber(payload.short_market_value),
    initialMargin: toNumber(payload.initial_margin),
    maintenanceMargin: toNumber(payload.maintenance_margin),
    dayPnl,
    dayPnlPct: lastEquity > 0 ? dayPnl / lastEquity : null,
    tradingBlocked: toBoolean(payload.trading_blocked),
    transfersBlocked: toBoolean(payload.transfers_blocked),
    accountBlocked: toBoolean(payload.account_blocked),
    patternDayTrader: toBoolean(payload.pattern_day_trader)
  };
}

function normalizePosition(payload: AlpacaPositionResponse, portfolioValue: number): AlpacaPositionSnapshot {
  const marketValue = toNumber(payload.market_value);
  const costBasis = toNumber(payload.cost_basis);

  return {
    symbol: toOptionalString(payload.symbol) ?? "-",
    assetClass: toOptionalString(payload.asset_class),
    side: toOptionalString(payload.side) ?? "long",
    quantity: toNumber(payload.qty),
    marketValue,
    costBasis,
    averageEntryPrice: toNumber(payload.avg_entry_price),
    currentPrice: toNumber(payload.current_price),
    lastDayPrice: toNumber(payload.lastday_price),
    unrealizedPnl: toNumber(payload.unrealized_pl),
    unrealizedPnlPct: toNullableNumber(payload.unrealized_plpc),
    unrealizedIntradayPnl: toNumber(payload.unrealized_intraday_pl),
    unrealizedIntradayPnlPct: toNullableNumber(payload.unrealized_intraday_plpc),
    allocationPct: portfolioValue > 0 ? marketValue / portfolioValue : null
  };
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

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return toNumber(value);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toBoolean(value: unknown) {
  return value === true || value === "true";
}
