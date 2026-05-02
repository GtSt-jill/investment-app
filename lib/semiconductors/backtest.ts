import { MINIMUM_BARS, analyzeSemiconductors } from "@/lib/semiconductors/analyzer";
import {
  DEFAULT_SEMICONDUCTOR_UNIVERSE,
  type MarketRegime,
  type PriceBar,
  type SignalAction,
  type SignalRating,
  type SymbolProfile
} from "@/lib/semiconductors/types";

const DEFAULT_HORIZONS = [20, 63] as const;
const DEFAULT_SCORE_BUCKET_SIZE = 10;
const DEFAULT_EXECUTION_PRICE: SignalBacktestExecutionPrice = "nextOpen";

export type SignalBacktestExecutionPrice = "signalClose" | "nextOpen";

export interface SignalBacktestOptions {
  horizons?: readonly number[];
  minHistoryBars?: number;
  sampleEvery?: number;
  scoreBucketSize?: number;
  startDate?: string;
  endDate?: string;
  executionPrice?: SignalBacktestExecutionPrice;
  transactionCostBps?: number;
  slippageBps?: number;
  marketBars?: {
    semiconductor?: PriceBar[];
    qqq?: PriceBar[];
  };
}

export interface SignalBacktestOutcome {
  horizon: number;
  forwardReturn: number;
  grossForwardReturn: number;
  maxDrawdown: number;
  maxAdverseExcursion: number;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  totalCostBps: number;
}

