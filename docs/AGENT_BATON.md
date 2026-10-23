# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-23（台灣）｜更新者：Claude Code（首頁星圖手牌定案 ADR 0051）

## 角色
- 規劃／驗收：Claude Code
- 執行：Antigravity

## 目前任務
手機版瀏覽體驗 4 大改良步驟（1. 頂欄單行雙連動選擇器＋膠囊搜尋、2. 首頁 2×5 十宮格遊戲×語系快速入口與新發售角標、3. 首頁分段式探索流＋最新系列單卡預覽＋手機 4 欄高密度卡牆與漲幅橫滑列、4. 我的收藏 4 格數據列＋深黑金框 TCG 收藏冊橫幅與快捷工具格）全數實作、通過 521 項單元測試並分步提交推送。

## 任務清單
- [x] 1. 首頁兔子插畫的樣式與首頁視覺改版（`index.html`、`look-clean.css`：吉祥物卡套框與 4px/6s 緩慢漂浮、昭源圓黑體 `Chiron GoRound TC`、新標題與導覽文案、頂欄與手機底欄對齊、方案 4＋5 變化 V5 活頁打孔與雙色書脊）
- [x] 2. 新增 ADR 0048（`docs/adr/0048-hero-mascot-and-ambient-float.md`，延伸 ADR 0047），並於 `docs/PRODUCT_PLAN.md` 第 5 節註明。
- [x] 3. 參考式版面與功能整合（`look-clean.css`、`series-band.js`：頂欄膠囊搜尋＋深色圓形放大鏡鈕、桌面選項 1／手機選項 2 首屏切換、系列分頁列＋左 1 黑框黑兔「最新系列 NEW」方格、單卡下方「左卡號、右稀有度」雙欄對齊與價格排版）。
- [x] 4. 手機版瀏覽體驗 4 步改良（`ui-enhancements.js`、`game-switcher.js`、`series-band.js`、`look-clean.css`：單行頂欄雙連動選擇器、2×5 十宮格快速入口、最新系列單卡預覽與手機 4 欄高密度卡格、我的收藏 4 格數據列與 TCG 收藏冊橫幅）。

## 已完成（本輪 Antigravity + Claude Code）
- 手機版瀏覽體驗 4 步改良（分四步 commit & push）：
  1. `e4b69cf`：手機單行緊湊頂欄（左側 `[遊戲圓標＋遊戲選擇器 | 語系版本選擇器]`＋右側膠囊搜尋框與圓形放大鏡鈕）。
  2. `029a5b3`：手機首頁 2×5 十宮格遊戲×語系快速入口（圓角方塊＋`新發售`／`即將發售`／`收錄中`／`收藏冊` 狀態角標）。
  3. `256cd24`：首頁最新系列下方自動載入 8 張單卡預覽、手機漲幅榜橫向卡片列與紅底漲幅膠囊、手機單卡格改為 4 欄高密度卡牆。
  4. 第 4 步：`我的收藏` 頂部新增 4 格數據列（收藏款數／收藏總張數／最近瀏覽系列／已估值款數）、深黑金框「TCG 收藏冊 · 已擁有 X 張卡 ›」橫幅與 2×2 快捷操作格。
- 參考式版面與功能整合（分三步 commit & push）：
  1. `fb40c94`：頂欄膠囊搜尋框（深色圓形放大鏡鈕）與手機首頁選項 2（隱藏大型歡迎卡、首屏直接進入搜尋與遊戲／系列面板）。
  2. `650a45d`：`series-band.js` 與 `look-clean.css` 新增首頁最新系列快速分類分頁列，並於系列滑動列左 1 固定加入黑框金內線「最新系列 NEW」黑兔方格（`rabbit-success-160.webp`）。
  3. `3c02cc5`：單卡格下方改為「第 1 行卡名、第 2 行左卡號＋右稀有度雙欄對齊、第 3 行粗體價格與版本小標」結構；`npm test` 521 項全數通過。
- 首頁第一屏吉祥物與視覺改版（ADR 0048）：`index.html`＋`look-clean.css` 完成桌面兩欄置中卡套框（240px、63/88）、手機標題上方 96px 小圖、4px／6s 緩慢漂浮（支援 `prefers-reduced-motion` 與 `data-cs-paused` 暫停）、昭源圓黑體標題、導覽列對齊與 V5 活頁打孔雙色書脊卡冊樣式；`npm test` 521 項全數通過。
- UI 收尾已部署（`d12aea8`）：手機詳細頁緊湊排列與 320px 修正、分享改用系統分享＋網址欄備援（`navigation-state.js` 的 `copyCurrentUrl`）、原始頁面 44px、系列分頁籤附數量、手機稀有度膠囊列、補台灣官方來源名稱。
- 視覺改版 ADR 0047（乾淨卡冊＋適度動態）、記憶體警戒日誌（Render OOM 後，日誌搜尋 `memory high`）均已上線。

