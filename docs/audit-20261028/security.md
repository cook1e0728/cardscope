# CardScope 資安盤點（2026-10-28，sonnet-worker，唯讀）

範圍與方法：程式碼審視（server.mjs、前端 *.js／index.html、sw.js、providers、scripts、.github、supabase/migrations）、正式庫唯讀 SELECT（`run-sql.mjs --read-only`）、對正式站的少量 GET（每個端點 1–3 次，沒有 POST、沒有壓測）。沒有讀 `.env.local`。已套用 mattpocock code-review 規則：本專案沒有成文的資安編碼標準，所以 Standards 軸只用 Fowler 氣味基準（見文末「code-review 規則套用」）；Spec 軸以 `docs/AUDIT_20261023.md` 與 ADR 0052 的「✅」聲明為規格。

上一輪已修且本次實測仍有效的項目（不重報）：靜態檔白名單（12 個路徑含 `/server.mjs`、`/.env.local`、`/assets/%2e%2e/…` 皆 404）、`/api/images/onepiece` 的 SSRF 防護、`/api/cards` offset 上限 200000。

## 一、發現（依嚴重度）

### 高

| 嚴重度 | 位置 | 現象與證據 | 建議修法 | 改動大小 |
|---|---|---|---|---|
| 高 | `server.mjs:1094-1099`（JustTCG 6 條路由）、`:1099`（eBay）、`:32-33`（`ebaySearchCache`／`justTcgCache`）、`:92-93`（providerStatus） | 這些「已停用」的端點在正式站仍然運作，而且無認證、無速率限制、不限 HTTP 方法。實測：`GET /api/providers/justtcg/games` 回 200（13 KB 的 JustTCG 資料），`GET /api/providers/ebay/search?q=pikachu` 回 200（真實 eBay 掛牌）。代表 Render 上 `JUSTTCG_API_KEY`、`EBAY_CLIENT_ID/SECRET` 都設了，任何人都能代打你的額度；`/api/providers` 卻回報 `justtcg.enabled:false`、`ebay.enabled:false`（硬編碼，與實況不符）。前端與 scripts 完全不呼叫這些路由（grep 無）。兩個快取 Map 沒有上限、鍵含使用者的 `q`，24 小時 TTL：送大量不同 `q` 就會無限成長，專案已有 10-15／10-16／10-21 三次 512 MB OOM 的前科。另外原樣轉出 JustTCG 回應也有授權疑慮（付費資料再散布）。我為了驗證各打了 1 次，已消耗 2 次第三方額度。 | 直接刪掉 6 條 JustTCG 路由與 1 條 eBay 路由（含 `justTcg()`、`searchEbay()`、`getEbayToken()`、兩個 Map），並請使用者在 Render 移除 `JUSTTCG_API_KEY`、`EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET` 環境變數（符合「不額外花錢」）。若要保留，至少加 `adminAuthorized`、快取加上限。 | 小 |
| 高 | `server.mjs:1145`（POST /api/reports）、`:997-999`（`clientIp`／`isRateLimited`／`readJsonBody`／`validateReport`） | 無認證的寫入端點。四個問題疊加：(1) 速率限制鍵是 `x-forwarded-for` 的**第一段**（`clientIp`，行 997），那是用戶端可自行填的值，每換一個假 IP 就有 5 次／小時，等於沒有限制（程式碼推論；依 Cloudflare 與 Render 會把真實 IP 附加在後面的行為判定，我沒有送 POST 實測）。(2) `validateReport` 對 `cardId`、`game` 完全不限長度、不檢查格式，只受 10 KB 本文限制（行 998），資料表也沒有任何 CHECK（`pg_constraint` 只有主鍵；`information_schema` 顯示欄位都是無長度的 `text`）。(3) 正式庫目前 **455 MB**（`pg_database_size`）；若仍是 Supabase 免費方案 500 MB 上限，只剩約 45 MB，約 4,500 次 10 KB 的偽造回報就能把資料庫推到唯讀，整站停擺。(4) `reportRateLimit` Map 永不清除舊鍵（行 996），偽造 IP 會讓它無限長大。前端沒有任何地方送出回報（`ui-enhancements.js:511` 只讀 `GET /api/reports`，grep 無 POST 表單），表裡只有 1 筆 8 月的資料。公開的 GET 又會原樣回傳使用者寫的 `cardName`、`note`，等於一個可被塗鴉的公開 JSON。 | 最省事：刪掉 POST 路由（前端沒用），GET 保留或一併刪。若要保留寫入：改用 `cf-connecting-ip`／最右邊可信的一段、對 `cardId`／`game` 加白名單與 ≤128 字、DB 加 CHECK（長度、`status` 列舉）、`reportRateLimit` 加定期清掃與上限、整體每日寫入上限。 | 小（刪除）／中（保留並加固） |

