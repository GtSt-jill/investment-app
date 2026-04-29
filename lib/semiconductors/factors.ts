import type { PriceBar } from "@/lib/semiconductors/types";

export interface FactorObservation {
  date: string;
  value: number;
}

export type FactorSeriesInput = PriceBar[] | FactorObservation[];

export interface ReturnOptions {
  method?: "simple" | "log";
}

export interface FactorExposureOptions {
  minObservations?: number;
  riskFreeRate?: number | FactorObservation[];
  annualizationPeriods?: number;
  factorReturnsAreExcess?: boolean;
}

export interface CapmExposure {
  model: "CAPM";
  observations: number;
  startDate: string | null;
  endDate: string | null;
  alpha: number | null;
  annualizedAlpha: number | null;
  beta: number | null;
  rSquared: number | null;
  correlation: number | null;
  residualVolatility: number | null;
  annualizedResidualVolatility: number | null;
  assetMeanReturn: number | null;
  marketMeanReturn: number | null;
  assetExcessMeanReturn: number | null;
  marketExcessMeanReturn: number | null;
  factorScore: number;
}

export interface MultiFactorExposure {
  model: "MULTI_FACTOR";
  observations: number;
  startDate: string | null;
  endDate: string | null;
  alpha: number | null;
  annualizedAlpha: number | null;
  exposures: Record<string, number>;
  rSquared: number | null;
  residualVolatility: number | null;
  annualizedResidualVolatility: number | null;
  assetMeanReturn: number | null;
  assetExcessMeanReturn: number | null;
  factorMeans: Record<string, number | null>;
  factorScore: number;
}

interface RegressionResult {
  alpha: number;
  betas: number[];
  rSquared: number | null;
  residualVolatility: number | null;
}

const DEFAULT_MIN_OBSERVATIONS = 2;
const DEFAULT_ANNUALIZATION_PERIODS = 252;

export function calculateReturns(bars: PriceBar[], options: ReturnOptions = {}): FactorObservation[] {
  const method = options.method ?? "simple";
  const normalized = normalizeBars(bars);
  const returns: FactorObservation[] = [];

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];

    if (previous.close <= 0 || current.close <= 0) {
      continue;
    }

    const value = method === "log" ? Math.log(current.close / previous.close) : current.close / previous.close - 1;
    if (Number.isFinite(value)) {
      returns.push({ date: current.date, value });
    }
  }

  return returns;
}

export function calculateExcessReturns(
  returns: FactorObservation[],
  riskFreeRate: number | FactorObservation[] = 0
): FactorObservation[] {
  const normalizedReturns = normalizeObservations(returns);

  if (typeof riskFreeRate === "number") {
    return normalizedReturns.map((row) => ({ date: row.date, value: row.value - riskFreeRate }));
  }

  const riskFreeByDate = new Map(normalizeObservations(riskFreeRate).map((row) => [row.date, row.value]));
  return normalizedReturns.flatMap((row) => {
    const riskFreeValue = riskFreeByDate.get(row.date);
    return riskFreeValue === undefined ? [] : [{ date: row.date, value: row.value - riskFreeValue }];
  });
}

export function calculateVariance(values: number[]) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length < 2) {
    return null;
  }

  const meanValue = mean(finiteValues);
  return finiteValues.reduce((total, value) => total + (value - meanValue) ** 2, 0) / (finiteValues.length - 1);
}

export function calculateCovariance(left: number[], right: number[]) {
  const pairs = left
    .map((value, index) => [value, right[index]] as const)
    .filter(([leftValue, rightValue]) => Number.isFinite(leftValue) && Number.isFinite(rightValue));

  if (pairs.length < 2) {
    return null;
  }

  const leftMean = mean(pairs.map(([value]) => value));
  const rightMean = mean(pairs.map(([, value]) => value));

  return pairs.reduce((total, [leftValue, rightValue]) => total + (leftValue - leftMean) * (rightValue - rightMean), 0) / (pairs.length - 1);
}

export function calculateBetaFromReturns(assetReturns: FactorObservation[], marketReturns: FactorObservation[]) {
  const aligned = alignNamedSeries({ asset: assetReturns, market: marketReturns });
  if (aligned.length < 2) {
    return null;
  }

  const assetValues = aligned.map((row) => row.values.asset);
  const marketValues = aligned.map((row) => row.values.market);
  const marketVariance = calculateVariance(marketValues);
  const covariance = calculateCovariance(assetValues, marketValues);

  if (marketVariance === null || marketVariance === 0 || covariance === null) {
    return null;
  }

  return covariance / marketVariance;
}

