# Market Technical Signals

Alpaca API を使って、カテゴリ別ウォッチリストのテクニカルシグナルと Alpaca 口座のポートフォリオ状況を確認する Next.js アプリです。

このアプリは次の 3 つの主要タブを持ちます。

- 銘柄シグナル: Alpaca Market Data から日足 OHLCV を取得し、半導体、大型テック、AI・ソフトウェア、クラウド・データ、クリーンエネルギー、産業・自動化の銘柄を `買い検討` / `監視継続` / `新規買い回避` に分類します。
- ポートフォリオ: Alpaca Trading API から API キー発行元アカウントの口座サマリー、買付余力、保有ポジション、含み損益を表示します。
- 自動売買: dry-run / paper の注文計画、ブロック理由、run 履歴を確認します。

## Features

- カテゴリ別ウォッチリストの横断分析
- ALL / カテゴリ別の表示切り替えと、カテゴリ単位の銘柄選択
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
- 自動売買準備:
  - dry-run の注文計画生成
  - paper account への明示的な注文送信
  - 未約定注文の再取得と重複発注防止
  - kill switch、live mode 拒否、run 履歴、注文ログ

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
    semiconductors/route.ts  # Alpaca Market Data から日足取得、カテゴリ別分析を実行
    trading/run/route.ts     # dry-run / paper の自動売買ワークフロー
    trading/runs/route.ts    # 自動売買 run 履歴
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
    trading/                 # 意図分類、サイズ計算、risk check、paper 実行
    types.ts                 # 分析結果の型、カテゴリ、対象銘柄
scripts/
  auto-trading-run.mjs       # cron / scheduler 向け runner
docs/
  technical-logic.md         # 分析ロジックの詳細
  auto-trade-server-settings.md # サーバー上の自動実行設定
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

初回表示時にデフォルトのカテゴリ別ウォッチリスト全体を取得します。銘柄シグナル画面では `ALL` またはカテゴリを選んでランキング、候補リスト、詳細を切り替えられます。ポートフォリオデータは「ポートフォリオ」タブを開いたタイミングで取得します。

## Watchlist Categories

既定ユニバースは `lib/semiconductors/types.ts` の `SECURITY_CATEGORIES` と `DEFAULT_MARKET_UNIVERSE` で管理します。

| カテゴリ | 用途 |
| --- | --- |
| 半導体 | 半導体、製造装置、EDA、サプライチェーン |
| 大型テック | プラットフォーム、クラウド、消費者向けテック |
| AI・ソフトウェア | AI、SaaS、データ分析、サイバーセキュリティ |
| クラウド・データ | ストレージ、ネットワーク、データ基盤 |
| クリーンエネルギー | 太陽光、EV、電力・蓄電関連 |
| 産業・自動化 | 産業テック、計測、製造自動化 |

カテゴリを追加する場合は、カテゴリ定義と銘柄リストを同じファイルに追加します。UI のカテゴリタブ、API の symbol allowlist、分析対象はこの定義から派生します。`/api/semiconductors` という route 名は既存互換のため残していますが、現在はカテゴリ別ユニバース全体を扱います。

## Scripts

```bash
npm run dev      # 開発サーバー
npm test         # Vitest
npm run build    # 本番ビルド
npm run auto-trade # スケジュール実行向け runner
```

環境によって Vitest が一時ディレクトリ作成で失敗する場合は、`TMPDIR` を明示してください。

```bash
TMPDIR=/tmp npm test
```

## API Endpoints

### `POST /api/semiconductors`

カテゴリ別ウォッチリストを分析します。

Request body:

```json
{
  "symbols": ["NVDA", "MSFT", "PLTR", "ENPH"],
  "lookbackDays": 520
}
```

`symbols` を省略するとデフォルトのカテゴリ別ウォッチリスト全体を分析します。`symbols` は既定ユニバースに含まれるティッカーだけを受け付けます。`lookbackDays` は 260-900 の範囲に丸められます。

### `GET /api/portfolio`

Alpaca Trading API から次を取得します。

- `/v2/account`
- `/v2/positions`

返却データには、口座サマリー、ポジション一覧、エクスポージャー、含み損益集計が含まれます。

### `POST /api/trading/run`

カテゴリ別ウォッチリストの分析、ポートフォリオ、未約定注文を取得して、注文計画を作ります。`mode` は `dry-run` または `paper` を受け付けます。`live` は承認条件を評価しますが、現時点では発注送信しません。

`dry-run` は Alpaca に発注せず、`plans`、`orders`、`summary`、ブロック理由を返します。`paper` は `AUTO_TRADING_PAPER_ENABLED=true` が環境変数で設定されている場合だけ、`planned` の注文を Alpaca paper account に送信します。request body の `config.paperTradingEnabled` だけでは paper 発注を有効化できません。

`riskProfile` で paper / dry-run の実行姿勢を切り替えられます。`active` は買い条件や価格乖離制限を緩め、弱い `HOLD` 保有も削減候補にします。`balanced` は既定値、`cautious` は買い条件、ATR、価格乖離、reward:risk を厳しくします。

### `GET /api/trading/runs`

`AUTO_TRADING_RUN_LOG_PATH` または `data/trading-runs.jsonl` から、直近の自動売買 run 履歴と paper run readiness を返します。

## Auto-Trading Readiness

現在の実装は dry-run と paper trading までを対象にしています。実資金の live 発注は未対応です。

実装済みの safety gate:

- ライブラリ設定の既定 mode は `off`、API / scheduler の未指定実行は発注しない `dry-run`
- `AUTO_TRADING_PAPER_ENABLED=true` がない限り paper 発注しない
- `live` mode は `/api/trading/run` と `npm run auto-trade` の両方で拒否
- Alpaca Trading client は明示的な `allowLive: true` なしに live URL へ注文送信しない
- `AUTO_TRADING_KILL_SWITCH=true` で paper 提出を skip
- paper 実行直前に open orders を再取得して重複注文を block
- live mode 要求時は、20日分の paper run、最新 dry-run id、環境変数の live enable flag、確認 token を検証する
- 注文は `limit` または `bracket` で作成し、`market buy` は生成しない
- scheduler は同時実行 lock と米国市場休場日の簡易 guard を持つ
- run 履歴と paper 注文ログを JSONL に保存できる。ただし保存失敗は notes に残す best-effort で、live 用の監査ログ保証ではない

real-money-readiness の未達 criteria:

- live 用 API key / base URL を paper と完全分離する
- live 注文前に dry-run と同一の注文計画を人間が確認できる UI を用意する
- 連続 API エラー、注文拒否、履歴保存失敗を検知して自動的に停止する運用ルールを決める
- stop loss / take profit、partial fill、cancel / replace、短縮取引日を含む broker 実挙動を paper と手動 review で確認する

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

このベーススコアに対して、銘柄自身の履歴に対する正規化指標と、QQQ / SMH へのファクター分析結果を小さく加減点します。SMH は半導体カテゴリに限らず、グロース・AI 関連のリスク proxy として補助的に使います。調整だけで `BUY` 閾値をまたがないようにし、既存のテクニカル判定を補助する用途に限定しています。

バックテスト用に `runSignalBacktest()` も用意しており、過去の分析時点ごとに 20 / 63 営業日先リターン、勝率、中央値リターン、profit factor、downside deviation、最大逆行、最大ドローダウンを Action やスコア帯別に集計できます。

詳細は [docs/technical-logic.md](docs/technical-logic.md) を参照してください。

## Environment Variables

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `APCA_API_KEY_ID` | Yes | - | Alpaca API key ID |
| `APCA_API_SECRET_KEY` | Yes | - | Alpaca API secret key |
| `ALPACA_DATA_FEED` | No | `iex` | Market Data の feed |
| `ALPACA_DATA_BASE_URL` | No | `https://data.alpaca.markets` | Market Data API の base URL |
| `ALPACA_TRADING_BASE_URL` | No | `https://paper-api.alpaca.markets` | Trading API の base URL |
| `AUTO_TRADING_MODE` | No | `off` / API default `dry-run` | `off`、`dry-run`、`paper`、`live`。`live` は承認条件のみ評価し、発注送信は未対応 |
| `AUTO_TRADING_PAPER_ENABLED` | No | `false` | `paper` mode の実発注許可 |
| `AUTO_TRADING_LIVE_ENABLED` | No | `false` | live approval gate の明示的な有効化。発注送信はまだ未対応 |
| `AUTO_TRADING_LIVE_CONFIRMATION_TOKEN` | No | - | live approval request で照合する確認 token |
| `AUTO_TRADING_KILL_SWITCH` | No | `false` | paper 提出を停止 |
| `AUTO_TRADING_ALLOWED_SYMBOLS` | No | - | 自動売買対象 symbol の comma-separated allowlist |
| `AUTO_TRADING_RISK_PROFILE` | No | `balanced` | `active`、`balanced`、`cautious` |
| `AUTO_TRADING_MIN_ENTRY_SCORE` | No | `70` | 新規買いの最低スコア |
| `AUTO_TRADING_ADD_MIN_SCORE` | No | `72` | 追加買いの最低スコア |
| `AUTO_TRADING_MIN_ENTRY_REWARD_RISK_RATIO` | No | `1.5` | エントリー時の最低 reward:risk |
| `AUTO_TRADING_NEUTRAL_ENTRY_SCORE_BUFFER` | No | `5` | neutral regime で追加要求するスコア buffer |
| `AUTO_TRADING_UNSTABLE_SIGNAL_SCORE_BUFFER` | No | `3` | 新規/反転 BUY に追加要求するスコア buffer |
| `AUTO_TRADING_MAX_ENTRY_SMA20_PREMIUM_PCT` | No | `0.08` | 20日線からの最大上方乖離 |
| `AUTO_TRADING_MAX_ENTRY_DAY_CHANGE_PCT` | No | `0.04` | エントリー許容する当日上昇率上限 |
| `AUTO_TRADING_WEAK_HOLD_REDUCE_SCORE_THRESHOLD` | No | - | 設定時、保有中の弱い `HOLD` を削減候補にするスコア閾値 |
| `AUTO_TRADING_RUN_LOG_PATH` | No | `data/trading-runs.jsonl` | run 履歴 JSONL |
| `AUTO_TRADING_LOG_PATH` | No | - | paper 注文ログ JSONL |
| `AUTO_TRADING_API_URL` | No | `http://localhost:3000/api/trading/run` | scheduler が呼ぶ API URL |
| `AUTO_TRADING_LOCK_PATH` | No | `data/auto-trading.lock` | scheduler の同時実行 lock |

## Notes

- このアプリは投資判断を補助するテクニカル分析ツールであり、投資助言ではありません。
- `BUY` は「買い検討」または「強気監視」であり、即時購入を指示するものではありません。
- `SELL` は「新規買い回避」または「弱含み」であり、保有銘柄の即時売却を断定するものではありません。
- 自動売買は現時点で dry-run と paper trading までです。live 発注は未対応で、実資金運用の前に上記 readiness criteria を満たす必要があります。
- 実際の注文前に、決算、ニュース、流動性、スリッページ、税金、ポジションサイズ、リスク許容度を確認してください。
- ポートフォリオタブには API キー発行元アカウントの情報が表示されます。共有環境では API キーの取り扱いに注意してください。
