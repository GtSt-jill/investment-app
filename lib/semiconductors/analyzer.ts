import {
  average,
  averageTrueRange,
  bollingerBands,
  macd,
  momentum,
  movingAverageSeries,
  relativeStrengthIndex,
  simpleMovingAverage
} from "@/lib/semiconductors/indicators";
import {
  DEFAULT_SEMICONDUCTOR_UNIVERSE,
  DEFAULT_MARKET_UNIVERSE,
  type IndicatorSnapshot,
  type FactorAnalysisSnapshot,
  type MarketAnalysisResult,
  type MarketRegime,
  type NormalizedTechnicalSnapshot,
  type PriceBar,
  type RecommendationItem,
  type ScoreAdjustment,
  type ScoreBreakdown,
  type SignalAction,
  type SignalChange,
  type SignalRating,
  type SymbolProfile
} from "@/lib/semiconductors/types";
import { normalizeSymbolSnapshot } from "@/lib/semiconductors/normalization";
import { calculateCapmExposure } from "@/lib/semiconductors/factors";

export const MINIMUM_BARS = 252;

const SCORE_WEIGHTS = {
  trendScore: 0.3,
  momentumScore: 0.25,
  relativeStrengthScore: 0.2,
  riskScore: 0.15,
  volumeScore: 0.1
} satisfies Record<keyof ScoreBreakdown, number>;

const RATING_THRESHOLDS = {
  strongBuy: 80,
  buy: 65,
  watch: 45,
  sell: 30
} as const;

const MARKET_REGIME_RULES = {
  bullish: {
    penalty: 0,
    buyThreshold: RATING_THRESHOLDS.buy,
    label: "Bullish market regime"
  },
  neutral: {
    penalty: 3,
    buyThreshold: RATING_THRESHOLDS.buy + 3,
    label: "Neutral market regime"
  },
  defensive: {
    penalty: 10,
    buyThreshold: RATING_THRESHOLDS.strongBuy,
    label: "Defensive market regime"
  }
} satisfies Record<MarketRegime, { penalty: number; buyThreshold: number; label: string }>;

const RELATIVE_STRENGTH_WEIGHTS = {
  momentum20: 0.25,
  momentum63: 0.45,
  momentum126: 0.3
} satisfies Record<"momentum20" | "momentum63" | "momentum126", number>;

const RISK_THRESHOLDS = {
  elevatedAtrPct: 0.075,
  deepDrawdownPct: -0.22
} as const;

const VOLUME_THRESHOLDS = {
  expansionRatio: 1.2,
  strongExpansionRatio: 1.35
} as const;

export interface AnalyzeSemiconductorsOptions {
  previousActions?: Partial<Record<string, SignalAction>>;
  marketBars?: {
    semiconductor?: PriceBar[];
    qqq?: PriceBar[];
  };
}

export function analyzeSemiconductors(
  barsBySymbol: Record<string, PriceBar[]>,
  universe: SymbolProfile[] = [...DEFAULT_SEMICONDUCTOR_UNIVERSE],
  options: AnalyzeSemiconductorsOptions = {}
): MarketAnalysisResult {
  const normalizedMarketBars = {
    semiconductor: normalizeBars(options.marketBars?.semiconductor ?? []),
    qqq: normalizeBars(options.marketBars?.qqq ?? [])
  };
  const baseRows = universe
    .map((profile) =>
      buildRecommendation(
        profile,
        normalizeBars(barsBySymbol[profile.symbol] ?? []),
        options.previousActions?.[profile.symbol],
        normalizedMarketBars
      )
    )
    .filter((row): row is RecommendationItem => row !== null);
  const analysisAsOf = latestDate(baseRows);
  const freshRows = analysisAsOf === "" ? baseRows : baseRows.filter((row) => row.asOf === analysisAsOf);
  const analyzedSymbols = new Set(freshRows.map((row) => row.symbol));
  const excludedSymbols = universe.map((profile) => profile.symbol).filter((symbol) => !analyzedSymbols.has(symbol));
  const marketRegime = calculateMarketRegime(normalizedMarketBars);

  const recommendations = applyRelativeStrengthScores(freshRows)
    .map((row) => applyMarketRegimeFilter(row, marketRegime))
    .map((row) => applyEarningsRiskFilter(row, row.earningsDate, row.asOf))
    .sort((left, right) => right.score - left.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const buyCandidates = recommendations.filter((row) => row.action === "BUY");
  const sellCandidates = recommendations.filter((row) => row.action === "SELL");
  const watchlist = recommendations.filter((row) => row.action === "HOLD");
  const asOf = latestDate(recommendations);
  const averageScore =
    recommendations.length === 0
      ? 0
      : recommendations.reduce((total, row) => total + row.score, 0) / recommendations.length;

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    universe,
    recommendations,
    buyCandidates,
    sellCandidates,
    watchlist,
    summary: {
      analyzedSymbols: recommendations.length,
      averageScore,
      strongestSymbol: recommendations[0]?.symbol ?? null,
      weakestSymbol: recommendations[recommendations.length - 1]?.symbol ?? null,
      marketBias: marketRegime === "neutral" ? inferMarketBias(recommendations) : marketRegime,
      marketRegime,
      excludedSymbols
    },
    notes: [
      "終値ベースの日足テクニカル分析です。約定価格、スリッページ、決算発表、ニュース、流動性は別途確認してください。",
      "BUY は買い検討または強気監視を意味し、即時の全力買いを推奨するものではありません。",
      "SELL は弱含みまたは新規買い回避を意味し、保有銘柄の売却を断定するものではありません。",
      `200日線を使うため、日足が${MINIMUM_BARS}本未満の銘柄は分析対象外です。`
    ]
  };
}