### 中

| 嚴重度 | 位置 | 現象與證據 | 建議修法 | 改動大小 |
|---|---|---|---|---|
| 中 | 全站（`server.mjs:64` `SECURITY_HEADERS` 只有 4 個）、`index.html` | 沒有 CSP（上一輪已知）。實測 `/` 的回應標頭沒有 `content-security-policy`、`permissions-policy`、COOP、CORP。我另外核實了可行性：`index.html` 有 4 個 inline `<script>`、13 處 inline 事件屬性（`onclick` 7＋`onerror`/`onload` 6，分布在 index.html、ui-enhancements.js、series-band.js、series-navigator.js）、少量 inline `style`；外部資源只有 Google Fonts。正式庫圖片主機（`tcg_printings`／`card_images`／`tcg_products`／`tcg_series` 的 image_url 去重）：`www.pokemon-card.com`、`asia.pokemon-card.com`、`images.pokemontcg.io`、`ubiaftrvmywwmifqzmik.supabase.co`、`asia-en.onepiece-cardgame.com`、`asia-tc.onepiece-cardgame.com`、`assets.tcgdex.net`、`images.ygoprodeck.com`、`images.scrydex.com`、`ws-tcg.com`、`www.takaratomy.co.jp`（全部是 https，沒有非 http 的 URL）。 | 先上 `Content-Security-Policy-Report-Only`，草案：`default-src 'self'; script-src 'self' 'nonce-…'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://www.pokemon-card.com https://asia.pokemon-card.com https://images.pokemontcg.io https://*.supabase.co https://*.onepiece-cardgame.com https://assets.tcgdex.net https://images.ygoprodeck.com https://images.scrydex.com https://ws-tcg.com https://www.takaratomy.co.jp; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`。第一階段保留 `script-src-attr 'unsafe-inline'`，這樣不用改那 13 個 inline 屬性；日後把 inline 屬性改成事件委派後再拿掉。伺服器回 index.html 時逐次產生 nonce（本來就要改寫 SEO head，成本低）。 | 中 |
| 中 | `server.mjs:1029`（`serveSeoIndex` 的 `send`）、`:1048`（sitemap `xml`）、`:1157`（robots）、`:88`（圖片代理只有 nosniff） | 上一輪標 ✅ 的「安全標頭」不完整：實測 `GET /?card=pokemon-pokemontcg-base1-58`（200）與 `GET /?series=zzz`（404）**完全沒有** `x-frame-options`、`x-content-type-options`、`strict-transport-security`、`referrer-policy`（`send` 只送 Content-Type）；`/robots.txt` 也沒有。正是被分享、被搜尋引擎抓的卡片頁最容易被內嵌（clickjacking）。 | `send`、`xml`、robots 一律展開 `...SECURITY_HEADERS`；抽一個共用的 `writeHeadSecure(res,status,headers)` 取代各處手寫。 | 小 |
| 中 | `server.mjs:1104`（`/api/search` 的 offset）、`:1100`（`/api/cards` 的 rarity／offset）、`:396-407`（`withBrowseHeavySlot`）、整站無速率限制 | 昂貴查詢可被放大。實測：(1) `/api/search?q=pikachu&offset=99999999999&limit=5` 被接受，echo 回 `offset:99999999999`，耗時 3.58 s，同一個詞正常請求 0.81 s（超出 int 範圍讓 ranked RPC 失敗後退到較重的備援路徑）；`offset` 是快取鍵的一部分，所以每個不同 offset 都不命中快取，也會把 200 筆的搜尋快取洗掉。上一輪的 offset 上限只加在 `/api/cards`（實測被截成 200000），`/api/search` 沒有。(2) `/api/cards?game=pokemon&rarity=zzqq1&offset=123457&limit=1` 第一次 9.9 s（第二次快取 0.5 s）：`rarity` 沒有對照白名單，任何新字串＋新 offset 都是新的快取鍵，每個都會做一次資料庫掃描，並占用 2 個重查詢名額（`BROWSE_HEAVY_MAX=2`、佇列 24）；攻擊者用不同 offset 就能讓所有人的篩選頁回 503 `BROWSE_BUSY`。(3) `POST /api/prices/reference` 每次一個最多 5000 列的查詢，不快取。全站沒有任何每 IP 限速。 | (1) `/api/search` offset 上限（例如 5000，超過直接回空頁）。(2) `rarity` 先比對 `loadBrowseRarityMap` 的已知 token，未知直接回空頁；filtered 路徑 offset 上限（例如 20000）。(3) 加一個小的 per-IP token bucket（每分鐘 120 次，Map 加清掃）。Render 前面是 Cloudflare，也可以在 Cloudflare 免費方案設 rate limiting 規則（不用改程式，使用者操作）。 | 小（上限）／中（限速） |
| 中 | `server.mjs:1091-1093`、`:173-174`、`providers/ygoprodeck.mjs:2,12-17` | 三個前端不用的公開端點（`/api/card-identities`、`/api/providers/ygoprodeck/search`、`/api/search/external`）`q` 沒有長度上限（實測 3000 字元的 `q` 被接受並整串 echo 在 `resolvedQuery`，耗時 1.96 s）。每個不同的 `q` 會：外呼 YGOPRODeck（`ygoprodeck.mjs` 的 `cache` Map 無上限、鍵含整個 q，24 小時）；若沒命中再抓一次航海王官網整頁 cardlist（`searchOnePieceOfficial`，無快取，再用多個 `[\s\S]*?` 的大 regex 掃整份 HTML，阻塞事件迴圈）。後果：記憶體成長、YGOPRODeck 的限流（20 req/s）把 Render 的出口 IP 封掉後，整點的遊戲王同步也會失敗、對航海王官網造成不禮貌的流量。 | 刪掉這三條路由（`grep` 證實前端、scripts 都沒用；`docs/HANDOFF.md:630` 只是歷史說明）。若保留：`q` 限 100 字、`cache` 加上限（LRU 200）、航海王 cardlist 加 10 分鐘快取。 | 小 |
| 中 | `server.mjs:1063,1077,1087,1089,1092,1094-1098,1148`（`json(res,502,{error:e.message})`）、`supabaseFetch`（行 103-109）的錯誤字串、`/api/catalog` 的 `meta.fallbackReason`、`/api/cards/:id/market` 的 `sources[].error` | 公開端點把 `e.message` 直接回給用戶端。`supabaseFetch` 的錯誤是 `SUPABASE_<狀態>:<PostgREST 回應前 200 字>`（行 103-109），會洩漏資料表／欄位／函式名稱與提示。共 13 處直接回傳，另有 3 處以欄位形式回傳。（上一輪只修了未預期例外的泛化訊息，行 1166-1170 正確。）本次沒有刻意製造後端錯誤，所以是程式碼證據，沒有實測洩漏樣本。 | 一個 `publicError(res,status,e)`：日誌記完整錯誤，回應只給固定中文訊息；`fallbackReason`、`sources[].error` 改成錯誤代碼（如 `UPSTREAM_UNAVAILABLE`）。 | 小 |
| 中 | `scripts/preview-proxy.mjs:14-30` | 開發用預覽代理 `listen(port)` 綁在所有網卡，而且沒有白名單：`join(root, pathname)` 只擋 `..`，`GET /.env.local` 會把 `SUPABASE_ACCESS_TOKEN` 送出去（`/.git/config`、`/server.mjs`、`/docs/*` 也是）。只有在有人執行 `node scripts/preview-proxy.mjs` 期間、且同網段有人連得到才成立（咖啡廳 Wi-Fi、共用網路）。我只讀程式碼，沒有啟動它。 | `listen(port,'127.0.0.1')`，並沿用正式站的 `PUBLIC_STATIC` 白名單（把正則抽成共用檔）。 | 小 |