## 驗收（Claude Code，2026-10-22）
- main＝`26796ed`，`npm test` 521/521。正式站已帶最新 `ui-enhancements.js`（含 `rarityBentoBox`）。
- 桌面首頁：主視覺、搜尋、遊戲列正常，無 console 錯誤。手機 375px：單行頂欄、2×5 快速入口（圖示與角標）、最新系列 NEW 兔子格、單卡預覽皆正常，無水平溢出。
- agy 在接力棒 14:08 更新後另推 4 個提交（已上線）：`50c32c9` 手機頂欄選擇器寬度與預覽缺圖、`b461641` 首頁同系列不同語言版本相鄰、`b4f2c28` 稀有度點開格狀清單＋熱門／最新 IP 預覽切換、`26796ed` 稀有度三欄方格＋底部拇指快選盤。
- 修正 `9b70f7a`：手機「暫停動態」浮鈕會蓋住卡牆左下角 → 手機改放頁尾（`look-motion.css`）。
- 修正：系列頁捲過稀有度方格後，底部快選盤自動以展開狀態出現（約 153px，蓋住約兩成卡牆）→ 改為預設收成右下膠囊（約 47px），點了才展開；方格上的「✦ 底部拇指盤」仍直接展開（`ui-enhancements.js` 的 `hudCollapsed`）。
- 修正：系列列左 1「最新系列 NEW」兔子格原本開 `dated[0]`，遊戲王（Magnificent Maestros）、排球少年會開到即將發售的系列 → 改開最新已發售系列（`series-band.js`）。
- 修正：手機首頁 2×5 快速入口的角標原為寫死文字（排球少年 10-24 後仍會顯示「即將發售」、寶可夢台版 90 天內沒有新系列卻標「新發售」）→ 改依目錄發售日計算（`window.syncMobileQuickGrid`，首頁重繪時由 `index.html` 呼叫）；「航海王日文」實際沒有日版資料、會退回台版 → 改為「航海王英文」（ASIA）。
- 修正：詳細頁預覽只用第一個候選圖片，失敗就顯示「圖片待補」，放大檢視卻會改用下一個候選（例：台版 M4-003 預覽空白、放大出現日版圖）。`resilientImage` 新增 `fallbacks`，詳細頁與卡片格都依序改用其他版本的圖。起因：2026-10-22 台灣官方站 `asia.pokemon-card.com` 整站顯示維護中，`/tw/card-img/*.png` 全部 302 回首頁。
- 補強：migration `20261022120000_browse_series_sibling_images`（已在正式庫回滾測試後套用、登記 schema_migrations，函式 md5 `48c66419…`）讓 `browse_series_cards` 多回傳 `siblingImages`（同作品層其他卡的 card_images）；伺服器依圖片權利篩過後掛成每張卡的 `fallbackImageUrls`（最多 3 個），卡牆依序備援。台版 M4 120/120、日版 M4 120/120 都有對方版本的圖；資料庫兩次呼叫共 183 ms。

## CI 修復（2026-10-22 晚，Claude Code）
- `ec181e6`、`ba397c4` 的 Beta reliability 失敗：`scripts/beta-browser-smoke.mjs` 還照舊首頁寫。改為手機找 2×5 快速入口格（`.mqg-tile`）與頂欄 `#q`／`#go`、桌面找 `#channels`／`#heroQ`；返回首頁改看 `body[data-view=landing]`；分享測試固定走剪貼簿（停用 `navigator.share`，本機 Edge 有系統分享）。
- 測試抓到的真問題（已修，`look-clean.css`）：手機詳細頁「×」關閉鈕被卡圖區塊蓋住點不到 → `#close{z-index:10}`；頂欄搜尋鈕 38px、稀有度直選「拇指盤」鈕 28px → 都改 44px。
- 本機跑法：無 Supabase 環境啟動 `PORT=4202 node server.mjs`，再 `CI=true CARDSCOPE_URL=http://127.0.0.1:4202 PLAYWRIGHT_CHANNEL=msedge node scripts/beta-browser-smoke.mjs`，全部通過；Node 522/522。

