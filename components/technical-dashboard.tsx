"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

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
            <MiniChart row={selectedRow} />
            <div className="detail-copy">
              <div className="price-line">
                <strong>{formatPrice(selectedRow.indicators.close)}</strong>
                <span className={selectedRow.indicators.dayChangePct >= 0 ? "positive" : "negative"}>
                  {formatPercent(selectedRow.indicators.dayChangePct)}
                </span>
              </div>
              <div className="metric-grid">
                <Metric label="RSI" value={formatNullable(selectedRow.indicators.rsi14)} />
                <Metric label="3か月" value={formatNullablePercent(selectedRow.indicators.momentum63)} />
                <Metric label="対20日線" value={distanceFrom(selectedRow.indicators.close, selectedRow.indicators.sma20)} />
                <Metric label="ATR" value={formatNullablePercent(selectedRow.indicators.atrPct)} />
              </div>
              <div className="metric-grid score-breakdown-grid">
                <Metric label="Trend" value={formatNumber(selectedRow.scoreBreakdown.trendScore, 0)} />
                <Metric label="Momentum" value={formatNumber(selectedRow.scoreBreakdown.momentumScore, 0)} />
                <Metric label="Relative" value={formatNumber(selectedRow.scoreBreakdown.relativeStrengthScore, 0)} />
                <Metric label="Risk" value={formatNumber(selectedRow.scoreBreakdown.riskScore, 0)} />
                <Metric label="Volume" value={formatNumber(selectedRow.scoreBreakdown.volumeScore, 0)} />
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card panel">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
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

function MiniChart({ row }: { row: RecommendationItem }) {
  const width = 780;
  const height = 280;
  const padding = 18;
  const values = row.chart.flatMap((point) => [point.close, point.sma20, point.sma50].filter((value): value is number => value !== null));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pathFor = (selector: (point: RecommendationItem["chart"][number]) => number | null) =>
    row.chart
      .reduce<string[]>((commands, point, index) => {
        const value = selector(point);
        if (value === null) {
          return commands;
        }
        const x = padding + (index / Math.max(row.chart.length - 1, 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        commands.push(`${commands.length === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
        return commands;
      }, [])
      .join(" ");

  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} className="mini-chart" role="img" aria-label={`${row.symbol} price chart`}>
        <rect x="0" y="0" width={width} height={height} rx="8" className="chart-surface" />
        <path d={pathFor((point) => point.sma50)} className="sma50-stroke" fill="none" strokeWidth="2" />
        <path d={pathFor((point) => point.sma20)} className="sma20-stroke" fill="none" strokeWidth="2" />
        <path d={pathFor((point) => point.close)} className="price-stroke" fill="none" strokeWidth="3" />
      </svg>
      <div className="chart-legend">
        <span className="price-line-key">終値</span>
        <span className="sma20-line-key">20日線</span>
        <span className="sma50-line-key">50日線</span>
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
