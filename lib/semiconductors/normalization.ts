import type { PriceBar } from "@/lib/semiconductors/types";

type NumericValue = number | null | undefined;

export interface RollingWindowOptions {
  window: number;
  minSamples?: number;
  endIndex?: number;
}

export interface HistoricalAtrPercentileOptions {
  atrLength?: number;
  lookback?: number;
  minSamples?: number;
  endIndex?: number;
}

export interface HistoricalMomentumPercentileOptions {
  lookback?: number;
  minSamples?: number;
  endIndex?: number;
}

export interface NormalizedSymbolSnapshotOptions {
  lookback?: number;
  minSamples?: number;
  atrLength?: number;
  zScoreWindow?: number;
}

export interface NormalizedSymbolSnapshot {
  asOf: string | null;
  close: number | null;
  closePercentileRank: number | null;
  closeZScore: number | null;
  atrPct: number | null;
  atrPercentile: number | null;
  momentum20: number | null;
  momentum20Percentile: number | null;
  momentum63: number | null;
  momentum63Percentile: number | null;
  momentum126: number | null;
  momentum126Percentile: number | null;
  sampleSizes: {
    close: number;
    atr: number;
    momentum20: number;
    momentum63: number;
    momentum126: number;
  };
}

const DEFAULT_LOOKBACK = 252;
const DEFAULT_MIN_SAMPLES = 60;
const DEFAULT_ATR_LENGTH = 14;
const DEFAULT_Z_SCORE_WINDOW = 126;

export function rollingPercentileRank(values: NumericValue[], options: RollingWindowOptions) {
  const sample = rollingSample(values, options);
  const current = valueAt(values, options.endIndex ?? values.length - 1);

  if (current === null || sample.values.length < sample.minSamples) {
    return null;
  }

  if (sample.values.length === 1) {
    return 50;
  }

  const lessThanCurrent = sample.values.filter((value) => value < current).length;
  const equalToCurrent = sample.values.filter((value) => value === current).length;
  const midRank = lessThanCurrent + (equalToCurrent - 1) / 2;

  return clamp((midRank / (sample.values.length - 1)) * 100, 0, 100);
}

export function rollingZScore(values: NumericValue[], options: RollingWindowOptions) {
  const sample = rollingSample(values, options);
  const current = valueAt(values, options.endIndex ?? values.length - 1);

  if (current === null || sample.values.length < sample.minSamples) {
    return null;
  }

  const mean = sample.values.reduce((total, value) => total + value, 0) / sample.values.length;
  const variance =
    sample.values.reduce((total, value) => total + (value - mean) ** 2, 0) / sample.values.length;
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) {
    return 0;
  }

  return (current - mean) / standardDeviation;
}

export function historicalAtrPercentile(bars: PriceBar[], options: HistoricalAtrPercentileOptions = {}) {
  const cleanedBars = normalizeBars(bars);
  const atrLength = options.atrLength ?? DEFAULT_ATR_LENGTH;
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  const minSamples = options.minSamples ?? Math.min(DEFAULT_MIN_SAMPLES, lookback);
  const endIndex = options.endIndex ?? cleanedBars.length - 1;
  const atrPctSeries = averageTrueRangePctSeries(cleanedBars, atrLength);

  return rollingPercentileRank(atrPctSeries, { window: lookback, minSamples, endIndex });
}

export function historicalMomentumPercentile(
  bars: PriceBar[],
  momentumLength: number,
  options: HistoricalMomentumPercentileOptions = {}
) {
  const cleanedBars = normalizeBars(bars);
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  const minSamples = options.minSamples ?? Math.min(DEFAULT_MIN_SAMPLES, lookback);
  const endIndex = options.endIndex ?? cleanedBars.length - 1;
  const momentumValues = momentumSeries(
    cleanedBars.map((bar) => bar.close),
    momentumLength
  );

  return rollingPercentileRank(momentumValues, { window: lookback, minSamples, endIndex });
}

