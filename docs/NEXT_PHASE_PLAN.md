# CardScope 下一階段計畫：版面升級＋eBay／SNKRDUNK 價格＋資安與合規

> 起草：Fable（2026-11-16）。拍板後由 Opus 帶 sonnet-worker 施作。
> 一律在 `main` 的最新狀態上開新分支做（本機目前停在舊分支 `claude/weiss-en`，落後 main 77 個提交，**不要在上面動工**）。

## 1. 背景

使用者定下的方向：電腦版太空曠，要更精緻也更好用；價格要加日本 SNKRDUNK 與歐美 eBay；資安與避免侵權要一起顧到。

這次實查到、會限制做法的事實：

- **SNKRDUNK**：條款第 7 條明文禁止爬蟲與擷取，沒有公開 API，也查不到對外的資料合作方案（`docs/research/price-sources/jp.md`）。**沒有「能抓又不違規」的方法，唯一合規的路是取得對方書面同意。**
- **eBay 掛牌價**：官方 Browse API 可用。eBay 夥伴計畫的問卷寫 Browse 不需要額外核准，但官方 Buy API 需求頁仍寫正式環境限夥伴，兩邊說法不一致，要先實測。
- **eBay 成交價**：官方 Marketplace Insights 不開放申請。站上現有的「鑑定卡成交價」（`providers/graded-prices.mjs`，第三方 PokemonPriceTracker 彙整 eBay／Fanatics，只有寶可夢，每天約 40 次查詢）是目前唯一來源。
- **不能放聯盟連結**：`docs/PRODUCT_PLAN.md` 固定原則——還在用限非商業的免費價格來源（TCG API、鑑定卡價格）時，全站不放廣告與聯盟連結。所以 eBay 不走夥伴計畫的分潤連結，只放一般連結。
- **版面**：正式站 1920 寬實測，首頁 `.wrap` 上限 1280px（`look-clean.css:22`），兩側大片留白；首頁「最熱」只有 1 張卡，後面整排空白；行情頁是橫向捲動列，下方空著。遊戲頁（`--shell-max:1440px`，`look-v2.css:193`）相對正常。
- **資料庫**：主庫 428 MB（紅線 450）。新價格來源**不得寫入主庫**。

## 2. 決定

已定：
- eBay 掛牌價與成交價都要，分開標示。
- 版面重點是電腦版的空間利用，不是整站換風格（沿用 ADR 0056 卡冊紙感）。

建議（批准本計畫即視為採用，要改請在批准時說）：
1. **SNKRDUNK：先寄授權信，回覆前只放外連按鈕，不抓資料。** 30 天沒回音或被拒就維持外連。
2. **預算：只買網域**（`cardscope.cc` 在 Cloudflare 每年約 NT$265），價格資料維持免費方案。網域能換來邊緣快取、防護規則、搬新加坡不換網址、對外申請授權時較像正式服務，是這筆錢效益最高的用法。付費買成交價資料等有流量再評估。
3. **暫不營利**。要營利得先換掉限非商業的來源，另開計畫。

## 3. 工作包

`server.mjs` 同一時間只給一個 worker；`index.html`／`ui-enhancements.js` 也一樣。

### P. 價格

