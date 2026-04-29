import type { AlpacaPositionSnapshot, PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import type { MarketRegime, RecommendationItem, SignalAction } from "@/lib/semiconductors/types";
import type { TradingConfig, TradingMode } from "./config";

export type TradeIntent = "OPEN_LONG" | "ADD_LONG" | "REDUCE_LONG" | "CLOSE_LONG" | "NO_ACTION";
export type TradeSide = "buy" | "sell";
export type TradeSignalStance = "bullish" | "neutral" | "bearish";
export type TradeActionReason =
  | "BUY_SIGNAL"
  | "HOLD_SIGNAL"
  | "SELL_AVOID_NEW_BUY"
  | "STOP_LOSS_EXIT"
  | "SEVERE_SELL_EXIT"
  | "WEAK_SELL_REDUCE"
  | "DEFENSIVE_REGIME_REDUCE"
  | "OVER_ALLOCATION_REDUCE";
export type TradeExitReason = "STOP_LOSS" | "SEVERE_SELL_SIGNAL" | "WEAK_SELL_SIGNAL" | "DEFENSIVE_REGIME" | "OVER_ALLOCATION";
export type TradeScoreGate = "passed" | "blocked" | "not_applicable";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "bracket";
export type TradePlanStatus = "planned" | "blocked" | "submitted" | "filled" | "rejected" | "cancelled";
export type BlockReasonSeverity = "info" | "warning" | "error";
export type BlockReasonSource = "system" | "account" | "portfolio" | "symbol" | "signal" | "sizing" | "orders";

export interface TradeBlockReason {
  code: string;
  message: string;
  severity: BlockReasonSeverity;
  source: BlockReasonSource;
}

export interface OpenOrderSnapshot {
  id?: string;
  clientOrderId?: string;
  symbol: string;
  side?: TradeSide;
  status?: string;
  quantity?: number;
  notional?: number;
  submittedAt?: string;
}

export interface TradeIntentCandidate {
  symbol: string;
  recommendation: RecommendationItem;
  position: AlpacaPositionSnapshot | null;
  intent: TradeIntent;
  side: TradeSide | null;
  action: SignalAction;
  stance: TradeSignalStance;
  actionReason: TradeActionReason;
  exitReason: TradeExitReason | null;
  scoreGate: TradeScoreGate;
  entryScoreThreshold: number | null;
  severeSellExitScoreThreshold: number | null;
  score: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  targetEntryPrice: number | null;
  existingAllocationPct: number;
  isNewEntry: boolean;
  reasons: string[];
  blockReasons: TradeBlockReason[];
}

export interface SizingResult {
  quantity: number;
  notional: number;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskAmount: number;
  riskPerShare: number | null;
  quantityByRisk: number | null;
  quantityByAllocation: number | null;
  quantityByBuyingPower: number | null;
  blockReasons: TradeBlockReason[];
}

export interface TradePlan {
  id: string;
  runId: string;
  symbol: string;
  intent: TradeIntent;
  side: TradeSide | null;
  action: SignalAction;
  score: number;
  quantity: number;
  notional: number;
  orderType: OrderType;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: TradePlanStatus;
  blockReasons: string[];
  blockReasonDetails: TradeBlockReason[];
  reasons: string[];
  recommendationRank: number;
  relativeStrengthRank: number;
}

export interface AlpacaOrderRequest {
  symbol: string;
  side: TradeSide;
  type: Exclude<OrderType, "bracket"> | "limit";
  time_in_force: "day";
  qty: string;
  limit_price?: string;
  stop_price?: string;
  order_class?: "simple" | "bracket";
  take_profit?: {
    limit_price: string;
  };
  stop_loss?: {
    stop_price: string;
  };
  client_order_id: string;
}

export interface TradingRunSummary {
  planCount: number;
  plannedCount: number;
  blockedCount: number;
  buyNotional: number;
  sellNotional: number;
  newEntryCount: number;
}

export type TradingRunStatus = "completed" | "failed";

export interface TradingRunRecord {
  id: string;
  mode: TradingMode;
  asOf: string;
  generatedAt: string;
  status: TradingRunStatus;
  marketRegime: MarketRegime;
  portfolioValue: number;
  notes: string[];
}

export interface TradingDryRunResult {
  run: TradingRunRecord;
  config: TradingConfig;
  portfolio: Pick<PortfolioSnapshot, "generatedAt" | "summary">;
  plans: TradePlan[];
  orders: AlpacaOrderRequest[];
  summary: TradingRunSummary;
  notes: string[];
}

export interface TradeOrderSubmission {
  planId: string;
  clientOrderId: string;
  symbol: string;
  side: TradeSide;
  status: "submitted" | "failed" | "skipped";
  alpacaOrderId?: string;
  alpacaStatus?: string;
  error?: string;
}

export interface TradeOrderLog {
  id: string;
  planId: string;
  runId: string;
  alpacaOrderId?: string;
  request: AlpacaOrderRequest;
  response?: unknown;
  error?: string;
  createdAt: string;
}

export interface TradingPaperRunResult extends TradingDryRunResult {
  submissions: TradeOrderSubmission[];
  orderLogs: TradeOrderLog[];
}