export function normalizeSymbolSnapshot(
  bars: PriceBar[],
  options: NormalizedSymbolSnapshotOptions = {}
): NormalizedSymbolSnapshot {
  const cleanedBars = normalizeBars(bars);
  const latest = cleanedBars[cleanedBars.length - 1] ?? null;
  const closes = cleanedBars.map((bar) => bar.close);
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  const minSamples = options.minSamples ?? Math.min(DEFAULT_MIN_SAMPLES, lookback);
  const atrLength = options.atrLength ?? DEFAULT_ATR_LENGTH;
  const zScoreWindow = options.zScoreWindow ?? DEFAULT_Z_SCORE_WINDOW;
  const atrPctValues = averageTrueRangePctSeries(cleanedBars, atrLength);
  const momentum20Values = momentumSeries(closes, 20);
  const momentum63Values = momentumSeries(closes, 63);
  const momentum126Values = momentumSeries(closes, 126);
  const endIndex = cleanedBars.length - 1;

  return {
    asOf: latest?.date ?? null,
    close: latest?.close ?? null,
    closePercentileRank: rollingPercentileRank(closes, { window: lookback, minSamples, endIndex }),
    closeZScore: rollingZScore(closes, {
      window: zScoreWindow,
      minSamples: Math.min(minSamples, zScoreWindow),
      endIndex
    }),
    atrPct: valueAt(atrPctValues, endIndex),
    atrPercentile: rollingPercentileRank(atrPctValues, { window: lookback, minSamples, endIndex }),
    momentum20: valueAt(momentum20Values, endIndex),
    momentum20Percentile: rollingPercentileRank(momentum20Values, { window: lookback, minSamples, endIndex }),
    momentum63: valueAt(momentum63Values, endIndex),
    momentum63Percentile: rollingPercentileRank(momentum63Values, { window: lookback, minSamples, endIndex }),
    momentum126: valueAt(momentum126Values, endIndex),
    momentum126Percentile: rollingPercentileRank(momentum126Values, { window: lookback, minSamples, endIndex }),
    sampleSizes: {
      close: rollingSample(closes, { window: lookback, minSamples: 1, endIndex }).values.length,
      atr: rollingSample(atrPctValues, { window: lookback, minSamples: 1, endIndex }).values.length,
      momentum20: rollingSample(momentum20Values, { window: lookback, minSamples: 1, endIndex }).values.length,
      momentum63: rollingSample(momentum63Values, { window: lookback, minSamples: 1, endIndex }).values.length,
      momentum126: rollingSample(momentum126Values, { window: lookback, minSamples: 1, endIndex }).values.length
    }
  };
}

function rollingSample(values: NumericValue[], options: RollingWindowOptions) {
  const window = Math.floor(options.window);
  const endIndex = options.endIndex ?? values.length - 1;
  const minSamples = options.minSamples ?? window;

  if (window <= 0 || minSamples <= 0 || endIndex < 0 || endIndex >= values.length) {
    return { values: [], minSamples };
  }

  const startIndex = Math.max(0, endIndex - window + 1);
  const sample = values.slice(startIndex, endIndex + 1).filter(isFiniteNumber);

  return { values: sample, minSamples };
}

function averageTrueRangePctSeries(bars: PriceBar[], length: number) {
  const roundedLength = Math.floor(length);
  const series = bars.map(() => null as number | null);

  if (roundedLength <= 0 || bars.length <= roundedLength) {
    return series;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1].close;
    trueRanges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));

    if (trueRanges.length < roundedLength) {
      continue;
    }

    const window = trueRanges.slice(trueRanges.length - roundedLength);
    const averageTrueRange = window.reduce((total, value) => total + value, 0) / roundedLength;
    series[index] = bar.close > 0 ? averageTrueRange / bar.close : null;
  }

  return series;
}

function momentumSeries(values: number[], length: number) {
  const roundedLength = Math.floor(length);
  const series = values.map(() => null as number | null);

  if (roundedLength <= 0) {
    return series;
  }

  for (let index = roundedLength; index < values.length; index += 1) {
    const previous = values[index - roundedLength];
    const current = values[index];
    series[index] = previous > 0 ? current / previous - 1 : null;
  }

  return series;
}

function normalizeBars(bars: PriceBar[]) {
  return [...bars]
    .filter((bar) => {
      return (
        bar.date.length > 0 &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close) &&
        Number.isFinite(bar.volume) &&
        bar.close > 0 &&
        bar.high >= bar.low
      );
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function valueAt(values: NumericValue[], index: number): number | null {
  const value = values[index];
  return isFiniteNumber(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isFiniteNumber(value: NumericValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
