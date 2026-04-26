export function simpleMovingAverage(values: number[], endIndex: number, length: number) {
  if (length <= 0 || endIndex < length - 1) {
    return null;
  }

  let sum = 0;
  for (let index = endIndex - length + 1; index <= endIndex; index += 1) {
    sum += values[index];
  }

  return sum / length;
}

export function momentum(values: number[], endIndex: number, lookback: number) {
  if (lookback <= 0 || endIndex < lookback) {
    return null;
  }

  const current = values[endIndex];
  const previous = values[endIndex - lookback];

  if (previous === 0) {
    return null;
  }

  return current / previous - 1;
}

export function maxDrawdown(values: number[]) {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdownPct = 0;

  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak <= 0) {
      continue;
    }

    const drawdown = value / peak - 1;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdown);
  }

  return maxDrawdownPct;
}

export function annualizedReturn(startValue: number, endValue: number, years: number) {
  if (startValue <= 0 || endValue <= 0 || years <= 0) {
    return 0;
  }

  return Math.pow(endValue / startValue, 1 / years) - 1;
}