## 航海王「台版」更名（2026-10-23）
- 航海王台灣官方站（asia-tc）的卡圖全是日文印刷（亞洲發行的日文版），台灣沒有繁中印刷的航海王卡。資料庫仍存 `region=TW`、`language=zh-Hant-TW`（未改資料），介面一律顯示「亞洲日文版」：`index.html` 的 `rn(region,game)`、`series-band.js` 的 `regionText`、`server.mjs` 的 `regionLabel(...,game)`；手機快速入口「航海王繁中」改「航海王日文」。之後若要改資料層的 language，需另寫 migration。
- 深色展示櫃上的單卡推送：卡名、IP、卡號改成米白／淡紫（`look-clean.css`）。

## 首頁「星圖手牌」定案（2026-10-23，ADR 0051）
- 使用者選 5 版預覽的第 1 版並要求重新構圖：兔子卡居中、4 張自動挑選的最高稀有度卡排成手牌扇形、首次聚光燈導覽、頂欄膠囊按鈕＋桌面也有底部玻璃 dock。檔案 `look-showcase.css`／`look-showcase.js`；`previews/` 與預覽載入器已刪除。
- 使用者確認卡片要「自動挑最新稀有的」，不要固定清單。航海王、芙莉蓮因官方圖有 SAMPLE 浮水印不選。
- 同輪修正：首頁系列磚 M6a／MF／OP-17 只顯示代碼 → 商品盒圖比目錄晚到時重畫系列列（`index.html`），官方圖單次失敗重試一次（`series-band.js`）。
- 冒煙測試：以回訪者身分跑（預寫 `cs-tour-done`），手牌區的 `/api/cards?sort=rarity-desc` 請求不計入故障模擬；新增首次導覽檢查。

## 無障礙驗收（2026-10-23，Claude Code）
- 以 Playwright 在桌面 1440、手機 390、200% 縮放（640×400）與 320px 重排下，掃首頁／遊戲頁／我的收藏／詳細頁：Tab 走訪、焦點可見與對比、只能用滑鼠點的元素、橫向溢出、關閉鈕可點、減少動態下仍在跑的動畫。
- 修正（`look-clean.css`）：桌面首頁深色展示櫃上的焦點框是深灰（約 1.5:1，幾乎看不見）→ 改米白；選中的遊戲格本來就有金框，焦點落在上面分不出來 → 改向內米白粗框；首頁大搜尋鈕（金底）焦點框改深色；手機稀有度快選盤（深底）焦點框改米白。
- 沒問題的：無鍵盤陷阱（收藏對話框正確鎖焦點）、無只能滑鼠點的元素、減少動態下無動畫在跑、200%／320px 無橫向溢出、詳細頁關閉鈕可點。
- `scripts/beta-browser-smoke.mjs` 新增：首頁 45 個 Tab 停點的焦點框對比 ≥3:1、減少動態下 `document.getAnimations()` 無執行中動畫、200% 縮放的遊戲頁不溢出與詳細頁關閉鈕可點。已確認拿掉 CSS 修正時新檢查會失敗。

## 首頁桌面改版（2026-10-22）
- 依 impeccable 與 ui-ux-pro-max 做 5 版預覽，使用者選第 3 版「夜間展示櫃」→ ADR 0050，樣式併入 `look-clean.css` 末段（≥761px），預覽開關與 `home-preview.css` 已移除；手機首屏不變。

## 下一步（唯一，具體到檔案與指令）
- 10-24 後確認排球少年 HV-P04／HV-D04 卡圖自動補上（`/api/search?q=HV-P04&limit=200`）。10-23 查：卡已在（HV-P04 100 張、HV-D04 13 張，搜尋上限可能截斷），但 0 張有圖；CI `000f8ad` Beta reliability 已綠。

## 卡住的地方／需要規劃方決策
- 無。

## 未提交的變更與暫存檔位置
- `index.html`：hero 插畫標記（見任務 1）。
- 本接力棒相關的協作設定檔（`CLAUDE.md`、`AGENTS.md`、`.gitignore`、`scripts/baton-snapshot.mjs`）已由 Claude Code 一併提交。

## 開始前必須重新核對
- `git status`、目前分支（`claude/binder-theme-preview`）、`npm test` 基準線 521。
- 之後要等的事：10-24 後確認排球少年 HV-P04／HV-D04 自動同步；約 10-27 皇巢／晴れる屋2 價格詢問若仍未回覆要問使用者；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
