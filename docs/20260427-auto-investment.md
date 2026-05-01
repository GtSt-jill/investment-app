# テクニカル分析結果に基づく自動売買機能 計画書

作成日: 2026-04-27
更新日: 2026-05-01

## 目的

既存のカテゴリ別ウォッチリストのテクニカル分析結果をもとに、Alpaca Trading API へ注文を出せる自動売買機能を段階的に実装する。

ただし、現在の `BUY` / `HOLD` / `SELL` は投資候補の分類であり、そのまま自動発注に直結させるには危険が大きい。自動売買機能では、分析結果を次の順に変換する。

```text
テクニカル分析結果
  -> 売買シグナル
  -> ポートフォリオ状況を加味した注文意図
  -> リスク制御済みの注文計画
  -> paper / dry-run での検証
  -> 明示的に許可された場合のみ live 発注
```

最初の実装目標は、ライブ発注ではなく、注文計画の生成、検証、paper trading での実行、実行ログの保存までとする。

## 現状

既存実装は次の構成になっている。

- `lib/semiconductors/analyzer.ts`
  - 日足 OHLCV からテクニカル指標を計算する。
  - `RecommendationItem` を生成する。
  - `action` は `BUY` / `HOLD` / `SELL`。
  - `analyzeMarketUniverse()` はカテゴリ別ウォッチリスト全体を分析し、既存の `analyzeSemiconductors()` は後方互換用の半導体既定ユニバースを持つ。
  - 銘柄別正規化、QQQ / SMH proxy のファクター分析、`scoreAdjustments` を返す。
  - `buyZone` に `idealEntry` / `pullbackEntry` / `stopLoss` / `takeProfit` を持つ。
- `lib/semiconductors/normalization.ts`
  - 銘柄自身の履歴に対する ATR / モメンタム / 価格位置のパーセンタイルと Z スコアを計算する。
- `lib/semiconductors/factors.ts`
  - CAPM 風の β・α・残差ボラティリティと、汎用マルチファクター回帰を計算する。
- `lib/semiconductors/backtest.ts`
  - 過去の分析時点ごとに Action / スコア帯別の将来リターンを検証する。
- `lib/semiconductors/portfolio.ts`
  - Alpaca Trading API から account / positions を取得する。
  - 口座状態、余力、保有ポジション、損益、配分比率を返す。
- `lib/semiconductors/trading/*`
  - 分析結果を売買意図、注文サイズ、注文計画、paper 実行、履歴保存へ変換する。
- `app/api/semiconductors/route.ts`
  - Alpaca Market Data API から日足を取得し、カテゴリ別ウォッチリストの分析結果を返す。
- `app/api/portfolio/route.ts`
  - Alpaca Trading API からポートフォリオ情報を返す。
- `app/api/trading/run/route.ts`
  - dry-run / paper の自動売買ワークフローを実行する。
- `app/api/trading/runs/route.ts`
  - 自動売買履歴を返す。

現行実装には、注文計画、リスク制御、重複発注防止、paper 実行、履歴保存、スケジュール実行用 runner が含まれる。引き続き live 実行、より詳細な監査ログ、外部ファクターデータ取得、決算予定日取得は慎重に拡張する。

残っている主な拡張候補:

- live 実行の段階的な有効化と追加確認 UI
- 決算予定日 API の連携
- 外部ファクター系列の取得と保存
- バックテスト結果の UI 表示
- シグナル遷移の永続化とヒステリシス
- 異常時停止ルールの強化

## 基本方針

### 1. `BUY` を即時買いにしない

既存の `BUY` は「買い検討」であり、即時発注ではない。自動売買では `RecommendationItem` をさらに評価して、次のような注文意図に変換する。

```ts
type TradeIntent =
  | "OPEN_LONG"
  | "ADD_LONG"
  | "REDUCE_LONG"
  | "CLOSE_LONG"
  | "NO_ACTION";
```

例:

