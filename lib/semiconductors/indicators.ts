import type { PriceBar } from "@/lib/semiconductors/types";

export function simpleMovingAverage(values: number[], length: number, endIndex = values.length - 1) {
  if (length <= 0 || endIndex < length - 1) {
    return null;
  }

  let sum = 0;
  for (let index = endIndex - length + 1; index <= endIndex; index += 1) {
    sum += values[index];
  }

  return sum / length;
}

export function movingAverageSeries(values: number[], length: number) {
  return values.map((_, index) => simpleMovingAverage(values, length, index));
}

export function exponentialMovingAverageSeries(values: number[], length: number) {
  if (length <= 0 || values.length < length) {
    return values.map(() => null);
  }

  const series: Array<number | null> = values.map(() => null);
  const smoothing = 2 / (length + 1);
  let previous = simpleMovingAverage(values, length, length - 1);

  series[length - 1] = previous;
  for (let index = length; index < values.length; index += 1) {
    previous = previous === null ? values[index] : values[index] * smoothing + previous * (1 - smoothing);
    series[index] = previous;
  }

  return series;
}

export function relativeStrengthIndex(values: number[], length = 14) {
  if (length <= 0 || values.length <= length) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / length;
  let averageLoss = losses / length;

  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (length - 1) + Math.max(change, 0)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(-change, 0)) / length;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function macd(values: number[], fastLength = 12, slowLength = 26, signalLength = 9) {
  const fast = exponentialMovingAverageSeries(values, fastLength);
  const slow = exponentialMovingAverageSeries(values, slowLength);
  const macdLine = values.map((_, index) => {
    if (fast[index] === null || slow[index] === null) {
      return null;
    }

    return fast[index]! - slow[index]!;
  });

  const compactMacd = macdLine.filter((value): value is number => value !== null);
  const compactSignal = exponentialMovingAverageSeries(compactMacd, signalLength);
  const signalLine = values.map(() => null as number | null);
  let signalIndex = 0;

  for (let index = 0; index < macdLine.length; index += 1) {
    if (macdLine[index] === null) {
      continue;
    }

    signalLine[index] = compactSignal[signalIndex] ?? null;
    signalIndex += 1;
  }

  const latestMacd = lastNumber(macdLine);
  const latestSignal = lastNumber(signalLine);

  return {
    macd: latestMacd,
    signal: latestSignal,
    histogram: latestMacd !== null && latestSignal !== null ? latestMacd - latestSignal : null
  };
}

export function bollingerBands(values: number[], length = 20, deviations = 2) {
  if (values.length < length) {
    return { upper: null, middle: null, lower: null };
  }

  const window = values.slice(values.length - length);
  const middle = window.reduce((total, value) => total + value, 0) / length;
  const variance = window.reduce((total, value) => total + (value - middle) ** 2, 0) / length;
  const standardDeviation = Math.sqrt(variance);

  return {
    upper: middle + standardDeviation * deviations,
    middle,
    lower: middle - standardDeviation * deviations
  };
}

export function averageTrueRange(bars: PriceBar[], length = 14) {
  if (bars.length <= length) {
    return null;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1].close;
    trueRanges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }

  return simpleMovingAverage(trueRanges, length);
}

export function momentum(values: number[], length: number) {
  if (length <= 0 || values.length <= length) {
    return null;
  }

  const current = values[values.length - 1];
  const previous = values[values.length - 1 - length];

  if (previous <= 0) {
    return null;
  }

  return current / previous - 1;
}

export function average(values: number[], length: number) {
  if (length <= 0 || values.length < length) {
    return null;
  }

  const window = values.slice(values.length - length);
  return window.reduce((total, value) => total + value, 0) / length;
}

function lastNumber(values: Array<number | null>) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && Number.isFinite(values[index])) {
      return values[index];
    }
  }

  return null;
}
