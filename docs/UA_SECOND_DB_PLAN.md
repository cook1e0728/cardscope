# UA 收錄：第二個 Supabase 資料庫計畫書

狀態：進行中（2026-11-14）。兩項都已同意（ADR 0057）；第 0–3 段完成、第 4 段程式完成（手機寬度待有第二庫金鑰時看）：第二個專案 `cardscope-ip2`（`kcqtmmurmggitbivonll`）已建立並套用卡表結構（`supabase/ip2/20261114120000_ip2_catalog_schema.sql`）。

## 為什麼

- UA（Union Arena）日版官方卡表：119 個商品、11,170 張（含平行卡 2,419）。
- 現有資料庫 426 MB；全站平均每張卡含索引約 3.9 KB，UA 全量估 40–45 MB，超過 450 MB 紅線與 ADR 0052「每個新 IP ≤30 MB」。
- 瘦身空間很小（`tcg_card_names` 正常大小、價格快照早已封存），不升級 Pro（ADR 0052 零花費）。
- 第二個免費專案多 500 MB，資料表結構照用；之後的新 IP 也放這裡。

## 開工前要使用者同意

1. **UA 官方卡表的條款風險**：`unionarena-tcg.com` 沒有 robots.txt、沒找到資料使用條款，與排球少年、芙莉蓮同類（ADR 0034）。同意後寫 ADR，`data/source-registry.json` 記 `risk-accepted`。
2. **建立第二個 Supabase 專案並把金鑰放進 Render**：免費方案每個組織最多 2 個專案，目前用 1 個。新專案的 service key 只放 Render 環境變數（`SUPABASE2_URL`、`SUPABASE2_SERVICE_KEY`），不進 repo、不進同步資料夾。

## 設計

**分流規則：依遊戲決定資料庫。**
- `GAME_DB`：`union-arena` → 第二個資料庫，其餘 → 主資料庫。卡片 id、系列 id 都以 `union-arena-` 開頭，只拿 id 的路徑（`getCard`、價格走勢）也能判斷。
- `supabaseFetch(path, options)` 加一個「用哪個庫」的參數，預設主庫；沒設第二庫的環境變數時，UA 當作「沒有資料」，主站照常。
- 第二庫連不上時只有 UA 空白，不能拖垮其他遊戲（各自 try/catch，逾時沿用現有設定）。

**要改的地方（server.mjs 約 117 處 supabase 呼叫，實際要分流的是這幾類）：**

| 類別 | 做法 |
|---|---|
| 有明確 game 的（瀏覽、系列卡表、`/api/cards`） | 依 game 選庫 |
| 只有 id 的（卡片詳細、價格歷史） | 依 id 前綴選庫 |
| 跨遊戲的（`loadCatalog` 系列清單、全站搜尋、sitemap） | 兩庫並行查再合併；第二庫失敗就只回主庫 |
| 只跟主庫有關的（寶可夢價格快照、漲跌榜、回報、統計、健康檢查容量） | 不動；健康檢查另加第二庫大小 |

**資料表結構：** 新庫只建卡表相關的表與 RPC（`tcg_games`、`tcg_series`、`tcg_cards`、`tcg_printings`、`card_images`、`tcg_canonical_cards`、`tcg_card_names`、`browse_card_keys_mat` 及瀏覽、搜尋、詳細頁用到的 RPC）。不重播 114 個 migration（其中有寶可夢專用的資料搬移）；改從主庫匯出這些表與函式的定義，整理成一個新庫用的 migration，用 Supabase MCP 套用。

**匯入：** 新增 `scripts/import-union-arena.mjs`：
- 讀官方卡表（表單 POST `series=<id>`，每秒 1 個請求），解析卡號、卡名、稀有度、平行卡（`_p1`）、圖片網址。
- 先產生計畫檔、人工抽查，再寫入第二庫（沿用現有匯入腳本的「計畫 → 套用」模式）。
- 平行卡做法比照航海王：同卡號、另一張卡（`_p1` → id 結尾 `-p1`），本彈大獎的異圖判斷直接可用。

**前端與規則：**
- `data/game-taxonomy.json`、`game-switcher.js` 加 UA（顯示名稱待定，例：「UNION ARENA」）。
- `data/rarity-rankings.json` 加 UA 稀有度順序（官網篩選有 SR、R、U、C、UR、SP、PR、OBC 等，排名需查清楚）。
- 本彈大獎 `PACK_PRIZE_GAMES` 加 UA（只看 BT／EX 補充包）。

**不休眠：** 免費專案 7 天沒有活動會暫停。伺服器開機預熱與每小時的本彈大獎都會查第二庫；另把第二庫加進 UptimeRobot 健康檢查。

## 分段與驗收

| 段 | 內容 | 驗收 |
|---|---|---|
| 0 | 使用者同意上面兩項、寫 ADR | ADR 合併 |
| 1 | 建第二個專案、套用資料表結構 | 新庫有表與 RPC，空表查詢正常（2026-11-14 完成：17 表、1 檢視、38 函式、索引、觸發器、權限與主庫比對一致，只差函式內換行 CRLF→LF；空表呼叫各 RPC、寫入測試後回滾都正常；新庫 12 MB） |
| 2 | 伺服器分流（含測試：沒設第二庫、第二庫失敗、跨庫合併） | `npm test`、`npm run check`；沒設環境變數時正式站行為不變（2026-11-14 完成，見下方「第 2 段做法」） |
| 3 | 匯入腳本與 UA 資料 | 11,170 張、抽查 20 張卡名／稀有度／圖片；新庫大小紀錄（2026-11-14 完成：119 系列、11,170 卡、11,170 版本、8,760 canonical；抽查 20 張（含 SR★★★、AP★、帶引號卡名、UR、PcSR★★）與官方詳細頁一致、圖片網址皆 200；瀏覽鍵重建 11,170；新庫 12 → 55 MB，tcg_cards 28 MB） |
| 4 | 導覽、稀有度、本彈大獎加 UA | 本機手機寬度看過（程式與測試 2026-11-14 完成；本機需要 `.env.local` 的 `SUPABASE2_*` 才能看 UA 頁，尚未看） |
| 5 | Render 設環境變數、部署 | 正式站 UA 頁、搜尋、詳細頁、本彈大獎；主站其他遊戲不受影響 |

