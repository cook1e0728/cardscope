# Cloudflare Workers 搬遷計畫書（好卡在 CardSeek）

> 文件建立日期：2026-11-23｜狀態：計畫定案（第 1 步程式已實作，尚未部署）
> 依據：`docs/PRODUCT_PLAN.md`、`AGENTS.md` 與 `server.mjs` / `providers/*.mjs` 原始碼實況盤點。

## 1. 背景、目標與平台限制

### 1.1 搬遷動機
- Render 免費方案每月 5 GB 對外傳輸流量已用罄並遭停權，急需將靜態資源與公開流量移出 Render。
- 資料庫（Supabase 主庫與第二庫 `cardscope-ip2`，皆位於東京區）繼續沿用；網域 `cardseektcg.com` 已託管於 Cloudflare 並開啟橘雲代理（Proxied）。
- 遵守 `docs/PRODUCT_PLAN.md` 原則：**不使用付費服務**，全搬遷過程維持在 Cloudflare Workers、Supabase 與 GitHub Actions 免費額度內。

### 1.2 Cloudflare Workers 免費方案核心配額（規劃基準）
| 資源項目 | 免費方案上限 | 對 CardSeek 的影響與設計原則 |
| --- | --- | --- |
| **Workers Static Assets** | 靜態檔案請求數與頻寬 **不計費／不限量**；單檔上限 25 MiB、單版最多 20,000 檔 | 第 1 步立刻釋放絕大多數 HTML／JS／CSS／圖片／字型流量，大幅降低原點流量 |
| **Worker 請求次數** | 每日 **100,000 次**（UTC 00:00 重置，跨帳號所有 Worker 共用） | `run_worker_first` 僅攔截 `/`、`/index.html`、`/api/*`、`/sitemap*`、`/robots.txt`、`/.well-known/*`，靜態 `.js`/`.css`/`.webp`/`.png` 直接由 Static Assets 送出，**不消耗每日 10 萬次額度** |
| **單次請求 CPU 時間** | **10 ms CPU**（網路 `fetch` 等待 I/O 時間不計入 CPU，只算 JS 執行時間） | 致命限制！所有大 JSON 同步壓縮、整庫掃描（coverage／sitemap）、大系列全量排序、多分片 gunzip 皆不可在請求內直接硬算，必須靠 Supabase RPC、KV／Cache API 快取或背景預產 |
| **單個 Isolate 記憶體** | **128 MB** | `server.mjs` 的 `browseCache`（24 MB）、`catalogCache`、`staticCompressCache`（20 MB）與百萬列掃描無法全塞在記憶體；大檔案須串流或切分片 |
| **Subrequest（對外 `fetch`）** | 單次請求最多 **50 次** | 禁止在單次請求內以迴圈對 Supabase 分頁掃描超過 50 頁（例如 `coverage`、`sitemap`、`forEachKeysetPage`）；必須改用單一 RPC 或 KV 預存快照 |
| **Workers KV** | 每日讀 **100,000**、寫 **1,000**、刪 **1,000**、清單 **1,000**；總容量 **1 GB**、單值 **25 MB** | 非常適合存放低頻更新但計算昂貴的快照：`sitemap`、`catalog`、`coverage`、`products`、`pack-prizes`、`series-hits`、`price-movers`、`hot-cards` |
| **Cron Triggers** | 免費帳號合計最多 **5 條**；每次觸發同樣受限 **10 ms CPU** | 僅適合輕量排程（例如定期刷 `pageStats`、`exchange-rates`、預熱 KV）；耗時長與大記憶體排程（`syncCatalog`、`priceSnapshot`、`priceArchive`、`cacheYugiohImages`）改由 GitHub Actions 或本機工作排程執行 |

### 1.3 架構關鍵注意事項（務必先處理）
1. **避免第 1–2 步代理迴圈（`CANONICAL_REDIRECT`）**：Render 目前環境變數設有 `CANONICAL_REDIRECT=true`（見 `server.mjs:1622`，收到 `Host: cardscope.onrender.com` 會 301 轉到 `https://cardseektcg.com`）。Workers 第 1 步以 `https://cardscope.onrender.com` 當原點代理時，若 Render 未先將 `CANONICAL_REDIRECT` 改回 `false`，所有經 Workers 代理的 `/api/*` 與 `/?card=` 都會無限 301！因此**切換 Cloudflare 正式網域路由前，必須先把 Render 的 `CANONICAL_REDIRECT` 改為 `false`**（改由 Workers 統一負責 `www.` 轉 apex）。
2. **`keep-warm.yml` 防休眠對象調整**：`.github/workflows/keep-warm.yml` 目前每 10 分鐘打 `https://cardseektcg.com/robots.txt`。第 1 步將 `/robots.txt` 移上 Workers 後，該請求不會再到 Render，Render 會在 15 分鐘後進入休眠（影響未搬遷的 `/api/*` 冷啟動）。若要在第 1–2 步維持 Render 喚醒，須同步評估讓該 workflow 改打 `HEAD`（如原點健康端點，且第 3 步停 Render 後關閉）。
3. **第 1 步 `pageStats` 暫時少計靜態頁**：第 1 步 `/`（首頁、遊戲頁、`?view=`）直接由 Workers 回應而不經 Render，因此 Render 上的 `pageStats` 僅會統計到有打原點的 `/?card=` 與 `/?series=`；待第 2 步搬移 `pageStats` 至 Workers 後恢復完整統計。
4. **`SNKRDUNK` 與測試契約不可破**：全站禁止伺服器端對 `snkrdunk.com` 發起任何請求（`test/snkrdunk-no-fetch.test.mjs`）；`server.mjs` 與 `index.html` 的 CSP 不可出現 `'unsafe-inline'` 於 `script-src`（`test/csp-strict.test.mjs`）。

---

## 2. `server.mjs` 完整路由、API 與背景作業逐條盤點

> 註：共用安全標頭、CSP、`PUBLIC_STATIC`、404 HTML、`security.txt`、`seoRequestTarget` 已於第 1 步抽離至無 `node:*` 依賴的 `providers/http-security.mjs`。

### 2.1 全域中介層與基礎建設