export function calculateCapmExposure(
  assetBars: PriceBar[],
  marketBars: PriceBar[],
  options: FactorExposureOptions = {}
): CapmExposure {
  const annualizationPeriods = options.annualizationPeriods ?? DEFAULT_ANNUALIZATION_PERIODS;
  const assetReturns = calculateReturns(assetBars);
  const marketReturns = calculateReturns(marketBars);
  const assetExcessReturns = calculateExcessReturns(assetReturns, options.riskFreeRate);
  const marketExcessReturns = calculateExcessReturns(marketReturns, options.riskFreeRate);
  const alignedRaw = alignNamedSeries({ asset: assetReturns, market: marketReturns });
  const alignedExcess = alignNamedSeries({ asset: assetExcessReturns, market: marketExcessReturns });
  const minObservations = options.minObservations ?? DEFAULT_MIN_OBSERVATIONS;

  if (alignedExcess.length < minObservations) {
    return emptyCapmExposure(alignedExcess, annualizationPeriods);
  }

  const y = alignedExcess.map((row) => row.values.asset);
  const x = alignedExcess.map((row) => [row.values.market]);
  const regression = linearRegression(y, x);
  const rawMeans = seriesMeans(alignedRaw, ["asset", "market"]);
  const excessMeans = seriesMeans(alignedExcess, ["asset", "market"]);
  const beta = calculateBetaFromReturns(assetExcessReturns, marketExcessReturns);
  const correlationValue = correlation(
    alignedExcess.map((row) => row.values.asset),
    alignedExcess.map((row) => row.values.market)
  );
  const exposure: CapmExposure = {
    model: "CAPM",
    observations: alignedExcess.length,
    startDate: alignedExcess[0]?.date ?? null,
    endDate: alignedExcess[alignedExcess.length - 1]?.date ?? null,
    alpha: regression?.alpha ?? null,
    annualizedAlpha: regression === null ? null : regression.alpha * annualizationPeriods,
    beta: beta ?? regression?.betas[0] ?? null,
    rSquared: regression?.rSquared ?? null,
    correlation: correlationValue,
    residualVolatility: regression?.residualVolatility ?? null,
    annualizedResidualVolatility:
      regression?.residualVolatility === null || regression?.residualVolatility === undefined
        ? null
        : regression.residualVolatility * Math.sqrt(annualizationPeriods),
    assetMeanReturn: rawMeans.asset,
    marketMeanReturn: rawMeans.market,
    assetExcessMeanReturn: excessMeans.asset,
    marketExcessMeanReturn: excessMeans.market,
    factorScore: 0
  };

  return { ...exposure, factorScore: buildFactorScore(exposure) };
}

export function calculateMultiFactorExposure(
  assetBars: PriceBar[],
  factorSeries: Record<string, FactorSeriesInput>,
  options: FactorExposureOptions = {}
): MultiFactorExposure {
  const annualizationPeriods = options.annualizationPeriods ?? DEFAULT_ANNUALIZATION_PERIODS;
  const factorNames = Object.keys(factorSeries).sort();
  const assetReturns = calculateReturns(assetBars);
  const assetExcessReturns = calculateExcessReturns(assetReturns, options.riskFreeRate);
  const normalizedFactors = Object.fromEntries(
    factorNames.map((name) => {
      const returns = normalizeFactorInput(factorSeries[name]);
      return [name, options.factorReturnsAreExcess === false ? calculateExcessReturns(returns, options.riskFreeRate) : returns];
    })
  );
  const aligned = alignNamedSeries({ asset: assetExcessReturns, ...normalizedFactors });
  const minObservations = options.minObservations ?? Math.max(DEFAULT_MIN_OBSERVATIONS, factorNames.length + 1);

  if (factorNames.length === 0 || aligned.length < minObservations) {
    return emptyMultiFactorExposure(aligned, factorNames, annualizationPeriods);
  }

  const y = aligned.map((row) => row.values.asset);
  const x = aligned.map((row) => factorNames.map((name) => row.values[name]));
  const regression = linearRegression(y, x);
  const excessMeans = seriesMeans(aligned, ["asset"]);
  const factorMeans = seriesMeans(aligned, factorNames);
  const exposures = Object.fromEntries(factorNames.map((name, index) => [name, regression?.betas[index] ?? 0]));
  const exposure: MultiFactorExposure = {
    model: "MULTI_FACTOR",
    observations: aligned.length,
    startDate: aligned[0]?.date ?? null,
    endDate: aligned[aligned.length - 1]?.date ?? null,
    alpha: regression?.alpha ?? null,
    annualizedAlpha: regression === null ? null : regression.alpha * annualizationPeriods,
    exposures,
    rSquared: regression?.rSquared ?? null,
    residualVolatility: regression?.residualVolatility ?? null,
    annualizedResidualVolatility:
      regression?.residualVolatility === null || regression?.residualVolatility === undefined
        ? null
        : regression.residualVolatility * Math.sqrt(annualizationPeriods),
    assetMeanReturn: meanOrNull(assetReturns.map((row) => row.value)),
    assetExcessMeanReturn: excessMeans.asset,
    factorMeans,
    factorScore: 0
  };

  return { ...exposure, factorScore: buildFactorScore(exposure) };
}

