import { annualizedReturn, maxDrawdown, momentum, simpleMovingAverage } from "@/lib/simulator/indicators";
import {
  ALL_SYMBOLS,
  DEFENSIVE_SYMBOLS,
  OFFENSIVE_SYMBOLS,
  type AlignedMarketData,
  type AllocationSegment,
  type PositionState,
  type Recommendation,
  type RecommendationAction,
  type Regime,
  type SimulationResult,
  type StrategyInput,
  type TradeRecord,
  type UniverseSymbol
} from "@/lib/simulator/types";

type HoldingsMap = Partial<Record<UniverseSymbol, PositionState>>;

interface PendingDecision {
  targets: UniverseSymbol[];
  regime: Regime;
  rationale: string;
}

const FALLBACK_SYMBOL: UniverseSymbol = "SHY";

export function simulateAlignedStrategy(data: AlignedMarketData, input: StrategyInput): SimulationResult {
  const latestDate = new Date(`${data.dates[data.dates.length - 1]}T00:00:00Z`);
  const startThreshold = new Date(latestDate);
  startThreshold.setUTCFullYear(startThreshold.getUTCFullYear() - input.years);

  const analysisStartIndex = Math.max(input.riskOnMaDays, input.momentumDays);
  const simulationStartIndex = Math.max(
    analysisStartIndex,
    data.dates.findIndex((date) => new Date(`${date}T00:00:00Z`) >= startThreshold)
  );

  if (simulationStartIndex < 0 || simulationStartIndex >= data.dates.length - 1) {
    throw new Error("Not enough historical data is available for the requested range.");
  }

  const positions: HoldingsMap = {};
  let cash = input.initialCapital;
  const trades: TradeRecord[] = [];
  const equityCurve: SimulationResult["equityCurve"] = [];
  const holdingsHistory: Array<{ date: string; symbols: UniverseSymbol[]; regime: Regime }> = [];
  let pendingDecision: PendingDecision | null = null;
  let latestDecision: PendingDecision | null = null;

  for (let index = simulationStartIndex; index < data.dates.length; index += 1) {
    const date = data.dates[index];
    const priceMap = mapPrices(data, index);

    if (pendingDecision) {
      const execution = executeRebalance({
        cash,
        currentDate: date,
        positions,
        priceMap,
        decision: pendingDecision,
        input
      });
      cash = execution.cash;
      trades.push(...execution.trades);
    }

    updatePeaks(positions, priceMap);

    const portfolioValue = cash + valueOfPositions(positions, priceMap);
    const regime = latestDecision?.regime ?? inferRegime(data, index, input);
    const benchmarkValue = calculateBenchmarkValue(data, simulationStartIndex, index, input.initialCapital);

    equityCurve.push({
      date,
      portfolioValue,
      benchmarkValue,
      cash,
      regime
    });
    holdingsHistory.push({
      date,
      symbols: activeSymbols(positions),
      regime
    });

    if (index === data.dates.length - 1) {
      continue;
    }

    latestDecision = buildDecision(data, index, positions, input);
    pendingDecision = latestDecision;
  }

  if (!latestDecision) {
    latestDecision = buildDecision(data, data.dates.length - 1, positions, input);
  }

  const summary = summarizeSimulation(equityCurve, trades, input, latestDecision.regime);
  const recommendation = buildRecommendation(latestDecision, activeSymbols(positions), data.dates[data.dates.length - 1]);

  return {
    input,
    summary,
    equityCurve,
    trades,
    allocationTimeline: compressHoldingsTimeline(holdingsHistory),
    recommendation,
    universe: {
      offensive: [...OFFENSIVE_SYMBOLS],
      defensive: [...DEFENSIVE_SYMBOLS]
    },
    strategyNotes: [
      "SPY が長期移動平均を上回ると攻め、下回ると守りへ切り替えます。",
      "攻め局面では SPY / QQQ / VTI の90日モメンタム上位を保有します。",
      "守り局面では IEF / GLD / SHY の相対的に強い2銘柄へ退避します。",
      "売買判定は終値ベース、約定は翌営業日の終値近似です。",
      "8% の固定ストップと 10% のトレーリングストップで大崩れを抑えます。"
    ]
  };
}

function summarizeSimulation(
  equityCurve: SimulationResult["equityCurve"],
  trades: TradeRecord[],
  input: StrategyInput,
  latestRegime: Regime
) {
  const startValue = equityCurve[0]?.portfolioValue ?? input.initialCapital;
  const endValue = equityCurve[equityCurve.length - 1]?.portfolioValue ?? input.initialCapital;
  const benchmarkStart = equityCurve[0]?.benchmarkValue ?? input.initialCapital;
  const benchmarkEnd = equityCurve[equityCurve.length - 1]?.benchmarkValue ?? input.initialCapital;
  const wins = countWinningRoundTrips(trades);

  return {
    startDate: equityCurve[0]?.date ?? "",
    endDate: equityCurve[equityCurve.length - 1]?.date ?? "",
    finalValue: endValue,
    totalReturnPct: endValue / startValue - 1,
    cagrPct: annualizedReturn(startValue, endValue, input.years),
    maxDrawdownPct: maxDrawdown(equityCurve.map((point) => point.portfolioValue)),
    benchmarkFinalValue: benchmarkEnd,
    benchmarkReturnPct: benchmarkEnd / benchmarkStart - 1,
    excessReturnPct: endValue / startValue - benchmarkEnd / benchmarkStart,
    winRatePct: wins.total > 0 ? wins.wins / wins.total : 0,
    totalTrades: trades.length,
    latestRegime
  };
}