| 項目（`server.mjs` 位置） | 搬到 Workers 的做法 | 依賴的 Node API 與替代方案 | 預估 CPU（免費上限 10 ms） | 風險與緩解策略 |
| --- | --- | --- | --- | --- |
| 舊網域轉址（`L1622`） | 第 1 步由 Worker 執行 `www.cardseektcg.com` → `301 https://cardseektcg.com`；`cardscope.onrender.com` 301 在第 1–2 步關閉，第 3 步停 Render | `req.headers.host` → Web `new URL(request.url)` | `< 0.1 ms` | **高風險（設定順序）**：Render 若未關 `CANONICAL_REDIRECT` 會造成代理迴圈；上線前必須先關閉 Render 轉址 |
| 安全標頭與動態 CSP（`L150-156, 1772-1775`） | `providers/http-security.mjs` 共用：`SECURITY_HEADERS`、`API_CSP`、依 `index.html` inline `<script>` 算 SHA-256；靜態檔另編譯進 `_headers` | `node:fs` (`readFileSync`) + `node:crypto` (`createHash`) → Web `ASSETS.fetch` + `crypto.subtle.digest('SHA-256')` + 實例內記憶體快取 | 首次 `< 1 ms`，快取命中 `< 0.05 ms` | 若 `ASSETS` 讀取 `index.html` 失敗，不可快取空值；並須確保 `_headers` 與 Worker 回應完全對齊 |
| 回應壓縮與靜態壓縮快取（`L82-149`） | **不需手寫**：Cloudflare Edge 原生自動對可壓縮 MIME 執行 Brotli / Gzip 壓縮與 `ETag` 協商 | `node:zlib` (`brotliCompressSync`, `gzipSync`) + `Buffer` + 20 MB Map → **移除**，交由 Cloudflare Edge 自動壓縮 | `0 ms`（邊緣處理） | **代理陷阱**：Worker `fetch()` 向原點拿回回應時會自動解壓串流，轉回前端時須移除 `content-encoding` 與 `content-length`，否則瀏覽器二次解碼失敗 |
| 記憶體警戒輪詢與 `inflightRequests`（`L1617-1619`） | Workers 無長駐進程與 RSS，此段不搬；改用 Cloudflare Workers Logs / Metrics 監測 CPU 與錯誤率 | `setInterval().unref()`、`process.memoryUsage()` → Cloudflare Analytics / `console.warn` | `0 ms` | Isolate 無狀態且隨時回收，無需手動監控 512 MB OOM |
| 全站 7 組 IP 限流器（`L885-907, 943, 966, 1624`） | **不可沿用單機 Map**（Edge 多節點不共享記憶體，限流會失效）。改在 Cloudflare WAF / Rate Limiting Rules 設門檻（免費方案提供基礎規則），或針對 `/api/sync/*`、`/api/auth/*`、`/api/graded-prices`、`/api/ebay-listings` 搭配極簡計數／KV 或 WAF 規則 | 記憶體 `Map` (`createRateLimiter`) + `socket.remoteAddress` → Cloudflare WAF Rate Limiting Rules + `cf-connecting-ip` 標頭 | `0–0.2 ms` | 免費方案 WAF Rate Limiting 規則數有限（通常 1 條規則／IP 視窗限制）；應優先把免費規則用在 `/api/sync/*` 與 `/api/auth/*` 暴力嘗試防護，其餘低頻保護輔以 Cache API 或 KV 計數（注意 KV 寫入 1,000/日上限） |
| 請求錯誤保護與 `badInput` 400（`L1776-1780`） | Worker `fetch` 外層 `try/catch` + `new URL` 與 `decodeURIComponent` 驗證；無效 URL 回 400 JSON，未預期錯誤回 500 通用中文訊息 | `URIError` / `ERR_INVALID_URL` → Web 標準 `TypeError` / `URIError` | `< 0.05 ms` | 禁止將 Supabase 或內部堆疊外洩至公開回應 |

### 2.2 靜態檔、無資料庫頁面與 SEO 動態頁

| 路由（`server.mjs` 位置） | 第 1 步 | 第 2/3 步做法 | 依賴的 Node API 與替代方案 | 預估 CPU | 風險與緩解策略 |
| --- | --- | --- | --- | --- | --- |
| `PUBLIC_STATIC` 靜態檔（`L77, 1759-1766`） | **已搬上 Workers**（`scripts/prepare-worker-assets.mjs` 預篩選白名單進 `worker/public/`） | 同左，Workers Static Assets 直接送出 + `_headers` | `node:fs/promises` + `node:path` → 建置期篩選 + `ASSETS.fetch` + `_headers` | `0 ms`（繞過 Worker 直接送 Static Assets）或 `< 0.5 ms` | `worker/index.mjs` 與建置腳本雙重檢查 `isPublicStaticPath`，確保 `.env*`、`server.mjs`、`providers/`、`docs/`、`data/catalog.json` 永不暴露 |
| `GET`/`HEAD /` 首頁、遊戲頁、`?view=`（`L1758-1766`） | **已搬上 Workers** | 同左，並補回 `pageStats` 計數 | `node:fs` + `node:crypto` (`sha1`) → `ASSETS.fetch('/index.html')` + `providers/seo.mjs` + `crypto.subtle.digest('SHA-1')` | `1–2.5 ms`（正規寫入 HTML head 與算 SHA-1） | 大部分請求落在 2 ms 內；對完全靜態的無參數 `/` 與常見 `?game=` 可用 Workers Cache API 再快取以壓低到 `< 0.3 ms` |
| `GET`/`HEAD /robots.txt`（`L1755`） | **已搬上 Workers** | 同左 | 純函式 `renderRobotsTxt`（無 Node 依賴） | `< 0.1 ms` | 幾乎零風險 |
| `GET`/`HEAD /.well-known/security.txt`（`L1754`） | **已搬上 Workers** | 同左 | 原用 `Date.now()`，無 Node API；共用 `renderSecurityTxt` | `< 0.1 ms` | 幾乎零風險 |
| 未知路徑 404（`L162, 1759`） | **已搬（非代理路徑）**；`/api/*` 代理原點 | 全數由 Worker 直接回 404 | 常量字串 `NOT_FOUND_HTML`／JSON | `< 0.1 ms` | 需保持 HTML 404 不帶 inline script 以符合無 script 頁面要求 |
| `GET`/`HEAD /?card=<id>`、`/?series=<id>`（`L1550-1573, 1758`） | **代理回 Render**（無效 ID 已於 Worker 邊緣放行或交原點處理；第 1 步無效 ID 先走靜態首頁或代理） | 搬上 Workers（第 2D 批）：先查 Cache API / KV，未中才查 Supabase（`get_card_detail` / `tcg_series` + `tcg_printings` 計數），維持 1.5s 逾時降級回 200 `indexHtml` | `node:fs` (`index.html`)、`AsyncLocalStorage`（`withDb`）→ `ASSETS.fetch` + 顯式傳 `db` 參數（或開啟 `nodejs_compat`）；快取改用 Cache API（`s-maxage`/TTL 600s，404 負快取 60s） | `2–4 ms`（JSON 解析與 `applySeoToHtml`） | `get_card_detail` 回傳多 printing 與 HTML 重寫在極大卡片物件時可能接近 3–5 ms；加上 Cache API 快取後重複爬蟲命中 `< 0.5 ms` |
| `GET`/`HEAD /sitemaps/pages.xml`（`L1595`） | **代理回 Render** | 搬上 Workers（第 2C 批）：直接由 `WORKER_GAME_IDS` 與 `pageSitemapEntries` 產生 | 純函式 `providers/seo.mjs` | `< 0.5 ms` | 零 DB、低風險 |
| `GET`/`HEAD /sitemap.xml`、`/sitemaps/series.xml`、`/sitemaps/cards-<n>.xml`（`L1575-1601`） | **代理回 Render** | **不可在請求時重算！** 改由 GitHub Actions 排程（每日）呼叫 Supabase `sitemap_card_groups` + `tcg_series` 產生所有 XML，寫入 Workers KV（或 Cloudflare R2 / Static Assets 部署更新） | `node:http` + 記憶體 `sitemapCache` + Keyset 60 秒 50+ 頁掃描（將爆 50 subrequest 與 10 ms CPU！）→ **預產存 KV**，Worker 只讀 KV 輸出 XML | 請求時 `< 0.5 ms`（直接讀 KV）；若在請求內建置會達數百 ms CPU **必爆 10 ms** | 單一 `cards-*.xml`（4 萬筆 URL）約 4–6 MB，未超過 KV 單值 25 MB 上限；KV 每日讀限 10 萬次足敷 Googlebot 爬取 |