### 低

| 嚴重度 | 位置 | 現象與證據 | 建議修法 | 改動大小 |
|---|---|---|---|---|
| 低 | `server.mjs:1156`（jp-prices）、`:944`（`yuyuteiMarket`）的 `esc` | 用反斜線跳脫 `\%_*(),.`，但 PostgREST 的 `or=()`／`eq.` 值不認反斜線（只認雙引號包裹）。實測 `GET /api/jp-prices?cardName=a,b` 回 502「查詢失敗」；`cardName=a,card_name.neq.zzz` 也是 502，表示現況**無法**注入額外條件（因為句點也被一併跳脫成 `\.`，構不成 `欄位.運算子.值`），但是個脆弱模式；功能面：含逗號、括號、句點的卡名（例如 `Mr. Mime`、`Dark Magician, …`）會失敗，`yuyuteiMarket` 的卡號含 `.`、`_`、`*` 時會因被加反斜線而查不到。`/api/jp-prices` 前端沒用。 | 刪 `/api/jp-prices`；`yuyuteiMarket` 改成「值用雙引號包起來、值中的 `"` 與 `\` 拒絕或移除」（沿用 `collection-valuation.mjs:15` 的做法）。 | 小 |
| 低 | `server.mjs` 多處 `"${String(id).replaceAll('"','')}"`（行 301、377、797、891、897、899、915、920、936、937、981，共 11 處）、`:933`（`replace(/[(),]/g,'')`） | PostgREST `in.()` 的引號清單做法重複 11 次且不一致：只拿掉 `"` 沒處理 `\`（結尾 `\` 會吃掉收尾的引號，造成整個過濾語法錯亂）。這些 id 目前都來自資料庫或已先驗證為真實卡片（價格走勢先 `getCard`），正式庫 77,366 張卡、1,401 個系列、3,316 個商品的 id 都不含 `' " \ < > & `` ` `` 字元（實測），所以現在無法利用。對比 `collection-valuation.mjs:15` 的 `validateReferenceRequest` 是正確的信任邊界寫法（拒絕 `"`、`\`、控制字元）。 | 一個 `pgInList(ids)` 共用函式（驗證後才包引號），十一處改呼叫它。 | 小 |
| 低 | `index.html:83,66`（`onclick="openCard('${e(c.id)}')"`、`openProduct('${e(s.id)}')`） | `e()` 把 `'` 轉成 `&#39;`，HTML 解析屬性值時會還原成 `'`，進到 inline JS 就是字串逸出：id 若含 `'`，`openCard('x');alert(1);//` 會執行。正式庫 id 沒有特殊字元（上列實測），所以目前不可利用，但 id 來自第三方匯入（Pokémon TCG、YGOPRODeck…），供應鏈上游若出現就是 DOM XSS。同樣模式也擋住嚴格 CSP。 | 改成 `data-card-open="${e(id)}"` 加事件委派（`ui-enhancements.js:185` 已經是這個寫法，`cards()` 模板沒統一）。 | 小 |
| 低 | `index.html:173`（`p.sourceUrl`）、`:247`（`tcgdex.sourceUrl`）、`series-navigator.js:19`（`row.cardUrl`） | 三處 `href` 沒檢查 scheme（`ui-enhancements.js:482` 有檢查 `^https://`）。正式庫相關欄位（printings／products／card_images／jp_buyback）非 http 的筆數都是 0。 | 共用 `safeHttpUrl()`，不是 http(s) 就不輸出連結。 | 小 |
| 低 | `server.mjs:668-672`（`adminAuthorized`） | 用 `===` 比對 `SCRAPE_SECRET`，不是定時比較；管理路由沒有嘗試次數限制。`/api/providers` 還公開 `yuyutei.enabled`（等於是否設了 SCRAPE_SECRET）。 | `crypto.timingSafeEqual`（先比長度）＋ per-IP 失敗限速；確認 SCRAPE_SECRET 至少 32 字元隨機。 | 小 |
| 低 | `server.mjs:70-90`（圖片代理） | 主機、協定、路徑前綴、副檔名都限制了，`redirect:'error'`、5 MB 上限，SSRF 防護實測有效（內網 IP、`.evil.com` 後綴、`../` 都 400）。剩餘：`Content-Type` 只檢查 `startsWith('image/')`，上游若回 `image/svg+xml` 會以同源送出；可附任意查詢字串繞過 `Cache-Control: public, max-age=86400`，無每 IP 限制，是上游官網的免費頻寬代理。 | 白名單 `image/jpeg|png|webp`；只轉送指定的查詢參數；跟全站限速一起處理。 | 小 |
| 低 | `.github/workflows/beta-reliability.yml` | 沒有 `permissions:` 區塊（預設 GITHUB_TOKEN 權限可能偏寬）、actions 用 tag 沒釘 SHA、CI 內 `npm install --no-save playwright` 未釘版本。觸發只有 `pull_request`（不是 `pull_request_target`），沒有用到 secrets。 | 加 `permissions: {contents: read}`；playwright 釘版本；actions 釘 commit SHA（可選）。 | 小 |
| 低 | `server.mjs:997`（`hashIp`） | `reporter_hash` 是未加鹽、截成 64 位元的 SHA-256(IP)。IPv4 空間只有 2^32，可離線窮舉還原。此欄位不在 `PUBLIC_SELECT`，不會對外，只有資料庫內部可見。 | 加伺服器端隨機鹽（環境變數），或根本不存。若上面的 POST 路由刪除就一併免了。 | 小 |
| 低 | 正式庫 grants（見第二節） | `anon`／`authenticated` 對 17 張表有完整表權限（含 `TRUNCATE`、`DELETE`），只靠 RLS（全部開啟、**0 條 policy**）擋住；PostgREST 不暴露 TRUNCATE，所以目前安全。另外 `reports` 資料表的 DDL 不在 `supabase/migrations/`（grep 無 CREATE TABLE reports），RLS 狀態只能從正式庫確認（rls=true），無法審查來源。伺服器全部走 `service_role`（行 103-109），包含純公開讀取：一旦出現注入，等同整庫權限。 | 一個新 migration：`revoke all on all tables in schema public from anon, authenticated` ＋ `alter default privileges … revoke`；把 reports DDL 補回 migrations。長期可為公開讀取另建唯讀角色（大改，非必要）。 | 小（revoke）／大（唯讀角色） |
| 低 | `sw.js:6,22-24` | 所有導覽請求共用 `/` 這個快取鍵，包括 SEO 改寫後的 `/?card=…` HTML：離線時可能看到別張卡的 `<title>`／canonical。不快取 `/api/*`、不快取第三方圖片、範圍僅限靜態外殼，符合設計。 | 導覽只在 `url.search===''` 時才寫入快取。 | 小 |
| 低 | 全站標頭 | HSTS 沒有 `includeSubDomains`／`preload`；沒有 `Permissions-Policy`、COOP、CORP。CORS：沒有 `Access-Control-*`（帶 `Origin: https://evil.example` 實測無任何 ACAO 標頭，OPTIONS 回 404），等於只允許同源，這是對的。 | `SECURITY_HEADERS` 補 `Permissions-Policy: camera=(), microphone=(), geolocation=()`、`Cross-Origin-Opener-Policy: same-origin`。 | 小 |
| 低 | `server.mjs:1148`、`/api/providers` | `/api/catalog/sync-status` 公開回傳同步作業的 `error` 與 `metadata`；`/api/providers` 公開 `reportsDb.enabled`、`yuyutei.enabled`。目前資料內容無敏感值（實測 `error:null`），但同步失敗時 `error` 會是原始錯誤字串。 | 去掉 `error` 欄位或泛化。 | 小 |

