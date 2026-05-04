# 分析スナップショット履歴機能 仕様書・実装計画

## 目的

カテゴリ別ウォッチリストの分析結果を 1 日 1 回 DB に保存し、ユーザーが日時を指定して過去の分析情報を参照できるようにする。

現行の `data/trading-runs.jsonl` は自動売買 run の監査ログであり、分析単体の履歴としては使いにくい。今回の機能では、`MarketAnalysisResult` を保存単位にした「分析スナップショット」を新設する。

## 対象範囲

- `/api/semiconductors` で生成している `MarketAnalysisResult` の日次保存
- 保存済みスナップショットの一覧取得
- 指定日時、指定日、指定銘柄の履歴参照
- 手動更新とスケジュール実行の重複保存防止
- 既存ダッシュボードからの履歴切り替え

自動売買 run の注文計画、発注結果、paper/live readiness は引き続き既存の `trading-runs.jsonl` と `/api/trading/runs` が扱う。

## 用語

- `analysis snapshot`: 1 回の分析結果を DB に永続化したレコード
- `asOf`: 分析対象の日足データの基準日。米国市場の日付
- `generatedAt`: 分析処理を実行した日時
- `snapshotKey`: 同一分析対象を判定するキー。`asOf + universeHash + lookbackDays + analyzerVersion`
- `universeHash`: 分析対象銘柄とカテゴリ構成から作る安定ハッシュ

## 保存タイミング

### 定期保存

- 1 日 1 回、米国市場の引け後に実行する。
- 推奨時刻は `America/New_York 18:30`。
- 日本時間では標準時間中 `08:30`、夏時間中 `07:30` の翌朝になる。
- 既存の scheduler 方針と同様、実行は cron または外部 scheduler から API/runner を呼び出す。

### 手動保存

- UI の「分析を更新」は原則として画面表示のみ更新する。
- 「履歴に保存」または `save=true` を指定した API 呼び出しだけが DB 保存する。
- ただしスケジュール実行の API は常に保存を試みる。

### 重複制御

- 同じ `snapshotKey` は upsert とする。
- `snapshotKey` は市場日付 `asOf` に加えて保存ローカル日を含める。同じ `asOf` でも翌日に保存した分析は別履歴として残す。
- 同一保存日で再実行した場合、既定では既存 snapshot を保持し、`force=true` のときだけ上書きする。
- 上書き時は `revision` をインクリメントし、`updatedAt` を更新する。

## DB 方針

初期実装は SQLite を推奨する。理由は、このアプリが単体 Next.js アプリとして動いており、既存の履歴もローカル `data/` 配下で完結しているため。将来サーバー複数台や外部ホスティングに移る場合は PostgreSQL へ移行できるよう、DB アクセス層を `lib/semiconductors/analysis-history/` に閉じ込める。

推奨ファイル:

- `data/investment-app.sqlite`

推奨環境変数:

- `ANALYSIS_HISTORY_DB_URL`: 例 `file:./data/investment-app.sqlite`
- `ANALYSIS_HISTORY_RETENTION_DAYS`: 既定 `1095`
- `ANALYSIS_HISTORY_API_URL`: scheduler から呼ぶ保存 API。既定 `http://localhost:3000/api/analysis/snapshots`
- `ANALYSIS_HISTORY_SCHEDULE_SYMBOLS`: 定期保存対象。未指定なら既定ユニバース全体
- `ANALYSIS_HISTORY_LOOKBACK_DAYS`: 既定 `520`
- `ANALYSIS_HISTORY_LOCK_PATH`: 既定 `data/analysis-history.lock`
- `ANALYSIS_HISTORY_LOCK_TTL_MS`: 既定 `2700000`
- `ANALYSIS_HISTORY_SKIP_MARKET_CLOSED`: 既定 `true`
- `ANALYSIS_HISTORY_FORCE`: 既定 `false`

## テーブル設計

### `analysis_snapshots`