### 2.3 圖片代理與公開 API

| 路由（`server.mjs` 位置） | 第 1 步 | 第 2/3 步做法 | 依賴的 Node API 與替代方案 | 預估 CPU | 風險與緩解策略 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/images/onepiece`（`L165-207, 1625`） | **代理回 Render** | 搬上 Workers（第 2A 批）：串流轉發白名單網域圖片（驗證 HTTPS、無 port/帳密、副檔名、MIME 與 5 MB 上限），搭配 Cache API 邊緣快取 24 小時 | `Buffer`、`ReadableStream` reader → 純 Web `Uint8Array` + `TransformStream` 計數斷流（超過 5 MB 立刻 cancel），**無需 Node Buffer** | `0.5–1.5 ms` | **最大流量省流來源！** 搬上 Workers 並開 Cache API 可直接省下大量 Render 圖片轉發流量；串流限流避免 Buffered 超過 128 MB 記憶體 |
| `GET /api/providers`（`L209-215, 1628`） | 代理回 Render | 搬上 Workers（第 2A 批）：依 `env` 判斷啟用狀態回傳靜態 JSON | 無 Node API | `< 0.1 ms` | 零風險 |
| `GET /api/catalog/sources`（`L1636`） | 代理回 Render | 搬上 Workers（第 2A 批）：改以靜態 JSON import `data/source-registry.json` | `providers/source-policy.mjs` 原用 `node:fs/promises` `readFile` → 改為靜態 `import registry from '../data/source-registry.json' with { type: 'json' }`（Node 24 與 Wrangler 皆支援） | `< 0.2 ms` | 必須確認打包後無剩餘 `fs` 讀取 |
| `GET /api/catalog`（`L1105-1165, 1631`） | 代理回 Render | 搬上 Workers（第 2C 批）：合併 `data/catalog.json` 與主/副庫 `tcg_games`、`tcg_series`、前 250 張卡，結果快取於 Cache API / KV 10 分鐘（避免每次請求做 `canonicalizeCatalog` 與 `structuredClone`） | `readFile` (`catalog.json`) + `AsyncLocalStorage` (`withDb`) + `structuredClone` → 靜態 import JSON + 顯式傳 `db` + KV/Cache API 快取序列化 JSON 字串 | 無快取約 `4–8 ms`（`canonicalizeCatalog` 較吃 CPU）；快取命中 `< 0.3 ms` | 若未快取且同時遇到 250 張卡多 printing 合併，冷請求可能逼近 10 ms 邊緣；解法為寫入 KV 時存已 `canonicalize` 完成的 JSON |
| `GET /api/catalog/coverage`（`L620-826, 1632`） | 代理回 Render | **嚴禁在 Worker 請求內全庫掃描！**（目前需掃 ~7.5 萬卡、10.5 萬 printing，耗時 30–125 秒、上百次 HTTP 請求，必爆 10 ms CPU 與 50 subrequest）。改由 GitHub Actions 每小時／每次同步後跑現有邏輯算出完整 JSON，透過 Cloudflare API 或排程端點寫入 Workers KV（`coverage:latest`）；Worker 端只讀 KV + 檢查過期標示 `stale` | `readFile`、`createHash`、`AsyncLocalStorage` → 外部批次預先運算 + Workers 僅讀 KV | Worker 讀取 `< 0.3 ms`（原運算需數秒 CPU，**不可搬進 Worker**） | 若 KV 尚無快照可退回 `buildFallbackCatalogCoverage` 或標示 `unavailable`；KV 單筆大小約 < 500 KB（已做 `slimCoverageGame` 瘦身） |
| `HEAD /api/catalog/health`（`L1634`） | 代理回 Render | 搬上 Workers（第 2A 批）：直接回 200 空回應（`no-store`） | 無 | `< 0.05 ms` | UptimeRobot 改測 Worker 時零延遲 |
| `GET /api/catalog/health`（`L851-866, 1635`） | 代理回 Render | 搬上 Workers（第 2C 批）：呼叫主庫 `catalog_health_snapshot_v2` 與主/副庫 `db_size_report`（共 3 次 `fetch`），並透過 Cache API / KV 快取 5–60 分鐘；若 `v2` 逾時或失敗 fallback 至預計算 KV | `AsyncLocalStorage`、`createBoundedSnapshotCache` → 顯式傳 `db` + KV/Cache API | `< 1 ms`（RPC 結果極小，等待時間不計 CPU） | 當 RPC 重建冷啟動需 14 秒時須防觸及 Workers 單次 Wall-clock 或 subrequest timeout，建議由 Cron / Actions 定時刷新 KV，公開端點直接讀 KV |
| `GET /api/catalog/image-status`（`L1629`） | 代理回 Render | 搬上 Workers（第 2A/2B 批）：分頁讀取或建議在 Supabase 補輕量 `count` RPC；未補 RPC 前需注意 `dbAll` 掃 2 萬列（約 20 次 subrequest + JSON 解析） | `providers/image-cache.mjs`（若不觸發寫入只讀狀態，無需 `Buffer`） | `2–6 ms`（視卡數而定） | 若 `ygoprodeck` 卡數超過 5 萬張會接近 50 subrequest 限制，應加上 RPC 計數或 Cache API 快取 10 分鐘 |
| `GET /api/catalog/sync-status`（`L1745`） | 代理回 Render | 搬上 Workers（第 2A 批）：單次查詢 `catalog_sync_runs` limit 12 | 無 Node API | `< 0.3 ms` | 單次小 JSON 查詢，極安全 |
| `GET /api/cards`（`L507-618, 1663`） | 代理回 Render | 搬上 Workers（第 2B 批）：直接走 Supabase RPC（`browse_cards_page`、`browse_cards_filtered`、`browse_cards_priced`、`browse_cards_facets`、`browse_series_cards`）+ `price_reference_best` / `price_reference_prior` + Cache API 60 秒快取；針對大系列 `browse_series_cards` 回傳 300–600 張卡時須特別優化 | `createHash('sha1')` (`node:crypto`)、`AsyncLocalStorage`、`Intl.Collator` → `crypto.subtle.digest`、顯式 `db` 參數；`Intl.Collator` Worker 支援 | 快取命中 `< 0.3 ms`；一般頁 `2–5 ms`；**大系列排序（>400 張）可能達 `6–12 ms`** | **高 CPU 風險點**：`browseDatabaseSeriesCards` 若單一系列有 500+ 張卡，在 JS 執行 `buildBrowsePage` + `Intl.Collator` 排序 + `structuredClone` 可能超過 10 ms！緩解：單系列改由資料庫端排序分頁或用 Cache API 快取整組系列結果／預先建置 `facets` |
| `GET /api/search`（`L1187-1322, 1664-1735`） | 代理回 Render | 搬上 Workers（第 2B 批）：依賴 `search_cards_ranked` RPC（主庫＋必要時第二庫），並將 `seriesIndex` 建置結果連同目錄快取於記憶體／KV，搭配 Cache API（TTL 60–300s） | `readFileSync` (`rarity-rankings.json`、`yugioh-zh-aliases.json`)、`AsyncLocalStorage`、`Buffer` 無 → 靜態 import JSON（改寫 `normalize.mjs` / `search-query.mjs`）、顯式 `db` | 熱查詢 `2–5 ms`；冷建置 `seriesIndex` 約 `3–6 ms` | **中風險**：若 `seriesIndex` 含上千個系列且每次冷啟動重算 `buildSeriesIndex`，加上搜尋降級多輪迴圈，可能逼近 10 ms；須將精簡 `seriesIndex` 預先序列化存 KV，且嚴格限制降級重試次數 |
| `GET /api/cards/:id`（`L1342-1365, 1736`） | 代理回 Render | 搬上 Workers（第 2B 批）：優先呼叫 `get_card_detail` RPC + `attachReferencePrices`，搭配 Cache API 60s（若無 `?open=1`） | `createHash`、`AsyncLocalStorage`、`cardHot.record()` → Web Crypto、顯式 `db`；`?open=1` 改呼叫 Durable Object / `waitUntil` 寫 KV 或 RPC（見 2.5 節） | `1–3 ms` | 若帶有 `?open=1` 須不可直接被 Cloudflare Cache 攔截（或改用 `ctx.waitUntil` 記錄計數後再讀快取內容） |
| `GET /api/products`（`L1074-1100, 1656`） | 代理回 Render | 搬上 Workers（第 2C 批）：讀取 `tcg_products`、`tcg_series` 與 `data/series-zh.json` 並快取於 KV（10 分鐘） | `readFile` (`series-zh.json`)、`structuredClone` → 靜態 import JSON + KV 快取已組合好的完整 JSON | 快取命中 `< 0.3 ms`；冷重算（掃千筆商品）`5–9 ms` | 資料庫所有商品列目前約 1–2 千筆，冷運算正規比對較耗 CPU，應靠 KV + Cron／背景更新，不讓訪客請求現場重算 |
| `GET /api/cards/:id/market`（`L1367-1415, 1736`） | 代理回 Render | 搬上 Workers（第 2B 批）：平行請求 YGOPRODeck / TCGdex / `price_snapshots` / `exchange-rates`，結果用 Cache API 快取 5 分鐘（失敗不快取） | `readFile` (`tcgdex-en-set-map.json`)、`Buffer` 無 → 靜態 import JSON + Cache API | `1.5–4 ms` | 依賴外站回應速度，Workers 需加 `AbortSignal.timeout` 避免超過 Worker 壁鐘等待時間；記得剔除有錯誤來源的快取 |
| `GET /api/cards/:id/price-history`（`L1418-1442, 1528-1533, 1736`） | 代理回 Render | 搬上 Workers（第 2E / 進階批）：讀最近 30 天 Supabase `price_snapshots` + 從 Storage `price-archive` 讀取相關月份分片 `.json.gz` 並解壓 | `node:zlib` (`gunzip`)、`node:crypto` (`createHash`)、`Buffer` → Web `DecompressionStream('gzip')` + `crypto.subtle.digest('SHA-256')` / `'SHA-1'` + `Uint8Array`；若保留 `node:zlib` 須開 `nodejs_compat` | **高風險（`4–15+ ms`）**：若一張卡跨越 6 個月 × 2 個分片，需一次解壓 12 份 ~60 KB `.json.gz` 並 `JSON.parse` 數萬筆 tuple，**可能突破 10 ms CPU**！ | **緩解策略**：(1) 歷史分片改寫為單月 64 或 128 分片縮小單檔（如降到 ~15 KB/檔）；或 (2) 用 GitHub Actions 預先將常見卡歷史摘要放 KV；或 (3) 實測 `DecompressionStream` 原生 C++ 解壓在 Workers 的實際計費 CPU，若仍超 10 ms 則改細分片或僅用近 30 天 DB + 背景合併 |
| `POST /api/prices/reference`（`L1739`） | 代理回 Render | 搬上 Workers（第 2B 批）：驗證 JSON（上限 20 KB、100 筆 ID）後查 `price_snapshots` + `getTwdRates` | 純函式 `collection-valuation.mjs` | `1–2.5 ms` | 最多 5000 列快照計算，落在 10 ms 內 |
| `GET /api/exchange-rates`（`L244-279, 1662`） | 代理回 Render | 搬上 Workers（第 2B 批）：先查 Cache API / Supabase `exchange_rates`，過期才打 `open.er-api.com` 並寫回 Supabase | 無 Node API（全 Web `fetch`） | `< 0.5 ms` | 多節點同時過期可能重複打 `open.er-api.com`，可用 KV 緩存 24 小時＋寫保護 |
| `GET /api/pack-prizes`（`L1481-1514, 1658`） | 代理回 Render | 搬上 Workers（第 2C 批）：由 KV 提供 1 小時快取；冷更新透過 GitHub Actions / 專用刷新流程寫入 KV | `readFileSync` (`pack-prizes.json`)、`browseDatabaseCards` 多次查詢與排序 → 靜態 import JSON + KV 預存快照 | KV 讀取 `< 0.2 ms`；**現場重算需多次系列全量排序，必破 10 ms** | 必須由外部或分段排程預先算出放進 KV，不可讓使用者請求觸發冷運算 |
| `GET /api/series-hits`（`L1518-1527, 1659`） | 代理回 Render | 搬上 Workers（第 2C 批）：同 `pack-prizes`，必須預先計算存於 KV（每次建置需抓每個遊戲前 6 個系列×多版本各最多 30 張卡，最多數十次請求） | `AsyncLocalStorage` + 多次 `browseDatabaseSeriesCards` → 外部預運算寫入 KV，Worker 唯讀 KV | KV 讀取 `< 0.2 ms`；現場重算 `> 15 ms` + 恐破 50 subrequest | 同上，必走 KV 預產 |
| `GET /api/hot-cards`（`L1473-1478, 1660`） | 代理回 Render | 搬上 Workers（第 2B 批）：單次 RPC `card_hot_top` + Cache API / KV 1 小時快取 | `createBoundedSnapshotCache` → Cache API / KV | `< 0.5 ms` | 僅 12 筆列，CPU 極低 |
| `GET /api/price-movers`（`L1460-1471, 1661`） | 代理回 Render | 搬上 Workers（第 2B/2C 批）：呼叫 `price_movers` RPC + 匯率換算，**冷啟動資料庫需掃約 50 萬頁耗時 > 12 秒**，必須用 KV 長期快取（1 小時 TTL + stale 24 小時）並由排程暖機 | `createBoundedSnapshotCache` + `AbortSignal.timeout(25000)` → KV 快取＋外部 Cron 暖機（若 DB 需 > 20s 建議建資料庫物化視圖） | Worker 端解析 40 筆列僅 `< 0.5 ms` | Supabase 冷查詢超過 Workers subrequest 上限時需由外部排程寫 KV，以免訪客看到 502 |
| `GET /api/market-events`（`L1444-1458, 1657`） | 代理回 Render | 搬上 Workers（第 2B 批）：平行查主/副庫 `tcg_series`（limit 500）與 `MARKET_EVENTS` 合併，Cache API 快取 1 小時 | `AsyncLocalStorage`（`withDb`）→ 顯式傳 `'main'` / `'ip2'` | `1–2 ms` | 加上 1 小時 Cache API 後風險極低 |
| `GET /api/graded-prices`（`L1604-1608, 1626`） | 代理回 Render | 搬上 Workers（第 2B 批）：打 PokemonPriceTracker API；**注意每日免費上限 100 credit（限定 40 次/日）與 24 小時快取！** 不可只用 Worker 記憶體（會跨節點且頻繁重啟導致超扣額度），必須用 **Workers KV** 存日計數與結果（24h TTL） | 記憶體 `Map`（`createGradedPrices`）→ 改以 KV 儲存單卡快取與今日已用量計數（每日最多寫 KV ~40 次，遠低於 1,000/日上限） | `< 1 ms` | 若未同步寫 KV，多節點並行可能提前用完每日 100 credit；KV 一致性為最終一致（約 60 秒），極端併發可能多打 1–2 次，上限調保守為 `35` 次/日即可 |
| `GET /api/ebay-listings`（`L1610-1615, 1627`） | 代理回 Render | 搬上 Workers（第 2B 批）：eBay OAuth token（2 小時）與查詢結果（1 小時）存入 KV 或 Cache API，日限流計數存入 KV / Cache | `Buffer.from(...).toString('base64')`（`ebay-listings.mjs:79`）→ 改用 Web `btoa(`${clientId}:${clientSecret}`)` | `< 1 ms` | `btoa` 支援 ASCII clientId/secret；每日 KV 寫入需注意避免突破 1,000 次/日限制（若熱門，以 Cache API 快取查詢結果＋只在計數每 10 次或 KV 不超標時寫，或完全靠 Cache API `s-maxage=3600` 保護額度） |
| `GET /api/trends`（`L827-850, 1639-1645`） | 代理回 Render | 搬上 Workers（第 2A 批）：目前 `yuyutei` `metadataCollection==='denied'` 直接固定回傳 disabled 空陣列；若未來重新啟用改讀 KV | 暫無（`sourceDisplayDenied` 回固定 JSON） | `< 0.2 ms` | 幾乎零風險 |
| `GET /api/buyback-prices`（`L1646-1655`） | 代理回 Render | 搬上 Workers（第 2A 批）：目前 `yuyutei` 被拒直接回固定空陣列 | 同上 | `< 0.2 ms` | 幾乎零風險 |
| `GET /api/reports/meta` & `GET /api/reports`（`L1737, 1743`） | 代理回 Render | 搬上 Workers（第 2B 批）：驗證參數後查詢主庫 `reports` | 無 Node API | `1–2 ms` | 最多取 1000 筆算 `buildStats`，10 ms 內綽綽有餘 |

### 2.4 Google 認證、收藏雲端同步與管理端點

| 路由（`server.mjs` 位置） | 第 1 步 | 第 2/3 步做法 | 依賴的 Node API 與替代方案 | 預估 CPU | 風險與緩解策略 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/auth/config`（`L910-912, 1740`） | 代理回 Render | 搬上 Workers（第 2A 批）：檢查 `env.SUPABASE2_URL` 與 `env.SUPABASE2_ANON_KEY`，回傳 origin | 無 Node API | `< 0.1 ms` | 零風險 |
| `POST /api/auth/exchange`、`refresh`、`logout`（`L942-962, 1741`） | 代理回 Render | 搬上 Workers（第 2A 批）：代轉發副庫 `/auth/v1/token` 與 `/logout` | `readJsonBody`（Node stream）→ `request.text()` 限長度（10 KB）+ `JSON.parse` | `0.5–1 ms` | 需確保 CSP `connect-src 'self'` 不變，金鑰放 Workers Secrets |
| `POST /api/sync/pull`、`push`、`delete`（`L899-902, 926-941, 963-1029, 1742`） | 代理回 Render | 搬上 Workers（第 2A 批）：驗證 JWT / 同步碼雜湊後寫入副庫 `collection_sync`；`googleSyncKey` 快取改用 Cache API 或僅查副庫 `/auth/v1/user` | `node:crypto` (`createHash('sha256')`)、`Buffer.from(..., 'base64url')`、`collection-store.js`（瀏覽器 IIFE 掛 `globalThis`）→ `crypto.subtle.digest`、純 JS base64url 解碼、`collection-store.js` 依舊支援 `globalThis.CollectionStore` | 一般 `< 2 ms`；**極端萬筆 `push`（2 MB / 10,000 卡）驗證＋排序＋`JSON.stringify` 可能達 `8–15 ms`** | **中/高 CPU 風險**：單人推動 10,000 款滿載收藏時，迴圈 `normalizeSyncEntry` × 10,000 + `mergeSync` + 2 次 `JSON.stringify` 有機會碰觸 10 ms CPU！緩解：單次 `push` 若卡數極多需實測 CPU 耗時，必要時微調 `normalizeSyncEntry` 與去除重複 `JSON.stringify`（直接比對 `Encoder.encode(body).byteLength`） |
| `GET /api/admin/catalog/health`（`L1030-1042, 1637`） | 代理回 Render | 搬上 Workers（第 2C 批）：改為驗證 `SCRAPE_SECRET`（Web Crypto `timingSafeEqual` 或 `crypto.subtle.timingSafeEqual`）後查缺口明細 + 讀 KV 的 `coverage` 摘要 | `timingSafeEqual` + `loadCatalogHealth` → Cloudflare 支援 `crypto.subtle.timingSafeEqual`（須開 `nodejs_compat` 或直接比對兩組 SHA-256 Digest 逐位元組 XOR） | `1–3 ms` | 嚴禁未授權外洩管理密鑰 |
| `GET /api/admin/page-stats`（`L1638`） | 代理回 Render | 搬上 Workers（第 2D 批）：讀主庫 `page_stats_daily` 與 `card_hot_daily`（加上 KV / Durable Object 尚未 flush 的 pending 數） | `timingSafeEqual` | `< 1 ms` | 注意管理 token 不可放在 URL query |
| `GET/POST /api/admin/price-snapshot*`、`price-archive*`、`catalog/sync`、`catalog/cache-images`、`scrape/yuyutei`（`L1630, 1744, 1747-1752`） | 代理回 Render | **不可在 Worker 內長跑！**（單輪同步需數十秒至數十分鐘、20 MB JSON、上千次外站請求，完全不適合 Workers）。第 2E / 第 3 步改為：管理端點在 Worker 改以 `POST https://api.github.com/repos/.../dispatches` 觸發 GitHub Actions Workflow（或轉送至自架排程機／homelab），`GET` 狀態改查 Supabase `catalog_sync_runs` 表 | `setInterval`、長生命週期控制器、`node:zlib`（archive gzip）、`Buffer`、`node:fs` → **全數移至 GitHub Actions / Node CLI 執行** | Worker 僅代理觸發 dispatch 與讀狀態：`< 1 ms` | `yuyutei` 目前 `collectionEnabled: false` 本就回 409；其餘同步改由 GitHub Actions `workflow_dispatch` + `schedule` 觸發，保留 `catalog_sync_runs` 單一狀態事實來源 |

