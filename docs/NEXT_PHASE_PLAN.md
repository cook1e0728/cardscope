# CardScope 下一階段計畫：版面升級＋eBay／SNKRDUNK 價格＋資安與合規

> 起草：Fable（2026-11-16）。拍板後由 Opus 帶 sonnet-worker 施作。
> 一律在 `main` 的最新狀態上開新分支做（本機目前停在舊分支 `claude/weiss-en`，落後 main 77 個提交，**不要在上面動工**）。

## 0. 這一回合要做的事（2026-11-17，使用者說「進行下一階段網站打造」）

整份計畫已於 11-16 批准；首頁預覽選 **A**；網域晚點再買（S3 延後，不擋其他工作）。這一回合啟動施作：

1. **把計畫文件推上 main**：本機分支 `plan/next-phase`（工作樹 `.claude/worktrees/plan-docs`，領先 main 2 個提交，只有文件）。先把 A 版預覽稿 `docs/design-previews/home-desktop.html` 用 `git add -f` 一併提交（該資料夾在本機排除清單裡，不進 git 的話施作方看不到；`docs/` 不會被網站對外提供），然後 `git push origin plan/next-phase:main`。提交訊息帶 `[skip render]`，不觸發部署。上次這個推送被權限分類器擋下；若再被擋，改成讓施作 session 直接從 `plan/next-phase` 分支開工，並請使用者手動推。
2. **開一個 Opus 主導的 session 做第 1 波**（依使用者的固定分工：Fable 寫計畫、Opus 指揮、Sonnet 施作）。從 main 開新工作樹，交接內容：
   - 先讀 `docs/AGENT_BATON.md`、`docs/NEXT_PHASE_PLAN.md`、`AGENTS.md`。
   - 第 1 波三條線派給 sonnet-worker（檔案不重疊）：A＝S0→S1→S2（`server.mjs`、測試）；B＝P4(b)(c)＋C1–C4（文件、頁尾、`data/source-registry.json`、`price-timeline.js` 的 SNKRDUNK 外連）；C＝L2（行情頁改網格）。
   - 第 1 波做完接第 2 波的版面線：L1 → L3 → L4，照 A 版預覽。P1／P2（eBay 掛牌）要等使用者把金鑰設到 Render 並提交帳號刪除通知豁免，沒完成前不開工。
   - 規則：每包測試全過才提交；**合併進 main 就是上線**，看得到的版面變更（L 系列、P4 的外連按鈕、頁尾）合併前先給使用者看截圖；純伺服器與文件的包（S0–S2、C 的文件部分）測試與 CI 綠了可直接合併。每包更新接力棒。新價格來源不寫主庫。伺服器不得對 snkrdunk.com 發請求。
3. **這個 session 留著等使用者的三件事**：SNKRDUNK 表單的署名與卡牌信箱完整地址（拿到後我填表單、停在送出前給使用者看）；eBay 金鑰設到 Render＋帳號刪除通知豁免；買網域（建議 `cardscopetw.com`）。

驗證：推送後 `git log origin/main -3` 看得到計畫提交、Render 沒有新部署；Opus session 回報時，我對照 diff 與測試結果再向使用者報告，不照單全收。

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

### Y. 收藏雲端同步（同步碼，2026-11-17 使用者決定；排在第 2 波之後）

**狀態：Y1–Y5 已完成（2026-11-19，ADR 0059）。** Y1 的副庫表已套用；另加的 180 天清理排程 `supabase/ip2/20261119180000_collection_sync_cleanup.sql` 只寫了檔，尚未套用。Y4 沒有 QR 碼（專案內沒有現成套件，只給文字碼）。

目的：同一個人的幾台裝置共用一份收藏，不用手動匯出匯入。**不做帳號**、不收信箱或任何個資；之後若要帳號，同一份資料再綁上去即可，不重做。這會修改 ADR 0045「收藏只存在這台裝置」，要寫 ADR 0059。

| 包 | 內容 | 主要檔案 | 完成的樣子 |
|---|---|---|---|
| Y1 | 副庫（`ip2`，`SUPABASE2_*`）建一張表：`sync_key_hash`（主鍵，同步碼的 SHA-256）、`items` jsonb、`updated_at`、`revision`。RLS 全關、只給 service role；**不放主庫**。migration 加進副庫的 migration 流程（照 `docs/UA_SECOND_DB_PLAN.md`） | 副庫 migration | 表存在、匿名角色讀不到 |
| Y2 | 端點：`POST /api/sync/pull`、`POST /api/sync/push`。同步碼放 request body（不放網址），伺服器只拿雜湊值查表。寫入時每筆收藏都用 `collection-store.js` 的同一套驗證（`problem`／`normalizeItem`、`LIMITS`），整份上限沿用 `LIMITS.itemsMax` 與 `fileMaxChars`。`revision` 做樂觀鎖：不符回 409，前端先拉再合併。限流比一般 API 更嚴（同一 IP 每分鐘數次），同步碼格式不對直接 400，不查庫。回應 `no-store` | `server.mjs`、`test/collection-sync.test.mjs` | 測試涵蓋：驗證拒絕壞資料、409、限流、碼格式、回應不含雜湊 |
| Y3 | 合併規則：每筆收藏加 `updatedAt`；兩邊同一張卡取較新的；刪除留墓碑（`deleted:true`＋時間），30 天後清掉。純函式放 `collection-store.js`，有單元測試 | `collection-store.js`、`test/collection-store.test.mjs` | 兩台交錯新增、修改、刪除，結果一致 |
| Y4 | 前端：收藏頁「管理」選單加「雲端同步」。開啟時在瀏覽器產生同步碼（`crypto.getRandomValues`，至少 128 bit，顯示成好抄的分組字串）＋ QR 碼讓另一台掃；另一台輸入或掃碼加入。同步碼只存 localStorage。時機：開收藏頁、收藏有變動後幾秒、切回分頁時。離線或伺服器失敗只顯示狀態，本機照用。可「停止同步」（只斷本機）與「刪除雲端資料」（整份刪除，確認後才做）。QR 碼若需要套件，先找專案內有沒有現成的；沒有就只給文字碼 | `ui-enhancements.js`、`collection-store.js`、`look-v2.css` | 兩個瀏覽器設定檔實測同步；離線不壞 |
| Y5 | 文件：ADR 0059、隱私說明改寫（雲端存什麼、存哪、同步碼要像密碼一樣保管、弄丟救不回、怎麼刪除）、資料來源頁不用改 | `docs/adr/0059-*.md`、隱私說明 | 頁面與 ADR 一致 |

安全要點：同步碼等於密碼，不進網址、不進伺服器紀錄；伺服器只存雜湊；回應與錯誤訊息不回傳任何雜湊或其他人的資料；收藏內容只接受驗證過的欄位。容量估計：每人約幾十 KB，副庫目前 55 MB，綽綽有餘；在 `/api/catalog/health` 既有的容量檢查之外不另加監控。

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
- **第 2 波之後**：Y1 → Y2 → Y3 → Y4 → Y5（收藏雲端同步）。Y2 與 P1 都動 `server.mjs`，不要同時做。Y4 是介面變更，合併前先給使用者看截圖。
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
