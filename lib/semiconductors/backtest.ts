import { MINIMUM_BARS, analyzeSemiconductors } from "@/lib/semiconductors/analyzer";
import {
  DEFAULT_SEMICONDUCTOR_UNIVERSE,
  type PriceBar,
  type SignalAction,
  type SignalRating,
  type SymbolProfile
} from "@/lib/semiconductors/types";

const DEFAULT_HORIZONS = [20, 63] as const;
const DEFAULT_SCORE_BUCKET_SIZE = 10;

export interface SignalBacktestOptions {
  horizons?: readonly number[];
  minHistoryBars?: number;
  sampleEvery?: number;
  scoreBucketSize?: number;
  startDate?: string;
  endDate?: string;
  marketBars?: {
    semiconductor?: PriceBar[];
    qqq?: PriceBar[];
  };
}

export interface SignalBacktestOutcome {
  horizon: number;
  forwardReturn: number;
  maxDrawdown: number;
  maxAdverseExcursion: number;
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
  outcomes: SignalBacktestOutcome[];
}

export interface SignalBacktestHorizonMetrics {
  horizon: number;
  count: number;
  wins: number;
  winRate: number;
  averageReturn: number;
  averageMaxDrawdown: number;
  averageAdverseExcursion: number;
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
  };
}

interface MutableHorizonMetrics {
  horizon: number;
  count: number;
  wins: number;
  totalReturn: number;
  totalMaxDrawdown: number;
  totalAdverseExcursion: number;
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
  const symbols = universe.map((profile) => profile.symbol);
  const normalizedBars = normalizeBarsBySymbol(barsBySymbol, symbols);
  const dateUniverse = buildDateUniverse(normalizedBars, options.startDate, options.endDate);
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
        const outcome = calculateOutcome(symbolBars, currentIndex, horizon);
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
  const totalOutcomes = events.reduce((total, event) => total + event.outcomes.length, 0);
  const skippedOutcomes = Object.values(skippedByHorizon).reduce((total, count) => total + count, 0);

  return {
    events,
    groups,
    byAction,
    byScoreBucket,
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
      skippedByHorizon
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

function calculateOutcome(bars: PriceBar[], currentIndex: number, horizon: number): SignalBacktestOutcome | null {
  const entry = bars[currentIndex];
  const exit = bars[currentIndex + horizon];
  if (!entry || !exit || entry.close <= 0) {
    return null;
  }

  let peak = entry.close;
  let maxDrawdown = 0;
  let maxAdverseExcursion = 0;

  for (let index = currentIndex + 1; index <= currentIndex + horizon; index += 1) {
    const bar = bars[index];
    if (!bar) {
      return null;
    }

    maxDrawdown = Math.min(maxDrawdown, bar.low / peak - 1);
    maxAdverseExcursion = Math.min(maxAdverseExcursion, bar.low / entry.close - 1);
    peak = Math.max(peak, bar.high);
  }

  return {
    horizon,
    forwardReturn: exit.close / entry.close - 1,
    maxDrawdown,
    maxAdverseExcursion
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
      metrics.totalReturn += outcome.forwardReturn;
      metrics.totalMaxDrawdown += outcome.maxDrawdown;
      metrics.totalAdverseExcursion += outcome.maxAdverseExcursion;
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
  return {
    horizon: metrics.horizon,
    count: metrics.count,
    wins: metrics.wins,
    winRate: metrics.count === 0 ? 0 : metrics.wins / metrics.count,
    averageReturn: metrics.count === 0 ? 0 : metrics.totalReturn / metrics.count,
    averageMaxDrawdown: metrics.count === 0 ? 0 : metrics.totalMaxDrawdown / metrics.count,
    averageAdverseExcursion: metrics.count === 0 ? 0 : metrics.totalAdverseExcursion / metrics.count,
    bestReturn: metrics.bestReturn,
    worstReturn: metrics.worstReturn
  };
}

function emptyMutableHorizon(horizon: number): MutableHorizonMetrics {
  return {
    horizon,
    count: 0,
    wins: 0,
    totalReturn: 0,
    totalMaxDrawdown: 0,
    totalAdverseExcursion: 0,
    bestReturn: null,
    worstReturn: null
  };
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

function buildDateUniverse(barsBySymbol: Record<string, PriceBar[]>, startDate?: string, endDate?: string) {
  return Array.from(
    new Set(
      Object.values(barsBySymbol)
        .flatMap((bars) => bars.map((bar) => bar.date))
        .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    )
  ).sort((left, right) => left.localeCompare(right));
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
