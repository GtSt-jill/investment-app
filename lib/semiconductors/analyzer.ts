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
  type PriceBar,
  type RecommendationItem,
  type SignalAction,
  type SignalRating,
  type SymbolProfile
} from "@/lib/semiconductors/types";

const MINIMUM_BARS = 80;

export function analyzeSemiconductors(
  barsBySymbol: Record<string, PriceBar[]>,
  universe: SymbolProfile[] = [...DEFAULT_SEMICONDUCTOR_UNIVERSE]
): MarketAnalysisResult {
  const rows = universe
    .map((profile) => buildRecommendation(profile, normalizeBars(barsBySymbol[profile.symbol] ?? [])))
    .filter((row): row is RecommendationItem => row !== null);

  const rankedByMomentum = [...rows].sort(
    (left, right) => (right.indicators.momentum63 ?? -Infinity) - (left.indicators.momentum63 ?? -Infinity)
  );
  const rankBySymbol = new Map(rankedByMomentum.map((row, index) => [row.symbol, index + 1]));

  const rescored = rows.map((row) => applyRelativeStrength(row, rankBySymbol.get(row.symbol) ?? rows.length, rows.length));
  const recommendations = rescored
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
      marketBias: inferMarketBias(recommendations)
    },
    notes: [
      "終値ベースの日足テクニカル分析です。約定価格、スリッページ、決算発表、ニュース、流動性は別途確認してください。",
      "BUY は今すぐ全力で買う指示ではなく、トレンド・モメンタム・相対強度がそろった監視優先度です。",
      "SELL は新規買いを避ける、または保有分の縮小・利確・損切りを検討するシグナルです。"
    ]
  };
}

function buildRecommendation(profile: SymbolProfile, bars: PriceBar[]) {
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
  const rsi14 = relativeStrengthIndex(closes, 14);
  const macdSnapshot = macd(closes);
  const bands = bollingerBands(closes);
  const atr14 = averageTrueRange(bars, 14);
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
    bollingerUpper: bands.upper,
    bollingerLower: bands.lower,
    atr14,
    atrPct: atr14 === null ? null : atr14 / latest.close,
    volume20,
    volumeRatio: volume20 === null || volume20 === 0 ? null : latest.volume / volume20,
    momentum20: momentum(closes, 20),
    momentum63: momentum(closes, 63),
    momentum126: momentum(closes, 126),
    drawdownFromHigh: recentHigh > 0 ? latest.close / recentHigh - 1 : null
  };

  const scored = scoreTechnicalSetup(indicators);
  const rating = ratingFromScore(scored.score);
  const action = actionFromRating(rating);
  const buyZone = buildBuyZone(indicators);

  return {
    symbol: profile.symbol,
    name: profile.name,
    segment: profile.segment,
    asOf: latest.date,
    rating,
    action,
    score: scored.score,
    rank: 0,
    relativeStrengthRank: 0,
    indicators,
    reasons: scored.reasons,
    risks: scored.risks,
    buyZone,
    chart: buildChart(bars, closes)
  };
}