export function buildFactorScore(exposure: Partial<CapmExposure | MultiFactorExposure>) {
  const alpha = exposure.annualizedAlpha ?? exposure.alpha ?? 0;
  const residualVolatility = exposure.annualizedResidualVolatility ?? exposure.residualVolatility ?? 0;
  const rSquared = exposure.rSquared ?? 0;
  const exposures = hasExposureMap(exposure) ? exposure.exposures : undefined;
  const betaPenalty =
    "beta" in exposure && typeof exposure.beta === "number"
      ? Math.abs(exposure.beta - 1) * 12
      : exposures === undefined
        ? 0
        : Math.max(0, averageAbs(Object.values(exposures)) - 1) * 10;

  const score = 50 + clamp(alpha * 200, -30, 30) + clamp(rSquared * 12, 0, 12) - clamp(residualVolatility * 35, 0, 25) - clamp(betaPenalty, 0, 20);
  return Math.round(clamp(score, 0, 100));
}

function linearRegression(y: number[], x: number[][]): RegressionResult | null {
  if (y.length === 0 || y.length !== x.length) {
    return null;
  }

  const parameterCount = (x[0]?.length ?? 0) + 1;
  if (y.length < parameterCount) {
    return null;
  }

  const matrix = Array.from({ length: parameterCount }, () => Array.from({ length: parameterCount }, () => 0));
  const rhs = Array.from({ length: parameterCount }, () => 0);

  for (let rowIndex = 0; rowIndex < y.length; rowIndex += 1) {
    const row = [1, ...x[rowIndex]];
    for (let column = 0; column < parameterCount; column += 1) {
      rhs[column] += row[column] * y[rowIndex];
      for (let inner = 0; inner < parameterCount; inner += 1) {
        matrix[column][inner] += row[column] * row[inner];
      }
    }
  }

  const coefficients = solveLinearSystem(matrix, rhs);
  if (coefficients === null) {
    return null;
  }

  const fitted = x.map((row) => coefficients[0] + row.reduce((total, value, index) => total + value * coefficients[index + 1], 0));
  const residuals = y.map((value, index) => value - fitted[index]);
  const yMean = mean(y);
  const sumSquaredResiduals = residuals.reduce((total, value) => total + value ** 2, 0);
  const totalSumSquares = y.reduce((total, value) => total + (value - yMean) ** 2, 0);
  const degreesOfFreedom = y.length - parameterCount;

  return {
    alpha: coefficients[0],
    betas: coefficients.slice(1),
    rSquared: totalSumSquares === 0 ? null : 1 - sumSquaredResiduals / totalSumSquares,
    residualVolatility: degreesOfFreedom <= 0 ? null : Math.sqrt(sumSquaredResiduals / degreesOfFreedom)
  };
}

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][column]) < 1e-12) {
      return null;
    }

    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let inner = column; inner <= size; inner += 1) {
      augmented[column][inner] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];
      for (let inner = column; inner <= size; inner += 1) {
        augmented[row][inner] -= factor * augmented[column][inner];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function normalizeFactorInput(series: FactorSeriesInput): FactorObservation[] {
  if (series.length === 0) {
    return [];
  }

  return "close" in series[0] ? calculateReturns(series as PriceBar[]) : normalizeObservations(series as FactorObservation[]);
}

function normalizeBars(bars: PriceBar[]) {
  const byDate = new Map<string, PriceBar>();

  for (const bar of bars) {
    const date = dateKey(bar.date);
    if (!date || !Number.isFinite(bar.close)) {
      continue;
    }

    byDate.set(date, { ...bar, date });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeObservations(series: FactorObservation[]) {
  const byDate = new Map<string, FactorObservation>();

  for (const row of series) {
    const date = dateKey(row.date);
    if (!date || !Number.isFinite(row.value)) {
      continue;
    }

    byDate.set(date, { date, value: row.value });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function alignNamedSeries(seriesByName: Record<string, FactorObservation[]>) {
  const names = Object.keys(seriesByName);
  const normalized = Object.fromEntries(names.map((name) => [name, normalizeObservations(seriesByName[name])]));
  const dateCounts = new Map<string, number>();

  for (const rows of Object.values(normalized)) {
    for (const row of rows) {
      dateCounts.set(row.date, (dateCounts.get(row.date) ?? 0) + 1);
    }
  }

  const byNameAndDate = Object.fromEntries(
    names.map((name) => [name, new Map(normalized[name].map((row) => [row.date, row.value]))])
  );

  return [...dateCounts.entries()]
    .filter(([, count]) => count === names.length)
    .map(([date]) => ({
      date,
      values: Object.fromEntries(names.map((name) => [name, byNameAndDate[name].get(date)!]))
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function correlation(left: number[], right: number[]) {
  const covariance = calculateCovariance(left, right);
  const leftVariance = calculateVariance(left);
  const rightVariance = calculateVariance(right);

  if (covariance === null || leftVariance === null || rightVariance === null || leftVariance === 0 || rightVariance === 0) {
    return null;
  }

  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function seriesMeans<T extends string>(rows: Array<{ values: Record<string, number> }>, names: T[]) {
  return Object.fromEntries(names.map((name) => [name, meanOrNull(rows.map((row) => row.values[name]))])) as Record<T, number | null>;
}

function emptyCapmExposure(alignedRows: Array<{ date: string }>, annualizationPeriods: number): CapmExposure {
  void annualizationPeriods;
  return {
    model: "CAPM",
    observations: alignedRows.length,
    startDate: alignedRows[0]?.date ?? null,
    endDate: alignedRows[alignedRows.length - 1]?.date ?? null,
    alpha: null,
    annualizedAlpha: null,
    beta: null,
    rSquared: null,
    correlation: null,
    residualVolatility: null,
    annualizedResidualVolatility: null,
    assetMeanReturn: null,
    marketMeanReturn: null,
    assetExcessMeanReturn: null,
    marketExcessMeanReturn: null,
    factorScore: buildFactorScore({})
  };
}

function emptyMultiFactorExposure(alignedRows: Array<{ date: string }>, factorNames: string[], annualizationPeriods: number): MultiFactorExposure {
  void annualizationPeriods;
  return {
    model: "MULTI_FACTOR",
    observations: alignedRows.length,
    startDate: alignedRows[0]?.date ?? null,
    endDate: alignedRows[alignedRows.length - 1]?.date ?? null,
    alpha: null,
    annualizedAlpha: null,
    exposures: Object.fromEntries(factorNames.map((name) => [name, 0])),
    rSquared: null,
    residualVolatility: null,
    annualizedResidualVolatility: null,
    assetMeanReturn: null,
    assetExcessMeanReturn: null,
    factorMeans: Object.fromEntries(factorNames.map((name) => [name, null])),
    factorScore: buildFactorScore({})
  };
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function meanOrNull(values: number[]) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length === 0 ? null : mean(finiteValues);
}

function averageAbs(values: number[]) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length === 0 ? 0 : mean(finiteValues.map((value) => Math.abs(value)));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function dateKey(date: string) {
  return date.trim().slice(0, 10);
}

function hasExposureMap(exposure: Partial<CapmExposure | MultiFactorExposure>): exposure is Partial<MultiFactorExposure> {
  return "exposures" in exposure && exposure.exposures !== undefined;
}
