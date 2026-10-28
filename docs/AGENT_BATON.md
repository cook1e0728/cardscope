# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-28（台灣）｜更新者：Claude Code（筆電 → 轉交桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- `main`＝`claude/binder-theme-preview`＝`ff69ba2`，工作目錄乾淨，`npm test` 574/574。
- 剛完成：五面向盤點（資安、完善度、效率、BUG、體驗），總表 `docs/AUDIT_20261028.md`、詳細報告 `docs/audit-20261028/`。只盤點，尚未修任何項目。

## 2026-10-28 桌電補記
- 已提交 10-24 中斷的「寶可夢卡牆參考價＋價格排序＋跨版本價格對照」（migration `20261024090000` 先前已套用並登記；`npm test` 591）。部署後要在正式站抽查寶可夢系列卡牆的「Cardmarket 參考」小標、價格排序與詳細頁對照表。價格快照自 10-24 因 440 MB 煞車停跑，7 天窗口過後（約 10-30）小標會全部消失，需先處理盤點 #2。

## 下一步（唯一）
等使用者選要先修哪一批（總表「建議先做」#1–#17）。建議分法：
- 不需同意、可直接派 worker 修：#3 刪第三方代理路由、#4 刪 `POST /api/reports`、#5 卡牆載入中篩選卡死（`index.html` `loadCardsPage`）、#6 系列深連結與 sitemap 補 `region`、#7 覆蓋率逾時不當 0、#8 字型子集化與「全部遊戲」圖、#9 展示區預載與 coverage 瘦身、#10 CLS、#11 安全標頭全回應＋CSP Report-Only、#12 offset 上限與 rarity 白名單、#13 詳細頁三個導覽 bug。寫入檔案多數重疊在 `server.mjs`／`index.html`／`ui-enhancements.js`，分封包時注意不要兩個 worker 改同一檔。
- 需使用者同意：#1 對寶可夢執行 `browse_refresh_keys('pokemon')`（正式庫寫入）、#2 清舊世代＋`VACUUM FULL`、#3 在 Render 移除 JustTCG／eBay 金鑰、#15 首頁副標文案、Render 區域。

## 卡住的地方／需要規劃方決策
- 上列「需使用者同意」各項。
- 資料庫 455 MB 逼近免費 500 MB，價格快照自 10-24 起因 440 MB 煞車每天跳過（#2 解決前會持續）。

## 本機檔案（不在 git，換電腦不會帶過去）
- `.env.local`：`SUPABASE_ACCESS_TOKEN`（`scripts/run-sql.mjs` 用），每台電腦各自建立。
- `docs/design-previews/`：10-22 首頁 5 版預覽截圖（已加入 `.git/info/exclude`），可不用。
- 這台的 Claude Code 工作階段在 `cardscope` 上一層開啟時，讀不到 `cardscope/.claude/agents/sonnet-worker.md`；改用通用 agent＋`model: sonnet`、`effort: high`，並把 sonnet-worker 規則貼進封包。

## 開始前必須重新核對
- `git pull` 後 `git log -1` 應為本檔提交或更新；`npm test` 基準 574。
- 之後要等的事：排球少年 HV-P04／HV-D04 卡圖（10-23 時 0 張有圖）；皇巢／晴れる屋2 價格詢問（約 10-27 若未回覆要問使用者）；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