export interface SignalBacktestReturnPercentiles {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export interface SignalBacktestEvent {
  symbol: string;
  asOf: string;
  action: SignalAction;
  rating: SignalRating;
  score: number;
  scoreBucket: string;
  scoreBucketMin: number;
  scoreBucketMax: number;
  close: number;
  rank: number;
  relativeStrengthRank: number;
  marketRegime: MarketRegime;
  outcomes: SignalBacktestOutcome[];
}

export interface SignalBacktestHorizonMetrics {
  horizon: number;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  averageReturn: number;
  medianReturn: number | null;
  averageWin: number;
  averageLoss: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  payoffRatio: number | null;
  downsideDeviation: number;
  averageDownsideReturn: number;
  returnPercentiles: SignalBacktestReturnPercentiles;
  averageMaxDrawdown: number;
  medianMaxDrawdown: number | null;
  averageAdverseExcursion: number;
  medianAdverseExcursion: number | null;
  worstAdverseExcursion: number | null;
  averageAdverseCapture: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
}

export interface SignalBacktestGroupSummary {
  group: string;
  action?: SignalAction;
  scoreBucket?: string;
  scoreBucketMin?: number;
  scoreBucketMax?: number;
  count: number;
  averageScore: number;
  horizons: Record<number, SignalBacktestHorizonMetrics>;
}

export interface SignalBacktestResult {
  events: SignalBacktestEvent[];
  groups: SignalBacktestGroupSummary[];
  byAction: SignalBacktestGroupSummary[];
  byScoreBucket: SignalBacktestGroupSummary[];
  byMarketRegime: SignalBacktestGroupSummary[];
  summary: {
    asOfStart: string | null;
    asOfEnd: string | null;
    horizons: number[];
    symbols: string[];
    minHistoryBars: number;
    sampleEvery: number;
    evaluatedSignals: number;
    includedSignals: number;
    totalOutcomes: number;
    skippedOutcomes: number;
    skippedByHorizon: Record<number, number>;
    executionPrice: SignalBacktestExecutionPrice;
    transactionCostBps: number;
    slippageBps: number;
  };
}

interface MutableHorizonMetrics {
  horizon: number;
  count: number;
  wins: number;
  losses: number;
  totalReturn: number;
  totalWinReturn: number;
  totalLossReturn: number;
  totalSquaredDownsideReturn: number;
  totalMaxDrawdown: number;
  totalAdverseExcursion: number;
  totalAdverseCapture: number;
  adverseCaptureCount: number;
  returns: number[];
  maxDrawdowns: number[];
  adverseExcursions: number[];
  bestReturn: number | null;
  worstReturn: number | null;
}

interface MutableGroup {
  group: string;
  action?: SignalAction;
  scoreBucket?: string;
  scoreBucketMin?: number;
  scoreBucketMax?: number;
  count: number;
  totalScore: number;
  horizons: Map<number, MutableHorizonMetrics>;
}

export function runSignalBacktest(
  barsBySymbol: Record<string, PriceBar[]>,
  universe: SymbolProfile[] = [...DEFAULT_SEMICONDUCTOR_UNIVERSE],
  options: SignalBacktestOptions = {}
): SignalBacktestResult {
  const horizons = normalizeHorizons(options.horizons);
  const scoreBucketSize = normalizePositiveInteger(options.scoreBucketSize, DEFAULT_SCORE_BUCKET_SIZE);
  const minHistoryBars = Math.max(MINIMUM_BARS, normalizePositiveInteger(options.minHistoryBars, MINIMUM_BARS));
  const sampleEvery = normalizePositiveInteger(options.sampleEvery, 1);
  const executionPrice = options.executionPrice ?? DEFAULT_EXECUTION_PRICE;
  const transactionCostBps = normalizeNonNegativeNumber(options.transactionCostBps, 0);
  const slippageBps = normalizeNonNegativeNumber(options.slippageBps, 0);
  const symbols = universe.map((profile) => profile.symbol);
  const normalizedBars = normalizeBarsBySymbol(barsBySymbol, symbols);
  const dateUniverse = buildCommonDateUniverse(normalizedBars, symbols, options.startDate, options.endDate);
  const marketBars = {
    semiconductor: normalizeBars(options.marketBars?.semiconductor ?? []),
    qqq: normalizeBars(options.marketBars?.qqq ?? [])
  };
  const events: SignalBacktestEvent[] = [];
  const skippedByHorizon = Object.fromEntries(horizons.map((horizon) => [horizon, 0])) as Record<number, number>;
  let evaluatedSignals = 0;
  let sampledDates = 0;

  for (const asOf of dateUniverse) {
    if (sampledDates % sampleEvery !== 0) {
      sampledDates += 1;
      continue;
    }
    sampledDates += 1;

    const windowBarsBySymbol = buildAsOfBars(normalizedBars, symbols, asOf, minHistoryBars);
    if (Object.keys(windowBarsBySymbol).length === 0) {
      continue;
    }

    const result = analyzeSemiconductors(windowBarsBySymbol, universe, {
      marketBars: {
        semiconductor: sliceBarsOnOrBefore(marketBars.semiconductor, asOf),
        qqq: sliceBarsOnOrBefore(marketBars.qqq, asOf)
      }
    });

    for (const recommendation of result.recommendations) {
      if (recommendation.asOf !== asOf) {
        continue;
      }

      evaluatedSignals += 1;
      const symbolBars = normalizedBars[recommendation.symbol] ?? [];
      const currentIndex = symbolBars.findIndex((bar) => bar.date === recommendation.asOf);
      if (currentIndex < 0) {
        continue;
      }

      const outcomes: SignalBacktestOutcome[] = [];
      for (const horizon of horizons) {
        const outcome = calculateOutcome(symbolBars, currentIndex, horizon, {
          executionPrice,
          transactionCostBps,
          slippageBps
        });
        if (outcome === null) {
          skippedByHorizon[horizon] += 1;
          continue;
        }
        outcomes.push(outcome);
      }

      if (outcomes.length === 0) {
        continue;
      }

      const scoreBucket = scoreBucketFor(recommendation.score, scoreBucketSize);
      events.push({
        symbol: recommendation.symbol,
        asOf: recommendation.asOf,
        action: recommendation.action,
        rating: recommendation.rating,
        score: recommendation.score,
        scoreBucket: scoreBucket.label,
        scoreBucketMin: scoreBucket.min,
        scoreBucketMax: scoreBucket.max,
        close: recommendation.indicators.close,
        rank: recommendation.rank,
        relativeStrengthRank: recommendation.relativeStrengthRank,
        marketRegime: recommendation.marketRegime ?? result.summary.marketRegime,
        outcomes
      });
    }
  }

  const groups = aggregateGroups(
    events,
    horizons,
    (event) => `${event.action}:${event.scoreBucket}`,
    (event) => ({
      group: `${event.action} ${event.scoreBucket}`,
      action: event.action,
      scoreBucket: event.scoreBucket,
      scoreBucketMin: event.scoreBucketMin,
      scoreBucketMax: event.scoreBucketMax
    })
  );
  const byAction = aggregateGroups(
    events,
    horizons,
    (event) => event.action,
    (event) => ({ group: event.action, action: event.action })
  );
  const byScoreBucket = aggregateGroups(
    events,
    horizons,
    (event) => event.scoreBucket,
    (event) => ({
      group: event.scoreBucket,
      scoreBucket: event.scoreBucket,
      scoreBucketMin: event.scoreBucketMin,
      scoreBucketMax: event.scoreBucketMax
    })
  );
  const byMarketRegime = aggregateGroups(
    events,
    horizons,
    (event) => event.marketRegime,
    (event) => ({ group: event.marketRegime })
  );
  const totalOutcomes = events.reduce((total, event) => total + event.outcomes.length, 0);
  const skippedOutcomes = Object.values(skippedByHorizon).reduce((total, count) => total + count, 0);

  return {
    events,
    groups,
    byAction,
    byScoreBucket,
    byMarketRegime,
    summary: {
      asOfStart: events[0]?.asOf ?? null,
      asOfEnd: events[events.length - 1]?.asOf ?? null,
      horizons,
      symbols,
      minHistoryBars,
      sampleEvery,
      evaluatedSignals,
      includedSignals: events.length,
      totalOutcomes,
      skippedOutcomes,
      skippedByHorizon,
      executionPrice,
      transactionCostBps,
      slippageBps
    }
  };
}

export function scoreBucketFor(score: number, bucketSize = DEFAULT_SCORE_BUCKET_SIZE) {
  const resolvedBucketSize = normalizePositiveInteger(bucketSize, DEFAULT_SCORE_BUCKET_SIZE);
  const clampedScore = clamp(Math.round(score), 0, 100);
  const min = Math.floor(clampedScore / resolvedBucketSize) * resolvedBucketSize;
  const max = clampedScore === 100 ? 100 : Math.min(100, min + resolvedBucketSize - 1);

  return {
    label: min === max ? `${min}` : `${min}-${max}`,
    min,
    max
  };
}

function calculateOutcome(
  bars: PriceBar[],
  currentIndex: number,
  horizon: number,
  options: {
    executionPrice: SignalBacktestExecutionPrice;
    transactionCostBps: number;
    slippageBps: number;
  }
): SignalBacktestOutcome | null {
  const entryIndex = options.executionPrice === "nextOpen" ? currentIndex + 1 : currentIndex;
  const exitIndex = currentIndex + horizon;
  const entry = bars[entryIndex];
  const exit = bars[exitIndex];
  const entryPrice = options.executionPrice === "nextOpen" ? entry?.open : entry?.close;
  const exitPrice = exit?.close;

  if (!entry || !exit || !entryPrice || !exitPrice || entryPrice <= 0) {
    return null;
  }

  const totalCost = ((options.transactionCostBps + options.slippageBps) * 2) / 10_000;
  const grossForwardReturn = exitPrice / entryPrice - 1;
  const forwardReturn = grossForwardReturn - totalCost;
  let peak = entryPrice;
  let maxDrawdown = 0;
  let maxAdverseExcursion = 0;

  for (let index = entryIndex; index <= exitIndex; index += 1) {
    const bar = bars[index];
    if (!bar) {
      return null;
    }

    maxDrawdown = Math.min(maxDrawdown, bar.low / peak - 1);
    maxAdverseExcursion = Math.min(maxAdverseExcursion, bar.low / entryPrice - 1);
    peak = Math.max(peak, bar.high);
  }

  return {
    horizon,
    forwardReturn,
    grossForwardReturn,
    maxDrawdown,
    maxAdverseExcursion,
    entryDate: entry.date,
    exitDate: exit.date,
    entryPrice,
    exitPrice,
    totalCostBps: (options.transactionCostBps + options.slippageBps) * 2
  };
}

function aggregateGroups(
  events: SignalBacktestEvent[],
  horizons: number[],
  keyFor: (event: SignalBacktestEvent) => string,
  seedFor: (event: SignalBacktestEvent) => Pick<
    SignalBacktestGroupSummary,
    "group" | "action" | "scoreBucket" | "scoreBucketMin" | "scoreBucketMax"
  >
) {
  const groups = new Map<string, MutableGroup>();

  for (const event of events) {
    const key = keyFor(event);
    let group = groups.get(key);
    if (!group) {
      group = {
        ...seedFor(event),
        count: 0,
        totalScore: 0,
        horizons: new Map(horizons.map((horizon) => [horizon, emptyMutableHorizon(horizon)]))
      };
      groups.set(key, group);
    }

    group.count += 1;
    group.totalScore += event.score;

    for (const outcome of event.outcomes) {
      const metrics = group.horizons.get(outcome.horizon) ?? emptyMutableHorizon(outcome.horizon);
      metrics.count += 1;
      metrics.wins += outcome.forwardReturn > 0 ? 1 : 0;
      metrics.losses += outcome.forwardReturn < 0 ? 1 : 0;
      metrics.totalReturn += outcome.forwardReturn;
      metrics.totalWinReturn += Math.max(outcome.forwardReturn, 0);
      metrics.totalLossReturn += Math.min(outcome.forwardReturn, 0);
      metrics.totalSquaredDownsideReturn += Math.min(outcome.forwardReturn, 0) ** 2;
      metrics.totalMaxDrawdown += outcome.maxDrawdown;
      metrics.totalAdverseExcursion += outcome.maxAdverseExcursion;
      metrics.returns.push(outcome.forwardReturn);
      metrics.maxDrawdowns.push(outcome.maxDrawdown);
      metrics.adverseExcursions.push(outcome.maxAdverseExcursion);
      if (outcome.forwardReturn < 0 && outcome.maxAdverseExcursion < 0) {
        metrics.totalAdverseCapture += Math.abs(outcome.forwardReturn) / Math.abs(outcome.maxAdverseExcursion);
        metrics.adverseCaptureCount += 1;
      }
      metrics.bestReturn =
        metrics.bestReturn === null ? outcome.forwardReturn : Math.max(metrics.bestReturn, outcome.forwardReturn);
      metrics.worstReturn =
        metrics.worstReturn === null ? outcome.forwardReturn : Math.min(metrics.worstReturn, outcome.forwardReturn);
      group.horizons.set(outcome.horizon, metrics);
    }
  }

  return Array.from(groups.values())
    .map(finalizeGroup)
    .sort(compareGroups);
}

function finalizeGroup(group: MutableGroup): SignalBacktestGroupSummary {
  return {
    group: group.group,
    action: group.action,
    scoreBucket: group.scoreBucket,
    scoreBucketMin: group.scoreBucketMin,
    scoreBucketMax: group.scoreBucketMax,
    count: group.count,
    averageScore: group.count === 0 ? 0 : group.totalScore / group.count,
    horizons: Object.fromEntries(
      Array.from(group.horizons.entries()).map(([horizon, metrics]) => [horizon, finalizeHorizon(metrics)])
    ) as Record<number, SignalBacktestHorizonMetrics>
  };
}

function finalizeHorizon(metrics: MutableHorizonMetrics): SignalBacktestHorizonMetrics {
  const averageWin = metrics.wins === 0 ? 0 : metrics.totalWinReturn / metrics.wins;
  const averageLoss = metrics.losses === 0 ? 0 : metrics.totalLossReturn / metrics.losses;
  const grossLoss = Math.abs(metrics.totalLossReturn);
  const payoffRatio = averageWin > 0 && averageLoss < 0 ? averageWin / Math.abs(averageLoss) : null;
  const returnPercentiles = percentileSummary(metrics.returns);

  return {
    horizon: metrics.horizon,
    count: metrics.count,
    wins: metrics.wins,
    losses: metrics.losses,
    winRate: metrics.count === 0 ? 0 : metrics.wins / metrics.count,
    lossRate: metrics.count === 0 ? 0 : metrics.losses / metrics.count,
    averageReturn: metrics.count === 0 ? 0 : metrics.totalReturn / metrics.count,
    medianReturn: returnPercentiles.p50,
    averageWin,
    averageLoss,
    grossProfit: metrics.totalWinReturn,
    grossLoss,
    profitFactor: grossLoss > 0 ? metrics.totalWinReturn / grossLoss : metrics.totalWinReturn > 0 ? Number.POSITIVE_INFINITY : null,
    payoffRatio,
    downsideDeviation: metrics.count === 0 ? 0 : Math.sqrt(metrics.totalSquaredDownsideReturn / metrics.count),
    averageDownsideReturn: metrics.count === 0 ? 0 : metrics.totalLossReturn / metrics.count,
    returnPercentiles,
    averageMaxDrawdown: metrics.count === 0 ? 0 : metrics.totalMaxDrawdown / metrics.count,
    medianMaxDrawdown: percentile(metrics.maxDrawdowns, 0.5),
    averageAdverseExcursion: metrics.count === 0 ? 0 : metrics.totalAdverseExcursion / metrics.count,
    medianAdverseExcursion: percentile(metrics.adverseExcursions, 0.5),
    worstAdverseExcursion: metrics.adverseExcursions.length === 0 ? null : Math.min(...metrics.adverseExcursions),
    averageAdverseCapture:
      metrics.adverseCaptureCount === 0 ? null : metrics.totalAdverseCapture / metrics.adverseCaptureCount,
    bestReturn: metrics.bestReturn,
    worstReturn: metrics.worstReturn
  };
}

function emptyMutableHorizon(horizon: number): MutableHorizonMetrics {
  return {
    horizon,
    count: 0,
    wins: 0,
    losses: 0,
    totalReturn: 0,
    totalWinReturn: 0,
    totalLossReturn: 0,
    totalSquaredDownsideReturn: 0,
    totalMaxDrawdown: 0,
    totalAdverseExcursion: 0,
    totalAdverseCapture: 0,
    adverseCaptureCount: 0,
    returns: [],
    maxDrawdowns: [],
    adverseExcursions: [],
    bestReturn: null,
    worstReturn: null
  };
}

function percentileSummary(values: number[]): SignalBacktestReturnPercentiles {
  return {
    p10: percentile(values, 0.1),
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9)
  };
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const boundedQuantile = clamp(quantile, 0, 1);
  const index = (sorted.length - 1) * boundedQuantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function compareGroups(left: SignalBacktestGroupSummary, right: SignalBacktestGroupSummary) {
  const actionOrder = { BUY: 0, HOLD: 1, SELL: 2 } satisfies Record<SignalAction, number>;
  const leftAction = left.action === undefined ? 3 : actionOrder[left.action];
  const rightAction = right.action === undefined ? 3 : actionOrder[right.action];

  if (leftAction !== rightAction) {
    return leftAction - rightAction;
  }

  const leftBucket = left.scoreBucketMin ?? -1;
  const rightBucket = right.scoreBucketMin ?? -1;
  if (leftBucket !== rightBucket) {
    return rightBucket - leftBucket;
  }

  return left.group.localeCompare(right.group);
}

function buildAsOfBars(
  barsBySymbol: Record<string, PriceBar[]>,
  symbols: string[],
  asOf: string,
  minHistoryBars: number
) {
  const result: Record<string, PriceBar[]> = {};

  for (const symbol of symbols) {
    const bars = barsBySymbol[symbol] ?? [];
    const endIndex = lastIndexOnOrBefore(bars, asOf);
    if (endIndex + 1 >= minHistoryBars) {
      result[symbol] = bars.slice(0, endIndex + 1);
    }
  }

  return result;
}

function buildCommonDateUniverse(
  barsBySymbol: Record<string, PriceBar[]>,
  symbols: string[],
  startDate?: string,
  endDate?: string
) {
  const dateSets = symbols
    .map((symbol) => barsBySymbol[symbol] ?? [])
    .filter((bars) => bars.length > 0)
    .map((bars) => new Set(bars.map((bar) => bar.date)));

  if (dateSets.length === 0 || dateSets.length !== symbols.length) {
    return [];
  }

  const [firstSet, ...remainingSets] = dateSets;
  return Array.from(firstSet)
    .filter(
      (date) =>
        (!startDate || date >= startDate) &&
        (!endDate || date <= endDate) &&
        remainingSets.every((dateSet) => dateSet.has(date))
    )
    .sort((left, right) => left.localeCompare(right));
}

function normalizeBarsBySymbol(barsBySymbol: Record<string, PriceBar[]>, symbols: string[]) {
  return Object.fromEntries(symbols.map((symbol) => [symbol, normalizeBars(barsBySymbol[symbol] ?? [])])) as Record<
    string,
    PriceBar[]
  >;
}

function normalizeBars(bars: PriceBar[]) {
  return bars
    .filter(
      (bar) =>
        bar.date &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close) &&
        Number.isFinite(bar.volume)
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

function sliceBarsOnOrBefore(bars: PriceBar[], asOf: string) {
  const endIndex = lastIndexOnOrBefore(bars, asOf);
  return endIndex < 0 ? [] : bars.slice(0, endIndex + 1);
}

function lastIndexOnOrBefore(bars: PriceBar[], asOf: string) {
  let low = 0;
  let high = bars.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].date <= asOf) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function normalizeHorizons(horizons: readonly number[] | undefined) {
  const resolved = horizons ?? DEFAULT_HORIZONS;
  const normalized = Array.from(new Set(resolved.map((horizon) => Math.floor(horizon)).filter((horizon) => horizon > 0))).sort(
    (left, right) => left - right
  );

  return normalized.length > 0 ? normalized : [...DEFAULT_HORIZONS];
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
