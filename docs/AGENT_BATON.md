# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-30（台灣）｜更新者：Claude Code（桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- 2026-10-29：10-28 盤點除需使用者同意的項目外全部修完並上線（main `9181691`），處理狀態見 `docs/AUDIT_20261028.md`。`npm test` 621/621，煙霧測試通過，正式站驗收 36 項通過。
- 資料清理：空系列與 8-31 示範卡（migration `20261029090000`）、遊戲王 88 筆殘留 unspecified 與 596 張無 TCG 系列的卡（`20261029100000`），備份在 `docs/evidence/cleanup-20261029/`；遊戲王 14,117 張、系列 1,396 個。
- 資料庫約 384 MB；`browse-keys-publish` 每小時 :25；價格快照每日恢復（10-28 寫入 13,562 筆）。

- 2026-10-30：CSP 改為強制（仍允許 inline，擋外部腳本與未列出的圖片主機；轉強制前正式站各遊戲／地區頁與詳細頁實測 0 違規）。首頁副標改為「寶可夢同一張卡的日版與台版並列對照」（#15）。Render 區域照建議維持現狀（搬遷要重建服務，目前延遲可接受）。

## 下次要確認
- CSP 已強制：新增卡圖來源主機時要加進 `server.mjs` 的 `CSP` img-src，否則圖片會被擋。之後若要拿掉 'unsafe-inline'，需把 index.html 的 inline 事件改事件委派並加 nonce。
- 參考價只收 8 天內快照，每日價格排程若停跑超過一天會掉；桌機卡格最小字級 11px。
- admin 端點仍回 e.message（需管理密鑰，保留診斷）；`yuyuteiMarket` 的 esc 反斜線跳脫未修（低）。
- 首頁 <title>／description 在 `providers/seo.mjs` 的 homeSeo 有一份，改 index.html 文案要同步；Chiron Hei HK 用 text= 子集化，改首頁大標或導覽小卡標題要同步 text=。

## 卡住的地方／需要規劃方決策
- 需使用者親自操作：#3 在 Render 後台刪除 `JUSTTCG_API_KEY`、`EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`（Render MCP 只能合併或整批取代環境變數，無法單獨刪除）。
- 需使用者明確同意：Q7 七龍珠超 Fusion World（等同接受新的授權風險，ADR 0052）。

## 本機檔案（不在 git，換電腦不會帶過去）
- `.env.local`：`SUPABASE_ACCESS_TOKEN`（`scripts/run-sql.mjs` 用），每台電腦各自建立。
- `docs/design-previews/`：10-22 首頁 5 版預覽截圖（已加入 `.git/info/exclude`），可不用。
- 這台的 Claude Code 工作階段在 `cardscope` 上一層開啟時，讀不到 `cardscope/.claude/agents/sonnet-worker.md`；改用通用 agent＋`model: sonnet`、`effort: high`，並把 sonnet-worker 規則貼進封包。

## 開始前必須重新核對
- `git pull` 後 `git log -1` 應為本檔提交或更新；`npm test` 基準 621。
- 之後要等的事：排球少年 HV-P04／HV-D04 卡圖（10-23 時 0 張有圖）；皇巢／晴れる屋2 價格詢問（約 10-27 若未回覆要問使用者）；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
