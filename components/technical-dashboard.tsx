"use client";

import { useEffect, useMemo, useState, useTransition, type MouseEvent, type PointerEvent } from "react";

import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import type { PortfolioSnapshot } from "@/lib/semiconductors/portfolio";
import {
  DEFAULT_MARKET_UNIVERSE,
  SECURITY_CATEGORIES,
  type MarketAnalysisResult,
  type RecommendationItem,
  type SecurityCategoryId,
  type SymbolProfile
} from "@/lib/semiconductors/types";
import type {
  PaperTradingReadiness,
  TradeOrderSubmission,
  TradePlan,
  TradingRiskProfile,
  TradingRunRecord,
  TradingRunSummary
} from "@/lib/semiconductors/trading";

type CategoryFilter = "all" | SecurityCategoryId;

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

const tradingRiskProfileLabels: Record<TradingRiskProfile, string> = {
  active: "積極",
  balanced: "標準",
  cautious: "慎重"
};

interface TradingRunResultPayload {
  run: TradingRunRecord;
  config?: {
    riskProfile: TradingRiskProfile;
  };
  summary: TradingRunSummary;
  plans: TradePlan[];
  submissions?: TradeOrderSubmission[];
  notes: string[];
}

interface TradingRunHistoryRecord extends TradingRunResultPayload {
  savedAt: string;
}

interface TradingReadinessPayload {
  paper: PaperTradingReadiness;
}