function buildRecommendation(decision: PendingDecision, currentSymbols: UniverseSymbol[], asOf: string): Recommendation {
  const actions: RecommendationAction[] = [];

  for (const symbol of currentSymbols) {
    if (!decision.targets.includes(symbol)) {
      actions.push({
        symbol,
        action: "SELL",
        reason: "次営業日のターゲット配分から外れるため"
      });
    }
  }

  for (const symbol of decision.targets) {
    if (currentSymbols.includes(symbol)) {
      actions.push({
        symbol,
        action: "HOLD",
        reason: "次営業日も継続保有候補"
      });
    } else {
      actions.push({
        symbol,
        action: "BUY",
        reason: "現在のモメンタム順位と市場局面に合致"
      });
    }
  }

  return {
    asOf,
    regime: decision.regime,
    targets: decision.targets,
    actions,
    rationale: decision.rationale
  };
}

function executeRebalance({
  cash,
  currentDate,
  positions,
  priceMap,
  decision,
  input
}: {
  cash: number;
  currentDate: string;
  positions: HoldingsMap;
  priceMap: Record<UniverseSymbol, number>;
  decision: PendingDecision;
  input: StrategyInput;
}) {
  const currentSymbols = activeSymbols(positions);
  const targetsChanged = !sameSymbols(currentSymbols, decision.targets);

  if (!targetsChanged) {
    return { cash, trades: [] as TradeRecord[] };
  }

  const trades: TradeRecord[] = [];
  let nextCash = cash;

  for (const symbol of currentSymbols) {
    if (decision.targets.includes(symbol)) {
      continue;
    }

    const position = positions[symbol];
    if (!position) {
      continue;
    }

    const price = priceMap[symbol];
    const grossValue = position.quantity * price;
    nextCash += grossValue - input.feePerTrade;
    trades.push({
      date: currentDate,
      symbol,
      side: "SELL",
      quantity: position.quantity,
      price,
      grossValue,
      fee: input.feePerTrade,
      reason: "Target rotation",
      regime: decision.regime
    });
    delete positions[symbol];
  }

  const portfolioValue = nextCash + valueOfPositions(positions, priceMap);
  const targetWeight = Math.min(input.maxAssetWeight, 1 / Math.max(decision.targets.length, 1));
  const targetSymbols = [...decision.targets];

  for (const symbol of targetSymbols) {
    const existing = positions[symbol];
    const desiredValue = portfolioValue * targetWeight;
    const currentValue = existing ? existing.quantity * priceMap[symbol] : 0;
    const deltaValue = desiredValue - currentValue;

    if (Math.abs(deltaValue) < 1) {
      continue;
    }

    if (deltaValue > 0) {
      const budget = Math.min(deltaValue, nextCash);
      const quantity = Math.max(0, (budget - input.feePerTrade) / priceMap[symbol]);
      if (quantity <= 0) {
        continue;
      }

      const grossValue = quantity * priceMap[symbol];
      nextCash -= grossValue + input.feePerTrade;
      positions[symbol] = {
        symbol,
        quantity: (existing?.quantity ?? 0) + quantity,
        entryPrice: existing?.quantity ? existing.entryPrice : priceMap[symbol],
        peakPrice: Math.max(existing?.peakPrice ?? 0, priceMap[symbol]),
        openedAt: existing?.openedAt ?? currentDate
      };
      trades.push({
        date: currentDate,
        symbol,
        side: "BUY",
        quantity,
        price: priceMap[symbol],
        grossValue,
        fee: input.feePerTrade,
        reason: "Target rotation",
        regime: decision.regime
      });
    }
  }

  return {
    cash: nextCash,
    trades
  };
}