### 2.5 背景排程、開機預熱與統計機制

| 背景工作（`server.mjs` 位置） | 現行依賴的 Node API | 搬到 Workers 後的替代架構 | 預估資源與風險 |
| --- | --- | --- | --- |
| 開機預熱（`L1797-1802`） | 無伺服器請求的預熱函式、`setTimeout().unref()` | **由 GitHub Actions / Cloudflare Cron Trigger（每小時或每 30 分鐘）把重型快照寫入 Workers KV**；Workers 無「開機」概念，所有快取改為 KV + Cache API | KV 每日寫限 1,000 次：每小時更新 6 份鍵（catalog、health、products、pack-prizes、series-hits、price-movers）僅約 `144 次寫入/日`，安全無虞 |
| 每小時目錄同步、`refreshBrowseKeys`、`cacheYugiohImages`（`L1804-1806`） | 長駐 `setInterval`、20 MB JSON、Node `fetch` + `Buffer` | **GitHub Actions Scheduled Workflow**（每小時或每 6 小時跑 `node scripts/...` 呼叫 `syncCatalog`、`refreshBrowseKeys`、`cacheYugiohImages`） | GitHub Actions 公開或免費私有倉額度需注意；同步只在新資料或 >72 小時才重跑，單次約 1–5 分鐘 |
| 每日 `priceSnapshot` 與 `tcgapiPricing`（`L1788-1795`） | 長時每秒 1 次請求（一次完整跑數小時）、`setTimeout`、`AbortController`、`readFile` | **GitHub Actions 每日排程**（注意 GitHub Actions 單 job 6 小時上限；`priceSnapshot` 原有 `cursor` 斷點續跑機制，排程切為每日數段跑完或自架排程機接手） | 若改在自架電腦／homelab（如既有備份主機）執行最穩，無 GitHub 6 小時截斷風險 |
| 每日 `priceArchive` 封存（`L1791`） | `node:zlib` (`gzip`/`gunzip`)、`node:crypto`、`Buffer` | **GitHub Actions / homelab 每日腳本**執行 `runPriceArchive`（目前邏輯本就冪等且有 `catalog_sync_runs` 鎖防重） | 需設定 `SUPABASE_URL` 與 `SUPABASE_SERVICE_KEY` Secret |
| `pageStats` 與 `cardHot` 計數（`L294-296, 1785-1794`） | 記憶體 `Map`、`setInterval`、`SIGTERM` flush | **方案 A（推薦，純免費零額外元件）**：透過 Cloudflare `ctx.waitUntil()` 做記憶體小批次累積或改為每 `N` 次／固定隨機抽樣寫入；或用 **Cloudflare Cron Trigger（每 10 分鐘）**（但注意 Cron 與請求 Worker **不共享**同一個 Isolate 記憶體！因此不可依賴 Isolate 記憶體累積再給 Cron flush）。**最準確且免費方案**：(1) 以極簡 **Workers KV 或 Cloudflare Analytics Engine（免費層含 10 萬次/日寫入與 SQL API）** 記每日統計；或 (2) **保留現有 Supabase `page_stats_add` / `card_hot_add`**：用前端／Worker `ctx.waitUntil` 抽樣（例如每 10 次合併寫入）或改為 1 個 **Durable Object（免費方案自 2024 起已支援 SQLite-backed DO，免費層每日 100,000 請求與 400,000 GB-s）** 集中累計後每 10 分鐘寫回 Supabase！ | **陷阱提醒**：Isolate 隨時被回收且不保證觸發 `SIGTERM`，絕不可用全域變數 `Map` + `setInterval` 在 Workers 裡存未 flush 統計！必須用 **Durable Object（單一實例聚合每 10 分鐘 alarm flush 一次，極省成本）** 或 **Cloudflare Analytics Engine** 替代 |