export function TechnicalDashboard() {
  const [activeTab, setActiveTab] = useState<"signals" | "portfolio" | "trading">("signals");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => DEFAULT_MARKET_UNIVERSE.map((item) => item.symbol));
  const [symbolFilter, setSymbolFilter] = useState("");
  const [lookbackDays, setLookbackDays] = useState(520);
  const [isUniverseOpen, setIsUniverseOpen] = useState(false);
  const [result, setResult] = useState<MarketAnalysisResult | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(DEFAULT_MARKET_UNIVERSE[0].symbol);
  const [error, setError] = useState<string | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [tradingResult, setTradingResult] = useState<TradingRunResultPayload | null>(null);
  const [tradingRuns, setTradingRuns] = useState<TradingRunHistoryRecord[]>([]);
  const [tradingReadiness, setTradingReadiness] = useState<TradingReadinessPayload | null>(null);
  const [tradingRiskProfile, setTradingRiskProfile] = useState<TradingRiskProfile>("balanced");
  const [tradingError, setTradingError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPortfolioPending, startPortfolioTransition] = useTransition();
  const [isTradingPending, startTradingTransition] = useTransition();
  const [isTradingHistoryPending, startTradingHistoryTransition] = useTransition();

  useEffect(() => {
    runAnalysis();
    // Initial load only. Manual refresh uses the current controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === "portfolio" && portfolio === null && !isPortfolioPending) {
      runPortfolioRefresh();
    }
    // Load portfolio once when the user opens the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, portfolio]);

  useEffect(() => {
    if (activeTab === "trading" && tradingRuns.length === 0 && !isTradingHistoryPending) {
      loadTradingRuns();
    }
    // Load trading history when the user opens the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tradingRuns.length]);

  const activeUniverse = useMemo(() => filterUniverseByCategory(DEFAULT_MARKET_UNIVERSE, activeCategory), [activeCategory]);
  const activeRecommendations = useMemo(() => {
    const rows = result?.recommendations ?? [];
    return activeCategory === "all" ? rows : rows.filter((row) => row.category === activeCategory);
  }, [activeCategory, result]);
  const activeBuyCandidates = useMemo(() => activeRecommendations.filter((row) => row.action === "BUY"), [activeRecommendations]);
  const activeSellCandidates = useMemo(() => activeRecommendations.filter((row) => row.action === "SELL"), [activeRecommendations]);
  const activeAverageScore = useMemo(() => {
    if (activeRecommendations.length === 0) {
      return 0;
    }

    return activeRecommendations.reduce((total, row) => total + row.score, 0) / activeRecommendations.length;
  }, [activeRecommendations]);
  const selectedRow = useMemo(() => {
    if (!result) {
      return null;
    }

    return activeRecommendations.find((row) => row.symbol === selectedSymbol) ?? activeRecommendations[0] ?? result.recommendations[0] ?? null;
  }, [activeRecommendations, result, selectedSymbol]);
  const filteredUniverse = useMemo(() => {
    const query = symbolFilter.trim().toUpperCase();
    const universe = activeUniverse;
    if (!query) {
      return universe;
    }

    return universe.filter((profile) => profile.symbol.includes(query) || profile.name.toUpperCase().includes(query));
  }, [activeUniverse, symbolFilter]);

  useEffect(() => {
    if (activeRecommendations.length === 0) {
      return;
    }

    setSelectedSymbol((current) =>
      activeRecommendations.some((row) => row.symbol === current) ? current : activeRecommendations[0].symbol
    );
  }, [activeRecommendations]);

  function toggleSymbol(symbol: string) {
    setSelectedSymbols((current) => {
      if (current.includes(symbol)) {
        return current.length === 1 ? current : current.filter((value) => value !== symbol);
      }

      return [...current, symbol];
    });
  }

  function selectCategory(category: CategoryFilter) {
    setActiveCategory(category);
    setSymbolFilter("");
  }

  function selectUniverse(symbols: string[]) {
    setSelectedSymbols(Array.from(new Set(symbols)));
  }

  function selectActiveUniverse() {
    selectUniverse(activeUniverse.map((item) => item.symbol));
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

  function runPortfolioRefresh() {
    setPortfolioError(null);
    startPortfolioTransition(async () => {
      const response = await fetch("/api/portfolio");
      const payload = (await response.json()) as PortfolioSnapshot | { error?: string };
      if (!response.ok) {
        setPortfolioError("error" in payload && payload.error ? payload.error : "ポートフォリオ取得に失敗しました。");
        return;
      }

      setPortfolio(payload as PortfolioSnapshot);
    });
  }

  function loadTradingRuns() {
    startTradingHistoryTransition(async () => {
      const response = await fetch("/api/trading/runs?limit=12");
      const payload = (await response.json()) as { runs?: TradingRunHistoryRecord[]; readiness?: TradingReadinessPayload; error?: string };
      if (!response.ok) {
        setTradingError(payload.error ?? "自動売買履歴の取得に失敗しました。");
        return;
      }

      setTradingRuns(payload.runs ?? []);
      setTradingReadiness(payload.readiness ?? null);
    });
  }

  function runTrading(mode: "dry-run" | "paper") {
    if (
      mode === "paper" &&
      !window.confirm(`${tradingRiskProfileLabels[tradingRiskProfile]}モードで Alpaca paper account に planned 注文を送信します。実行しますか？`)
    ) {
      return;
    }

    setTradingError(null);
    startTradingTransition(async () => {
      const response = await fetch("/api/trading/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, symbols: selectedSymbols, lookbackDays, riskProfile: tradingRiskProfile })
      });
      const payload = (await response.json()) as TradingRunResultPayload | { error?: string };
      if (!response.ok) {
        setTradingError("error" in payload && payload.error ? payload.error : "自動売買実行に失敗しました。");
        return;
      }

      setTradingResult(payload as TradingRunResultPayload);
      loadTradingRuns();
    });
  }

  return (
    <div className="dashboard">
      <section className="panel workspace-tabs-panel">
        <div className="workspace-tabs" aria-label="Dashboard sections">
          <button type="button" className={activeTab === "signals" ? "active" : ""} onClick={() => setActiveTab("signals")}>
            銘柄シグナル
          </button>
          <button type="button" className={activeTab === "portfolio" ? "active" : ""} onClick={() => setActiveTab("portfolio")}>
            ポートフォリオ
          </button>
          <button type="button" className={activeTab === "trading" ? "active" : ""} onClick={() => setActiveTab("trading")}>
            自動売買
          </button>
        </div>
        <div className="workspace-tab-meta">
          {activeTab === "signals"
            ? "カテゴリ別ウォッチリストのテクニカル分析"
            : activeTab === "portfolio"
              ? "Alpaca Trading API の口座・保有ポジション"
              : "注文計画、paper 実行、履歴"}
        </div>
      </section>

      {activeTab === "signals" ? (
        <>
      <section className="panel control-strip">
        <div className="control-head">
          <div>
            <p className="panel-eyebrow">Universe</p>
            <h2>分析対象</h2>
          </div>
          <div className="control-status-row">
            <span className="status-pill">{categoryFilterLabel(activeCategory)}</span>
            <span className="status-pill">{selectedSymbols.length} / {DEFAULT_MARKET_UNIVERSE.length}</span>
            <span className={`status-pill ${isPending ? "pending" : ""}`}>{isPending ? "取得中" : "準備完了"}</span>
          </div>
        </div>

        <CategoryTabs
          activeCategory={activeCategory}
          selectedSymbols={selectedSymbols}
          onSelect={selectCategory}
        />

        <div className="run-row">
          <label>
            取得期間
            <select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>
              <option value={360}>約1年</option>
              <option value={520}>約2年</option>
              <option value={780}>約3年</option>
            </select>
          </label>
          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={() => setIsUniverseOpen((current) => !current)}>
              {isUniverseOpen ? "銘柄選択を閉じる" : "銘柄を編集"}
            </button>
            <button type="button" className="primary-button" onClick={runAnalysis} disabled={isPending}>
              分析を更新
            </button>
          </div>
        </div>

        {isUniverseOpen ? (
          <div className="universe-drawer">
            <div className="universe-tools">
              <input
                type="search"
                placeholder={`${categoryFilterLabel(activeCategory)}から検索`}
                value={symbolFilter}
                onChange={(event) => setSymbolFilter(event.target.value)}
              />
              <button type="button" onClick={() => selectUniverse(DEFAULT_MARKET_UNIVERSE.map((item) => item.symbol))}>
                ALL選択
              </button>
              <button type="button" onClick={selectActiveUniverse}>
                表示カテゴリ選択
              </button>
              <button type="button" onClick={() => selectUniverse(activeUniverse.slice(0, 20).map((item) => item.symbol))}>
                表示上位20件
              </button>
              <button type="button" onClick={() => setSelectedSymbols((current) => (current.length <= 1 ? current : [current[0]]))}>
                クリア
              </button>
            </div>

            <div className="selected-symbol-strip" aria-label="Selected symbols">
              {selectedSymbols.slice(0, 36).map((symbol) => (
                <button key={symbol} type="button" onClick={() => toggleSymbol(symbol)}>
                  {symbol}
                </button>
              ))}
              {selectedSymbols.length > 36 ? <span>+{selectedSymbols.length - 36}</span> : null}
            </div>

            <div className="symbol-toggle-grid">
              {filteredUniverse.map((profile) => (
                <button
                  key={profile.symbol}
                  type="button"
                  className={`symbol-toggle ${selectedSymbols.includes(profile.symbol) ? "active" : ""}`}
                  onClick={() => toggleSymbol(profile.symbol)}
                >
                  <strong>{profile.symbol}</strong>
                  <span>{selectedSymbols.includes(profile.symbol) ? "Selected" : profile.segment}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="error-message">{error}</p> : null}
      </section>

      <section className="summary-grid">
        <SummaryCard label="買い検討" value={formatNumber(activeBuyCandidates.length, 0)} />
        <SummaryCard label="弱含み" value={formatNumber(activeSellCandidates.length, 0)} />
        <SummaryCard label="平均スコア" value={formatNumber(activeAverageScore, 1)} />
        <SummaryCard label="地合い" value={marketBiasLabel(result?.summary.marketBias)} />
      </section>

      {activeRecommendations.length ? (
        <PriceBoard rows={activeRecommendations.slice(0, 28)} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} totalRows={activeRecommendations.length} />
      ) : null}

      <section className="split-grid">
        <RecommendationList title="買い検討候補" rows={activeBuyCandidates.slice(0, 5)} emptyText="買い検討判定はまだありません。" />
        <RecommendationList title="弱含み・回避候補" rows={activeSellCandidates.slice(0, 5)} emptyText="明確な弱含み判定はまだありません。" />
      </section>

      <section className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Technical Detail</p>
            <h2>{selectedRow ? `${selectedRow.symbol} ${selectedRow.name}` : "銘柄詳細"}</h2>
          </div>
          {selectedRow ? (
            <div className="detail-header-actions">
              <ExternalResearchLinks symbol={selectedRow.symbol} compact />
              <SignalBadge row={selectedRow} />
            </div>
          ) : null}
        </div>

        {selectedRow ? (
          <div className="detail-grid">
            <StockChart row={selectedRow} />
            <div className="detail-copy">
              <SecuritySnapshot row={selectedRow} />
              <ScoreBreakdownPanel row={selectedRow} />
              <NormalizedTechnicalPanel row={selectedRow} />
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
          <table className="signal-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Symbol</th>
                <th>Action</th>
                <th>Links</th>
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
              {activeRecommendations.map((row) => (
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
                    <ExternalResearchLinks symbol={row.symbol} compact onClick={(event) => event.stopPropagation()} />
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
        </>
      ) : activeTab === "portfolio" ? (
        <PortfolioDashboard snapshot={portfolio} error={portfolioError} isPending={isPortfolioPending} onRefresh={runPortfolioRefresh} />
      ) : (
        <TradingDashboard
          result={tradingResult}
          runs={tradingRuns}
          readiness={tradingReadiness}
          riskProfile={tradingRiskProfile}
          error={tradingError}
          isPending={isTradingPending}
          isHistoryPending={isTradingHistoryPending}
          onRun={runTrading}
          onRiskProfileChange={setTradingRiskProfile}
          onRefreshHistory={loadTradingRuns}
        />
      )}
    </div>
  );
}

function CategoryTabs({
  activeCategory,
  selectedSymbols,
  onSelect
}: {
  activeCategory: CategoryFilter;
  selectedSymbols: string[];
  onSelect: (category: CategoryFilter) => void;
}) {
  const selectedSet = new Set(selectedSymbols);
  const allSelectedCount = DEFAULT_MARKET_UNIVERSE.filter((profile) => selectedSet.has(profile.symbol)).length;

  return (
    <div className="category-tabs" aria-label="Security categories">
      <button type="button" className={activeCategory === "all" ? "active" : ""} onClick={() => onSelect("all")}>
        <span>ALL</span>
        <strong>{allSelectedCount}/{DEFAULT_MARKET_UNIVERSE.length}</strong>
      </button>
      {SECURITY_CATEGORIES.map((category) => {
        const universe = filterUniverseByCategory(DEFAULT_MARKET_UNIVERSE, category.id);
        const selectedCount = universe.filter((profile) => selectedSet.has(profile.symbol)).length;

        return (
          <button
            key={category.id}
            type="button"
            className={activeCategory === category.id ? "active" : ""}
            title={category.description}
            onClick={() => onSelect(category.id)}
          >
            <span>{category.label}</span>
            <strong>{selectedCount}/{universe.length}</strong>
          </button>
        );
      })}
    </div>
  );
}

function PriceBoard({
  rows,
  selectedSymbol,
  onSelect,
  totalRows
}: {
  rows: RecommendationItem[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  totalRows: number;
}) {
  return (
    <section className="panel price-board-panel">
      <div className="panel-header compact-header">
        <div>
          <p className="panel-eyebrow">Market Board</p>
          <h2>価格とシグナルの俯瞰</h2>
        </div>
        <span className="muted-copy">上位{rows.length}件 / 全{totalRows}件</span>
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

function TradingDashboard({
  result,
  runs,
  readiness,
  riskProfile,
  error,
  isPending,
  isHistoryPending,
  onRun,
  onRiskProfileChange,
  onRefreshHistory
}: {
  result: TradingRunResultPayload | null;
  runs: TradingRunHistoryRecord[];
  readiness: TradingReadinessPayload | null;
  riskProfile: TradingRiskProfile;
  error: string | null;
  isPending: boolean;
  isHistoryPending: boolean;
  onRun: (mode: "dry-run" | "paper") => void;
  onRiskProfileChange: (profile: TradingRiskProfile) => void;
  onRefreshHistory: () => void;
}) {
  const plans = result?.plans ?? [];
  const planned = plans.filter((plan) => plan.status === "planned");
  const blocked = plans.filter((plan) => plan.status === "blocked");
  const submissions = result?.submissions ?? [];
  const paperReadiness = readiness?.paper ?? null;

  return (
    <>
      <section className="panel trading-control-panel">
        <div className="portfolio-hero-main">
          <div>
            <p className="panel-eyebrow">Auto Trading</p>
            <h2>自動売買実行</h2>
            <p className="muted-copy">
              dry-run は注文計画のみ作成します。paper 実行は selected profile の planned 注文だけ Alpaca paper account に送信します。
            </p>
          </div>
          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={onRefreshHistory} disabled={isHistoryPending}>
              {isHistoryPending ? "取得中" : "履歴更新"}
            </button>
            <button type="button" className="secondary-button" onClick={() => onRun("dry-run")} disabled={isPending}>
              Dry Run
            </button>
            <button type="button" className="primary-button" onClick={() => onRun("paper")} disabled={isPending}>
              Paper 実行
            </button>
          </div>
        </div>
        <div className="workspace-tabs compact-tabs" aria-label="Paper execution profile">
          {(["active", "balanced", "cautious"] as const).map((profile) => (
            <button
              key={profile}
              type="button"
              className={riskProfile === profile ? "active" : ""}
              onClick={() => onRiskProfileChange(profile)}
              disabled={isPending}
            >
              {tradingRiskProfileLabels[profile]}
            </button>
          ))}
        </div>
        <p className="muted-copy">
          {riskProfile === "active"
            ? "積極: BUY 条件と価格乖離制限を緩め、弱い HOLD の保有削減も許可します。"
            : riskProfile === "cautious"
              ? "慎重: BUY 条件、ATR、価格乖離、reward:risk を厳しくします。"
              : "標準: 現在の既定リスク設定で実行します。"}
        </p>
        {error ? <p className="error-message">{error}</p> : null}
        {result ? (
          <div className="trading-run-strip">
            <StatusChip label={result.run.mode} tone={result.run.mode === "paper" ? "warn" : "neutral"} />
            <StatusChip
              label={tradingRiskProfileLabels[result.config?.riskProfile ?? "balanced"]}
              tone={(result.config?.riskProfile ?? "balanced") === "active" ? "warn" : (result.config?.riskProfile ?? "balanced") === "cautious" ? "neutral" : "ok"}
            />
            <StatusChip label={result.run.status} tone={result.run.status === "completed" ? "ok" : "danger"} />
            <span>{result.run.asOf}</span>
            <span>{new Date(result.run.generatedAt).toLocaleString("ja-JP")}</span>
          </div>
        ) : null}
      </section>

      <section className="summary-grid">
        <SummaryCard label="注文計画" value={formatNumber(result?.summary.planCount ?? 0, 0)} />
        <SummaryCard label="planned" value={formatNumber(result?.summary.plannedCount ?? 0, 0)} />
        <SummaryCard label="blocked" value={formatNumber(result?.summary.blockedCount ?? 0, 0)} />
        <SummaryCard label="発注結果" value={formatNumber(submissions.filter((item) => item.status === "submitted").length, 0)} />
      </section>

      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Live Readiness</p>
            <h2>実資金前レビュー</h2>
          </div>
          <StatusChip label={paperReadiness?.ready ? "paper ready" : "paper review required"} tone={paperReadiness?.ready ? "ok" : "warn"} />
        </div>
        {paperReadiness ? (
          <div className="metric-grid portfolio-metric-grid">
            <Metric label="Paper日数" value={`${paperReadiness.completedPaperDays} / ${paperReadiness.requiredPaperDays}`} />
            <Metric label="Paper Runs" value={formatNumber(paperReadiness.completedPaperRuns, 0)} />
            <Metric label="Submitted" value={formatNumber(paperReadiness.submittedOrders, 0)} />
            <Metric label="失敗Run" value={formatNumber(paperReadiness.failedPaperRuns, 0)} />
            <Metric label="失敗注文" value={formatNumber(paperReadiness.failedSubmissions, 0)} />
            <Metric label="期間" value={paperReadiness.firstPaperAsOf && paperReadiness.latestPaperAsOf ? `${paperReadiness.firstPaperAsOf} - ${paperReadiness.latestPaperAsOf}` : "-"} />
          </div>
        ) : (
          <p className="muted-copy">履歴更新後に paper run レビュー状況を表示します。</p>
        )}
        {paperReadiness && paperReadiness.blockers.length > 0 ? (
          <ul className="notes-list">
            {paperReadiness.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="split-grid trading-split-grid">
        <section className="panel table-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">Plans</p>
              <h2>注文計画</h2>
            </div>
            <span className="muted-copy">{planned.length} planned / {blocked.length} blocked</span>
          </div>
          {plans.length === 0 ? (
            <p className="muted-copy">まだ実行結果はありません。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Intent</th>
                    <th>Status</th>
                    <th>Qty</th>
                    <th>Notional</th>
                    <th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.slice(0, 30).map((plan) => (
                    <tr key={plan.id}>
                      <td><strong>{plan.symbol}</strong></td>
                      <td>{plan.intent}</td>
                      <td><PlanStatusBadge status={plan.status} /></td>
                      <td>{formatNumber(plan.quantity, 4)}</td>
                      <td>{formatPrice(plan.notional)}</td>
                      <td className="reason-cell">{plan.blockReasons[0] ?? plan.reasons[0] ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel table-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">Submissions</p>
              <h2>paper 発注結果</h2>
            </div>
            <span className="muted-copy">{submissions.length} submissions</span>
          </div>
          {submissions.length === 0 ? (
            <p className="muted-copy">paper 実行後に発注結果が表示されます。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Status</th>
                    <th>Alpaca</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => (
                    <tr key={`${submission.clientOrderId}-${submission.status}`}>
                      <td><strong>{submission.symbol}</strong></td>
                      <td>{submission.side}</td>
                      <td><PlanStatusBadge status={submission.status} /></td>
                      <td>{submission.alpacaStatus ?? submission.alpacaOrderId ?? "-"}</td>
                      <td className="reason-cell">{submission.error ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">History</p>
            <h2>実行履歴</h2>
          </div>
          <span className="muted-copy">{runs.length} runs</span>
        </div>
        {runs.length === 0 ? (
          <p className="muted-copy">保存された自動売買履歴はまだありません。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Plans</th>
                  <th>Planned</th>
                  <th>Blocked</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={`${run.run.id}-${run.savedAt}`}>
                    <td>{new Date(run.savedAt).toLocaleString("ja-JP")}</td>
                    <td>{run.run.mode}</td>
                    <td><PlanStatusBadge status={run.run.status} /></td>
                    <td>{run.summary.planCount}</td>
                    <td>{run.summary.plannedCount}</td>
                    <td>{run.summary.blockedCount}</td>
                    <td>{run.submissions?.filter((item) => item.status === "submitted").length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const activeStatuses = new Set(["planned", "submitted", "completed", "new", "accepted", "pending_new", "partially_filled", "open"]);
  const warningStatuses = new Set(["blocked", "skipped", "held", "pending_cancel", "pending_replace"]);
  const tone = activeStatuses.has(normalized) ? "ok" : warningStatuses.has(normalized) ? "warn" : "danger";

  return <StatusChip label={status} tone={tone} />;
}

function PortfolioDashboard({
  snapshot,
  error,
  isPending,
  onRefresh
}: {
  snapshot: PortfolioSnapshot | null;
  error: string | null;
  isPending: boolean;
  onRefresh: () => void;
}) {
  const account = snapshot?.account;
  const positions = snapshot?.positions ?? [];
  const openOrders = snapshot?.openOrders ?? [];

  return (
    <>
      <section className="panel portfolio-hero-panel">
        <div className="portfolio-hero-main">
          <div>
            <p className="panel-eyebrow">Portfolio</p>
            <h2>口座サマリー</h2>
            <p className="muted-copy">
              {snapshot?.generatedAt ? `${new Date(snapshot.generatedAt).toLocaleString("ja-JP")} 更新` : "Alpaca Trading API から取得します。"}
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onRefresh} disabled={isPending}>
            {isPending ? "取得中" : "更新"}
          </button>
        </div>

        {error ? <p className="error-message">{error}</p> : null}

        {account ? (
          <>
            <div className="portfolio-balance">
              <div>
                <span>Portfolio Value</span>
                <strong>{formatPrice(account.portfolioValue)}</strong>
                <PriceMove value={account.dayPnlPct ?? 0} />
              </div>
              <div className="portfolio-status-stack">
                <StatusChip label={account.status ?? "status unknown"} tone={account.tradingBlocked || account.accountBlocked ? "danger" : "ok"} />
                {account.patternDayTrader ? <StatusChip label="PDT" tone="warn" /> : null}
                <StatusChip label={account.currency} tone="neutral" />
              </div>
            </div>
            <section className="summary-grid portfolio-summary-grid">
              <SummaryCard label="現金" value={formatPrice(account.cash)} />
              <SummaryCard label="買付余力" value={formatPrice(account.buyingPower)} />
              <SummaryCard label="当日損益" value={formatSignedCurrency(account.dayPnl)} />
              <SummaryCard label="保有銘柄" value={formatNumber(snapshot.summary.positionCount, 0)} />
              <SummaryCard label="未約定注文" value={formatNumber(snapshot.summary.openOrderCount, 0)} />
            </section>
          </>
        ) : (
          <div className="portfolio-empty-state">
            <strong>{isPending ? "ポートフォリオを取得しています。" : "ポートフォリオデータはまだありません。"}</strong>
            <span>Trading API の認証情報と `ALPACA_TRADING_BASE_URL` を確認してください。</span>
          </div>
        )}
      </section>

      {snapshot ? (
        <>
          <section className="portfolio-layout">
            <section className="panel allocation-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Allocation</p>
                  <h2>エクスポージャー</h2>
                </div>
              </div>
              <div className="allocation-stack">
                <AllocationRow label="Long" value={snapshot.summary.longExposure} total={snapshot.account.portfolioValue} />
                <AllocationRow label="Short" value={snapshot.summary.shortExposure} total={snapshot.account.portfolioValue} />
                <AllocationRow label="Cash" value={snapshot.account.cash} total={snapshot.account.portfolioValue} />
              </div>
              <div className="metric-grid portfolio-metric-grid">
                <Metric label="最大保有" value={snapshot.summary.largestPositionSymbol ?? "-"} />
                <Metric label="最大比率" value={formatNullablePercent(snapshot.summary.largestPositionAllocationPct)} />
                <Metric label="含み損益" value={formatSignedCurrency(snapshot.summary.totalUnrealizedPnl)} />
                <Metric label="含み損益率" value={formatNullablePercent(snapshot.summary.totalUnrealizedPnlPct)} />
              </div>
            </section>

            <section className="panel portfolio-risk-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Account Risk</p>
                  <h2>制約と余力</h2>
                </div>
              </div>
              <div className="portfolio-risk-grid">
                <Metric label="Long MV" value={formatPrice(snapshot.account.longMarketValue)} />
                <Metric label="Short MV" value={formatPrice(Math.abs(snapshot.account.shortMarketValue))} />
                <Metric label="Initial Margin" value={formatPrice(snapshot.account.initialMargin)} />
                <Metric label="Maintenance" value={formatPrice(snapshot.account.maintenanceMargin)} />
              </div>
              <div className="account-flags">
                <StatusChip label="Trading" tone={snapshot.account.tradingBlocked ? "danger" : "ok"} />
                <StatusChip label="Transfers" tone={snapshot.account.transfersBlocked ? "danger" : "ok"} />
                <StatusChip label="Account" tone={snapshot.account.accountBlocked ? "danger" : "ok"} />
              </div>
            </section>
          </section>

          <section className="panel table-panel">
            <div className="panel-header">
              <div>
                <p className="panel-eyebrow">Open Orders</p>
                <h2>未約定注文</h2>
              </div>
              <span className="muted-copy">{openOrders.length} orders</span>
            </div>
            {openOrders.length === 0 ? (
              <p className="muted-copy">現在の未約定注文はありません。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Notional</th>
                      <th>Limit</th>
                      <th>Stop</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.map((order) => (
                      <tr key={order.id ?? order.clientOrderId ?? `${order.symbol}-${order.submittedAt ?? order.status ?? "open"}`}>
                        <td>
                          <strong>{order.symbol}</strong>
                          <span className="table-subtext">{order.assetClass ?? "asset"}</span>
                        </td>
                        <td>{order.side ?? "-"}</td>
                        <td><PlanStatusBadge status={order.status ?? "open"} /></td>
                        <td>
                          {order.type ?? "-"}
                          {order.orderClass ? <span className="table-subtext">{order.orderClass}</span> : null}
                        </td>
                        <td>{formatOptionalNumber(order.quantity, 4)}</td>
                        <td>{formatOptionalPrice(order.notional)}</td>
                        <td>{formatOptionalPrice(order.limitPrice)}</td>
                        <td>{formatOptionalPrice(order.stopPrice)}</td>
                        <td>{formatOptionalDateTime(order.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel table-panel">
            <div className="panel-header">
              <div>
                <p className="panel-eyebrow">Positions</p>
                <h2>保有ポジション</h2>
              </div>
              <span className="muted-copy">{positions.length} positions</span>
            </div>
            {positions.length === 0 ? (
              <p className="muted-copy">現在のオープンポジションはありません。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Qty</th>
                      <th>Market Value</th>
                      <th>Alloc</th>
                      <th>Avg Entry</th>
                      <th>Current</th>
                      <th>Unrealized</th>
                      <th>Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={position.symbol}>
                        <td>
                          <strong>{position.symbol}</strong>
                          <span className="table-subtext">{position.assetClass ?? "asset"}</span>
                        </td>
                        <td>{position.side}</td>
                        <td>{formatNumber(position.quantity, 4)}</td>
                        <td>{formatPrice(position.marketValue)}</td>
                        <td>{formatNullablePercent(position.allocationPct)}</td>
                        <td>{formatPrice(position.averageEntryPrice)}</td>
                        <td>{formatPrice(position.currentPrice)}</td>
                        <td>
                          <PnlStack value={position.unrealizedPnl} pct={position.unrealizedPnlPct} />
                        </td>
                        <td>
                          <PnlStack value={position.unrealizedIntradayPnl} pct={position.unrealizedIntradayPnlPct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel disclosure-panel">
            {snapshot.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </section>
        </>
      ) : null}
    </>
  );
}

function AllocationRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? value / total : 0;

  return (
    <div className="allocation-row">
      <div>
        <span>{label}</span>
        <strong>{formatPrice(value)}</strong>
      </div>
      <div className="allocation-bar">
        <i style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
      </div>
      <span>{formatPercent(pct)}</span>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  return <span className={`status-chip ${tone}`}>{label}</span>;
}

function PnlStack({ value, pct }: { value: number; pct: number | null }) {
  const positive = value >= 0;

  return (
    <div className={`pnl-stack ${positive ? "positive" : "negative"}`}>
      <strong>{formatSignedCurrency(value)}</strong>
      <span>{formatNullablePercent(pct)}</span>
    </div>
  );
}

function SecuritySnapshot({ row }: { row: RecommendationItem }) {
  return (
    <div className="security-snapshot">
      <div>
        <span className="snapshot-meta">{row.segment}</span>
        <strong>{formatPrice(row.indicators.close)}</strong>
        <PriceMove value={row.indicators.dayChangePct} />
        <ExternalResearchLinks symbol={row.symbol} />
      </div>
      <div className="snapshot-score">
        <span>Final Score</span>
        <strong>{row.score}</strong>
        <SignalBadge row={row} />
      </div>
    </div>
  );
}

function ExternalResearchLinks({
  symbol,
  compact = false,
  onClick
}: {
  symbol: string;
  compact?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const profileUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/profile`;
  const newsUrl = `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(`${symbol} stock news`)}`;

  return (
    <div className={`external-link-row ${compact ? "compact" : ""}`} aria-label={`${symbol} research links`}>
      <a href={profileUrl} target="_blank" rel="noreferrer" onClick={onClick}>
        企業情報
      </a>
      <a href={newsUrl} target="_blank" rel="noreferrer" onClick={onClick}>
        関連ニュース
      </a>
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

function NormalizedTechnicalPanel({ row }: { row: RecommendationItem }) {
  const normalized = row.normalizedTechnicals;
  const adjustments = row.scoreAdjustments ?? [];

  if (!normalized && adjustments.length === 0) {
    return null;
  }

  const metrics = normalized
    ? [
        ["ATR %ile", formatNullablePercentileRank(normalized.atrPctPercentile)],
        ["63D mom %ile", formatNullablePercentileRank(normalized.momentum63Percentile)],
        ["126D mom %ile", formatNullablePercentileRank(normalized.momentum126Percentile)],
        ["Close z", formatNullableZScore(normalized.closeZScore)]
      ]
    : [];

  return (
    <div className="normalized-panel">
      {metrics.length > 0 ? (
        <div className="normalized-metrics" aria-label="Normalized technical metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {adjustments.length > 0 ? (
        <div className="adjustment-list" aria-label="Score adjustments">
          {adjustments.map((adjustment) => (
            <div key={`${adjustment.source}-${adjustment.label}-${adjustment.value}`} className={adjustment.value >= 0 ? "positive" : "negative"}>
              <span>{adjustment.label}</span>
              <strong>{formatSignedAdjustment(adjustment.value)}</strong>
            </div>
          ))}
        </div>
      ) : null}
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

function filterUniverseByCategory(universe: SymbolProfile[], category: CategoryFilter) {
  return category === "all" ? universe : universe.filter((profile) => profile.category === category);
}

function categoryFilterLabel(category: CategoryFilter) {
  if (category === "all") {
    return "ALL";
  }

  return SECURITY_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

function formatNullable(value: number | null) {
  return value === null ? "-" : formatNumber(value, 1);
}

function formatOptionalNumber(value: number | undefined, maximumFractionDigits = 1) {
  return value === undefined ? "-" : formatNumber(value, maximumFractionDigits);
}

function formatOptionalPrice(value: number | undefined) {
  return value === undefined ? "-" : formatPrice(value);
}

function formatOptionalDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString("ja-JP") : "-";
}

function formatNullablePercent(value: number | null) {
  return value === null ? "-" : formatPercent(value);
}

function formatNullablePercentileRank(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 0)}`;
}

function formatNullableZScore(value: number | null) {
  return value === null ? "-" : formatNumber(value, 2);
}

function formatSignedAdjustment(value: number) {
  if (value > 0) {
    return `+${formatNumber(value, 0)}`;
  }
  if (value < 0) {
    return formatNumber(value, 0);
  }

  return "0";
}

function formatSignedCurrency(value: number) {
  const formatted = formatPrice(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
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
