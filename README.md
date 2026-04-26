# Semiconductor Technical Signals

Alpaca Market Data から主要半導体銘柄の日足を取得し、買い検討・監視継続・新規買い回避の候補を一覧化する Next.js アプリです。

## Features

- 半導体・AI関連ウォッチリストの横断分析
- 指標: 20/50/200日移動平均、RSI、MACD、ボリンジャーバンド、ATR、出来高比率、20/63/126営業日モメンタム
- スコアリング: トレンド、モメンタム、出来高、相対強度、ボラティリティを 0-100 点で評価
- 推奨分類: `買い検討`, `監視継続`, `新規買い回避`
- 銘柄詳細: 価格チャート、買値目安、押し目目安、損切り・利確目安、買い材料とリスク

## Setup

Alpaca の認証情報を環境変数に設定してください。

```bash
export APCA_API_KEY_ID="your-key"
export APCA_API_SECRET_KEY="your-secret"
export ALPACA_DATA_FEED="iex"
npm install
npm run dev
```

別名として `ALPACA_API_KEY` / `ALPACA_API_SECRET` も利用できます。

## Testing

```bash
npm test
npm run build
```

## Notes

- このアプリは投資判断を補助するテクニカル分析ツールであり、投資助言ではありません。
- 実際の注文前に決算、ニュース、流動性、スリッページ、税金、ポジションサイズを確認してください。
