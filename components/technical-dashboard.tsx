"use client";

import { useEffect, useMemo, useState, useTransition, type PointerEvent } from "react";

import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { DEFAULT_SEMICONDUCTOR_UNIVERSE, type MarketAnalysisResult, type RecommendationItem } from "@/lib/semiconductors/types";

const ratingLabels: Record<RecommendationItem["rating"], string> = {
  STRONG_BUY: "強気監視",
  BUY: "買い検討",
  WATCH: "監視",
  SELL: "弱含み",
  STRONG_SELL: "新規買い回避"
};

const actionLabels: Record<RecommendationItem["action"], string> = {
  BUY: "買い検討",
  HOLD: "監視継続",
  SELL: "新規買い回避"
};

export function TechnicalDashboard() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => DEFAULT_SEMICONDUCTOR_UNIVERSE.map((item) => item.symbol));
  const [lookbackDays, setLookbackDays] = useState(520);
  const [result, setResult] = useState<MarketAnalysisResult | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(DEFAULT_SEMICONDUCTOR_UNIVERSE[0].symbol);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    runAnalysis();
    // Initial load only. Manual refresh uses the current controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRow = useMemo(() => {
    if (!result) {
      return null;
    }

    return result.recommendations.find((row) => row.symbol === selectedSymbol) ?? result.recommendations[0] ?? null;
  }, [result, selectedSymbol]);

  function toggleSymbol(symbol: string) {
    setSelectedSymbols((current) => {
      if (current.includes(symbol)) {
        return current.length === 1 ? current : current.filter((value) => value !== symbol);
      }

      return [...current, symbol];
    });
  }

  function runAnalysis() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/semiconductors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: selectedSymbols, lookbackDays })
      });

      const payload = (await response.json()) as MarketAnalysisResult | { error?: string };
      if (!response.ok) {
        setError("error" in payload && payload.error ? payload.error : "分析に失敗しました。");
        return;
      }

      const analysis = payload as MarketAnalysisResult;
      setResult(analysis);
      setSelectedSymbol((current) => analysis.recommendations.find((row) => row.symbol === current)?.symbol ?? analysis.recommendations[0]?.symbol ?? current);
    });
  }

  return (
    <div className="dashboard">
      <section className="panel control-strip">
        <div className="control-head">
          <div>
            <p className="panel-eyebrow">Universe</p>
            <h2>分析対象</h2>
          </div>
          <span className={`status-pill ${isPending ? "pending" : ""}`}>{isPending ? "取得中" : "準備完了"}</span>
        </div>

        <div className="symbol-toggle-grid">
          {DEFAULT_SEMICONDUCTOR_UNIVERSE.map((profile) => (
            <button
              key={profile.symbol}
              type="button"
              className={`symbol-toggle ${selectedSymbols.includes(profile.symbol) ? "active" : ""}`}
              onClick={() => toggleSymbol(profile.symbol)}
            >
              <strong>{profile.symbol}</strong>
              <span>{profile.segment}</span>
            </button>
          ))}
        </div>

        <div className="run-row">
          <label>
            取得期間
            <select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>
              <option value={360}>約1年</option>
              <option value={520}>約2年</option>
              <option value={780}>約3年</option>
            </select>
          </label>
          <button type="button" className="primary-button" onClick={runAnalysis} disabled={isPending}>
            分析を更新
          </button>
        </div>

        {error ? <p className="error-message">{error}</p> : null}
      </section>

      <section className="summary-grid">
        <SummaryCard label="買い検討" value={formatNumber(result?.buyCandidates.length ?? 0, 0)} />
        <SummaryCard label="弱含み" value={formatNumber(result?.sellCandidates.length ?? 0, 0)} />
        <SummaryCard label="平均スコア" value={formatNumber(result?.summary.averageScore ?? 0, 1)} />
        <SummaryCard label="地合い" value={marketBiasLabel(result?.summary.marketBias)} />
      </section>

      {result?.recommendations.length ? (
        <PriceBoard rows={result.recommendations} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />
      ) : null}

      <section className="split-grid">
        <RecommendationList title="買い検討候補" rows={result?.buyCandidates.slice(0, 5) ?? []} emptyText="買い検討判定はまだありません。" />
        <RecommendationList title="弱含み・回避候補" rows={result?.sellCandidates.slice(0, 5) ?? []} emptyText="明確な弱含み判定はまだありません。" />
      </section>

      <section className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Technical Detail</p>
            <h2>{selectedRow ? `${selectedRow.symbol} ${selectedRow.name}` : "銘柄詳細"}</h2>
          </div>
          {selectedRow ? <SignalBadge row={selectedRow} /> : null}
        </div>

        {selectedRow ? (
          <div className="detail-grid">
            <StockChart row={selectedRow} />
            <div className="detail-copy">
              <SecuritySnapshot row={selectedRow} />
              <ScoreBreakdownPanel row={selectedRow} />
              <div className="metric-grid price-metric-grid">
                <Metric label="20営業日" value={formatNullablePercent(selectedRow.indicators.momentum20)} />
                <Metric label="63営業日" value={formatNullablePercent(selectedRow.indicators.momentum63)} />
                <Metric label="126営業日" value={formatNullablePercent(selectedRow.indicators.momentum126)} />
                <Metric label="RSI" value={formatNullable(selectedRow.indicators.rsi14)} />
                <Metric label="対20日線" value={distanceFrom(selectedRow.indicators.close, selectedRow.indicators.sma20)} />
                <Metric label="対50日線" value={distanceFrom(selectedRow.indicators.close, selectedRow.indicators.sma50)} />
                <Metric label="対200日線" value={distanceFrom(selectedRow.indicators.close, selectedRow.indicators.sma200)} />
                <Metric label="ATR" value={formatNullablePercent(selectedRow.indicators.atrPct)} />
                <Metric label="出来高 1D/20D" value={formatNullable(selectedRow.indicators.volumeRatio)} />
                <Metric label="出来高 5D/20D" value={formatNullable(selectedRow.indicators.volume5To20Ratio)} />
              </div>
              <div className="zone-grid">
                <Metric label="理想買値" value={formatPrice(selectedRow.buyZone.idealEntry)} />
                <Metric label="押し目" value={formatPrice(selectedRow.buyZone.pullbackEntry)} />
                <Metric label="損切り目安" value={formatPrice(selectedRow.buyZone.stopLoss)} />
                <Metric label="利確目安" value={formatPrice(selectedRow.buyZone.takeProfit)} />
              </div>
              <ReasonBlock title="買い材料" items={selectedRow.reasons} />
              <ReasonBlock title="リスク" items={selectedRow.risks} />
            </div>
          </div>
        ) : (
          <p className="muted-copy">分析結果を待っています。</p>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Rankings</p>
            <h2>銘柄別シグナル</h2>
          </div>
          <span className="muted-copy">{result?.asOf ? `${result.asOf} 時点` : ""}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Symbol</th>
                <th>Action</th>
                <th>Score</th>
                <th>Change</th>
                <th>Price</th>
                <th>Day</th>
                <th>20D</th>
                <th>63D</th>
                <th>RSI</th>
                <th>RS Rank</th>
              </tr>
            </thead>
            <tbody>
              {(result?.recommendations ?? []).map((row) => (
                <tr
                  key={row.symbol}
                  className={row.symbol === selectedRow?.symbol ? "selected-row" : ""}
                  onClick={() => setSelectedSymbol(row.symbol)}
                >
                  <td>{row.rank}</td>
                  <td>
                    <strong>{row.symbol}</strong>
                    <span className="table-subtext">{row.segment}</span>
                  </td>
                  <td>
                    <SignalBadge row={row} compact />
                  </td>
                  <td>
                    <ScoreMeter score={row.score} />
                  </td>
                  <td>{signalChangeLabel(row.signalChange)}</td>
                  <td>{formatPrice(row.indicators.close)}</td>
                  <td>
                    <PriceMove value={row.indicators.dayChangePct} />
                  </td>
                  <td>{formatNullablePercent(row.indicators.momentum20)}</td>
                  <td>{formatNullablePercent(row.indicators.momentum63)}</td>
                  <td>{formatNullable(row.indicators.rsi14)}</td>
                  <td>{row.relativeStrengthRank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel disclosure-panel">
        <p>
          このアプリは売買判断を補助するテクニカル分析ツールです。投資助言ではありません。実際の注文前に企業決算、ニュース、
          ポジションサイズ、税金、流動性、リスク許容度を確認してください。
        </p>
        {result?.notes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </section>
    </div>
  );
}

function PriceBoard({
  rows,
  selectedSymbol,
  onSelect
}: {
  rows: RecommendationItem[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <section className="panel price-board-panel">
      <div className="panel-header compact-header">
        <div>
          <p className="panel-eyebrow">Market Board</p>
          <h2>価格とシグナルの俯瞰</h2>
        </div>
        <span className="muted-copy">クリックで詳細を切り替え</span>
      </div>
      <div className="price-board">
        {rows.map((row) => (
          <button
            key={row.symbol}
            type="button"
            className={`price-card ${row.action.toLowerCase()} ${row.symbol === selectedSymbol ? "active" : ""}`}
            onClick={() => onSelect(row.symbol)}
          >
            <span className="price-card-top">
              <strong>{row.symbol}</strong>
              <SignalBadge row={row} compact />
            </span>
            <span className="price-card-name">{row.name}</span>
            <span className="price-card-price">{formatPrice(row.indicators.close)}</span>
            <span className="price-card-bottom">
              <PriceMove value={row.indicators.dayChangePct} />
              <span>Score {row.score}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card panel">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SecuritySnapshot({ row }: { row: RecommendationItem }) {
  return (
    <div className="security-snapshot">
      <div>
        <span className="snapshot-meta">{row.segment}</span>
        <strong>{formatPrice(row.indicators.close)}</strong>
        <PriceMove value={row.indicators.dayChangePct} />
      </div>
      <div className="snapshot-score">
        <span>Final Score</span>
        <strong>{row.score}</strong>
        <SignalBadge row={row} />
      </div>
    </div>
  );
}

function ScoreBreakdownPanel({ row }: { row: RecommendationItem }) {
  const items = [
    ["Trend", row.scoreBreakdown.trendScore],
    ["Momentum", row.scoreBreakdown.momentumScore],
    ["Relative", row.scoreBreakdown.relativeStrengthScore],
    ["Risk", row.scoreBreakdown.riskScore],
    ["Volume", row.scoreBreakdown.volumeScore]
  ] as const;

  return (
    <div className="breakdown-panel">
      {items.map(([label, score]) => (
        <div key={label} className="breakdown-row">
          <span>{label}</span>
          <div>
            <i style={{ width: `${score}%` }} />
          </div>
          <strong>{formatNumber(score, 0)}</strong>
        </div>
      ))}
    </div>
  );
}

function RecommendationList({ title, rows, emptyText }: { title: string; rows: RecommendationItem[]; emptyText: string }) {
  return (
    <section className="panel recommendation-panel">
      <div className="panel-header">
        <div>
          <p className="panel-eyebrow">Recommendation</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="recommendation-list">
        {rows.length === 0 ? <p className="muted-copy">{emptyText}</p> : null}
        {rows.map((row) => (
          <article key={row.symbol} className="recommendation-card">
            <div>
              <strong>{row.symbol}</strong>
              <span>{row.name}</span>
            </div>
            <SignalBadge row={row} compact />
            <p>{row.reasons[0] ?? row.risks[0]}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PriceMove({ value }: { value: number }) {
  return <span className={`price-move ${value >= 0 ? "positive" : "negative"}`}>{formatPercent(value)}</span>;
}

function SignalBadge({ row, compact = false }: { row: RecommendationItem; compact?: boolean }) {
  return (
    <span className={`signal-badge ${row.action.toLowerCase()} ${compact ? "compact" : ""}`}>
      {compact ? actionLabels[row.action] : `${actionLabels[row.action]} / ${ratingLabels[row.rating]}`}
    </span>
  );
}

function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="score-meter" aria-label={`Score ${score}`}>
      <strong>{score}</strong>
      <span>
        <i style={{ width: `${score}%` }} />
      </span>
    </div>
  );
}

function StockChart({ row }: { row: RecommendationItem }) {
  const [range, setRange] = useState<"1M" | "3M" | "6M">("3M");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 860;
  const height = 430;
  const margin = { top: 22, right: 76, bottom: 38, left: 16 };
  const volumeHeight = 82;
  const gap = 18;
  const chartHeight = height - margin.top - margin.bottom - volumeHeight - gap;
  const volumeTop = margin.top + chartHeight + gap;
  const rangeSize = range === "1M" ? 22 : range === "3M" ? 66 : 132;
  const points = row.chart.slice(-rangeSize);
  const priceValues = points.flatMap((point) => [point.high, point.low, point.sma20, point.sma50].filter((value): value is number => value !== null));
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const pricePadding = (maxPrice - minPrice || maxPrice * 0.02) * 0.08;
  const lower = minPrice - pricePadding;
  const upper = maxPrice + pricePadding;
  const priceRange = upper - lower || 1;
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const plotWidth = width - margin.left - margin.right;
  const candleSlot = plotWidth / Math.max(points.length, 1);
  const candleWidth = Math.max(3, Math.min(10, candleSlot * 0.56));
  const hovered = hoverIndex === null ? points[points.length - 1] : points[hoverIndex];
  const current = points[points.length - 1];
  const priceTicks = Array.from({ length: 5 }, (_, index) => lower + (priceRange / 4) * index).reverse();
  const timeTicks = buildTimeTicks(points);
  const xFor = (index: number) => margin.left + candleSlot * index + candleSlot / 2;
  const yFor = (price: number) => margin.top + ((upper - price) / priceRange) * chartHeight;
  const volumeYFor = (volume: number) => volumeTop + volumeHeight - (volume / maxVolume) * volumeHeight;
  const pathFor = (selector: (point: RecommendationItem["chart"][number]) => number | null) =>
    points
      .reduce<string[]>((commands, point, index) => {
        const value = selector(point);
        if (value === null) {
          return commands;
        }
        commands.push(`${commands.length === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)}`);
        return commands;
      }, [])
      .join(" ");

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.round((x - margin.left - candleSlot / 2) / candleSlot);
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  return (
    <div className="chart-box stock-chart-box">
      <div className="stock-chart-toolbar">
        <div>
          <strong>{row.symbol}</strong>
          <span>{hovered ? `${hovered.date} / O ${formatPrice(hovered.open)} H ${formatPrice(hovered.high)} L ${formatPrice(hovered.low)} C ${formatPrice(hovered.close)}` : ""}</span>
        </div>
        <div className="range-tabs" aria-label="Chart range">
          {(["1M", "3M", "6M"] as const).map((item) => (
            <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mini-chart stock-chart"
        role="img"
        aria-label={`${row.symbol} candlestick chart`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <rect x="0" y="0" width={width} height={height} rx="8" className="chart-surface" />

        {priceTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={width - margin.right + 10} y={y + 4} className="axis-label">
                {formatAxisPrice(tick)}
              </text>
            </g>
          );
        })}

        {timeTicks.map(({ index, label }) => {
          const x = xFor(index);
          return (
            <g key={`${index}-${label}`}>
              <line x1={x} x2={x} y1={margin.top} y2={volumeTop + volumeHeight} className="chart-grid-line vertical" />
              <text x={x} y={height - 12} textAnchor="middle" className="axis-label">
                {label}
              </text>
            </g>
          );
        })}

        <line x1={margin.left} x2={width - margin.right} y1={volumeTop - 8} y2={volumeTop - 8} className="chart-axis-line" />
        <text x={margin.left} y={volumeTop + 10} className="axis-label">
          Vol
        </text>

        {points.map((point, index) => {
          const x = xFor(index);
          const rising = point.close >= point.open;
          const volumeY = volumeYFor(point.volume);
          return (
            <rect
              key={`volume-${point.date}`}
              x={x - candleWidth / 2}
              y={volumeY}
              width={candleWidth}
              height={volumeTop + volumeHeight - volumeY}
              className={rising ? "volume-bar up" : "volume-bar down"}
            />
          );
        })}

        {points.map((point, index) => {
          const x = xFor(index);
          const rising = point.close >= point.open;
          const highY = yFor(point.high);
          const lowY = yFor(point.low);
          const openY = yFor(point.open);
          const closeY = yFor(point.close);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
          return (
            <g key={point.date}>
              <line x1={x} x2={x} y1={highY} y2={lowY} className={rising ? "candle-wick up" : "candle-wick down"} />
              <rect
                x={x - candleWidth / 2}
                y={bodyY}
                width={candleWidth}
                height={bodyHeight}
                rx="1.5"
                className={rising ? "candle-body up" : "candle-body down"}
              />
            </g>
          );
        })}

        <path d={pathFor((point) => point.sma50)} className="sma50-stroke" fill="none" strokeWidth="2" />
        <path d={pathFor((point) => point.sma20)} className="sma20-stroke" fill="none" strokeWidth="2" />

        {current ? (
          <g>
            <line x1={margin.left} x2={width - margin.right} y1={yFor(current.close)} y2={yFor(current.close)} className="current-price-line" />
            <rect x={width - margin.right + 5} y={yFor(current.close) - 11} width="62" height="22" rx="5" className="current-price-label-bg" />
            <text x={width - margin.right + 36} y={yFor(current.close) + 4} textAnchor="middle" className="current-price-label">
              {formatAxisPrice(current.close)}
            </text>
          </g>
        ) : null}

        {hoverIndex !== null && hovered ? (
          <g>
            <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={margin.top} y2={volumeTop + volumeHeight} className="crosshair-line" />
            <line x1={margin.left} x2={width - margin.right} y1={yFor(hovered.close)} y2={yFor(hovered.close)} className="crosshair-line" />
            <circle cx={xFor(hoverIndex)} cy={yFor(hovered.close)} r="4" className="crosshair-dot" />
          </g>
        ) : null}
      </svg>
      <div className="chart-legend">
        <span className="candle-up-key">上昇</span>
        <span className="candle-down-key">下落</span>
        <span className="sma20-line-key">20日線</span>
        <span className="sma50-line-key">50日線</span>
        <span className="volume-line-key">出来高</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReasonBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="reason-block">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function marketBiasLabel(value: MarketAnalysisResult["summary"]["marketBias"] | undefined) {
  if (value === "bullish") {
    return "強気";
  }
  if (value === "defensive") {
    return "守り";
  }

  return "中立";
}

function signalChangeLabel(value: RecommendationItem["signalChange"]) {
  const labels: Record<RecommendationItem["signalChange"], string> = {
    NEW_BUY: "新規強気",
    BUY_CONTINUATION: "強気継続",
    BUY_TO_HOLD: "中立化",
    HOLD_TO_BUY: "強気転換",
    NEW_SELL: "新規弱含み",
    SELL_CONTINUATION: "弱含み継続",
    SELL_TO_HOLD: "中立化",
    NO_CHANGE: "-"
  };

  return labels[value];
}

function formatNullable(value: number | null) {
  return value === null ? "-" : formatNumber(value, 1);
}

function formatNullablePercent(value: number | null) {
  return value === null ? "-" : formatPercent(value);
}

function distanceFrom(close: number, reference: number | null) {
  return reference === null || reference === 0 ? "-" : formatPercent(close / reference - 1);
}

function buildTimeTicks(points: RecommendationItem["chart"]) {
  if (points.length === 0) {
    return [];
  }

  const indexes = Array.from(new Set([0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1]));

  return indexes.map((index) => ({
    index,
    label: formatChartDate(points[index].date)
  }));
}

function formatChartDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date.slice(5);
  }

  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

function formatAxisPrice(value: number) {
  if (value >= 1_000) {
    return value.toFixed(0);
  }
  if (value >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}