## 二、資料庫權限實測（正式庫，全部唯讀）

- Public schema 業務函式 39 個（已排除 pg_trgm 擴充附帶的函式）：`anon`、`authenticated` 對**所有業務函式**都沒有 EXECUTE（僅 `tcg_search_fold`、`tcg_search_bigrams` 兩個純 IMMUTABLE 輔助函式開放，無副作用）；`service_role` 皆可執行。
- SECURITY DEFINER 函式 5 個（`browse_note_card_change`、`browse_note_printing_change`、`browse_refresh_keys`、`browse_refresh_keys_build`、`browse_refresh_keys_publish`）全部 `search_path=""`、`anon`／`authenticated` 不可執行。其他函式為 SECURITY INVOKER，且 `search_path` 為空或 `public`（`catalog_health_snapshot*`、`price_snapshots_archive*` 為 `public`，且 anon 不可執行，風險低）。
- `public`（27 個關聯，含 1 個無 anon 權限的檢視）與 `private`（audit 表）的所有資料表 RLS 皆開啟（`tables_without_rls`=0）、`pg_policies` 0 條（含 storage）→ 預設拒絕。`private` schema 對 anon／authenticated 無 USAGE。
- Storage：`card-images` 公開讀（`file_size_limit` 600000、MIME 僅 jpeg／png／webp、14,555 個物件 383 MB，沒有任何寫入 policy，匿名無法上傳）；`price-archive` 為私有。
- 目前資料庫大小 455 MB（`reports` 48 kB）。