function scoreTechnicalSetup(indicators: IndicatorSnapshot) {
  let score = 50;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (indicators.sma20 !== null && indicators.close > indicators.sma20) {
    score += 6;
    reasons.push("終値が20日線を上回り、短期トレンドが上向き");
  } else if (indicators.sma20 !== null) {
    score -= 6;
    risks.push("終値が20日線を下回り、短期の上値が重い");
  }

  if (indicators.sma50 !== null && indicators.close > indicators.sma50) {
    score += 9;
    reasons.push("終値が50日線を上回り、中期トレンドが維持されている");
  } else if (indicators.sma50 !== null) {
    score -= 10;
    risks.push("50日線を下回っており、押し目ではなく下降継続の可能性");
  }

  if (indicators.sma200 !== null && indicators.close > indicators.sma200) {
    score += 12;
    reasons.push("200日線を上回る長期上昇トレンド");
  } else if (indicators.sma200 !== null) {
    score -= 18;
    risks.push("200日線を下回っており、長期トレンドは弱い");
  }

  if (indicators.sma50 !== null && indicators.sma200 !== null && indicators.sma50 > indicators.sma200) {
    score += 6;
    reasons.push("50日線が200日線を上回り、トレンド構造が良い");
  }

  if (indicators.momentum20 !== null) {
    if (indicators.momentum20 > 0.08) {
      score += 8;
      reasons.push("20営業日モメンタムが強い");
    } else if (indicators.momentum20 < -0.05) {
      score -= 8;
      risks.push("20営業日モメンタムが悪化");
    }
  }

  if (indicators.momentum63 !== null) {
    if (indicators.momentum63 > 0.18) {
      score += 11;
      reasons.push("3か月モメンタムがセクター内で買い向き");
    } else if (indicators.momentum63 > 0.06) {
      score += 6;
      reasons.push("3か月モメンタムがプラス");
    } else if (indicators.momentum63 < -0.08) {
      score -= 10;
      risks.push("3か月モメンタムがマイナス");
    }
  }

  if (indicators.rsi14 !== null) {
    if (indicators.rsi14 >= 50 && indicators.rsi14 <= 68) {
      score += 8;
      reasons.push("RSIが強すぎず弱すぎない買いゾーン");
    } else if (indicators.rsi14 > 78) {
      score -= 7;
      risks.push("RSIが過熱圏で短期反落に注意");
    } else if (indicators.rsi14 < 38) {
      score -= 8;
      risks.push("RSIが弱く、反発確認待ち");
    }
  }

  if (indicators.macdHistogram !== null) {
    if (indicators.macdHistogram > 0) {
      score += 7;
      reasons.push("MACDが上向きで買い圧力が優勢");
    } else {
      score -= 6;
      risks.push("MACDが下向きで勢いが不足");
    }
  }

  if (indicators.volumeRatio !== null && indicators.volumeRatio > 1.35) {
    if (indicators.dayChangePct > 0) {
      score += 5;
      reasons.push("出来高増を伴う上昇");
    } else {
      score -= 5;
      risks.push("出来高増を伴う下落");
    }
  }

  if (indicators.atrPct !== null && indicators.atrPct > 0.075) {
    score -= 5;
    risks.push("ATRが高く、値幅リスクが大きい");
  }

  if (indicators.drawdownFromHigh !== null && indicators.drawdownFromHigh < -0.22) {
    score -= 7;
    risks.push("直近高値から20%以上下落している");
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    reasons: reasons.slice(0, 5),
    risks: risks.length > 0 ? risks.slice(0, 4) : ["明確な弱点は少ないが、決算日と指数全体の地合いは確認が必要"]
  };
}

function applyRelativeStrength(row: RecommendationItem, relativeRank: number, universeSize: number) {
  const size = Math.max(1, universeSize);
  let scoreAdjustment = 0;
  const reasons = [...row.reasons];
  const risks = [...row.risks];

  if (relativeRank <= Math.ceil(size * 0.25)) {
    scoreAdjustment += 8;
    reasons.unshift("セクター内の相対強度が上位");
  } else if (relativeRank >= Math.floor(size * 0.75)) {
    scoreAdjustment -= 8;
    risks.unshift("セクター内の相対強度が下位");
  }

  const score = clamp(row.score + scoreAdjustment, 0, 100);
  const rating = ratingFromScore(score);

  return {
    ...row,
    score,
    rating,
    action: actionFromRating(rating),
    relativeStrengthRank: relativeRank,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 4)
  };
}

function buildBuyZone(indicators: IndicatorSnapshot) {
  const atr = indicators.atr14 ?? indicators.close * 0.04;
  const trendReference = Math.max(indicators.sma20 ?? 0, indicators.sma50 ?? 0, indicators.close - atr);
  const idealEntry = Math.min(indicators.close, trendReference + atr * 0.35);
  const pullbackEntry = indicators.sma20 ?? indicators.close - atr;
  const stopLoss = Math.min(indicators.close - atr * 2.2, (indicators.sma50 ?? indicators.close) * 0.96);
  const takeProfit = indicators.close + atr * 3;

  return {
    idealEntry,
    pullbackEntry,
    stopLoss: Math.max(0.01, stopLoss),
    takeProfit
  };
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

function ratingFromScore(score: number): SignalRating {
  if (score >= 82) {
    return "STRONG_BUY";
  }
  if (score >= 66) {
    return "BUY";
  }
  if (score >= 44) {
    return "WATCH";
  }
  if (score >= 28) {
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

function inferMarketBias(rows: RecommendationItem[]) {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
