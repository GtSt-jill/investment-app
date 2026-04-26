import { TechnicalDashboard } from "@/components/technical-dashboard";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="app-header">
        <div>
          <p className="eyebrow">Semiconductor Technical Desk</p>
          <h1>半導体銘柄シグナル</h1>
          <p className="hero-copy">
            Alpaca の日足データから主要半導体銘柄を横断分析し、トレンド、モメンタム、出来高、相対強度で買い検討・監視継続・新規買い回避を整理します。
          </p>
        </div>
        <div className="header-status">
          <span>Data</span>
          <strong>Alpaca Market Data</strong>
          <p>日足 / 調整後価格 / 半導体・AI関連ウォッチリスト</p>
        </div>
      </section>

      <TechnicalDashboard />
    </main>
  );
}
