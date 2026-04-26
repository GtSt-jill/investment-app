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
  type IndicatorSnapshot,
  type MarketAnalysisResult,
  type MarketRegime,
  type PriceBar,
  type RecommendationItem,
  type ScoreBreakdown,
  type SignalAction,
  type SignalChange,
  type SignalRating,
  type SymbolProfile
} from "@/lib/semiconductors/types";

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

const MARKET_REGIME_PENALTY = {
  bullish: 0,
  neutral: 0,
  defensive: 8
} satisfies Record<MarketRegime, number>;

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
  const baseRows = universe
    .map((profile) => buildRecommendation(profile, normalizeBars(barsBySymbol[profile.symbol] ?? []), options.previousActions?.[profile.symbol]))
    .filter((row): row is RecommendationItem => row !== null);
  const analyzedSymbols = new Set(baseRows.map((row) => row.symbol));
  const excludedSymbols = universe.map((profile) => profile.symbol).filter((symbol) => !analyzedSymbols.has(symbol));
  const marketRegime = calculateMarketRegime(options.marketBars);

  const recommendations = applyRelativeStrengthScores(baseRows)
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

function buildRecommendation(profile: SymbolProfile, bars: PriceBar[], previousAction?: SignalAction): RecommendationItem | null {
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
  const score = calculateFinalScore(scoreBreakdown);
  const rating = ratingFromScore(score);
  const action = actionFromRating(rating);
  const explanation = buildExplanation(indicators, scoreBreakdown);

  return {
    symbol: profile.symbol,
    name: profile.name,
    segment: profile.segment,
    asOf: latest.date,
    rating,
    action,
    previousAction,
    signalChange: calculateSignalChange(previousAction, action),
    score,
    scoreBreakdown,
    rank: 0,
    relativeStrengthRank: 0,
    earningsDate: profile.earningsDate,
    indicators,
    reasons: explanation.reasons,
    risks: explanation.risks,
    buyZone: buildBuyZone(indicators),
    chart: buildChart(bars, closes)
  } satisfies RecommendationItem;
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

function applyRelativeStrengthScores(rows: RecommendationItem[]) {
  const rankedByMomentum = [...rows].sort(
    (left, right) => (right.indicators.momentum63 ?? -Infinity) - (left.indicators.momentum63 ?? -Infinity)
  );
  const rankBySymbol = new Map(rankedByMomentum.map((row, index) => [row.symbol, index + 1]));
  const size = Math.max(1, rows.length);

  return rows.map((row) => {
    const relativeStrengthRank = rankBySymbol.get(row.symbol) ?? size;
    const relativeStrengthScore = size === 1 ? 50 : ((size - relativeStrengthRank) / (size - 1)) * 100;
    const scoreBreakdown = {
      ...row.scoreBreakdown,
      relativeStrengthScore: Math.round(relativeStrengthScore)
    };
    const score = calculateFinalScore(scoreBreakdown);
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

function applyMarketRegimeFilter(row: RecommendationItem, marketRegime: MarketRegime) {
  const penalty = MARKET_REGIME_PENALTY[marketRegime];
  if (penalty === 0) {
    return { ...row, marketRegime };
  }

  const score = clamp(row.score - penalty, 0, 100);
  const rating = ratingFromScore(score);
  const action = actionFromRating(rating);
  const risks =
    marketRegime === "defensive"
      ? unique(["市場環境が守り寄りのため、新規エントリーは慎重に確認", ...row.risks]).slice(0, 4)
      : row.risks;

  return {
    ...row,
    marketRegime,
    score,
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

  return {
    ...row,
    earningsDate,
    action,
    rating,
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

  return Math.max(0.01, Math.max(atrLine, smaLine));
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
  const start = Math.max(0, bars.length - 90);

  return bars.slice(start).map((bar, offset) => {
    const index = start + offset;
    return {
      date: bar.date,
      close: bar.close,
      sma20: sma20[index] ?? null,
      sma50: sma50[index] ?? null
    };
  });
}

function buildExplanation(indicators: IndicatorSnapshot, scoreBreakdown: ScoreBreakdown) {
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

  return {
    reasons: unique(reasons).slice(0, 5),
    risks: risks.length > 0 ? unique(risks).slice(0, 4) : ["決算日と指数全体の地合いは別途確認が必要"]
  };
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
