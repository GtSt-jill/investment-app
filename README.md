# Signal Forge

米国 ETF を対象にした投資シミュレーターのプロトタイプです。  
通知アプリへ拡張する前段として、説明可能なルールベース戦略で売買を再現し、元本の増加やドローダウンを検証できます。

## Strategy

- 市場判定: `SPY` が長期移動平均を上回ると `risk-on`、下回ると `risk-off`
- 攻め候補: `SPY`, `QQQ`, `VTI`
- 守り候補: `IEF`, `GLD`, `SHY`
- ランキング: 90 日モメンタム
- 執行: 終値でシグナル判定、翌営業日の終値で約定近似
- リスク制御: 固定ストップ、トレーリングストップ、集中投資上限

## Setup

```bash
npm install
npm run fetch:data
npm run dev
```

## Testing

```bash
npm test
npm run build
```

## Notes

- バックテスト結果は将来の運用成果を保証しません
- このプロトタイプは投資助言ではありません
- 初版では税金と配当再投資を簡略化しています