function buildRecommendation(
  profile: SymbolProfile,
  bars: PriceBar[],
  previousAction?: SignalAction,
  marketBars?: AnalyzeSemiconductorsOptions["marketBars"]
): RecommendationItem | null {
  if (bars.length < MINIMUM_BARS) {
    return null;
  }

  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2] ?? latest;
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const sma200 = simpleMovingAverage(closes, 200);

  if (sma200 === null) {
    return null;
  }

  const rsi14 = relativeStrengthIndex(closes, 14);
  const macdSnapshot = macd(closes);
  const bands = bollingerBands(closes);
  const atr14 = averageTrueRange(bars, 14);
  const volume5 = average(volumes, 5);
  const volume20 = average(volumes, 20);
  const highWindow = closes.slice(Math.max(0, closes.length - 126));
  const recentHigh = Math.max(...highWindow);

  const indicators: IndicatorSnapshot = {
    close: latest.close,
    previousClose: previous.close,
    dayChangePct: previous.close > 0 ? latest.close / previous.close - 1 : 0,
    sma20,
    sma50,
    sma200,
    rsi14,
    macd: macdSnapshot.macd,
    macdSignal: macdSnapshot.signal,
    macdHistogram: macdSnapshot.histogram,
    macdHistogramPrevious: macdSnapshot.previousHistogram,
    bollingerUpper: bands.upper,
    bollingerLower: bands.lower,
    atr14,
    atrPct: atr14 === null ? null : atr14 / latest.close,
    volume5,
    volume20,
    volumeRatio: volume20 === null || volume20 === 0 ? null : latest.volume / volume20,
    volume5To20Ratio: volume5 === null || volume20 === null || volume20 === 0 ? null : volume5 / volume20,
    momentum20: momentum(closes, 20),
    momentum63: momentum(closes, 63),
    momentum126: momentum(closes, 126),
    drawdownFromHigh: recentHigh > 0 ? latest.close / recentHigh - 1 : null,
    longTermTrendUnavailable: false
  };

  const scoreBreakdown = buildBaseScoreBreakdown(indicators);
  const normalizedTechnicals = buildNormalizedTechnicalSnapshot(bars);
  const factorAnalysis = buildFactorAnalysisSnapshot(bars, marketBars);
  const scoreAdjustments = [
    ...buildNormalizedScoreAdjustments(normalizedTechnicals),
    ...buildFactorScoreAdjustments(factorAnalysis)
  ];
  const score = calculateAdjustedScore(scoreBreakdown, scoreAdjustments);
  const rating = ratingFromScore(score);
  const action = actionFromRating(rating);
  const explanation = buildExplanation(indicators, scoreBreakdown, normalizedTechnicals);

  return {
    symbol: profile.symbol,
    name: profile.name,
    segment: profile.segment,
    category: profile.category,
    asOf: latest.date,
    rating,
    action,
    previousAction,
    signalChange: calculateSignalChange(previousAction, action),
    score,
    scoreBreakdown,
    scoreAdjustments,
    rank: 0,
    relativeStrengthRank: 0,
    earningsDate: profile.earningsDate,
    indicators,
    normalizedTechnicals,
    factorAnalysis,
    reasons: explanation.reasons,
    risks: explanation.risks,
    buyZone: buildBuyZone(indicators),
    chart: buildChart(bars, closes)
  } satisfies RecommendationItem;
}

