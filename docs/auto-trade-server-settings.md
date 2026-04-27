# Linux サーバーでの自動売買スケジュール実行設定

この手順は、Linux サーバー上で Next.js アプリを起動し、cron から `yarn auto-trade` を定期実行するための設定例です。

API キーは `.env` に書かず、`export` または systemd / cron の環境変数として渡す前提です。

## 前提

- Node.js 20 以上
- yarn が利用可能
- Alpaca paper account の API key / secret
- アプリの配置先例: `/opt/investment-app`
- 実行ユーザー例: `invest`
- Next.js は `http://localhost:3000` で待ち受ける

## 1. アプリを配置する

```bash
sudo mkdir -p /opt/investment-app
sudo chown -R "$USER":"$USER" /opt/investment-app
cd /opt/investment-app

# 例: git clone 済みでない場合
# git clone <repository-url> .

yarn install
yarn build
mkdir -p data logs
```

## 2. 手動起動で動作確認する

API キーは起動する shell で `export` します。

```bash
export APCA_API_KEY_ID="your-api-key-id"
export APCA_API_SECRET_KEY="your-api-secret-key"
export ALPACA_DATA_FEED="iex"
export ALPACA_TRADING_BASE_URL="https://paper-api.alpaca.markets"

export AUTO_TRADING_MODE="dry-run"
export AUTO_TRADING_PAPER_ENABLED="false"
export AUTO_TRADING_KILL_SWITCH="false"
export AUTO_TRADING_API_URL="http://localhost:3000/api/trading/run"
export AUTO_TRADING_LOCK_PATH="/opt/investment-app/data/auto-trading.lock"
export AUTO_TRADING_RUN_LOG_PATH="/opt/investment-app/data/trading-runs.jsonl"
export AUTO_TRADING_LOG_PATH="/opt/investment-app/data/trading-orders.jsonl"

yarn start
```

別 terminal から確認します。

```bash
curl -X POST http://localhost:3000/api/trading/run \
  -H 'Content-Type: application/json' \
  -d '{"mode":"dry-run"}'
```

## 3. systemd で Next.js を常時起動する

`/etc/systemd/system/investment-app.service` を作成します。

```ini
[Unit]
Description=Investment App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=invest
WorkingDirectory=/opt/investment-app
ExecStart=/usr/bin/yarn start
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=APCA_API_KEY_ID=your-api-key-id
Environment=APCA_API_SECRET_KEY=your-api-secret-key
Environment=ALPACA_DATA_FEED=iex
Environment=ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
Environment=AUTO_TRADING_MODE=dry-run
Environment=AUTO_TRADING_PAPER_ENABLED=false
Environment=AUTO_TRADING_KILL_SWITCH=false
Environment=AUTO_TRADING_API_URL=http://localhost:3000/api/trading/run
Environment=AUTO_TRADING_LOCK_PATH=/opt/investment-app/data/auto-trading.lock
Environment=AUTO_TRADING_RUN_LOG_PATH=/opt/investment-app/data/trading-runs.jsonl
Environment=AUTO_TRADING_LOG_PATH=/opt/investment-app/data/trading-orders.jsonl

[Install]
WantedBy=multi-user.target
```

反映します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable investment-app
sudo systemctl start investment-app
sudo systemctl status investment-app
```

ログ確認:

```bash
journalctl -u investment-app -f
```

## 4. cron で dry-run を定期実行する

最初は必ず `dry-run` で運用します。

```bash
crontab -e
```

例:

```cron
# サーバー時刻に合わせて調整する。まずは dry-run のみ。
30 7 * * 2-6 cd /opt/investment-app && /usr/bin/env AUTO_TRADING_MODE=dry-run AUTO_TRADING_API_URL=http://localhost:3000/api/trading/run AUTO_TRADING_LOCK_PATH=/opt/investment-app/data/auto-trading.lock AUTO_TRADING_RUN_LOG_PATH=/opt/investment-app/data/trading-runs.jsonl yarn auto-trade >> /opt/investment-app/logs/auto-trading.log 2>&1
```

`yarn auto-trade` は次を行います。

- `POST /api/trading/run` を呼ぶ
- `AUTO_TRADING_MODE=off` なら何もしない
- `AUTO_TRADING_MODE=live` は拒否する
- 同時実行ロックを取得する
- 米国市場の土日と主要休場日をスキップする
- 実行結果を JSON で stdout に出す

## 5. paper 実行に切り替える

dry-run の履歴と blocked 理由を確認してから、paper 実行に切り替えます。

cron の環境変数を次のように変更します。

```cron
30 7 * * 2-6 cd /opt/investment-app && /usr/bin/env AUTO_TRADING_MODE=paper AUTO_TRADING_PAPER_ENABLED=true AUTO_TRADING_KILL_SWITCH=false AUTO_TRADING_API_URL=http://localhost:3000/api/trading/run AUTO_TRADING_LOCK_PATH=/opt/investment-app/data/auto-trading.lock AUTO_TRADING_RUN_LOG_PATH=/opt/investment-app/data/trading-runs.jsonl AUTO_TRADING_LOG_PATH=/opt/investment-app/data/trading-orders.jsonl yarn auto-trade >> /opt/investment-app/logs/auto-trading.log 2>&1
```

paper 実行では、`planned` の注文だけ Alpaca paper account に送信されます。`blocked` の注文は送信されません。

## 6. 手動で runner を確認する

```bash
cd /opt/investment-app

export AUTO_TRADING_MODE="dry-run"
export AUTO_TRADING_API_URL="http://localhost:3000/api/trading/run"
export AUTO_TRADING_LOCK_PATH="/opt/investment-app/data/auto-trading.lock"

yarn auto-trade
```

成功時の出力例:

```json
{"status":"completed","mode":"dry-run","runId":"dryrun_xxx","planned":0,"blocked":91,"submitted":0}
```

`AUTO_TRADING_MODE=off` の場合:

```json
{"status":"skipped","reason":"AUTO_TRADING_MODE is off."}
```

## 7. 履歴を確認する

UI の「自動売買」タブで履歴を確認できます。

API で確認する場合:

```bash
curl http://localhost:3000/api/trading/runs?limit=10
```

ファイルで確認する場合:

```bash
tail -n 20 /opt/investment-app/data/trading-runs.jsonl
tail -n 20 /opt/investment-app/data/trading-orders.jsonl
```

## 8. 停止方法

自動実行を止めるだけなら cron を削除するか、`AUTO_TRADING_MODE=off` にします。

緊急停止したい場合:

```bash
export AUTO_TRADING_KILL_SWITCH=true
```

systemd 側で止める場合:

```bash
sudo systemctl stop investment-app
```

## 9. 注意点

- `AUTO_TRADING_MODE=paper` だけでは発注されません。`AUTO_TRADING_PAPER_ENABLED=true` も必要です。
- `ALPACA_TRADING_BASE_URL` は paper では必ず `https://paper-api.alpaca.markets` にします。
- live trading は現時点では未対応です。
- cron の環境変数は systemd service の `Environment=` とは別です。cron から `yarn auto-trade` を実行する場合、cron 行の中でも必要な環境変数を渡してください。
- API キーを shell 履歴に残したくない場合は、systemd の `EnvironmentFile=` や OS の secret 管理を使ってください。
- 市場休場判定は主要な米国市場休日を対象にした簡易ガードです。特殊休場や短縮取引日は別途確認してください。