| 包 | 內容 | 主要檔案 | 完成的樣子 |
|---|---|---|---|
| P0 | **使用者動作**：註冊 eBay 開發者帳號、建正式環境金鑰、處理「帳號刪除通知」要求（不存 eBay 使用者資料可申請豁免）；把金鑰設到 Render 環境變數 `EBAY_CLIENT_ID`／`EBAY_CLIENT_SECRET`。Opus 給逐步清單 | — | 用正式金鑰查一次 Browse 搜尋回 200。**回 403 就停，P1 改成只放 eBay 外連，回報使用者** |
| P1 | eBay 掛牌價：新 `providers/ebay-listings.mjs`，照 `graded-prices.mjs` 的形狀（開卡時才查、不寫資料庫、每日上限、輸入白名單驗證）。只取固定價、卡牌單卡分類；用英文名＋系列代號＋卡號查，**標題必須含卡號才算對到**，對不到就不顯示。快取用 `createBoundedSnapshotCache`，時間取短（1 小時，eBay 對資料新鮮度的條款未能確認）。端點 `/api/ebay-listings` 受既有限流 | `providers/ebay-listings.mjs`、`server.mjs`、`data/source-registry.json`、`test/ebay-listings.test.mjs` | 測試涵蓋：查詢組裝、配錯卡不顯示、每日上限、金鑰缺少時回空而不是錯誤 |
| P2 | eBay 掛牌顯示：依 eBay 顯示規定列出前 3–5 筆，**照 eBay 回傳的順序，不自己依價格重排**（顯示規定不准改排序）；每筆有商品圖、完整標題、價格與運費分開、狀態、賣家、連到商品頁，區塊有 eBay 標誌（圖檔放本站）與使用者協議連結，標「現售掛牌價，不是成交價」。已結束的刊登不顯示。eBay 區塊自成一區，不和其他來源的數字混在同一列。CSP `img-src` 加 eBay 圖片主機 | `price-timeline.js`、`server.mjs`（CSP）、`look-v2.css` | 詳細側板看得到；CSP 0 違規 |
| P3 | 成交價區整理：現有區塊標題改「eBay 鑑定卡成交價（第三方彙整，未驗證）」——它只有 PSA／BGS 等鑑定卡，**沒有裸卡成交價**，標題不能省略「鑑定卡」；和掛牌價上下相鄰；沒有資料的卡（台版、其他遊戲）明寫「目前沒有成交資料來源」而不是留白 | `price-timeline.js` | 有資料的寶可夢卡兩區都有；其他有說明句 |
| P4 | SNKRDUNK：(a) Fable 起草日文授權信（用途、頻率、只取價格事實、標示來源與連結、非營利），使用者寄出，寄出日與回覆記進 `docs/research/price-sources/inquiries-*.md`；(b) 詳細側板加「到 SNKRDUNK 查看」外連（先人工確認搜尋網址格式，只組網址、伺服器不發任何請求到 snkrdunk.com）；(c) 登記為 link-only、permission-pending，`server.mjs` 裡 SNKRDUNK 的狀態說明文字同步改掉 | `price-timeline.js`、`data/source-registry.json`、`docs/research/price-sources/` | 按鈕開新分頁到正確搜尋結果；程式裡沒有對 snkrdunk.com 的 fetch（加一個測試擋） |
| P5 | 「各平台價格」總覽：Cardmarket／TCGplayer 參考價排成一張表（價格性質、更新時間）；下方依序是 eBay 掛牌區、eBay 鑑定卡成交區、SNKRDUNK 外連。總覽只放「有／沒有、跳到該區」，不把 eBay 數字抄進表裡 | `price-timeline.js`、`look-v2.css` | 取代散在各處的比價區塊 |
| P6 | ADR 0058：eBay 掛牌（官方 API）、成交（第三方）、SNKRDUNK（等授權）的來源決定與顯示規則。`data/source-registry.json` 補登 PokemonPriceTracker（agy 指出目前沒登記，Opus 先確認），eBay 的兩個圖片政策欄位對齊成可顯示刊登縮圖 | `docs/adr/0058-*.md`、`docs/PAGE_COPY_PRIVACY_SOURCES.md`、`data/source-registry.json` | 文件與 registry 一致 |

SNKRDUNK 若同意授權，另開一包做 provider，不在本計畫範圍。

### L. 電腦版版面（先預覽、使用者選了才實作）

| 包 | 內容 | 主要檔案 |
|---|---|---|
| L0 | Fable 出 2 版 1920／1440 寬預覽稿（靜態 HTML，放 `docs/design-previews/`，不上線），使用者選一版 | — |
| L1 | 首頁：寬螢幕改多欄，把「本彈大獎」「漲跌榜」「時事」並排進首屏下方；「最新／最夯／最熱」任一榜不足 6 張時補滿或不顯示該分頁；`.wrap` 上限放寬到和遊戲頁一致 | `index.html`、`look-clean.css`、`look-showcase.css`、`pack-prizes` 前端 |
| L2 | 行情頁：橫向捲動列改成網格，≥1200px 漲跌左右並排，時事放右欄 | `price-movers.js`、`market-events.js`、`look-v2.css` |
| L3 | 卡牆：≥1600px 時 shell 上限放寬、欄數跟著增加；確認側板開啟時不擠壓 | `look-v2.css` |
| L4 | 詳細側板：寬螢幕加寬成「卡圖｜資料與價格」兩欄，放得下 P5 的價格表 | `look-v2.css`、`ui-enhancements.js` |
| L5 | 精修一輪：空白與錯誤狀態、字級與間距節奏、hover／focus 一致；通用 toast（接力棒待辦） | `look-v2.css`、`ui-enhancements.js` |

手機版面不改，每包都要確認 ≤760px 沒有跑版。

### S. 技術與資安

