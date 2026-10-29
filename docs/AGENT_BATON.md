# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-28 晚（台灣）｜更新者：Claude Code（桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- 2026-10-28 晚：盤點 #1–#14、#16、#17 已修並上線（處理狀態見 `docs/AUDIT_20261028.md`），`npm test` 607/607，煙霧測試通過。
- 資料庫 384 MB；排程 `browse-keys-publish` 每小時 :25 成功；價格快照 10-28 19:34 起恢復執行。

## 下次要確認
- 正式站：寶可夢卡牆「Cardmarket 參考」小標、價格排序、詳細頁對照表；手機首頁 CLS（漲幅區本機無資料無法量）；瀏覽器主控台的 CSP Report-Only 違規。
- 10-29 已處理「系列 0 張」與遊戲王 unspecified（正式站已確認系列 1401→1396、sitemap 無空系列）：空系列與示範卡（migration `20261029090000`）；遊戲王 88 筆殘留 unspecified 版本、596 張無 TCG 系列的卡（OCG 限定、遊戲用卡、衍生物、未發售）移除，遊戲王卡 14,713→14,117，資料庫已無無系列的印刷版本（`20261029100000`）。兩個 migration 已套用並登記，備份在 `docs/evidence/cleanup-20261029/`。同步改為只收有 TCG 印刷的卡、系列名不分大小寫比對、只建立有卡用到的系列。下一次排序鍵重建（每小時 :07 建、:25 發布）後遊戲王圖鑑才會反映。
- 盤點剩餘：#16 系列／稀有度網址載入後捲到卡牆；13 處端點回傳 `e.message`；`today()` 用 UTC；`/api/jp-prices`、`/api/portfolio` 是否刪除；CSP 轉強制。

## 卡住的地方／需要規劃方決策
- 需使用者同意：#3 在 Render 移除 `JUSTTCG_API_KEY`、`EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`；#15 首頁副標文案；Render 區域；Q7 七龍珠超 Fusion World。

## 本機檔案（不在 git，換電腦不會帶過去）
- `.env.local`：`SUPABASE_ACCESS_TOKEN`（`scripts/run-sql.mjs` 用），每台電腦各自建立。
- `docs/design-previews/`：10-22 首頁 5 版預覽截圖（已加入 `.git/info/exclude`），可不用。
- 這台的 Claude Code 工作階段在 `cardscope` 上一層開啟時，讀不到 `cardscope/.claude/agents/sonnet-worker.md`；改用通用 agent＋`model: sonnet`、`effort: high`，並把 sonnet-worker 規則貼進封包。

## 開始前必須重新核對
- `git pull` 後 `git log -1` 應為本檔提交或更新；`npm test` 基準 607。
- 之後要等的事：排球少年 HV-P04／HV-D04 卡圖（10-23 時 0 張有圖）；皇巢／晴れる屋2 價格詢問（約 10-27 若未回覆要問使用者）；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