## 第 2 段做法（2026-11-14）

- `server.mjs`：`supabaseFetch`／`supabaseFetchPage` 依 `options.db` 或 AsyncLocalStorage 範圍（`withDb`）選庫；`dbForGame`、`dbForId`（id 以 `union-arena-` 開頭）決定範圍。價格、回報、統計、匯率、買取、同步紀錄的路徑（`MAIN_ONLY_PATH`）永遠走主庫。
- 單一遊戲：`browseDatabaseCards`（含稀有度表、facets）、`loadCardFromDatabase`、`loadSeoForSeries` 進第二庫範圍。
- 跨遊戲：目錄（遊戲與系列清單）併入第二庫的列，等最多 `SUPABASE2_TIMEOUT_MS`（預設 4 秒）；搜尋先問主庫，主庫填不滿一頁才問第二庫，接在主庫結果後面（排序不跨庫比較、主庫整頁時總數只算主庫，程式內註明）；零結果的拼寫建議與摺疊重試兩庫都問；sitemap 另外收第二庫的卡與系列，失敗不留半套；覆蓋率的 UA 有自己的關聯狀態。
- 健康檢查：`/api/catalog/health` 有設第二庫時多 `secondStorage.status`（每小時查一次 `db_size_report`，也讓第二庫不因 7 天沒活動被暫停）；管理端點多 `secondStorage` 詳細。
- `CATALOG_GAME_IDS` 只在有設 `SUPABASE2_URL`＋`SUPABASE2_SERVICE_KEY` 時加入 `union-arena`：第 5 段在 Render 設好環境變數，UA API 才會開。
- 測試 `test/second-db.test.mjs`（兩個模擬庫）：沒設第二庫、各類請求走對的庫、搜尋補頁、第二庫錯誤或連不上、拼寫建議。
- 尚未做：近期發售活動（`/api/market-events` 的系列發售日）、商品圖（`tcg_products`）只看主庫；本彈大獎的 UA 留第 4 段。

## 第 3、4 段做法（2026-11-14）

- 匯入 `scripts/import-union-arena.mjs plan <檔>`：商品下拉選單（119 個）→ 逐商品 POST 卡表 → 稀有度篩選對應（全站查詢結果太多時官方回 0 筆，R、U、C 改成逐商品查）→ 平行卡逐張讀詳細頁的星數（`_p` 編號和星數不一一對應，`_p2` 也可能是 SR★★★）→ 商品頁補充包發售日（依商品名比對，只補 BT）。每個請求間隔 1.1 秒、連線中斷重試，進度存在 `<檔>.partial`，中斷後重跑接著做。`apply <檔>` 用 `SUPABASE2_*` 只新增不覆蓋。
- id：卡號 `UA01BT/CGH-1-004` → `union-arena-ua01bt-cgh-1-004`，平行卡 `_p1` → `-p1`（同 canonical id）；系列 `union-arena-ua01bt`，沒有【】代號的商品用官方商品編號（例：`union-arena-570702`）。同一張卡在多個商品出現時算第一個列出它的商品。
- 稀有度：存官方詳細頁的寫法（SR★、SR★★★、PcSR★…）；`rarityToken` 改成保留 ★（其他遊戲沒有用到 ★，2026-11-14 查過主庫）。排名見 `data/rarity-rankings.json` 的 `union-arena`（星數多的平行卡 > UR > SP > SR > Pc 系列 > R…，只供導覽）。
- 本彈大獎：`{game:'union-arena', top:'SR★', code: UA/EX..BT}`。順手修 `mergePrizeRows` 合併鍵：原本所有遊戲都取卡號斜線前，黑白雙翼（`SFN/S136-100R`）與 UA 整彈會併成一張而永遠不顯示；改成只對寶可夢切斜線。
- 近期發售：`loadCatalogEvents` 另問第二庫的系列發售日，失敗或逾時只少 UA。
- 寫入：這次 `.env.local` 沒有第二庫金鑰，改用新庫暫時的密碼閘門函式 `_ip2_import`（只允許寫 5 張卡表、只新增），寫完已刪除、密碼檔已刪。之後有金鑰就用 `apply`。寫入後在第二庫執行 `select public.browse_refresh_keys('union-arena');`。
- 官方資料細節：稀有度篩選合計 10,198 張，其餘 972 張是アクションポイントカード（官方沒有稀有度，給 AP／AP★ 分組）；卡號帶 ★ 的 AP 卡（54 張）id 用 `-star`，否則會和同號 AP 卡撞號被丟掉；卡名裡的引號官方沒跳脫（4 張）。
- 導覽：`data/game-taxonomy.json`、`game-switcher.js` 啟用 UA（名稱「UNION ARENA」，沒有 logo）；各處遊戲名稱對照、`navigation-state.js` 允許清單、系列分組（ST 起始牌組、BT 補充包、其他特別商品／推廣卡）。

## 風險

- 跨庫搜尋多一次網路來回，搜尋可能慢 0.1–0.5 秒；第二庫逾時要短，不能拖慢主站。
- 兩個庫的資料表結構要一起維護：之後改卡表結構的 migration 要套兩次（在 migration 檔頭註明）。
- 條款未確認的法律風險由使用者承擔（同 ADR 0034）。