---

## 3. 三步驟分階段搬遷、驗收與回滾方式

### 第 1 步：前端靜態資源 ＋ 無資料庫 SEO 頁上 Workers；`/api/*`、`/sitemap*`、需 DB SEO 頁代理回 Render（本階段目標，程式已備妥）
- **架構**：`cardseektcg.com` 流量進入 Cloudflare Worker：
  - `PUBLIC_STATIC` 靜態檔、`/`（首頁／遊戲頁／`?view=`）、`/robots.txt`、`/.well-known/security.txt`、`www.` 301 由 Worker + Static Assets 直接處理。
  - `/api/*`、`/sitemap.xml`、`/sitemaps/*`、有效 `/?card=<id>` 與 `/?series=<id>` 由 Worker 透明代理回 Render 原點（`ORIGIN_URL`，預設 `https://cardscope.onrender.com`），並夾帶 `x-origin-verify`（若設定）與保留 `cf-connecting-ip`。
- **驗收門檻**：
  1. 本機驗收：`node scripts/prepare-worker-assets.mjs` 成功複製公開資產且無任何敏感檔案；`npm run check` 與 `npm test`（含 `test/worker.test.mjs`）100% 通過。
  2. 預覽域（`*.workers.dev`）驗收：首頁、遊戲頁、CSS/JS/WebP、`/robots.txt`、`/.well-known/security.txt` 回 200 且標頭與 CSP 與 `server.mjs` 一致；存取 `/server.mjs`、`/.env`、`/data/catalog.json` 回 404；搜尋與開卡詳細頁經原點代理正常。
  3. 切換正式網域路由後實測：`https://cardseektcg.com/` 回應標頭帶 Worker 處理特徵、Render 流量監控明顯驟降（約 70–85% 以上靜態資源與首頁流量移出 Render）；`www.cardseektcg.com` 301 至 apex；`/?card=...` SEO head 與 `/sitemap.xml` 正常。
