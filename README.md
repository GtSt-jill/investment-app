# Semiconductor Technical Signals

Alpaca API を使って、半導体・AI 関連銘柄のテクニカルシグナルと Alpaca 口座のポートフォリオ状況を確認する Next.js アプリです。

このアプリは次の 2 つの画面を持ちます。

- 銘柄シグナル: Alpaca Market Data から日足 OHLCV を取得し、主要半導体銘柄を `買い検討` / `監視継続` / `新規買い回避` に分類します。
- ポートフォリオ: Alpaca Trading API から API キー発行元アカウントの口座サマリー、買付余力、保有ポジション、含み損益を表示します。

## Features

- 半導体・AI 関連ウォッチリストの横断分析
- 分析指標:
  - 20 / 50 / 200 日移動平均
  - RSI
  - MACD
  - ボリンジャーバンド
  - ATR
  - 出来高比率
  - 20 / 63 / 126 営業日モメンタム
  - 銘柄自身の履歴に対する ATR / モメンタム / 価格位置のパーセンタイルと Z スコア
  - QQQ / SMH を proxy にした CAPM 風の β・α・残差ボラティリティ
- スコアリング:
  - トレンド
  - モメンタム
  - 相対強度
  - リスク
  - 出来高
  - 銘柄別正規化とファクター分析による保守的なスコア調整
- 銘柄詳細:
  - ローソク足チャート
  - 正規化テクニカル指標とスコア調整
  - 買値目安
  - 押し目目安
  - 損切り目安
  - 利確目安
  - 買い材料とリスク
- ポートフォリオ表示:
  - 口座評価額
  - 現金
  - 買付余力
  - 当日損益
  - Long / Short / Cash エクスポージャー
  - 保有ポジション一覧
  - 含み損益と日中損益
  - 取引制限フラグ

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Vitest
- Alpaca Market Data API
- Alpaca Trading API

## Project Structure

```text
app/
  api/
    portfolio/route.ts       # Alpaca Trading API から口座・ポジション取得
    semiconductors/route.ts  # Alpaca Market Data から日足取得、分析実行
  page.tsx                   # アプリのトップページ
components/
  technical-dashboard.tsx    # シグナル/ポートフォリオのタブ UI
lib/
  semiconductors/
    alpaca.ts                # Market Data API クライアント
    analyzer.ts              # テクニカル分析とスコアリング
    backtest.ts              # シグナル別の将来リターン検証
    factors.ts               # CAPM / マルチファクター分析ユーティリティ
    indicators.ts            # SMA / RSI / MACD / ATR などの指標計算
    normalization.ts         # 銘柄別パーセンタイル / Z スコア
    portfolio.ts             # Trading API クライアントとポートフォリオ整形
    types.ts                 # 分析結果の型と対象銘柄
docs/
  technical-logic.md         # 分析ロジックの詳細
  trading-intent-refinement.md # 売買意図の分類と実行ルール
tests/
  *.test.ts                  # 指標計算と分析ロジックのテスト
```

## Requirements

- Node.js 20 以上
- Alpaca API key / secret

Market Data と Trading API は同じ認証情報を使いますが、接続先 URL は用途によって異なります。

## Setup

依存関係をインストールします。

```bash
npm install
```

環境変数を設定します。`.env.example` を参考に `.env.local` を作成してください。

```bash
APCA_API_KEY_ID=your-api-key-id
APCA_API_SECRET_KEY=your-api-secret-key
ALPACA_DATA_FEED=iex
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
```

別名として `ALPACA_API_KEY` / `ALPACA_API_SECRET` も利用できます。

### Paper / Live Account

ポートフォリオタブは `ALPACA_TRADING_BASE_URL` の接続先アカウントを表示します。

| 用途 | `ALPACA_TRADING_BASE_URL` |
| --- | --- |
| Paper trading | `https://paper-api.alpaca.markets` |
| Live trading | `https://api.alpaca.markets` |

ライブ口座を表示する場合は、誤って paper 用の API key を使っていないか確認してください。

## Development

```bash
npm run dev
```

ブラウザで次を開きます。

```text
http://localhost:3000
```

初回表示時に銘柄シグナルを取得します。ポートフォリオデータは「ポートフォリオ」タブを開いたタイミングで取得します。

## Scripts

```bash
npm run dev      # 開発サーバー
npm test         # Vitest
npm run build    # 本番ビルド
```

環境によって Vitest が一時ディレクトリ作成で失敗する場合は、`TMPDIR` を明示してください。

```bash
TMPDIR=/tmp npm test
```

## API Endpoints

### `POST /api/semiconductors`

半導体ウォッチリストを分析します。

Request body:

```json
{
  "symbols": ["NVDA", "AMD", "AVGO"],
  "lookbackDays": 520
}
```

`symbols` を省略するとデフォルトのウォッチリスト全体を分析します。`lookbackDays` は 260-900 の範囲に丸められます。

### `GET /api/portfolio`

Alpaca Trading API から次を取得します。

- `/v2/account`
- `/v2/positions`

返却データには、口座サマリー、ポジション一覧、エクスポージャー、含み損益集計が含まれます。

## Analysis Logic

分析対象は 200 日移動平均を使うため、日足が 252 本未満の銘柄は除外します。

最終スコアは次のカテゴリの重み付き平均です。

```text
finalScore =
  trendScore * 0.30
+ momentumScore * 0.25
+ relativeStrengthScore * 0.20
+ riskScore * 0.15
+ volumeScore * 0.10
```

このベーススコアに対して、銘柄自身の履歴に対する正規化指標と、QQQ / SMH へのファクター分析結果を小さく加減点します。調整だけで `BUY` 閾値をまたがないようにし、既存のテクニカル判定を補助する用途に限定しています。

バックテスト用に `runSignalBacktest()` も用意しており、過去の分析時点ごとに 20 / 63 営業日先リターン、勝率、最大逆行、最大ドローダウンを Action やスコア帯別に集計できます。

詳細は [docs/technical-logic.md](docs/technical-logic.md) を参照してください。

## Environment Variables

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `APCA_API_KEY_ID` | Yes | - | Alpaca API key ID |
| `APCA_API_SECRET_KEY` | Yes | - | Alpaca API secret key |
| `ALPACA_DATA_FEED` | No | `iex` | Market Data の feed |
| `ALPACA_DATA_BASE_URL` | No | `https://data.alpaca.markets` | Market Data API の base URL |
| `ALPACA_TRADING_BASE_URL` | No | `https://paper-api.alpaca.markets` | Trading API の base URL |

## Notes

- このアプリは投資判断を補助するテクニカル分析ツールであり、投資助言ではありません。
- `BUY` は「買い検討」または「強気監視」であり、即時購入を指示するものではありません。
- `SELL` は「新規買い回避」または「弱含み」であり、保有銘柄の即時売却を断定するものではありません。
- 実際の注文前に、決算、ニュース、流動性、スリッページ、税金、ポジションサイズ、リスク許容度を確認してください。
- ポートフォリオタブには API キー発行元アカウントの情報が表示されます。共有環境では API キーの取り扱いに注意してください。