export function analyzeMarketUniverse(
  barsBySymbol: Record<string, PriceBar[]>,
  universe: SymbolProfile[] = [...DEFAULT_MARKET_UNIVERSE],
  options: AnalyzeSemiconductorsOptions = {}
): MarketAnalysisResult {
  return analyzeSemiconductors(barsBySymbol, universe, options);
}

function buildBaseScoreBreakdown(indicators: IndicatorSnapshot): ScoreBreakdown {
  return {
    trendScore: calculateTrendScore(indicators),
    momentumScore: calculateMomentumScore(indicators),
    relativeStrengthScore: 50,
    riskScore: calculateRiskScore(indicators),
    volumeScore: calculateVolumeScore(indicators)
  };
}

function calculateTrendScore(indicators: IndicatorSnapshot) {
  const sma20Distance = percentageDistance(indicators.close, indicators.sma20);
  const sma50Distance = percentageDistance(indicators.close, indicators.sma50);
  const sma200Distance = percentageDistance(indicators.close, indicators.sma200);
  let score = 0;

  score += indicators.sma20 !== null && indicators.close > indicators.sma20 ? 15 : 5;
  score += indicators.sma50 !== null && indicators.close > indicators.sma50 ? 25 : 6;
  score += indicators.sma200 !== null && indicators.close > indicators.sma200 ? 35 : 0;
  score += indicators.sma50 !== null && indicators.sma200 !== null && indicators.sma50 > indicators.sma200 ? 15 : 4;

  const distanceScore = [sma20Distance, sma50Distance, sma200Distance]
    .filter((value): value is number => value !== null)
    .reduce((total, distance) => total + clamp(50 + distance * 180, 0, 100), 0);
  const distanceCount = [sma20Distance, sma50Distance, sma200Distance].filter((value) => value !== null).length || 1;

  score += (distanceScore / distanceCount) * 0.1;
  return clamp(Math.round(score), 0, 100);
}

function calculateMomentumScore(indicators: IndicatorSnapshot) {
  const shortTerm = scoreFromRange(indicators.momentum20, -0.08, 0.12);
  const mediumTerm = scoreFromRange(indicators.momentum63, -0.15, 0.28);
  const longTerm = scoreFromRange(indicators.momentum126, -0.22, 0.42);
  const macdScore = scoreMacd(indicators.macdHistogram, indicators.macdHistogramPrevious);

  return clamp(Math.round(shortTerm * 0.25 + mediumTerm * 0.4 + longTerm * 0.2 + macdScore * 0.15), 0, 100);
}

function calculateRiskScore(indicators: IndicatorSnapshot) {
  const atrScore = scoreLowIsBetter(indicators.atrPct, 0.025, RISK_THRESHOLDS.elevatedAtrPct, 20);
  const drawdownScore = scoreDrawdown(indicators.drawdownFromHigh);

  return clamp(Math.round(atrScore * 0.45 + drawdownScore * 0.55), 0, 100);
}

function calculateVolumeScore(indicators: IndicatorSnapshot) {
  const latestRatio = indicators.volumeRatio ?? 1;
  const fiveDayRatio = indicators.volume5To20Ratio ?? 1;
  const direction = indicators.dayChangePct > 0 ? 1 : indicators.dayChangePct < 0 ? -1 : 0;
  let score = 50;

  if (latestRatio >= VOLUME_THRESHOLDS.strongExpansionRatio) {
    score += direction > 0 ? 18 : direction < 0 ? -18 : 4;
  } else if (latestRatio >= VOLUME_THRESHOLDS.expansionRatio) {
    score += direction > 0 ? 10 : direction < 0 ? -10 : 2;
  }

  if (fiveDayRatio >= VOLUME_THRESHOLDS.strongExpansionRatio) {
    score += direction >= 0 ? 16 : -12;
  } else if (fiveDayRatio >= VOLUME_THRESHOLDS.expansionRatio) {
    score += direction >= 0 ? 8 : -6;
  } else if (fiveDayRatio < 0.75 && indicators.momentum20 !== null && indicators.momentum20 > 0.04) {
    score -= 8;
  }

  return clamp(Math.round(score), 0, 100);
}

