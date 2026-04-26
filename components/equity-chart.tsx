"use client";

import { formatCurrency } from "@/lib/format";
import type { SimulationResult } from "@/lib/simulator/types";

interface EquityChartProps {
  equityCurve: SimulationResult["equityCurve"];
}

export function EquityChart({ equityCurve }: EquityChartProps) {
  const width = 920;
  const height = 320;
  const padding = 18;
  const values = equityCurve.flatMap((point) => [point.portfolioValue, point.benchmarkValue]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const buildPath = (selector: (point: SimulationResult["equityCurve"][number]) => number) =>
    equityCurve
      .map((point, index) => {
        const x = padding + (index / Math.max(equityCurve.length - 1, 1)) * (width - padding * 2);
        const y = height - padding - ((selector(point) - min) / range) * (height - padding * 2);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const finalPoint = equityCurve[equityCurve.length - 1];

  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div>
          <p className="panel-eyebrow">Equity Curve</p>
          <h2>資産推移</h2>
        </div>
        <div className="chart-legend">
          <span className="strategy-line">Strategy</span>
          <span className="benchmark-line">SPY Buy & Hold</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Portfolio equity curve">
        <defs>
          <linearGradient id="equity-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(241, 117, 58, 0.45)" />
            <stop offset="100%" stopColor="rgba(241, 117, 58, 0)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="24" className="chart-surface" />
        <path
          d={`${buildPath((point) => point.portfolioValue)} L ${width - padding} ${height - padding} L ${padding} ${
            height - padding
          } Z`}
          fill="url(#equity-gradient)"
        />
        <path d={buildPath((point) => point.benchmarkValue)} fill="none" strokeWidth="3" className="benchmark-stroke" />
        <path d={buildPath((point) => point.portfolioValue)} fill="none" strokeWidth="4" className="strategy-stroke" />
      </svg>

      <div className="chart-footer">
        <span>{equityCurve[0]?.date}</span>
        <strong>{finalPoint ? formatCurrency(finalPoint.portfolioValue) : "-"}</strong>
        <span>{equityCurve[equityCurve.length - 1]?.date}</span>
      </div>
    </section>
  );
}
