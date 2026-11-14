# UA 收錄：第二個 Supabase 資料庫計畫書

狀態：草案（2026-11-14）。使用者已選「第二個資料庫」方案；下列「開工前要使用者同意」兩項確認後才動正式環境。

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
| 1 | 建第二個專案、套用資料表結構 | 新庫有表與 RPC，空表查詢正常 |
| 2 | 伺服器分流（含測試：沒設第二庫、第二庫失敗、跨庫合併） | `npm test`、`npm run check`；沒設環境變數時正式站行為不變 |
| 3 | 匯入腳本與 UA 資料 | 11,170 張、抽查 20 張卡名／稀有度／圖片；新庫大小紀錄 |
| 4 | 導覽、稀有度、本彈大獎加 UA | 本機手機寬度看過 |
| 5 | Render 設環境變數、部署 | 正式站 UA 頁、搜尋、詳細頁、本彈大獎；主站其他遊戲不受影響 |

## 風險

- 跨庫搜尋多一次網路來回，搜尋可能慢 0.1–0.5 秒；第二庫逾時要短，不能拖慢主站。
- 兩個庫的資料表結構要一起維護：之後改卡表結構的 migration 要套兩次（在 migration 檔頭註明）。
- 條款未確認的法律風險由使用者承擔（同 ADR 0034）。
