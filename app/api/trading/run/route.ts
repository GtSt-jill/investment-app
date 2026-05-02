import { NextResponse } from "next/server";

import { runMarketAnalysis } from "@/lib/semiconductors/analysis-service";
import { fetchPortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import {
  appendTradeOrderLogs,
  createTradingRun,
  fetchOpenAlpacaOrders,
  submitAlpacaOrder,
  type OpenOrderSnapshot,
  type TradeSide,
  type TradingConfigInput,
  type TradingRiskProfile
} from "@/lib/semiconductors/trading";
import { appendTradingRunHistory, readTradingRunHistory } from "@/lib/semiconductors/trading/history";
import { evaluateLiveTradingReadiness, latestDryRunId } from "@/lib/semiconductors/trading/readiness";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<{
      mode: unknown;
      symbols: unknown;
      lookbackDays: unknown;
      config: unknown;
      riskProfile: unknown;
      openOrders: unknown;
      liveApproval: unknown;
    }>;
    const mode = coerceMode(payload.mode ?? process.env.AUTO_TRADING_MODE);
    if (mode === "live") {
      const history = await readTradingRunHistory(100);
      const readiness = evaluateLiveTradingReadiness(history, {
        liveEnabled: optionalBoolean(process.env.AUTO_TRADING_LIVE_ENABLED) === true,
        expectedConfirmationToken: optionalString(process.env.AUTO_TRADING_LIVE_CONFIRMATION_TOKEN),
        confirmationToken: liveApprovalString(payload.liveApproval, "confirmationToken"),
        approvedDryRunId: liveApprovalString(payload.liveApproval, "approvedDryRunId"),
        latestDryRunId: latestDryRunId(history)
      });

      return NextResponse.json(
        {
          error: readiness.ready
            ? "Live approval gates passed, but live order submission is still disabled in this build."
            : "Live trading approval requirements are not met.",
          readiness
        },
        { status: 400 }
      );
    }
    if (mode === "off") {
      return NextResponse.json({ error: "Auto-trading mode is off." }, { status: 400 });
    }

    const envConfig = configFromEnv();
    const requestConfig = mergeTradingConfig(coerceConfig(payload.config), {
      riskProfile: coerceRiskProfile(payload.riskProfile)
    });
    const config = mergeTradingConfig(envConfig, requestConfig);
    if (mode === "paper" && envConfig.paperTradingEnabled !== true) {
      return NextResponse.json({ error: "Paper trading is disabled. Set AUTO_TRADING_PAPER_ENABLED=true." }, { status: 400 });
    }

    const [analysisExecution, portfolio] = await Promise.all([
      runMarketAnalysis({
        symbols: payload.symbols,
        lookbackDays: payload.lookbackDays
      }),
      fetchPortfolioSnapshot()
    ]);
    const analysis = analysisExecution.result;
    const openOrders = mode === "paper" ? await fetchOpenAlpacaOrders() : coerceOpenOrders(payload.openOrders);
    const result = await createTradingRun({
      mode,
      analysis,
      portfolio,
      openOrders,
      config,
      submitOrder: (order) => submitAlpacaOrder(order)
    });
    if ("orderLogs" in result && Array.isArray(result.orderLogs)) {
      try {
        await appendTradeOrderLogs(result.orderLogs);
      } catch (logError) {
        const message = logError instanceof Error ? logError.message : "Failed to append order logs.";
        result.notes.push(`Order log persistence failed after paper execution: ${message}`);
        result.run.notes.push(`Order log persistence failed after paper execution: ${message}`);
      }
    }
    try {
      await appendTradingRunHistory(result);
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : "Failed to append trading run history.";
      result.notes.push(`Run history persistence failed: ${message}`);
      result.run.notes.push(`Run history persistence failed: ${message}`);
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run trading dry-run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function coerceMode(value: unknown) {
  if (value === undefined || value === null) {
    return "dry-run";
  }
  if (value === "dry-run" || value === "paper" || value === "live" || value === "off") {
    return value;
  }

  throw new Error("Invalid trading mode.");
}

function coerceOpenOrders(value: unknown): OpenOrderSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      id: optionalString(item.id),
      clientOrderId: optionalString(item.clientOrderId ?? item.client_order_id),
      symbol: optionalString(item.symbol)?.toUpperCase() ?? "",
      side: coerceSide(item.side),
      status: optionalString(item.status),
      quantity: optionalNumber(item.quantity ?? item.qty),
      notional: optionalNumber(item.notional),
      submittedAt: optionalString(item.submittedAt ?? item.submitted_at)
    }))
    .filter((item) => item.symbol.length > 0);
}