function calculateFinalScore(scoreBreakdown: ScoreBreakdown) {
  const weightedScore = Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => {
    return total + scoreBreakdown[key as keyof ScoreBreakdown] * weight;
  }, 0);

  return clamp(Math.round(weightedScore), 0, 100);
}

function calculateAdjustedScore(scoreBreakdown: ScoreBreakdown, adjustments: ScoreAdjustment[] = []) {
  const baseScore = calculateFinalScore(scoreBreakdown);
  const adjustmentTotal = adjustments.reduce((total, adjustment) => total + adjustment.value, 0);
  const adjustedScore = clamp(Math.round(baseScore + adjustmentTotal), 0, 100);

  if (baseScore < RATING_THRESHOLDS.buy && adjustedScore >= RATING_THRESHOLDS.buy) {
    return RATING_THRESHOLDS.buy - 1;
  }

  return adjustedScore;
}

function applyRelativeStrengthScores(rows: RecommendationItem[]) {
  const size = Math.max(1, rows.length);
  const horizonScores = buildRelativeStrengthHorizonScores(rows);
  const compositeScores = new Map(
    rows.map((row) => {
      const symbolScores = horizonScores.get(row.symbol);
      const relativeStrengthScore =
        symbolScores === undefined
          ? 50
          : symbolScores.momentum20 * RELATIVE_STRENGTH_WEIGHTS.momentum20 +
            symbolScores.momentum63 * RELATIVE_STRENGTH_WEIGHTS.momentum63 +
            symbolScores.momentum126 * RELATIVE_STRENGTH_WEIGHTS.momentum126;

      return [row.symbol, relativeStrengthScore];
    })
  );
  const rankedByComposite = [...rows].sort((left, right) => {
    const scoreDelta = (compositeScores.get(right.symbol) ?? 0) - (compositeScores.get(left.symbol) ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.symbol.localeCompare(right.symbol);
  });
  const rankBySymbol = new Map(rankedByComposite.map((row, index) => [row.symbol, index + 1]));

  return rows.map((row) => {
    const relativeStrengthRank = rankBySymbol.get(row.symbol) ?? size;
    const relativeStrengthScore = size === 1 ? 50 : (compositeScores.get(row.symbol) ?? 50);
    const scoreBreakdown = {
      ...row.scoreBreakdown,
      relativeStrengthScore: Math.round(relativeStrengthScore)
    };
    const score = calculateAdjustedScore(scoreBreakdown, row.scoreAdjustments);
    const rating = ratingFromScore(score);
    const action = actionFromRating(rating);
    const reasons = [...row.reasons];
    const risks = [...row.risks];

    if (relativeStrengthScore >= 75) {
      reasons.unshift("セクター内の相対強度が上位");
    } else if (relativeStrengthScore <= 25) {
      risks.unshift("セクター内の相対強度が下位");
    }

    return {
      ...row,
      score,
      rating,
      action,
      signalChange: calculateSignalChange(row.previousAction, action),
      scoreBreakdown,
      relativeStrengthRank,
      reasons: unique(reasons).slice(0, 5),
      risks: unique(risks).slice(0, 4)
    };
  });
}

function buildRelativeStrengthHorizonScores(rows: RecommendationItem[]) {
  const scores = new Map<string, { momentum20: number; momentum63: number; momentum126: number }>();

  for (const row of rows) {
    scores.set(row.symbol, {
      momentum20: 50,
      momentum63: 50,
      momentum126: 50
    });
  }

  for (const horizon of Object.keys(RELATIVE_STRENGTH_WEIGHTS) as Array<keyof typeof RELATIVE_STRENGTH_WEIGHTS>) {
    const ranked = [...rows].sort((left, right) => {
      const leftMomentum = left.indicators[horizon] ?? -Infinity;
      const rightMomentum = right.indicators[horizon] ?? -Infinity;
      const momentumDelta = rightMomentum - leftMomentum;
      if (momentumDelta !== 0) {
        return momentumDelta;
      }

      return left.symbol.localeCompare(right.symbol);
    });

    const size = Math.max(1, ranked.length);
    ranked.forEach((row, index) => {
      const symbolScores = scores.get(row.symbol);
      if (symbolScores === undefined) {
        return;
      }

      symbolScores[horizon] = size === 1 ? 50 : ((size - index - 1) / (size - 1)) * 100;
    });
  }

  return scores;
}

function applyMarketRegimeFilter(row: RecommendationItem, marketRegime: MarketRegime) {
  const rule = MARKET_REGIME_RULES[marketRegime];
  if (rule.penalty === 0 && rule.buyThreshold === RATING_THRESHOLDS.buy) {
    return { ...row, marketRegime };
  }

  const marketAdjustments: ScoreAdjustment[] = [];
  let score = clamp(row.score - rule.penalty, 0, 100);

  if (rule.penalty !== 0) {
    marketAdjustments.push({
      source: "market-regime",
      label: rule.label,
      value: -rule.penalty
    });
  }

  if (score >= RATING_THRESHOLDS.buy && score < rule.buyThreshold) {
    const thresholdPenalty = score - (RATING_THRESHOLDS.buy - 1);
    score = RATING_THRESHOLDS.buy - 1;
    marketAdjustments.push({
      source: "market-regime",
      label: `${rule.label} entry threshold`,
      value: -thresholdPenalty
    });
  }

  const scoreAdjustments = [...(row.scoreAdjustments ?? []), ...marketAdjustments];
  const rating = ratingFromScore(score);
  const action = actionFromRating(rating);
  const risks =
    marketRegime === "defensive"
      ? unique(["市場環境が守り寄りのため、新規エントリーは慎重に確認", ...row.risks]).slice(0, 4)
      : marketRegime === "neutral"
        ? unique(["市場環境が中立のため、買い判定にはより強い確認が必要", ...row.risks]).slice(0, 4)
      : row.risks;

  return {
    ...row,
    marketRegime,
    score,
    scoreAdjustments,
    rating,
    action,
    signalChange: calculateSignalChange(row.previousAction, action),
    risks
  };
}

export function applyEarningsRiskFilter(row: RecommendationItem, earningsDate?: string, asOf = row.asOf): RecommendationItem {
  if (!earningsDate || !isWithinBusinessDays(asOf, earningsDate, 5)) {
    return row;
  }

  const action = row.action === "BUY" ? "HOLD" : row.action;
  const rating = row.action === "BUY" ? "WATCH" : row.rating;
  const score = row.action === "BUY" ? Math.min(row.score, RATING_THRESHOLDS.buy - 1) : row.score;
  const adjustmentValue = score - row.score;
  const scoreAdjustments =
    adjustmentValue === 0
      ? row.scoreAdjustments
      : [
          ...(row.scoreAdjustments ?? []),
          {
            source: "earnings",
            label: "Upcoming earnings blackout",
            value: adjustmentValue
          } satisfies ScoreAdjustment
        ];

  return {
    ...row,
    earningsDate,
    action,
    rating,
    score,
    scoreAdjustments,
    signalChange: calculateSignalChange(row.previousAction, action),
    risks: unique(["決算前のため新規エントリー注意", ...row.risks]).slice(0, 4)
  };
}

function buildBuyZone(indicators: IndicatorSnapshot) {
  const atr = indicators.atr14 ?? indicators.close * 0.04;
  const trendReference = Math.max(indicators.sma20 ?? 0, indicators.sma50 ?? 0, indicators.close - atr);
  const idealEntry = Math.min(indicators.close, trendReference + atr * 0.35);
  const pullbackEntry = indicators.sma20 ?? indicators.close - atr;
  const stopLoss = defensiveStopLoss(indicators.close, atr, indicators.sma50);
  const takeProfit = indicators.close + atr * 3;

  return {
    idealEntry,
    pullbackEntry,
    stopLoss,
    takeProfit
  };
}

// 防衛的な損切りライン。ATRだけでなく50日線近辺も見て、損失限定側の高い価格を採用する。
export function defensiveStopLoss(currentPrice: number, atr: number | null, sma50: number | null) {
  const resolvedAtr = atr ?? currentPrice * 0.04;
  const atrLine = currentPrice - resolvedAtr * 2.2;
  const smaLine = sma50 === null ? atrLine : sma50 * 0.96;
  const stopCandidates = [atrLine, smaLine].filter((value) => value < currentPrice);
  const rawStop = stopCandidates.length === 0 ? currentPrice - resolvedAtr * 2.2 : Math.max(...stopCandidates);

  return Math.max(0.01, rawStop);
}

export function calculateSignalChange(previousAction: SignalAction | undefined, currentAction: SignalAction): SignalChange {
  if (previousAction === undefined) {
    if (currentAction === "BUY") {
      return "NEW_BUY";
    }
    if (currentAction === "SELL") {
      return "NEW_SELL";
    }
    return "NO_CHANGE";
  }

  if (previousAction === currentAction) {
    if (currentAction === "BUY") {
      return "BUY_CONTINUATION";
    }
    if (currentAction === "SELL") {
      return "SELL_CONTINUATION";
    }
    return "NO_CHANGE";
  }

  if (previousAction === "BUY" && currentAction === "HOLD") {
    return "BUY_TO_HOLD";
  }
  if (previousAction === "HOLD" && currentAction === "BUY") {
    return "HOLD_TO_BUY";
  }
  if (previousAction === "SELL" && currentAction === "HOLD") {
    return "SELL_TO_HOLD";
  }
  if (currentAction === "BUY") {
    return "HOLD_TO_BUY";
  }
  if (currentAction === "SELL") {
    return "NEW_SELL";
  }

  return "NO_CHANGE";
}

export function calculateMarketRegime(marketBars?: AnalyzeSemiconductorsOptions["marketBars"]): MarketRegime {
  const semiconductorCloses = normalizeBars(marketBars?.semiconductor ?? []).map((bar) => bar.close);
  const qqqCloses = normalizeBars(marketBars?.qqq ?? []).map((bar) => bar.close);
  const semiconductorClose = semiconductorCloses[semiconductorCloses.length - 1];
  const qqqClose = qqqCloses[qqqCloses.length - 1];
  const semiconductorSma50 = simpleMovingAverage(semiconductorCloses, 50);
  const qqqSma50 = simpleMovingAverage(qqqCloses, 50);
  const qqqSma200 = simpleMovingAverage(qqqCloses, 200);

  if (
    semiconductorClose === undefined ||
    qqqClose === undefined ||
    semiconductorSma50 === null ||
    qqqSma50 === null
  ) {
    return "neutral";
  }

  const semiconductorAbove50 = semiconductorClose > semiconductorSma50;
  const qqqAbove50 = qqqClose > qqqSma50;
  const qqqBelow200 = qqqSma200 !== null && qqqClose < qqqSma200;

  if ((!semiconductorAbove50 && !qqqAbove50) || qqqBelow200) {
    return "defensive";
  }
  if (semiconductorAbove50 && qqqAbove50) {
    return "bullish";
  }

  return "neutral";
}

function buildChart(bars: PriceBar[], closes: number[]) {
  const sma20 = movingAverageSeries(closes, 20);
  const sma50 = movingAverageSeries(closes, 50);
  const start = Math.max(0, bars.length - 180);

  return bars.slice(start).map((bar, offset) => {
    const index = start + offset;
    return {
      date: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      sma20: sma20[index] ?? null,
      sma50: sma50[index] ?? null
    };
  });
}

function buildExplanation(
  indicators: IndicatorSnapshot,
  scoreBreakdown: ScoreBreakdown,
  normalizedTechnicals?: NormalizedTechnicalSnapshot
) {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (scoreBreakdown.trendScore >= 70) {
    reasons.push("短期・中期・長期のトレンド構造が良好");
  } else if (scoreBreakdown.trendScore <= 40) {
    risks.push("移動平均線ベースのトレンドが弱い");
  }

  if (scoreBreakdown.momentumScore >= 70) {
    reasons.push("複数期間のモメンタムが上向き");
  } else if (scoreBreakdown.momentumScore <= 40) {
    risks.push("モメンタムが弱く、上昇の勢いが不足");
  }

  if (indicators.rsi14 !== null && indicators.rsi14 > 78) {
    risks.push("RSIが過熱圏で短期反落に注意");
  } else if (indicators.rsi14 !== null && indicators.rsi14 >= 50 && indicators.rsi14 <= 68) {
    reasons.push("RSIが強すぎず弱すぎない範囲");
  }

  if (scoreBreakdown.riskScore <= 45) {
    risks.push("ATRまたは高値からの下落率が大きく、値幅リスクが高い");
  }

  if (scoreBreakdown.volumeScore >= 65) {
    reasons.push("出来高増を伴う上昇が確認できる");
  } else if (scoreBreakdown.volumeScore <= 40) {
    risks.push("出来高面では買いの裏付けが弱い、または売り圧力が強い");
  }

  if ((normalizedTechnicals?.momentum63Percentile ?? 50) >= 75) {
    reasons.push("銘柄自身の過去レンジ比でも中期モメンタムが上位");
  } else if ((normalizedTechnicals?.momentum63Percentile ?? 50) <= 25) {
    risks.push("銘柄自身の過去レンジ比で中期モメンタムが下位");
  }

  if ((normalizedTechnicals?.atrPctPercentile ?? 50) >= 85) {
    risks.push("銘柄自身の過去レンジ比でATRが高く、通常より値幅が大きい");
  }

  return {
    reasons: unique(reasons).slice(0, 5),
    risks: risks.length > 0 ? unique(risks).slice(0, 4) : ["決算日と指数全体の地合いは別途確認が必要"]
  };
}

function buildNormalizedTechnicalSnapshot(bars: PriceBar[]): NormalizedTechnicalSnapshot {
  const normalized = normalizeSymbolSnapshot(bars, {
    lookback: 252,
    minSamples: 60,
    atrLength: 14,
    zScoreWindow: 126
  });

  return {
    closePercentileRank: normalized.closePercentileRank,
    closeZScore: normalized.closeZScore,
    atrPctPercentile: normalized.atrPercentile,
    momentum20Percentile: normalized.momentum20Percentile,
    momentum63Percentile: normalized.momentum63Percentile,
    momentum126Percentile: normalized.momentum126Percentile
  };
}

function buildNormalizedScoreAdjustments(normalized: NormalizedTechnicalSnapshot): ScoreAdjustment[] {
  const adjustments: ScoreAdjustment[] = [];

  if (normalized.momentum63Percentile !== null) {
    if (normalized.momentum63Percentile >= 80) {
      adjustments.push({ source: "normalization", label: "Own-history 63D momentum leadership", value: 3 });
    } else if (normalized.momentum63Percentile <= 20) {
      adjustments.push({ source: "normalization", label: "Own-history 63D momentum weakness", value: -3 });
    }
  }

  if (normalized.momentum126Percentile !== null) {
    if (normalized.momentum126Percentile >= 75) {
      adjustments.push({ source: "normalization", label: "Own-history 126D momentum leadership", value: 2 });
    } else if (normalized.momentum126Percentile <= 25) {
      adjustments.push({ source: "normalization", label: "Own-history 126D momentum weakness", value: -2 });
    }
  }

  if (normalized.atrPctPercentile !== null) {
    if (normalized.atrPctPercentile >= 90) {
      adjustments.push({ source: "normalization", label: "Own-history ATR extreme", value: -4 });
    } else if (normalized.atrPctPercentile >= 80) {
      adjustments.push({ source: "normalization", label: "Own-history ATR elevated", value: -2 });
    } else if (normalized.atrPctPercentile <= 35) {
      adjustments.push({ source: "normalization", label: "Own-history ATR contained", value: 1 });
    }
  }

  if (normalized.closeZScore !== null && normalized.closeZScore > 2.5) {
    adjustments.push({ source: "normalization", label: "Price extended versus own history", value: -2 });
  }

  return adjustments;
}

function buildFactorAnalysisSnapshot(
  bars: PriceBar[],
  marketBars?: AnalyzeSemiconductorsOptions["marketBars"]
): FactorAnalysisSnapshot | undefined {
  const qqqBars = marketBars?.qqq ?? [];
  const semiconductorBars = marketBars?.semiconductor ?? [];

  if (qqqBars.length < 80 && semiconductorBars.length < 80) {
    return undefined;
  }

  const marketExposure =
    qqqBars.length >= 80 ? calculateCapmExposure(bars, qqqBars, { minObservations: 60 }) : null;
  const sectorExposure =
    semiconductorBars.length >= 80 ? calculateCapmExposure(bars, semiconductorBars, { minObservations: 60 }) : null;
  const factorScores = [marketExposure?.factorScore, sectorExposure?.factorScore].filter((value): value is number =>
    Number.isFinite(value)
  );

  return {
    marketBeta: marketExposure?.beta ?? null,
    sectorBeta: sectorExposure?.beta ?? null,
    alpha: marketExposure?.annualizedAlpha ?? marketExposure?.alpha ?? null,
    residualVolatility: marketExposure?.annualizedResidualVolatility ?? marketExposure?.residualVolatility ?? null,
    factorScore: factorScores.length === 0 ? null : Math.round(average(factorScores, factorScores.length) ?? 50),
    observations: Math.max(marketExposure?.observations ?? 0, sectorExposure?.observations ?? 0)
  };
}

function buildFactorScoreAdjustments(factorAnalysis: FactorAnalysisSnapshot | undefined): ScoreAdjustment[] {
  if (!factorAnalysis || factorAnalysis.factorScore === null || factorAnalysis.observations < 60) {
    return [];
  }

  const adjustments: ScoreAdjustment[] = [];

  if (factorAnalysis.factorScore >= 75) {
    adjustments.push({ source: "factor", label: "Positive factor-adjusted profile", value: 2 });
  } else if (factorAnalysis.factorScore <= 35) {
    adjustments.push({ source: "factor", label: "Weak factor-adjusted profile", value: -2 });
  }

  if ((factorAnalysis.marketBeta ?? 1) > 1.8 && (factorAnalysis.residualVolatility ?? 0) > 0.55) {
    adjustments.push({ source: "factor", label: "High beta and residual volatility", value: -2 });
  }

  return adjustments;
}

function ratingFromScore(score: number): SignalRating {
  if (score >= RATING_THRESHOLDS.strongBuy) {
    return "STRONG_BUY";
  }
  if (score >= RATING_THRESHOLDS.buy) {
    return "BUY";
  }
  if (score >= RATING_THRESHOLDS.watch) {
    return "WATCH";
  }
  if (score >= RATING_THRESHOLDS.sell) {
    return "SELL";
  }

  return "STRONG_SELL";
}

function actionFromRating(rating: SignalRating): SignalAction {
  if (rating === "STRONG_BUY" || rating === "BUY") {
    return "BUY";
  }
  if (rating === "SELL" || rating === "STRONG_SELL") {
    return "SELL";
  }

  return "HOLD";
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

function latestDate(rows: RecommendationItem[]) {
  return rows.reduce((latest, row) => (row.asOf > latest ? row.asOf : latest), rows[0]?.asOf ?? "");
}

function inferMarketBias(rows: RecommendationItem[]): MarketRegime {
  if (rows.length === 0) {
    return "neutral";
  }

  const buyRatio = rows.filter((row) => row.action === "BUY").length / rows.length;
  const sellRatio = rows.filter((row) => row.action === "SELL").length / rows.length;

  if (buyRatio >= 0.4) {
    return "bullish";
  }
  if (sellRatio >= 0.4) {
    return "defensive";
  }

  return "neutral";
}

function scoreFromRange(value: number | null, low: number, high: number) {
  if (value === null) {
    return 50;
  }

  return clamp(((value - low) / (high - low)) * 100, 0, 100);
}

function scoreLowIsBetter(value: number | null, good: number, poor: number, floor: number) {
  if (value === null) {
    return 60;
  }
  if (value <= good) {
    return 95;
  }
  if (value >= poor) {
    return floor;
  }

  return clamp(95 - ((value - good) / (poor - good)) * (95 - floor), floor, 95);
}

function scoreDrawdown(drawdown: number | null) {
  if (drawdown === null) {
    return 60;
  }
  if (drawdown >= -0.05) {
    return 95;
  }
  if (drawdown <= RISK_THRESHOLDS.deepDrawdownPct) {
    return 20;
  }

  return clamp(95 - ((Math.abs(drawdown) - 0.05) / (Math.abs(RISK_THRESHOLDS.deepDrawdownPct) - 0.05)) * 75, 20, 95);
}

function scoreMacd(current: number | null, previous: number | null) {
  if (current === null) {
    return 50;
  }

  const expanding = previous !== null ? current > previous : current > 0;

  if (current > 0 && expanding) {
    return 82;
  }
  if (current > 0) {
    return 66;
  }
  if (expanding) {
    return 45;
  }

  return 28;
}

function percentageDistance(value: number, reference: number | null) {
  if (reference === null || reference <= 0) {
    return null;
  }

  return value / reference - 1;
}

function isWithinBusinessDays(asOf: string, targetDate: string, businessDays: number) {
  const start = parseUtcDate(asOf);
  const target = parseUtcDate(targetDate);

  if (start === null || target === null || target < start) {
    return false;
  }

  let cursor = new Date(start);
  let days = 0;

  while (cursor < target) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      days += 1;
    }
  }

  return days <= businessDays;
}

function parseUtcDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