- 未保有銘柄が `BUY` かつスコア・地合い・流動性条件を満たす場合だけ `OPEN_LONG`
- 既に保有中の銘柄が `BUY` の場合は、上限配分未満なら `ADD_LONG`
- 保有中の銘柄が `SELL` の場合は、損切り条件やトレンド崩れを確認して `REDUCE_LONG` または `CLOSE_LONG`
- `HOLD` は原則 `NO_ACTION`

### 2. 発注ロジックは分析ロジックから分離する

`analyzer.ts` に発注処理を混ぜない。分析は純粋なシグナル生成に保ち、自動売買は別モジュールに分ける。

追加候補:

```text
lib/semiconductors/trading/
  config.ts
  intent.ts
  sizing.ts
  risk.ts
  orders.ts
  alpaca-trading.ts
  storage.ts
  runner.ts
```

責務:

- `intent.ts`: 分析結果と保有状況から売買意図を作る
- `sizing.ts`: 注文数量・金額を計算する
- `risk.ts`: 口座・銘柄・日次損失などの制約を適用する
- `orders.ts`: Alpaca に送る注文リクエスト形式へ変換する
- `alpaca-trading.ts`: Alpaca Trading API の薄いクライアント
- `storage.ts`: シグナル、注文計画、注文結果を保存する
- `runner.ts`: 一連の自動売買ワークフローを実行する

### 3. 最初は paper trading と dry-run を必須にする

実装初期は `AUTO_TRADING_MODE` を次の 3 モードにする。

```text
off      : 自動売買しない
dry-run  : 注文計画だけ作り、API へ発注しない
paper    : Alpaca paper account にだけ発注する
live     : live account に発注する
```

初期値は必ず `off` にする。`live` は実装しても最初は無効化し、十分な paper 検証と手動確認 UI を入れてから有効にする。

## 売買ルール

### エントリー条件

未保有銘柄に対して、次をすべて満たす場合だけ新規買い候補にする。

- `action === "BUY"`
- `score >= 70`
- `rating` が `BUY` または `STRONG_BUY`
- `marketRegime !== "defensive"`
- `relativeStrengthRank` が上位グループ
- `stopLoss < currentPrice < takeProfit`
- `atrPct` が上限以下
- 決算予定日が近い場合は除外
- 既に同一銘柄の未約定注文がない
- 1日の新規エントリー上限に達していない

既存の `buyZone.idealEntry` と `buyZone.pullbackEntry` を使い、現在値が大きく乖離している場合は発注しないか、指値注文にする。

### 追加購入条件

保有中銘柄に対して、次を満たす場合だけ追加購入を検討する。

- `action === "BUY"`
- 既存ポジションが含み益
- 現在の銘柄配分が上限未満
- 追加後もポートフォリオ全体のリスク上限内
- 前回購入から一定営業日以上経過

### 売却条件

保有中銘柄に対して、次のいずれかを満たす場合に売却候補にする。

- `action === "SELL"` かつ `score < sellScoreThreshold`
- `action === "SELL"` かつ `score <= severeSellExitScoreThreshold`
- 現在値が保存済み stop loss を下回った
- `marketRegime === "defensive"` かつ銘柄スコアが悪化
- 銘柄配分が上限を超えている
- 日次または週次の損失制限に近づいている

通常の弱い `SELL` は `REDUCE_LONG` による部分売却を優先する。損切りラインを明確に割った場合、または `severeSellExitScoreThreshold` 以下の強い悪化シグナルでは `CLOSE_LONG` を許可する。

現行の `TradeIntentCandidate` は、実行意図を追跡しやすくするために次のメタデータを持つ。

- `stance`: `bullish` / `neutral` / `bearish`
- `actionReason`: `BUY_SIGNAL`、`SELL_AVOID_NEW_BUY`、`WEAK_SELL_REDUCE`、`SEVERE_SELL_EXIT`、`STOP_LOSS_EXIT` など
- `exitReason`: `STOP_LOSS`、`SEVERE_SELL_SIGNAL`、`WEAK_SELL_SIGNAL`、`DEFENSIVE_REGIME`、`OVER_ALLOCATION`
- `scoreGate`: エントリースコア条件を通過したか
- `entryScoreThreshold`
- `severeSellExitScoreThreshold`