function coerceConfig(value: unknown): TradingConfigInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const risk =
    raw.risk !== null && typeof raw.risk === "object" && !Array.isArray(raw.risk)
      ? (raw.risk as Record<string, unknown>)
      : {};

  return {
    enabledSymbols: raw.enabledSymbols === null ? null : coerceOptionalSymbolList(raw.enabledSymbols),
    killSwitch: optionalBoolean(raw.killSwitch),
    paperTradingEnabled: optionalBoolean(raw.paperTradingEnabled),
    liveTradingEnabled: optionalBoolean(raw.liveTradingEnabled),
    useBracketOrders: optionalBoolean(raw.useBracketOrders),
    riskProfile: coerceRiskProfile(raw.riskProfile),
    risk: {
      riskPerTradePct: optionalNumber(risk.riskPerTradePct),
      maxPositionPct: optionalNumber(risk.maxPositionPct),
      maxSectorPct: optionalNumber(risk.maxSectorPct),
      maxDailyNewEntries: optionalNumber(risk.maxDailyNewEntries),
      maxDailyNotionalPct: optionalNumber(risk.maxDailyNotionalPct),
      minOrderNotional: optionalNumber(risk.minOrderNotional),
      maxAtrPct: optionalNumber(risk.maxAtrPct),
      minEntryScore: optionalNumber(risk.minEntryScore),
      addMinScore: optionalNumber(risk.addMinScore),
      sellScoreThreshold: optionalNumber(risk.sellScoreThreshold),
      severeSellExitScoreThreshold: optionalNumber(risk.severeSellExitScoreThreshold),
      weakHoldReduceScoreThreshold: optionalNumber(risk.weakHoldReduceScoreThreshold),
      topRelativeStrengthPct: optionalNumber(risk.topRelativeStrengthPct),
      maxEntryPricePremiumPct: optionalNumber(risk.maxEntryPricePremiumPct),
      maxEntrySma20PremiumPct: optionalNumber(risk.maxEntrySma20PremiumPct),
      maxEntryDayChangePct: optionalNumber(risk.maxEntryDayChangePct),
      minEntryRewardRiskRatio: optionalNumber(risk.minEntryRewardRiskRatio),
      neutralEntryScoreBuffer: optionalNumber(risk.neutralEntryScoreBuffer),
      unstableSignalScoreBuffer: optionalNumber(risk.unstableSignalScoreBuffer),
      minEntryScoreChange: optionalNumber(risk.minEntryScoreChange),
      minSignalStabilityAdjustment: optionalNumber(risk.minSignalStabilityAdjustment),
      reducePositionPct: optionalNumber(risk.reducePositionPct),
      allowAddToLosingPositions: optionalBoolean(risk.allowAddToLosingPositions),
      allowPatternDayTraderBuys: optionalBoolean(risk.allowPatternDayTraderBuys)
    }
  };
}