## 三、已檢查、沒問題

- 路徑穿越／靜態檔：白名單正則加 `startsWith(root)`；實測 `/server.mjs`、`/package.json`、`/.env.local`、`/docs/…`、`/providers/…`、`/supabase/…`、`/.git/config`、`/assets/../server.mjs`、`/assets/%2e%2e/…`、`/assets/..%5c…` 全部 404／400。`.env.local` 在 `.gitignore`，`git log --all` 沒有它的歷史。
- SSRF：唯一的出站使用者可控 URL 是 `/api/images/onepiece`，主機白名單＋https＋路徑前綴＋副檔名＋`redirect:'error'`；實測內網 IP、`.evil.com` 後綴主機、`../` 都 400。其他外呼的主機都是寫死的（YGOPRODeck、TCGdex、ExchangeRate-API、航海王官網、遊々亭）；遊々亭抓取路由要 `adminAuthorized` 且網址限 `https://yuyu-tei.jp/buy/` 前綴。
- 開放重導：伺服器不產生任何 `Location` 標頭、前端沒有以資料賦值 `location`。
- PostgREST／RPC 注入（使用者可控參數）：`/api/search` 經 `postgrestLike`（剝除 `\ % _ * ( ) , .`）才組 `ilike.*term*` 與 `or=()`；RPC 一律走 JSON body；`game` 用 `[^a-z0-9-]` 清洗並比對 `CATALOG_GAME_IDS`，series 用 `[^a-z0-9:_-]`；其餘過濾都經 `URLSearchParams` 編碼；`/api/prices/reference` 的 `validateReferenceRequest` 是標準的信任邊界驗證（筆數 ≤100、長度 ≤128、拒絕 `"`、`\`、控制字元、拒絕多餘欄位、本文 ≤20 KB）。`/api/reports` GET 的 `cardName`／`cardId`／`game` 是放在獨立的查詢參數值（不是 `or=()`），實測 `cardId=x'")(,` 回正常空結果。
- ReDoS：搜尋字串先截 100 字再進正則；`search-query.mjs` 的稀有度正則由靜態資料產生並跳脫；`cardNumberTerms`、`anniversaryTerms`、`foldSearch` 都是線性。（唯一的大型 lazy regex 是 `searchOnePieceOfficial`，已列在中等項目。）
- 前端 XSS：用 `scan.mjs`（只讀掃描，放在 scratchpad）列出 `index.html` 171 處＋其他 7 支 JS 的所有 `${…}` 插值，逐一檢視未包 `e()`／`esc()` 者：剩下的都是數字（`toLocaleString`）、常數、已跳脫函式的輸出或 `textContent` 賦值。`data-fallbacks` 是 `e(JSON.stringify(...))` 屬性，由 `dataset` 讀回後 `JSON.parse`，只當網址賦給 `img.src`，不會被當程式執行。URL 參數（`q`、`rarity`、`region`、`game`、`card`、`series`、`view`）寫回畫面時都走 `textContent` 或 `e()`；沒有 `eval`、`new Function`、`document.write`、`insertAdjacentHTML`、`setTimeout(字串)`。收藏匯入（JSON／CSV）有嚴格驗證（整數數量、id 長度與控制字元、2 MB／10,000 筆上限）。SEO 注入（`providers/seo.mjs`）所有 head／noscript 值都 `escapeHtml`，JSON-LD 另外跳脫 `< > &` 與 U+2028／2029。
- 金鑰與權限：repo（工作樹與 586 個 commit 的歷史）以 JWT／`sb_secret_`／`sbp_`／私鑰／常見金鑰格式 regex 掃描無命中；`SUPABASE_SERVICE_KEY` 只出現在 `server.mjs`、`providers/image-cache.mjs`、`providers/price-archive.mjs`、scripts，前端檔案完全沒有 Supabase URL 或金鑰字串（只有 `supabase-current-rows` 這個資料來源標籤）。
- CORS：無 `Access-Control-*`，同源限定。快取：目錄類 `public, max-age=60, stale-while-revalidate=300`、其餘 API `no-store`；沒有使用者私人資料會被快取（收藏只存在瀏覽器 localStorage，`/api/prices/reference` 為 POST 且 `no-store`）。
- 壞 `%` 編碼：`/api/cards/%E0%A4%A`、`/%E0%A4%A` 在邊緣（Cloudflare）回 520 而不是 400，但實測前後 `/api/catalog/health` 的記憶體快取時間戳連續（lastSuccessAt 07:35→07:40，期間未重置），表示程序沒有重啟；`handleRequest` 外層的 `.catch` 與 `URIError`→400 在程式碼上正確（行 1166-1170）。520 看起來是邊緣先拒絕了這種網址，影響只是狀態碼不同，不是崩潰。
- 相依套件：`package.json` 沒有 `dependencies`／`devDependencies`（零第三方套件），也沒有 `package-lock.json`，所以 `npm audit --omit=dev` 回 `ENOLOCK`、沒有可稽核的內容（出現相依漏洞的面積為零）。唯一的外部安裝是 CI 的 playwright（見低項目）。
- 錯誤處理：未預期例外回固定訊息「伺服器暫時發生錯誤」，不含堆疊（行 1166-1170）。