| 包 | 內容 |
|---|---|
| S0 | Opus 先對照 main，確認 `docs/SITE_IMPROVEMENT_PLAN.md` 的 A1–A6（限流後備、安全標頭、innerHTML 跳脫測試、`npm run check`、預覽只聽本機、Actions 固定版本）哪些已做，沒做的照原規格做，不重寫規格 |
| S1 | `serveSeoIndex`（卡片／系列的 SEO 頁）補 `Cache-Control: no-cache`＋`ETag`，和首頁一致 |
| S2 | 新端點守則：eBay 金鑰只存在 Render 環境變數；錯誤訊息不外洩上游內容；快取有上限；輸入全部白名單驗證；A3 的跳脫測試加入 eBay 標題與賣家名稱（這是外部不可信字串）；eBay 回傳的商品連結與圖片網址必須是 `https:` 且主機在 eBay 白名單內才輸出，外連加 `rel="noopener noreferrer"`；每日上限的計數在記憶體，重啟會歸零，所以 eBay 上限設得遠低於官方額度（例如每天 1,000 次） |
| S3 | 網域上線（使用者買好後）：照 SITE_IMPROVEMENT_PLAN 的 C2；Cloudflare 的 TTL、SSL 步驟、301 保留路徑可直接用 11-15 那份外部文件的 Phase 2。`.js`／`.css` 要先加版本號才能長快取 |

### C. 合規

| 包 | 內容 |
|---|---|
| C1 | 「資料來源」頁（原 G3）：每個遊戲的資料、圖片、價格來源與性質一張表，加入 eBay 與 SNKRDUNK |
| C2 | 頁尾官方網站連結補七龍珠超 Fusion World 與 Union Arena；eBay 區塊下方放 eBay 使用者協議連結（顯示規定） |
| C3 | 權利人聯絡與移除流程（原 G2）：信箱、處理時限、`security.txt` |
| C4 | 隱私說明（原 G1） |

## 4. 順序

- **第 0 波（使用者）**：P0 的 eBay 金鑰、寄 SNKRDUNK 授權信、決定買不買網域。同時 Fable 做 L0 預覽與 P4(a) 信稿。
- **第 1 波（可平行，檔案不重疊）**：worker A＝S0→S1→S2（`server.mjs`、測試）；worker B＝P4(b)(c)＋C1–C4（文件、頁尾、registry）；worker C＝L2（行情頁，獨立檔案）。
- **第 2 波**：P1（接在 worker A 之後用 `server.mjs`）→ P2 → P3 → P5；另一線 L1 → L3 → L4（等 L0 選定）。P5 與 L4 都動詳細側板，L4 先、P5 後。
- **第 3 波**：L5、P6、S3（等網域）。
- 每完成一包：測試全過、更新 `docs/AGENT_BATON.md`、commit 並 push。合併進 main 即上線，版面類的包要先給使用者看截圖。

## 5. 驗證

- `npm test` 全過（開工前先記下 main 的基準數）、`npm run check`。
- P1：用假的 eBay 回應跑測試；正式金鑰只在 Render 上，部署後對 3 張卡（寶可夢英文、日版、遊戲王）人工核對掛牌是否就是那張卡。
- P4：`grep` 與測試確認程式沒有請求 snkrdunk.com。
- 版面：內建瀏覽器 1920、1440、1280、375 四種寬度截圖；CLS 與 CSP 違規數不得高於現況；鍵盤可操作新表格與外連。
- 資安：安全標頭用 curl 驗；A3 的跳脫測試包含 eBay 欄位；`git log -p` 掃不到金鑰。
- 資料庫大小在全部做完後不變（新來源都不寫庫）。

## 6. 風險

- eBay 正式金鑰可能要求夥伴身分（官方需求頁這樣寫，agy 也認為會被擋；夥伴計畫問卷則寫 Browse 不需額外核准）→ P0 實測就會知道，被擋就只放外連。**不會為了拿權限而加入分潤計畫**，那會違反站內原則與成交價來源的無營收條件。
- P0 時 Opus 要讀一次 eBay API License Agreement 原文（先前環境讀不到），確認快取時限與「不得和其他來源混排」的要求；讀不到就照本計畫的保守做法（快取 1 小時、eBay 自成一區）。
- eBay 以關鍵字搜尋，身分對應不可靠 → 寧可不顯示也不配錯；非英文卡命中率會低。
- SNKRDUNK 很可能拒絕或不回（遊々亭前例）→ 站內就只有外連，日本行情仍缺。這點要先有心理準備。
- 成交價覆蓋小（只有寶可夢、每天約 40 張新卡）→ 要擴大只能付費，屬之後的決定。
- eBay 掛牌是關鍵字比對的掛牌價，可能被誤讀成行情 → 每處都標性質。