| column | type | required | description |
| --- | --- | --- | --- |
| `id` | text | yes | UUID または deterministic id |
| `snapshot_key` | text | yes | 重複防止キー |
| `as_of` | text | yes | `YYYY-MM-DD` |
| `generated_at` | text | yes | ISO datetime |
| `saved_at` | text | yes | ISO datetime |
| `updated_at` | text | yes | ISO datetime |
| `revision` | integer | yes | 初期値 `1` |
| `lookback_days` | integer | yes | 分析に使った日足期間 |
| `analyzer_version` | text | yes | 分析ロジック版 |
| `universe_hash` | text | yes | 対象銘柄・カテゴリのハッシュ |
| `symbols` | text | yes | JSON array |
| `summary_json` | text | yes | `MarketAnalysisResult.summary` |
| `result_json` | text | yes | `MarketAnalysisResult` 全体 |
| `source` | text | yes | `scheduled` / `manual` / `trading-run` |
| `notes_json` | text | yes | JSON array |

制約:

- `UNIQUE(snapshot_key)`
- index: `(as_of desc)`
- index: `(generated_at desc)`
- index: `(source, as_of desc)`

### `analysis_snapshot_symbols`

一覧や銘柄別履歴を軽く取得するため、主要値だけを展開して保存する。

| column | type | required | description |
| --- | --- | --- | --- |
| `snapshot_id` | text | yes | `analysis_snapshots.id` |
| `as_of` | text | yes | 親 snapshot の `as_of` |
| `symbol` | text | yes | ticker |
| `category` | text | no | category id |
| `segment` | text | yes | 表示カテゴリ名 |
| `rank` | integer | yes | 総合順位 |
| `relative_strength_rank` | integer | yes | 相対強度順位 |
| `action` | text | yes | `BUY` / `HOLD` / `SELL` |
| `rating` | text | yes | rating |
| `score` | real | yes | score |
| `score_change` | real | no | 前回比がある場合 |
| `close` | real | yes | 指標 snapshot の終値 |
| `day_change_pct` | real | yes | 日次変化率 |
| `market_regime` | text | no | 銘柄または全体の regime |

制約:

- `PRIMARY KEY(snapshot_id, symbol)`
- index: `(symbol, as_of desc)`
- index: `(action, as_of desc)`
- index: `(category, as_of desc)`

## 保存データの粒度

`result_json` には既存 UI が必要とする完全な `MarketAnalysisResult` を保存する。これにより、過去表示時に Alpaca API を再呼び出しせず、当時のチャート、理由、リスク、スコア内訳を再現できる。

一方で検索や一覧に使う値は `analysis_snapshot_symbols` に展開する。JSON 全文検索に依存しないため、将来 PostgreSQL に移しても設計を保ちやすい。

## API 仕様

### `POST /api/analysis/snapshots`

分析を実行し、結果を DB に保存する。

request:

```json
{
  "symbols": ["NVDA", "AMD"],
  "lookbackDays": 520,
  "source": "manual",
  "force": false
}
```

response:

```json
{
  "snapshot": {
    "id": "analysis_...",
    "asOf": "2026-05-01",
    "generatedAt": "2026-05-02T08:30:00.000+09:00",
    "savedAt": "2026-05-02T08:30:05.000+09:00",
    "revision": 1,
    "symbolCount": 123,
    "summary": {}
  },
  "created": true,
  "result": {}
}
```

重複時:

- `force=false`: `created=false` と既存 snapshot を返す
- `force=true`: 同じ `snapshot_key` を上書きし、`revision` を増やす

### `GET /api/analysis/snapshots`

保存済み snapshot の一覧を返す。

query:

- `limit`: 既定 `30`、最大 `365`
- `from`: `YYYY-MM-DD`
- `to`: `YYYY-MM-DD`
- `symbol`: 任意。指定時はその銘柄を含む snapshot に絞る
- `category`: 任意

response:

```json
{
  "snapshots": [
    {
      "id": "analysis_...",
      "asOf": "2026-05-01",
      "generatedAt": "...",
      "savedAt": "...",
      "revision": 1,
      "lookbackDays": 520,
      "symbolCount": 123,
      "summary": {
        "analyzedSymbols": 120,
        "averageScore": 62.4,
        "marketRegime": "neutral"
      }
    }
  ]
}
```

### `GET /api/analysis/snapshots/:id`

指定 snapshot の完全な `MarketAnalysisResult` を返す。

response:

```json
{
  "snapshot": {},
  "result": {}
}
```

### `GET /api/analysis/snapshots/at?datetime=...`