- **回滾方式（< 1 分鐘）**：
  - 於 Cloudflare Dashboard → Workers & Pages → `cardseek` → Triggers/Routes **停用或移除 `cardseektcg.com/*` 與 `www.cardseektcg.com/*` 路由**（並在 DNS 維持原 CNAME 指向 Render），所有流量立刻退回 Render 直連；若需要舊網域自動轉址再把 Render 的 `CANONICAL_REDIRECT` 設回 `true`。

### 第 2 步：API 逐支搬進 Workers（依風險由低到高分 5 批）
每批上線只需在 `worker/index.mjs` 增加對應路由處理（尚未列出的 `/api/*` 仍自動走現有代理分支回 Render），實作「逐支平滑切換」。

1. **第 2A 批（無狀態／輕量與關鍵止血流量）**：
   - 搬移：`/api/images/onepiece`（含 Cache API 24h 快取，最大化省下 Render 流量）、`HEAD /api/catalog/health`、`/api/providers`、`/api/catalog/sources`、`/api/catalog/sync-status`、`/api/trends`、`/api/buyback-prices`、`/api/auth/*`、`/api/sync/*`。
   - 先置準備：`normalize.mjs` 與 `search-query.mjs` 的 JSON 載入改為 ESM JSON import（`with { type: 'json' }`）；為 Worker 加入 `SUPABASE2_*`、`SUPABASE2_ANON_KEY` Secrets 與 `wrangler.toml` `nodejs_compat` 相容性設定（若需要）。
   - 驗收：航海王卡圖從 Workers Cache HIT、Google 登入與同步碼 pull/push/delete 通過 E2E 測試；`sync/push` 測試大筆資料確認 CPU < 10 ms。
   - 回滾：移除該批路由在 `worker/index.mjs` 的分支，重新 `wrangler deploy`（30 秒內退回代理 Render）。

2. **第 2B 批（核心讀 API ＋ 外部價格代理）**：
   - 搬移：`/api/cards`、`/api/search`、`/api/cards/:id`、`/api/cards/:id/market`、`/api/prices/reference`、`/api/exchange-rates`、`/api/market-events`、`/api/hot-cards`、`/api/price-movers`、`/api/reports/meta`、`/api/reports`、`/api/graded-prices`、`/api/ebay-listings`。
   - 先置準備：建立 Workers KV Namespace（快取 `graded-prices`、`ebay-listings` token/結果、`price-movers` 與預序列化 `seriesIndex`）；測試大系列 `/api/cards?series=...` 排序 CPU 是否超標，若逼近 10 ms 改由 SQL 端分頁或 KV 快取整系列。
   - 驗收：全站 7 大 IP 瀏覽／篩選／排序、固定 8 個搜尋驗收詞、詳情頁市場分頁、收藏估價全過，P95 延遲優於 Render（不冬眠）。
   - 回滾：同 2A，將有問題的單支路徑註解即刻退回代理 Render。