function configFromEnv(): TradingConfigInput {
  return {
    mode: coerceOptionalMode(process.env.AUTO_TRADING_MODE),
    enabledSymbols: coerceOptionalSymbolList(process.env.AUTO_TRADING_ALLOWED_SYMBOLS),
    killSwitch: optionalBoolean(process.env.AUTO_TRADING_KILL_SWITCH),
    paperTradingEnabled: optionalBoolean(process.env.AUTO_TRADING_PAPER_ENABLED),
    liveTradingEnabled: optionalBoolean(process.env.AUTO_TRADING_LIVE_ENABLED),
    useBracketOrders: optionalBoolean(process.env.AUTO_TRADING_USE_BRACKET_ORDERS),
    riskProfile: coerceRiskProfile(process.env.AUTO_TRADING_RISK_PROFILE),
    risk: {
      riskPerTradePct: optionalNumber(process.env.AUTO_TRADING_RISK_PER_TRADE_PCT),
      maxPositionPct: optionalNumber(process.env.AUTO_TRADING_MAX_POSITION_PCT),
      maxSectorPct: optionalNumber(process.env.AUTO_TRADING_MAX_SECTOR_PCT),
      maxDailyNewEntries: optionalNumber(process.env.AUTO_TRADING_MAX_DAILY_NEW_ENTRIES),
      maxDailyNotionalPct: optionalNumber(process.env.AUTO_TRADING_MAX_DAILY_NOTIONAL_PCT),
      minOrderNotional: optionalNumber(process.env.AUTO_TRADING_MIN_ORDER_NOTIONAL),
      maxAtrPct: optionalNumber(process.env.AUTO_TRADING_MAX_ATR_PCT),
      minEntryScore: optionalNumber(process.env.AUTO_TRADING_MIN_ENTRY_SCORE),
      addMinScore: optionalNumber(process.env.AUTO_TRADING_ADD_MIN_SCORE),
      sellScoreThreshold: optionalNumber(process.env.AUTO_TRADING_SELL_SCORE_THRESHOLD),
      severeSellExitScoreThreshold: optionalNumber(process.env.AUTO_TRADING_SEVERE_SELL_EXIT_SCORE_THRESHOLD),
      weakHoldReduceScoreThreshold: optionalNumber(process.env.AUTO_TRADING_WEAK_HOLD_REDUCE_SCORE_THRESHOLD),
      topRelativeStrengthPct: optionalNumber(process.env.AUTO_TRADING_TOP_RELATIVE_STRENGTH_PCT),
      maxEntryPricePremiumPct: optionalNumber(process.env.AUTO_TRADING_MAX_ENTRY_PRICE_PREMIUM_PCT),
      maxEntrySma20PremiumPct: optionalNumber(process.env.AUTO_TRADING_MAX_ENTRY_SMA20_PREMIUM_PCT),
      maxEntryDayChangePct: optionalNumber(process.env.AUTO_TRADING_MAX_ENTRY_DAY_CHANGE_PCT),
      minEntryRewardRiskRatio: optionalNumber(process.env.AUTO_TRADING_MIN_ENTRY_REWARD_RISK_RATIO),
      neutralEntryScoreBuffer: optionalNumber(process.env.AUTO_TRADING_NEUTRAL_ENTRY_SCORE_BUFFER),
      unstableSignalScoreBuffer: optionalNumber(process.env.AUTO_TRADING_UNSTABLE_SIGNAL_SCORE_BUFFER),
      minEntryScoreChange: optionalNumber(process.env.AUTO_TRADING_MIN_ENTRY_SCORE_CHANGE),
      minSignalStabilityAdjustment: optionalNumber(process.env.AUTO_TRADING_MIN_SIGNAL_STABILITY_ADJUSTMENT),
      reducePositionPct: optionalNumber(process.env.AUTO_TRADING_REDUCE_POSITION_PCT),
      allowAddToLosingPositions: optionalBoolean(process.env.AUTO_TRADING_ALLOW_ADD_TO_LOSING_POSITIONS),
      allowPatternDayTraderBuys: optionalBoolean(process.env.AUTO_TRADING_ALLOW_PATTERN_DAY_TRADER_BUYS)
    }
  };
}

function mergeTradingConfig(base: TradingConfigInput, override: TradingConfigInput): TradingConfigInput {
  return {
    ...base,
    ...definedOnly(override),
    killSwitch: Boolean(base.killSwitch) || Boolean(override.killSwitch),
    paperTradingEnabled:
      base.paperTradingEnabled === false ? false : (override.paperTradingEnabled ?? base.paperTradingEnabled),
    liveTradingEnabled:
      base.liveTradingEnabled === false ? false : (override.liveTradingEnabled ?? base.liveTradingEnabled),
    risk: {
      ...definedOnly(base.risk ?? {}),
      ...definedOnly(override.risk ?? {})
    }
  };
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function coerceOptionalSymbolList(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const symbols = value.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
    return symbols.length > 0 ? Array.from(new Set(symbols)) : undefined;
  }
  if (Array.isArray(value)) {
    const symbols = value
      .filter((symbol): symbol is string => typeof symbol === "string")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);
    return symbols.length > 0 ? Array.from(new Set(symbols)) : undefined;
  }

  return undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function liveApprovalString(value: unknown, key: "confirmationToken" | "approvedDryRunId") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return optionalString((value as Record<string, unknown>)[key]);
}

function coerceSide(value: unknown): TradeSide | undefined {
  return value === "buy" || value === "sell" ? value : undefined;
}

function coerceOptionalMode(value: unknown) {
  if (value === "off" || value === "dry-run" || value === "paper" || value === "live") {
    return value;
  }

  return undefined;
}

function coerceRiskProfile(value: unknown): TradingRiskProfile | undefined {
  return value === "active" || value === "balanced" || value === "cautious" ? value : undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function optionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
}
