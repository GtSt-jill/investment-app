# 売買意図の精緻化メモ

この文書は、分析結果の `BUY` / `HOLD` / `SELL` を自動売買の実行意図へ変換するときの意味づけを整理します。

## 背景

`SignalAction` は分析画面向けの分類です。特に `SELL` は文脈依存で、未保有銘柄では「新規買い回避」、保有中銘柄では「削減または撤退候補」を意味します。そのため、`SignalAction` をそのまま注文命令として扱わず、`trading/intent.ts` で保有状況・スコア・リスク設定を加味して `TradeIntentCandidate` に変換します。

## 現行の意図分類

| 状況 | 実行意図 | 補足 |
| --- | --- | --- |
| 未保有 `BUY` | `OPEN_LONG` | リスク条件を満たさない場合は blocked |
| 保有中 `BUY` | `ADD_LONG` | 含み益、配分上限、買い増し条件を確認 |
| 未保有 `HOLD` / `SELL` | `NO_ACTION` | `SELL` は新規買い回避であり、空売りではない |
| 保有中の弱い `SELL` | `REDUCE_LONG` | `sellScoreThreshold` 未満で部分削減 |
| 保有中の重い `SELL` | `CLOSE_LONG` | `severeSellExitScoreThreshold` 以下で全撤退 |
| 損切り到達 | `CLOSE_LONG` | stop loss 到達を最優先 |
| 防衛的地合い + スコア不足 | `REDUCE_LONG` | 市場環境によるリスク削減 |
| 配分上限超過 | `REDUCE_LONG` | ポートフォリオ制約による削減 |

## 追加メタデータ

`TradeIntentCandidate` には、注文判断の説明性を上げるために次のメタデータを追加しています。

```ts
stance: "bullish" | "neutral" | "bearish";
actionReason:
  | "BUY_SIGNAL"
  | "HOLD_SIGNAL"
  | "SELL_AVOID_NEW_BUY"
  | "STOP_LOSS_EXIT"
  | "SEVERE_SELL_EXIT"
  | "WEAK_SELL_REDUCE"
  | "DEFENSIVE_REGIME_REDUCE"
  | "OVER_ALLOCATION_REDUCE";
exitReason:
  | "STOP_LOSS"
  | "SEVERE_SELL_SIGNAL"
  | "WEAK_SELL_SIGNAL"
  | "DEFENSIVE_REGIME"
  | "OVER_ALLOCATION"
  | null;
scoreGate: "passed" | "blocked" | "not_applicable";
entryScoreThreshold: number | null;
severeSellExitScoreThreshold: number | null;
```

これにより、同じ `SELL` でも「新規買い回避」「部分削減」「全撤退」を区別できます。

## 閾値

主な設定値は `lib/semiconductors/trading/config.ts` にあります。

| 設定 | 既定値 | 用途 |
| --- | ---: | --- |
| `minEntryScore` | 70 | 新規買いの最低スコア |
| `addMinScore` | 72 | 追加買いの最低スコア |
| `sellScoreThreshold` | 45 | 保有銘柄の削減候補 |
| `severeSellExitScoreThreshold` | 15 | 保有銘柄の全撤退候補 |

`severeSellExitScoreThreshold` に `null` を設定すると、重い `SELL` による全撤退を無効化し、従来通り部分削減中心の挙動にできます。損切り到達による `CLOSE_LONG` は引き続き有効です。

## BUY / HOLD の境界

分析側の `BUY` / `HOLD` と、実行側のエントリースコア条件は別です。例えば `action === "BUY"` でも `score < minEntryScore` なら `OPEN_LONG` 候補は blocked になります。一方、`HOLD` はスコアが高くても `NO_ACTION` です。

この設計により、分析画面の分類と実際の注文条件を分離しています。将来的にヒステリシスを入れる場合は、前回 Action や保有状態を使って「新規 BUY 閾値」と「BUY 継続閾値」を分けるのが自然です。

## テスト

関連テストは `tests/trading-intent-refinement.test.ts` です。次を確認しています。

- 未保有 `SELL` が売り注文にならないこと
- 弱い保有 `SELL` が `REDUCE_LONG` になること
- 損切り到達が `CLOSE_LONG` になること
- `severeSellExitScoreThreshold` 以下の重い `SELL` が `CLOSE_LONG` になること
- `severeSellExitScoreThreshold: null` で重い `SELL` の全撤退を無効化できること
- BUY スコア条件の通過/ブロックが `scoreGate` で追跡できること