指定日時以前で最も近い snapshot を返す。

query:

- `datetime`: ISO datetime または `YYYY-MM-DD`
- `symbol`: 任意。指定時はその銘柄を含む snapshot を優先
- `toleranceDays`: 既定 `7`

判定:

- `datetime` が日付だけなら、その日付の `as_of <= date` で最も近い snapshot
- datetime なら `generated_at <= datetime` で最も近い snapshot
- `toleranceDays` を超えて古い snapshot しかない場合は 404

### `GET /api/analysis/symbols/:symbol/history`

銘柄別のスコア・Action 履歴を返す。

query:

- `from`
- `to`
- `limit`: 既定 `252`

response:

```json
{
  "symbol": "NVDA",
  "history": [
    {
      "snapshotId": "analysis_...",
      "asOf": "2026-05-01",
      "rank": 3,
      "action": "BUY",
      "rating": "BUY",
      "score": 76.2,
      "close": 112.3,
      "dayChangePct": 0.018
    }
  ]
}
```

## UI 仕様

### 銘柄シグナルタブ

- 現行の最新分析表示は維持する。
- 上部に「履歴」操作を追加する。
  - 日付/日時 picker
  - 最新へ戻る
  - 履歴に保存
- 履歴 snapshot を表示中は、ヘッダーに `履歴: YYYY-MM-DD asOf / savedAt ...` を表示する。
- 履歴表示中に「分析を更新」を押した場合は最新分析に戻す。

### 銘柄詳細

- 選択銘柄のスコア履歴ミニチャートを追加する。
- Action 変更点をマーカー表示する。
- 初期実装では履歴チャートは直近 90 snapshot に限定する。

### 自動売買タブ

- trading run に紐づく `analysisSnapshotId` を表示できるようにする。
- dry-run / paper 実行時に使った分析が保存済みならリンクする。
- 保存されていない場合は従来通り run 内の情報だけを表示する。

## スケジューラ設計

新規 script:

- `scripts/save-analysis-snapshot.mjs`

責務:

- lock 取得
- 米国市場営業日 guard
- `POST /api/analysis/snapshots` 呼び出し
- JSON で実行結果を標準出力
- 失敗時は非ゼロ終了

package script:

```json
{
  "scripts": {
    "save-analysis-snapshot": "node scripts/save-analysis-snapshot.mjs"
  }
}
```

cron 例:

```cron
30 7 * * 2-6 cd /path/to/investment-app && ANALYSIS_HISTORY_API_URL=http://localhost:3000/api/analysis/snapshots npm run save-analysis-snapshot >> logs/analysis-history.log 2>&1
```

日本時間固定 cron では夏時間に 1 時間ずれるため、厳密に米国東部 18:30 に合わせたい場合は systemd timer か外部 scheduler 側で timezone を `America/New_York` にする。

## 実装方針

### 1. 永続化層

追加ファイル:

- `lib/semiconductors/analysis-history/types.ts`
- `lib/semiconductors/analysis-history/schema.ts`
- `lib/semiconductors/analysis-history/repository.ts`
- `lib/semiconductors/analysis-history/snapshot.ts`

責務:

- DB 初期化
- migration 適用
- snapshot key / universe hash 生成
- `MarketAnalysisResult` から DB レコードへの変換
- upsert / list / findById / findAt / symbolHistory

### 2. 分析実行の共通化

現状 `/api/semiconductors` と `/api/trading/run` に、銘柄 coercion、lookback coercion、Alpaca fetch、`analyzeMarketUniverse()` が重複している。

追加候補:

- `lib/semiconductors/analysis-service.ts`

責務:

- symbols と lookbackDays の正規化
- `SMH` / `QQQ` を含む日足取得
- `MarketAnalysisResult` 生成

これにより、通常表示、履歴保存、自動売買が同じ分析実行コードを使える。

### 3. API 追加

追加 route:

- `app/api/analysis/snapshots/route.ts`
- `app/api/analysis/snapshots/[id]/route.ts`
- `app/api/analysis/snapshots/at/route.ts`
- `app/api/analysis/symbols/[symbol]/history/route.ts`

既存 route の変更:

- `/api/semiconductors`: まずは互換維持。必要なら `save` query/body を受け付けて `POST /api/analysis/snapshots` 相当を内部呼び出しする。
- `/api/trading/run`: 将来的に実行時分析を snapshot として保存し、`run.analysisSnapshotId` を持たせる。ただし初期実装では必須にしない。

### 4. UI 追加

`components/technical-dashboard.tsx` に状態を追加:

- `analysisSnapshots`
- `selectedSnapshotId`
- `isHistoricalAnalysis`
- `snapshotError`

追加 UI:

- 履歴一覧の取得
- 日時指定による snapshot 検索
- snapshot 詳細取得後、既存 `result` state に保存済み `MarketAnalysisResult` をセット
- 最新分析へ戻す

### 5. テスト

追加テスト:

- `tests/analysis-history.test.ts`
  - snapshot key が同一入力で安定する
  - upsert が重複を作らない
  - `force=false` で既存を保持する
  - `force=true` で revision が増える
  - `findAt` が指定日時以前の最も近い snapshot を返す
  - `symbolHistory` が日付降順で主要値を返す
- API route の軽量テスト
  - 不正 symbol を除外する
  - limit / date query を丸める
  - 404 条件を返す

既存テスト:

- `tests/semiconductor-analyzer.test.ts`
- `tests/trading-history.test.ts`
- `tests/auto-trading-runner.test.ts`

は変更後も通す。

## 移行計画

### Phase 1: DB と repository

- SQLite 依存を追加する。
- migration と repository を実装する。
- DB ファイルを `.gitignore` 対象にする。
- repository 単体テストを追加する。

完了条件:

- 空 DB から schema 作成できる
- snapshot を保存し、一覧・ID・日時・銘柄別で取得できる

### Phase 2: 分析保存 API

- `analysis-service.ts` を追加し、分析実行を共通化する。
- `POST /api/analysis/snapshots` を実装する。
- `GET /api/analysis/snapshots*` を実装する。

完了条件:

- API から最新分析を保存できる
- 同一 `asOf` の二重保存が抑止される
- 指定日時から過去 snapshot を取得できる

### Phase 3: scheduler

- `scripts/save-analysis-snapshot.mjs` を追加する。
- lock と市場営業日 guard を入れる。
- README または `docs/auto-trade-server-settings.md` に設定例を追記する。

完了条件:

- cron から 1 日 1 回保存できる
- 同時実行時に片方が skip される
- 失敗時に非ゼロ終了する

### Phase 4: UI 履歴参照

- 銘柄シグナルタブに履歴選択 UI を追加する。
- 履歴 snapshot を既存の分析画面に読み込めるようにする。
- 銘柄別スコア履歴を追加する。

完了条件:

- 日時指定で過去分析を表示できる
- 最新分析と履歴分析の区別が画面上で分かる
- Alpaca API なしで保存済み履歴を再表示できる

### Phase 5: trading run 連携

- `TradingRunRecord` に任意の `analysisSnapshotId` を追加する。
- dry-run / paper 実行時に保存済み snapshot を再利用、または実行時分析を保存する。
- run 履歴から分析 snapshot へリンクする。

完了条件:

- 注文計画がどの分析 snapshot に基づくか追跡できる
- 既存の `trading-runs.jsonl` 読み込み互換を壊さない

## リスクと判断事項

- SQLite は単一サーバー運用には簡潔だが、複数インスタンスや serverless には向かない。複数環境で運用するなら最初から PostgreSQL を選ぶ。
- `result_json` に chart データを含めるため、DB サイズは増える。1 日 1 回、100-150 銘柄、3 年保持なら現実的な範囲だが、保持期間と vacuum 方針は決める。
- `asOf` は米国市場日付、`generatedAt/savedAt` は ISO datetime。UI では timezone を明示する。
- 過去分析の「再計算」ではなく「当時保存した結果の再表示」を仕様とする。分析ロジック変更後に過去を再計算したい場合は別機能にする。

## 初期実装で採用する既定値

- DB: SQLite
- 保存頻度: 1 日 1 回
- 保存対象: 既定ユニバース全体
- lookbackDays: `520`
- retention: `1095` 日
- analyzerVersion: コード定数 `technical-v1`
- 重複: `snapshot_key` upsert、既定は上書きしない
- 日時検索: 指定日時以前の最新 snapshot