## 注文サイズ計算

注文サイズは「スコアが高いから大きく買う」ではなく、「許容損失から逆算する」方式にする。

基本式:

```text
riskAmount = portfolioValue * riskPerTradePct
riskPerShare = currentPrice - stopLoss
quantityByRisk = floor(riskAmount / riskPerShare)
quantityByAllocation = floor(maxPositionValue / currentPrice)
quantity = min(quantityByRisk, quantityByAllocation, quantityByBuyingPower)
```

初期値:

| 項目 | 初期値 |
| --- | ---: |
| 1トレードの最大許容損失 | 口座評価額の 0.5% |
| 1銘柄の最大配分 | 口座評価額の 8% |
| 分析対象カテゴリ群の最大配分 | 口座評価額の 50% |
| 1日の新規エントリー数 | 3件 |
| 1日の最大発注額 | 口座評価額の 15% |
| 最小注文金額 | 100 USD |

小口口座や fractional shares を使う場合は、数量ベースではなく notional 注文も検討する。ただし初期実装では整数株を前提にして、仕様を単純にする。

## リスク制御

自動売買では、発注前に必ず次の制約を確認する。

### 口座制約

- `account.tradingBlocked` が true なら発注禁止
- `account.accountBlocked` が true なら発注禁止
- `account.buyingPower` が不足している場合は発注禁止
- `account.patternDayTrader` が true の場合は日中売買を抑制

### ポートフォリオ制約

- 最大ポジション数
- 1銘柄最大配分
- セクター最大配分
- 現金比率の下限
- 日次損失上限
- 週次損失上限
- 未約定注文を含めた予定配分

### 銘柄制約

- ATR 比率が高すぎる銘柄を除外
- 出来高が薄い銘柄を除外
- 価格が低すぎる銘柄を除外
- 決算前の新規エントリーを停止
- ギャップアップ直後の成行買いを禁止

### システム制約

- 同じ分析日・同じ銘柄・同じ intent の重複発注を禁止
- 注文送信前に最新ポジションと未約定注文を再取得する
- API エラーが続いた場合は自動売買を停止する
- 発注後は注文 ID とレスポンスを保存する
- live mode では手動承認フラグを必須にする

## 注文方式

初期実装では、買い注文は原則として指値または bracket order を使う。

候補:

| 用途 | 注文方式 |
| --- | --- |
| 新規買い | limit buy |
| 新規買い + 利確/損切り | bracket order |
| 既存ポジションの利確 | limit sell |
| 既存ポジションの損切り | stop または stop limit |
| 緊急クローズ | market sell。ただし通常運用では避ける |

Alpaca Trading API は `/v2/orders` で注文作成を行い、equity では `simple` / `oco` / `oto` / `bracket` などの order class を扱える。実装時は Alpaca 公式ドキュメントの最新仕様を確認する。

参考:

- [Alpaca Trading API](https://docs.alpaca.markets/docs/trading-api)
- [Alpaca Placing Orders](https://docs.alpaca.markets/docs/trading/orders/)
- [Alpaca Create an Order](https://docs.alpaca.markets/reference/postorder)
- [Alpaca Paper Trading](https://docs.alpaca.markets/docs/trading/paper-trading/)

## データ保存

自動売買では、前回シグナル、注文計画、注文結果、エラーを保存する必要がある。

保存対象:

```ts
interface TradingRun {
  id: string;
  mode: "dry-run" | "paper" | "live";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "stopped";
  marketRegime: MarketRegime;
  portfolioValue: number;
  notes: string[];
}

interface TradePlan {
  id: string;
  runId: string;
  symbol: string;
  intent: TradeIntent;
  action: SignalAction;
  score: number;
  quantity: number;
  notional: number;
  orderType: "market" | "limit" | "stop" | "stop_limit" | "bracket";
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: "planned" | "blocked" | "submitted" | "filled" | "rejected" | "cancelled";
  blockReasons: string[];
}

interface TradeOrderLog {
  id: string;
  planId: string;
  alpacaOrderId?: string;
  request: unknown;
  response?: unknown;
  error?: string;
  createdAt: string;
}
```

実装方式は、まず `storage.ts` でインターフェースを切る。ローカル実行中心なら SQLite、外部デプロイするなら Postgres を使う。Next.js の実行環境に依存しないよう、注文判断ロジックはストレージ実装から分離する。

## API 設計

### 自動売買設定取得

```text
GET /api/trading/config
```

返す内容:

- mode
- risk limits
- enabled symbols
- live trading enabled flag
- last run summary

### 自動売買 dry-run

```text
POST /api/trading/run
{
  "mode": "dry-run"
}
```

分析、ポートフォリオ取得、注文計画作成、リスクチェックまで行う。Alpaca には発注しない。

### paper 発注

```text
POST /api/trading/run
{
  "mode": "paper"
}
```

dry-run と同じ注文計画を作り、通過した注文だけ Alpaca paper account に送信する。

### live 発注

```text
POST /api/trading/run
{
  "mode": "live",
  "confirmation": "明示的な確認トークン"
}
```

初期実装では 400 を返す。live 有効化は別フェーズで行う。

### 注文履歴

```text
GET /api/trading/runs
GET /api/trading/runs/:id
```

過去の実行、注文計画、発注結果、ブロック理由を確認できるようにする。

## UI 設計

既存ダッシュボードに次の領域を追加する。

- 自動売買モード表示
- 直近 run の結果
- 注文候補一覧
- ブロックされた注文と理由
- paper 注文の送信結果
- ポジション別の stop loss / take profit
- 自動売買停止ボタン

UI では「買い推奨」ではなく「注文候補」「発注予定」「ブロック理由」という表現にする。特に live mode では、発注前に確認画面を必須にする。

## 実行タイミング

最初は手動実行だけにする。

```text
Phase 1: 手動 dry-run
Phase 2: 手動 paper trading
Phase 3: スケジュール実行 dry-run
Phase 4: スケジュール実行 paper trading
Phase 5: live mode の限定解放
```

スケジュール実行を入れる場合は、米国市場の引け後または寄り前に限定する。日足ベースの分析なので、ザラ場中に頻繁に実行する必要はない。

候補:

- 米国市場引け後に日足確定を待って実行
- 寄り前に前日データで注文計画を作成
- 決算発表日や祝日カレンダーを確認して停止

## サーバー運用方針

自動売買を行う場合、処理はサーバー上で実行できる状態にする。ただし、Next.js アプリ本体を常時起動して売買判断を担わせるのではなく、管理画面/API と自動売買 runner を分離する。

```text
Next.js App
  - ダッシュボード表示
  - 設定確認
  - 注文履歴確認
  - 手動 dry-run / paper 実行

Trading Runner
  - cron または scheduler から起動
  - 分析結果とポートフォリオを取得
  - 注文計画を生成
  - risk check を通過した注文だけ送信
  - 実行結果とエラーを保存

DB
  - 分析結果
  - 注文計画
  - 注文結果
  - エラー履歴
```

日足ベースの分析では常時監視は不要であり、まずは米国市場の引け後または寄り前に 1 日 1 回だけ runner を実行する。Next.js の API から手動実行できるようにしつつ、本番運用では外部 scheduler から runner を呼ぶ構成にする。

初期の推奨構成:

- 小さな VPS または常時稼働できるサーバーにデプロイする
- `AUTO_TRADING_MODE=off` を初期値にする
- cron では最初に `dry-run` だけを実行する
- paper trading へ進むまでは Alpaca への注文送信を無効にする
- scheduler と手動実行が同時に動かないよう run lock を入れる
- エラーが連続した場合は kill switch を有効にして自動実行を止める

実装上は `yarn auto-trade` を cron から呼ぶ。これは Next.js の `/api/trading/run` を呼び出す薄い runner であり、次を担当する。

- `AUTO_TRADING_API_URL` に対して `POST /api/trading/run` を送る
- `AUTO_TRADING_MODE` が `paper` または `dry-run` の場合だけ実行する
- `AUTO_TRADING_LOCK_PATH` にロックファイルを作り、同時実行を防ぐ
- `AUTO_TRADING_LOCK_TTL_MS` を過ぎた古いロックは破棄する
- `AUTO_TRADING_SKIP_MARKET_CLOSED=true` の場合、米国東部時間の土日は実行しない

cron 例:

```cron
# 米国市場引け後を想定。サーバーの timezone に合わせて調整する。
30 7 * * 2-6 cd /path/to/investment-app && yarn auto-trade >> logs/auto-trading.log 2>&1
```

最初は `AUTO_TRADING_MODE=dry-run` で運用し、履歴と blocked 理由を確認してから `AUTO_TRADING_MODE=paper` と `AUTO_TRADING_PAPER_ENABLED=true` に進める。

## テスト計画

### ユニットテスト

- `intent.ts`
  - 未保有 `BUY` が `OPEN_LONG` になる
  - 保有中 `SELL` が `REDUCE_LONG` または `CLOSE_LONG` になる
  - `HOLD` は `NO_ACTION` になる
- `sizing.ts`
  - stop loss から数量を逆算できる
  - buying power 不足時に数量が制限される
  - risk per share が不正な場合に注文不可になる
- `risk.ts`
  - 口座ブロック時に全注文を止める
  - 銘柄配分上限を超える注文を止める
  - 重複注文を止める
- `orders.ts`
  - TradePlan から Alpaca 注文リクエストを生成できる

### 結合テスト

- 固定の分析結果とポートフォリオを使って dry-run を実行する
- 発注対象、ブロック対象、理由が期待通りになる
- Alpaca API クライアントを mock して paper 注文送信を検証する

### 運用テスト

- 最低 20 営業日分の paper trading を記録する
- 実発注前に、注文候補と実際の約定結果の差を確認する
- スリッページ、未約定、部分約定、API エラー、祝日、決算日を観察する

## 実装フェーズ

### Phase 1: dry-run 基盤

目的: 発注せずに注文計画を作れるようにする。

実装:

- `TradeIntent` / `TradePlan` / `RiskConfig` 型を追加
- 分析結果とポートフォリオから `TradePlan` を生成
- 注文サイズ計算を追加
- リスクチェックを追加
- `POST /api/trading/run` の `dry-run` を追加
- テストを追加

完了条件:

- Alpaca に発注せず、注文候補とブロック理由を JSON で返せる
- 同じ入力に対して deterministic な結果になる

### Phase 2: paper trading

目的: Alpaca paper account に限定して注文を送信できるようにする。

実装:

- Alpaca `/v2/orders` クライアントを追加
- 未約定注文取得を追加
- 注文送信前の再チェックを追加
- 注文レスポンス保存を追加
- `paper` mode を追加

完了条件:

- paper account にだけ発注される
- 発注した注文 ID とレスポンスを保存できる
- API エラー時に後続注文を止められる

### Phase 3: 履歴と UI

目的: 自動売買の判断理由と実行結果を追跡できるようにする。

実装:

- run 履歴 API を追加
- 注文計画一覧 UI を追加
- ブロック理由表示を追加
- ポジション別 risk 表示を追加
- kill switch を追加

完了条件:

- どのシグナルから、なぜ注文したか、またはなぜ止めたかを追跡できる
- UI から自動売買を停止できる

### Phase 4: スケジュール実行

目的: 手動実行ではなく、決まった時間に dry-run / paper を実行できるようにする。

実装:

- `scripts/auto-trading-run.mjs` を追加し、cron または外部 scheduler から `yarn auto-trade` で実行する
- 米国東部時間の土日を市場休場扱いとして停止する
- run の同時実行ロックを追加する
- API エラー時は非ゼロ終了コードを返し、cron 側で検知できるようにする

完了条件:

- 同時実行されない
- 土日は実行されない
- API エラー時に非ゼロ終了コードで終了する
- cron ログに run id、planned / blocked / submitted 件数が残る

### Phase 5: live mode 検討

目的: paper trading の検証結果が十分な場合だけ live 発注を限定的に解放する。

実装前条件:

- paper trading の実績が最低 20 営業日以上ある
- すべての注文が履歴保存されている
- stop loss / take profit の扱いが検証済み
- API 障害時の停止動作が確認済み
- live 用の別 API key と明示的な環境変数がある

実装:

- `AUTO_TRADING_LIVE_ENABLED=true` がない限り live 不可
- 1回の live run ごとに確認トークンを要求
- 初期は 1 日 1 注文、最小金額で開始
- live では market buy を禁止し、limit または bracket のみにする

完了条件:

- live mode は明示的に有効化しない限り動かない
- live 発注前に dry-run と同じ注文計画を確認できる
- live 注文はすべて監査ログに残る

## 環境変数

追加候補:

```text
AUTO_TRADING_MODE=off
AUTO_TRADING_LIVE_ENABLED=false
AUTO_TRADING_MAX_POSITION_PCT=0.08
AUTO_TRADING_MAX_SECTOR_PCT=0.50
AUTO_TRADING_RISK_PER_TRADE_PCT=0.005
AUTO_TRADING_MAX_DAILY_NEW_ENTRIES=3
AUTO_TRADING_MAX_DAILY_NOTIONAL_PCT=0.15
AUTO_TRADING_MIN_ORDER_NOTIONAL=100
AUTO_TRADING_ALLOWED_SYMBOLS=NVDA,AVGO,AMD,ASML,TSM
AUTO_TRADING_KILL_SWITCH=true
```

既存の Alpaca 環境変数は継続利用する。

```text
APCA_API_KEY_ID
APCA_API_SECRET_KEY
ALPACA_DATA_BASE_URL
ALPACA_DATA_FEED
ALPACA_TRADING_BASE_URL
```

live と paper を誤って混同しないよう、live 用 base URL と paper 用 base URL は設定上で明確に分ける。

## 最初に実装すべき最小構成

まずは Phase 1 の dry-run を実装する。

優先順位:

1. `TradeIntent` / `TradePlan` / `RiskConfig` の型定義
2. `RecommendationItem` と `PortfolioSnapshot` から注文候補を作る純粋関数
3. stop loss ベースの数量計算
4. 口座・配分・重複注文のリスクチェック
5. `POST /api/trading/run` の dry-run
6. ユニットテスト

この段階では Alpaca への発注処理は入れない。dry-run の出力が納得できるまで、paper trading へ進まない。

## 主要な注意点

- テクニカル分析は将来の価格を保証しない。
- paper trading の約定品質は live と一致しない。
- 成行注文はスリッページの影響を受ける。
- 決算、ニュース、規制、金利、為替などはテクニカル指標だけでは捉えられない。
- API 障害やデータ欠損があると誤発注につながる。
- 自動売買は「止める条件」を先に実装する必要がある。

## 結論

この機能は、分析結果から直接発注するのではなく、次の順で実装する。

1. dry-run で注文計画を生成する
2. リスク制約とブロック理由を明確にする
3. paper trading で注文送信を検証する
4. 履歴と UI で判断理由を追跡できるようにする
5. 十分な検証後に live mode を限定的に検討する

最初の実装単位は `lib/semiconductors/trading/` 配下の純粋関数と `POST /api/trading/run` の `dry-run` に限定する。
