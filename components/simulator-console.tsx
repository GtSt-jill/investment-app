"use client";

import { useState, useTransition } from "react";

import { EquityChart } from "@/components/equity-chart";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { SimulationResult, StrategyInput } from "@/lib/simulator/types";

interface SimulatorConsoleProps {
  initialInput: StrategyInput;
  initialResult: SimulationResult;
}

export function SimulatorConsole({ initialInput, initialResult }: SimulatorConsoleProps) {
  const [form, setForm] = useState(initialInput);
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof StrategyInput>(field: K, value: number) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Simulation failed.");
        return;
      }

      const payload = (await response.json()) as SimulationResult;
      setResult(payload);
    });
  }

  return (
    <div className="dashboard-grid">
      <section className="panel control-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Scenario Inputs</p>
            <h2>シミュレーション条件</h2>
          </div>
          <span className={`status-pill ${isPending ? "pending" : ""}`}>{isPending ? "Running" : "Ready"}</span>
        </div>

        <form className="controls" onSubmit={handleSubmit}>
          <label>
            <span>初期元本 (USD)</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={form.initialCapital}
              onChange={(event) => updateField("initialCapital", Number(event.target.value))}
            />
          </label>
          <label>
            <span>検証年数</span>
            <input
              type="number"
              min={1}
              max={6}
              step={1}
              value={form.years}
              onChange={(event) => updateField("years", Number(event.target.value))}
            />
          </label>
          <label>
            <span>移動平均日数</span>
            <input
              type="number"
              min={50}
              max={250}
              step={10}
              value={form.riskOnMaDays}
              onChange={(event) => updateField("riskOnMaDays", Number(event.target.value))}
            />
          </label>
          <label>
            <span>モメンタム日数</span>
            <input
              type="number"
              min={20}
              max={180}
              step={10}
              value={form.momentumDays}
              onChange={(event) => updateField("momentumDays", Number(event.target.value))}
            />
          </label>
          <label>
            <span>保有銘柄数</span>
            <input
              type="number"
              min={1}
              max={2}
              step={1}
              value={form.topAssets}
              onChange={(event) => updateField("topAssets", Number(event.target.value))}
            />
          </label>
          <label>
            <span>固定ストップ (%)</span>
            <input
              type="number"
              min={2}
              max={20}
              step={1}
              value={form.stopLossPct * 100}
              onChange={(event) => updateField("stopLossPct", Number(event.target.value) / 100)}
            />
          </label>
          <label>
            <span>トレーリング (%)</span>
            <input
              type="number"
              min={3}
              max={25}
              step={1}
              value={form.trailingStopPct * 100}
              onChange={(event) => updateField("trailingStopPct", Number(event.target.value) / 100)}
            />
          </label>
          <label>
            <span>取引手数料 (USD)</span>
            <input
              type="number"
              min={0}
              max={25}
              step={0.5}
              value={form.feePerTrade}
              onChange={(event) => updateField("feePerTrade", Number(event.target.value))}
            />
          </label>
          <button type="submit">Re-run Simulation</button>
        </form>

        {error ? <p className="error-message">{error}</p> : null}

        <div className="notes-block">
          <p className="panel-eyebrow">Rules</p>
          <ul>
            {result.strategyNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="summary-grid">
        <SummaryCard label="Final Value" value={formatCurrency(result.summary.finalValue)} />
        <SummaryCard label="Total Return" value={formatPercent(result.summary.totalReturnPct)} />
        <SummaryCard label="CAGR" value={formatPercent(result.summary.cagrPct)} />
        <SummaryCard label="Max Drawdown" value={formatPercent(result.summary.maxDrawdownPct)} />
        <SummaryCard label="SPY Return" value={formatPercent(result.summary.benchmarkReturnPct)} />
        <SummaryCard label="Win Rate" value={formatPercent(result.summary.winRatePct)} />
      </section>

      <EquityChart equityCurve={result.equityCurve} />

      <section className="panel recommendation-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Next Session</p>
            <h2>推奨アクション</h2>
          </div>
          <span className={`regime-badge ${result.recommendation.regime}`}>{result.recommendation.regime}</span>
        </div>

        <p className="recommendation-copy">{result.recommendation.rationale}</p>
        <div className="chip-row">
          {result.recommendation.targets.map((symbol) => (
            <span key={symbol} className="symbol-chip">
              {symbol}
            </span>
          ))}
        </div>

        <div className="action-list">
          {result.recommendation.actions.map((action) => (
            <article key={`${action.symbol}-${action.action}`} className="action-card">
              <strong>{action.symbol}</strong>
              <span>{action.action}</span>
              <p>{action.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Execution Log</p>
            <h2>売買履歴</h2>
          </div>
          <span>{formatNumber(result.summary.totalTrades, 0)} trades</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Side</th>
                <th>Symbol</th>
                <th>Price</th>
                <th>Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.slice(-16).reverse().map((trade) => (
                <tr key={`${trade.date}-${trade.symbol}-${trade.side}-${trade.quantity}`}>
                  <td>{trade.date}</td>
                  <td>{trade.side}</td>
                  <td>{trade.symbol}</td>
                  <td>{formatCurrency(trade.price)}</td>
                  <td>{formatCurrency(trade.grossValue)}</td>
                  <td>{trade.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">Allocation Stints</p>
            <h2>保有銘柄の推移</h2>
          </div>
          <span>{result.summary.startDate} to {result.summary.endDate}</span>
        </div>
        <div className="timeline-list">
          {result.allocationTimeline.slice(-12).reverse().map((segment) => (
            <article key={`${segment.startDate}-${segment.endDate}-${segment.symbols.join("-")}`} className="timeline-card">
              <div>
                <strong>{segment.symbols.join(" / ") || "CASH"}</strong>
                <span>{segment.regime}</span>
              </div>
              <p>
                {segment.startDate} → {segment.endDate}
              </p>
            </article>
          ))}
        </div>
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