3. **第 2C 批（重型預產快照與 Sitemap）**：
   - 搬移：`/api/catalog`、`/api/products`、`/api/catalog/coverage`、`/api/catalog/health`、`/api/pack-prizes`、`/api/series-hits`、`/sitemap.xml`、`/sitemaps/*`。
   - 先置準備：新增 GitHub Actions（或擴充同步腳本）定時計算 `coverage`、`sitemap` XMLs、`pack-prizes`、`series-hits`、`catalog`、`products` 並推送至 Workers KV；Worker 端唯讀 KV（讀不到才有限度 fallback）。
   - 驗收：`?view=about`、`?view=market`、首頁「最新｜最夯｜最熱」、所有 sitemap XML 與真實資料庫一致且 Worker CPU < 2 ms。
   - 回滾：該批路由退回代理 Render。

4. **第 2D 批（需 DB 的 SEO 頁與頁面／熱門統計）**：
   - 搬移：`/?card=<id>`、`/?series=<id>`、`pageStats`、`cardHot`、`/api/admin/page-stats`、`/api/admin/catalog/health`。
   - 先置準備：建立免費版 SQLite-backed Durable Object 聚合 `pageStats` / `cardHot`（每 10 分鐘 Alarm 寫入 Supabase）並將 `/?card=` / `/?series=` SEO HTML 結果寫入 Cache API 10 分鐘。
   - 驗收：`curl` 驗證卡片／系列 SEO head、`noindex` 404 與 ETag 304；觀察 1 小時確認 `page_stats_daily` 與 `card_hot_daily` 正常累加。
   - 回滾：將 `shouldProxyToOrigin` 的 `'seo-db'` 重新打開、將統計停寫退回 Render。

5. **第 2E 批（歷史價格分片與背景排程外移）**：
   - 搬移：`/api/cards/:id/price-history`（壓測 `DecompressionStream` 讀多分片 CPU；若超過 10 ms 則同步將 `price-archive` 調整為更細分片或預先彙整）、`/api/admin/*`（改觸發 GitHub Actions `workflow_dispatch`）；並把 `syncCatalog`、`priceSnapshot`、`priceArchive`、`tcgapiPricing`、`cacheYugiohImages` 排程全部移到 GitHub Actions / homelab。
   - 驗收：連續 7 天觀察 GitHub Actions 排程穩定完成 `catalog_sync_runs` 與價格快照／封存，詳細頁價格走勢圖完整繪製近 180 天資料。
   - 回滾：重新啟用 Render 實例背景排程並切回 `/api/cards/:id/price-history` 代理。

### 第 3 步：停用 Render
- **切換條件**：第 2 步全數上線並觀察 **至少 48–72 小時**，Render Access Log 中只剩健康檢查（無任何使用者請求），且所有背景排程已在 GitHub Actions / homelab 成功完成一輪每日循環。
- **執行動作**：
  1. 自 `worker/index.mjs` 移除代理函式與 `ORIGIN_URL` 依賴（未定義路由一律直接 404）。
  2. 停用或刪除 `.github/workflows/keep-warm.yml`。
  3. 更新 UptimeRobot 兩個監控（804235519、804670677），確認指向 Cloudflare Workers 上的 `https://cardseektcg.com` 與 `/api/catalog/health`。
  4. 更新 `index.html` 隱私說明頁中「主機與網路服務（Render、Cloudflare）」字樣，改為實際使用的託管架構。
  5. 暫停（Suspend）Render 服務並觀察 7 天，確認無異常後再刪除 Render 服務。
- **回滾方式**：在 Render 未刪除前（Suspend 狀態），隨時可一鍵 Resume Render 服務並恢復第 1 步（或切回 Cloudflare DNS CNAME 直連 Render）。

---

## 4. 需要使用者親自執行的事項（切勿由代理擅自執行）

### 第 1 步上線前與上線時
1. **安裝依賴並登入 Wrangler**：
   - 在本機執行 `npm install`（安裝 `devDependencies` 中的 `wrangler`）。
   - 執行 `npx wrangler login`，在瀏覽器完成 Cloudflare 帳號 OAuth 授權登入。
2. **設定 Workers 秘密環境變數（如有啟用來源驗證）**：
   - 若 Render 目前有設 `ORIGIN_VERIFY_SECRET`，請執行：
     `npx wrangler secret put ORIGIN_VERIFY_SECRET`
     輸入與 Render **完全相同**的值（這樣經 Worker 代理時 Render 才會採信 `cf-connecting-ip` 做限流）。
   - 若 Render 原點網址非 `https://cardscope.onrender.com`，請在 Cloudflare Dashboard 或 `wrangler.toml` 調整 `ORIGIN_URL`。
3. **預覽部署與測試（不影響正式站）**：
   - 執行 `npx wrangler deploy` 先推上 `*.workers.dev` 預覽網域測試靜態資源、首頁、API 代理是否通暢（**注意：若 Render 還開著 `CANONICAL_REDIRECT=true`，預覽打代理一樣會收到 301！**）。
4. **關閉 Render 的舊網域強制轉址**：
   - 到 Render Dashboard → `cardscope` → Environment，將 `CANONICAL_REDIRECT` 由 `true` 改為 **`false`**（防止 Worker 代理時產生 301 迴圈；改由 Worker 負責 `www.` 轉 apex）。
5. **綁定正式網域路由**：
   - 在 `wrangler.toml` 取消註解 `routes`（或於 Cloudflare Dashboard → Workers → `cardseek` → Settings → Domains & Routes 新增 `cardseektcg.com/*` 與 `www.cardseektcg.com/*`），再執行 `npx wrangler deploy`。
   - 檢查 Cloudflare DNS 維持橘雲（Proxied）。
6. **調整防休眠排程（視需要）**：
   - 由於 `/robots.txt` 第 1 步改由 Worker 回應，`.github/workflows/keep-warm.yml` 將不再打到 Render；若希望 Render 仍在第 1–2 步期間維持喚醒，請確認是否要把該 workflow 改打有轉送至 Render 的輕量端點（例如 `HEAD /api/catalog/health`）。

### 第 2 步與第 3 步需要使用者做的事
- **第 2 步（依批次建立）**：
  - 於 Cloudflare 建立 Workers KV Namespace 並將 ID 填入 `wrangler.toml`。
  - 使用 `npx wrangler secret put` 依序設定：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`SUPABASE2_URL`、`SUPABASE2_SERVICE_KEY`、`SUPABASE2_ANON_KEY`、`SCRAPE_SECRET`、`EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`、`POKEMONPRICETRACKER_API_KEY`、`TCGAPI_KEY`。
  - 在 Cloudflare Security → WAF 設定免費方案 Rate Limiting Rule 保護 `/api/sync/*` 與 `/api/auth/*`。
  - 於 GitHub Repository Settings → Secrets 設定背景同步與快照工作流所需金鑰。
- **第 3 步（停用 Render）**：
  - 確認 UptimeRobot 與監控穩定、Render 零真實流量後，手動於 Render Dashboard Suspend / Delete 服務，並批准更新隱私說明頁文案。