## 四、未能驗證／需要 lead 決定

1. `POST /api/reports` 的 XFF 繞過沒有實測（任務規定不可嘗試寫入）。若要確認，可由使用者同意後送一次**驗證失敗**的 POST（例如缺少 `platform`，回 400、不寫入）觀察不同 `X-Forwarded-For` 是否各自計數；但第一個請求就會消耗速率額度，這個結果不影響「建議直接刪除」的結論。
2. 不確定 Supabase 專案是否是免費方案（500 MB 上限）；455 MB 這個數字是 `pg_database_size`，請使用者從 Supabase 儀表板確認方案與已用量。
3. 沒有讀 Render 的環境變數（不碰金鑰）。JustTCG／eBay 金鑰是否存在，是從端點實際回 200 推得。
4. 沒有實測 Supabase Data API 以 anon key 的行為（我沒有 anon key，也不應取得）；結論來自 `pg_policies`（0 條）、`relrowsecurity`、`information_schema.role_table_grants` 的目錄查詢。
5. CSP 草案尚未在瀏覽器驗證，建議先 Report-Only。

## 五、建議的修法順序（給 lead 排封包）

1. 封包 A（小，一個 PR）：刪除 JustTCG／eBay／ygoprodeck-search／search-external／card-identities／jp-prices／portfolio／reports POST 這批前端不用的路由，並請使用者移除 Render 上多餘的第三方金鑰。這一個動作消除高×2、中×1、低×2。
2. 封包 B（小）：`SECURITY_HEADERS` 套用到所有回應（SEO 頁、sitemap、robots、圖片代理）＋補 Permissions-Policy／COOP；`publicError` 統一泛化錯誤；`/api/search` offset 上限、`rarity` 白名單。
3. 封包 C（中）：per-IP 限速（或 Cloudflare 規則）、CSP Report-Only → 強制、`onclick` 模板改事件委派。
4. 封包 D（小）：migration revoke anon／authenticated 表權限、補 reports DDL；preview-proxy 綁 127.0.0.1＋白名單；CI `permissions`。