function buildDecision(data: AlignedMarketData, index: number, positions: HoldingsMap, input: StrategyInput): PendingDecision {
  const regime = inferRegime(data, index, input);
  const offensiveRank = rankSymbols(OFFENSIVE_SYMBOLS, data, index, input.momentumDays);
  const defensiveRank = rankSymbols(DEFENSIVE_SYMBOLS, data, index, input.momentumDays);
  const currentPrices = mapPrices(data, index);
  const stopTriggered = activeSymbols(positions).filter((symbol) => shouldStop(positions[symbol], currentPrices[symbol], input));

  let targets =
    regime === "risk-on"
      ? offensiveRank.filter((entry) => entry.score > 0).slice(0, input.topAssets).map((entry) => entry.symbol)
      : defensiveRank.slice(0, input.topAssets).map((entry) => entry.symbol);

  if (targets.length < input.topAssets) {
    const defensiveFallbacks = defensiveRank.map((entry) => entry.symbol);
    for (const symbol of defensiveFallbacks) {
      if (!targets.includes(symbol)) {
        targets.push(symbol);
      }
      if (targets.length >= input.topAssets) {
        break;
      }
    }
  }

  if (targets.length === 0) {
    targets = [FALLBACK_SYMBOL];
  }

  for (const symbol of stopTriggered) {
    targets = targets.filter((candidate) => candidate !== symbol);
  }

  if (targets.length === 0) {
    targets = [FALLBACK_SYMBOL];
  }

  const primary = regime === "risk-on" ? offensiveRank : defensiveRank;
  const rankedSummary = primary
    .slice(0, 3)
    .map((entry) => `${entry.symbol} ${(entry.score * 100).toFixed(1)}%`)
    .join(", ");

  return {
    regime,
    targets,
    rationale:
      regime === "risk-on"
        ? `SPY が ${input.riskOnMaDays} 日移動平均を上回っているため攻め。候補順位: ${rankedSummary}.`
        : `SPY が ${input.riskOnMaDays} 日移動平均を下回っているため守り。候補順位: ${rankedSummary}.`
  };
}

function inferRegime(data: AlignedMarketData, index: number, input: StrategyInput): Regime {
  const spySeries = data.pricesBySymbol.SPY;
  const average = simpleMovingAverage(spySeries, index, input.riskOnMaDays);
  if (average === null) {
    return "risk-off";
  }

  return spySeries[index] >= average ? "risk-on" : "risk-off";
}

function rankSymbols(symbols: readonly UniverseSymbol[], data: AlignedMarketData, index: number, lookback: number) {
  return symbols
    .map((symbol) => ({
      symbol,
      score: momentum(data.pricesBySymbol[symbol], index, lookback) ?? Number.NEGATIVE_INFINITY
    }))
    .sort((left, right) => right.score - left.score);
}

function calculateBenchmarkValue(
  data: AlignedMarketData,
  simulationStartIndex: number,
  currentIndex: number,
  initialCapital: number
) {
  const startPrice = data.pricesBySymbol.SPY[simulationStartIndex];
  const currentPrice = data.pricesBySymbol.SPY[currentIndex];
  if (startPrice <= 0) {
    return initialCapital;
  }

  return initialCapital * (currentPrice / startPrice);
}

function shouldStop(position: PositionState | undefined, currentPrice: number, input: StrategyInput) {
  if (!position) {
    return false;
  }

  const fixedStop = currentPrice <= position.entryPrice * (1 - input.stopLossPct);
  const trailingStop = currentPrice <= position.peakPrice * (1 - input.trailingStopPct);

  return fixedStop || trailingStop;
}

function updatePeaks(positions: HoldingsMap, prices: Record<UniverseSymbol, number>) {
  for (const symbol of ALL_SYMBOLS) {
    const position = positions[symbol];
    if (!position) {
      continue;
    }

    position.peakPrice = Math.max(position.peakPrice, prices[symbol]);
  }
}

function valueOfPositions(positions: HoldingsMap, prices: Record<UniverseSymbol, number>) {
  return activeSymbols(positions).reduce((total, symbol) => {
    const position = positions[symbol];
    return total + (position ? position.quantity * prices[symbol] : 0);
  }, 0);
}

function mapPrices(data: AlignedMarketData, index: number) {
  return Object.fromEntries(
    ALL_SYMBOLS.map((symbol) => [symbol, data.pricesBySymbol[symbol][index]])
  ) as Record<UniverseSymbol, number>;
}

function activeSymbols(positions: HoldingsMap) {
  return ALL_SYMBOLS.filter((symbol) => {
    const quantity = positions[symbol]?.quantity ?? 0;
    return quantity > 1e-8;
  });
}

function sameSymbols(left: UniverseSymbol[], right: UniverseSymbol[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((symbol) => right.includes(symbol));
}

function compressHoldingsTimeline(history: Array<{ date: string; symbols: UniverseSymbol[]; regime: Regime }>) {
  const segments: AllocationSegment[] = [];

  for (const entry of history) {
    const signature = `${entry.regime}:${entry.symbols.join("|")}`;
    const previous = segments[segments.length - 1];
    const previousSignature = previous ? `${previous.regime}:${previous.symbols.join("|")}` : "";

    if (!previous || previousSignature !== signature) {
      segments.push({
        startDate: entry.date,
        endDate: entry.date,
        symbols: entry.symbols,
        regime: entry.regime
      });
    } else {
      previous.endDate = entry.date;
    }
  }

  return segments;
}

function countWinningRoundTrips(trades: TradeRecord[]) {
  const openCostBasis = new Map<UniverseSymbol, number>();
  let wins = 0;
  let total = 0;

  for (const trade of trades) {
    if (trade.side === "BUY") {
      openCostBasis.set(trade.symbol, (openCostBasis.get(trade.symbol) ?? 0) + trade.grossValue + trade.fee);
      continue;
    }

    const basis = openCostBasis.get(trade.symbol);
    if (basis === undefined) {
      continue;
    }

    total += 1;
    if (trade.grossValue - trade.fee > basis) {
      wins += 1;
    }
    openCostBasis.delete(trade.symbol);
  }

  return { wins, total };
}