## 第二意見審核修正（2026-11-23，gemini-4-neon-medium 審、Claude 核對）
- **已修（高）訪客 IP**：Render 也在 Cloudflare 後面，Worker 轉送的 `cf-connecting-ip` 會被改成 Worker 出口 IP，限流會變全站共用。改為 Worker 只在設了 `ORIGIN_VERIFY_SECRET` 時送 `x-client-ip`，`server.mjs` 驗過密鑰才採信。**上線第 1 步前 Render 與 Worker 都必須設同一個 `ORIGIN_VERIFY_SECRET`**，否則所有經 Worker 的訪客共用一組限流額度。
- **已修（中）代理逾時**：SEO 查庫 1.5 秒、其餘 30 秒，逾時降級為靜態首頁或 502。
- **已修（低）**`/sitemaps/*` 只代理 `pages|series|cards-N.xml`。
- **第 2 步前要處理（中）**：Worker 打包上限（免費 3 MiB 壓縮後）與啟動時間；大型 `data/*.json` 不要 import 進 bundle，改放 Static Assets 或 KV。
- **第 2 步前要處理（中）**：Cache API 在 `*.workers.dev` 預覽網域不生效，快取命中只能在正式網域驗證。
- **第 2D 步前要處理（中）**：pageStats／cardHot 若每次瀏覽都打 Durable Object，會吃每日請求額度；要先在 Worker 端批次合併或抽樣，並設超額降級。

## 第 2 步第一批（4f867db）審核與補強紀錄（2026-11-23）

### 1. 一致性與執行期修補摘要
- `MAIN_ONLY_PATH` 強制主庫路由修正：`resolveDb` 先比對主庫限定路徑，避免顯式 `db='ip2'` 繞過主庫強制路由。
- `buildBrowsePage`／系列 `precomputedFacets` 與無效系列字元一致性修正，確保分頁結果與輸入驗證行為對齊原點。
- `getCard` 冷熱 Isolate 一致性修補，統一單卡詳情在冷啟動與記憶體快取命中時的輸出結構。
- `catalog-health`、`market-events`、`card-market`、`hot-cards`、`price-movers` 遇降級或過期回應時禁止寫入 Edge Cache。
- 所有 SWR／TTL 背景更新（含快照刷新與 Edge Cache 寫入）改接 `ctx.waitUntil`，避免請求結束後背景任務遭中斷。
- Edge Cache Key 正規化，防止無關查詢參數或參數排序差異穿透邊緣快取。
- 整數 `limit` 解析邏輯統一，並修補 `buyback-prices` 原型鏈查表問題（避免特殊鍵名讀取內建屬性）。
- `onePieceImageTarget` 加固：限制網址長度、阻擋 `%2e/%2f/%5c/%00` 與反斜線／控制字元路徑遍歷，並清除 URL fragment（`hash`）。

### 2. 安全審核與 Worker 限流策略（雙層防護）
- **公開邊界安全檢核**：
  - 確認無 Supabase 金鑰外洩，PostgREST 錯誤細節與內部表名僅寫伺服器／Worker 日誌，不進公開 JSON 回應。
  - Service Key 僅存於伺服器環境變數或 Worker `env` Secrets；`MIGRATED_API` 僅讀取環境設定，無法被訪客查詢參數或標頭覆寫。
  - `/api/images/onepiece` 確認無 SSRF 風險：限定白名單主機與 `https:` 協定、禁止自訂埠與帳密、設定 `redirect: 'error'`、阻擋 `%2e/%2f/%5c/%00` 遍歷、檢查圖片 MIME 白名單並於串流超過 5 MB 時立即斷流。
- **第一層（全域主防線）**：Cloudflare 免費方案 WAF Rate Limiting Rule（免費 1 條規則、10 秒視窗）。第 2 步第一批先守護 `/api/*` 突發流量；待第 2A 後期搬遷 `/api/sync/*` 與 `/api/auth/*` 時，優先將免費規則移給寫入與認證端點防暴力嘗試。
- **第二層（已實作的 Isolate 防護）**：`worker/index.mjs` 內建 `createRateLimiter` 涵蓋 20 支已搬遷 API：
  - 嚴格只讀 `cf-connecting-ip`（**絕不信任 `X-Forwarded-For`**；無 `cf-connecting-ip` 時略過以相容無 CF 標頭的單元測試環境）。
  - 單 Isolate 限制 `maxKeys: 2000`、`windowMs: 60000`，預設門檻 `API_RATE_LIMIT_PER_MINUTE=240`、`/api/images/onepiece` 為 `IMAGE_RATE_LIMIT_PER_MINUTE=1200`。
  - 請求夾帶有效 `SCRAPE_SECRET`（`x-scrape-token` 或 `Authorization: Bearer`，以 Web Crypto SHA-256 固定時間 XOR 比對）時豁免限流；超額立即回 `429` 並帶 `Retry-After: 60`、`API_CSP`、`SECURITY_HEADERS`、`Cache-Control: no-store` 與 `Vary: Accept-Encoding`。
  - **跨節點說明**：此層為單 Isolate 記憶體計數，跨 PoP 或冷啟動後不共享；一般讀 API **不以 Workers KV**（免費每日 1,000 次寫入上限極易寫爆）或 **Durable Object**（免費每日 10 萬次請求配額應保留給高價值端點與統計聚合）作為全域計數器。

### 3. CPU（10 ms）與 Subrequest（50 次）風險實測與預設留代理建議

| 端點 | 實作優化摘要 | 冷啟動實測／風險評估 | 部署建議 |
| --- | --- | --- | --- |
| `/api/cards`（含 600 張卡大系列） | 移除 `browseCacheBytes` 重複 `JSON.stringify`、按 `region` 延遲快取 facets 與非價格排序切片、`rarityToken` 快取、`WORKER_SERIES_FALLBACK_MAX` 降為 `500`（確保備援 `< 50` subrequests） | 熱分頁 `< 1–2 ms`；冷啟動 600+ 張系列約 `6–9 ms`，仍貼近 10 ms 邊緣 | **可先開啟**；若線上觀測到 1102 CPU 超時再設 `MIGRATED_API="-cards"` 退回代理，長期改 SQL 分頁 RPC 或 KV |
| `/api/search` | 純符號／空查詢早退免載目錄、快取 `seriesById` 與本地卡正規化、`ip2` 逾時中止、零結果降級 subrequest 預算上限 30 | 冷啟動仍須執行 `loadCatalogShared()` 與 `buildSeriesIndex(1,200+ 系列)`（桌機實測僅 `buildSeriesIndex(1200)` 即達 **~20 ms**），極易超過免費 10 ms CPU | **第 2C 批將精簡 `seriesIndex` 存入 Workers KV 前，預設留代理** |
| `/api/catalog`、`/api/products` | 暖實例 `WeakMap` 預序列化 JSON、背景更新改接 `ctx.waitUntil` | 冷啟動須組裝 1,200+ 系列與 250 張卡，並執行 `canonicalizeCatalog` 與 ~1.5 MB JSON 序列化，逼近或超過 10 ms CPU | **第 2C 批 KV 預產快照到位前，預設留代理** |

- **部署設定建議**：第 2C 批 KV 預產快照到位前，建議於 `wrangler.toml`（或 Cloudflare Dashboard）設定 `MIGRATED_API = "all,-catalog,-products,-search"`（或 `"-catalog,-products,-search"`）；待第 2C 批 KV 快照完成後再切回全開。