## 六、code-review 規則套用（兩軸，不合併排名）

**Standards 軸**（repo 沒有成文資安標準，只有 Fowler 氣味基準，皆為判斷性）：
- Duplicated Code／Shotgun Surgery：PostgREST `in.()` 引號清單的清洗寫了 11 次且不一致（上表低項目），三種跳脫策略並存（`postgrestLike` 剝除、`esc` 反斜線、`replaceAll('"','')`），應收斂成一個 `pgInList`／`pgLike`。同樣 `adminAuthorized`＋401 的樣板重複 9 次。
- Speculative Generality／死碼：一批前端不用的公開路由（上表），是這次最大的攻擊面來源。
- Divergent Change：`server.mjs` 1196 行同時放路由、快取、DB 查詢、驗證與安全標頭，標頭沒套到所有回應就是這個結構造成的。
- Mysterious Name：前端的 `e`、`G`、`rn` 單字母全域函式（安全相關的 `e` 與其他資料函式同名風格，難以 grep 稽核）。

**Spec 軸**（對照 `docs/AUDIT_20261023.md` 的「✅」聲明）：
- 「安全標頭 ✅」：部分達成——標頭只套在 `json()` 與靜態檔，SEO 頁、sitemap、robots、圖片代理沒有（中）。
- 「搜尋字數、`/api/cards` offset 無上限 ✅ 100 字、200,000」：`/api/cards` 實測成立；`/api/search` 的 offset 仍無上限（中）。
- 「壞 `%` 編碼崩潰 ✅」：程序沒有崩潰，但邊緣回 520 而非報告寫的 400（低、狀態碼差異）。
- 「靜態檔白名單 ✅」：實測成立。
