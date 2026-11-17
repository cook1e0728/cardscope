---
status: accepted
---

# ADR 0058：eBay 掛牌（官方 API）、鑑定卡成交（第三方彙整）、SNKRDUNK（只外連，等授權）的來源決定與顯示規則

**狀態：已採用（2026-11-18）。依據：使用者 2026-11-16 批准的 `docs/NEXT_PHASE_PLAN.md`（P0–P6）；P1／P2／P3／P4／P5 已上線，本 ADR 補記來源決定與顯示規則，並對齊 `data/source-registry.json`。**

## 背景

站上原本只有 Cardmarket、TCGplayer 的參考價，沒有「現在有人在賣多少」與「鑑定卡實際賣多少」，也沒有日本行情。三個來源的授權條件各不相同，所以分開決定，不混在同一個數字區：

- eBay Marketplace Insights（官方成交資料）不開放申請，拿不到；eBay Browse API（現售掛牌）可申請。
- 成交價目前唯一可用的是第三方 PokemonPriceTracker 彙整的 eBay／Fanatics 鑑定卡成交，來源不透明。
- SNKRDUNK 規約第 7 條禁止爬蟲與擷取，也沒有公開 API。

## 決定

### 一、eBay 現售掛牌價：官方 Browse API（`providers/ebay-listings.mjs`）

- **取得**：OAuth client_credentials；金鑰只放 Render 環境變數 `EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`，沒設時端點回 200 的空結果（`not-configured`），不報錯。市場 `EBAY_US`；分類 `183454`（單卡）；只取固定價（`buyingOptions:{FIXED_PRICE}`）。
- **查詢**：開卡時才查（`/api/ebay-listings`，受既有限流）。輸入全部白名單驗證（卡名、系列代號、卡號格式），不符回 400。查詢字串由英文名、（可選的）系列代號、卡號組成；目前前端只送英文名與卡號，沒有英文名或卡號格式不合（例如航海王 OP05-060）就不查。
- **對卡**：標題必須含卡號才算對到；有分母（025/165）時標題也要有分母，避免「PSA 10」之類的數字誤中卡號。對不到就不顯示。
- **鑑定卡標題**：標題含 PSA／BGS／CGC／SGC／TAG／ACE／CSG／ARS 加級別的刊登排除，掛牌區只留裸卡（鑑定卡另有成交區）。**只過濾，不重排。**
- **順序與數量**：照 eBay 回傳順序取前 5 筆，不依價格重排（eBay 顯示規定不准改排序）。伺服器最多回 10 筆，前端只顯示 5 筆，已過 `itemEndDate` 的不顯示。
- **快取與額度**：記憶體快取 1 小時（以查詢為鍵，最多 500 組）；每日最多 1,000 次實際查詢（台北時間換日）。計數與快取只在記憶體，Render 重啟會歸零，所以上限設得遠低於官方額度。不寫資料庫。eBay 的 API 授權文本當時回 403 讀不到，快取期限與保存條款無法確認，1 小時是刻意取短。
- **網址白名單**：商品連結只收 `https:` 且主機為 `ebay.com` 或其子網域；圖片只收 `https:` 且主機為 `ebayimg.com` 或其子網域。伺服器與前端各驗一次。外連 `target="_blank" rel="noopener noreferrer"`。標題、賣家、狀態是外部不可信字串，前端一律跳脫。CSP `img-src` 只加 `i.ebayimg.com`。
- **圖片**：刊登縮圖只在該筆刊登內顯示、連回該刊登，不存、不轉存、不放進卡圖資料表。`source-registry.json` 的 `imageDisplayPolicies.ebay` 為 `risk-accepted`（eBay API 授權文本當時讀不到、條款未能逐條確認，由使用者承擔風險隨刊登顯示；不是 `rehost-permitted`），`sources[].imagePolicy` 為 `remote-listing-only`，兩者對齊為「可隨刊登顯示縮圖、不可儲存」。
- **顯示**：區塊標題「eBay 現售掛牌價」，標明「現售掛牌，不是成交價；依 eBay 搜尋結果，不保證就是這張卡」；每筆有圖、完整標題、價格與運費分開、狀態、賣家、連到商品頁；頁尾有文字標示「eBay」與 eBay 使用者協議連結。官方 eBay 標誌圖檔尚未放（待使用者決定），目前只用文字。自成一區，不與其他來源的數字同列。無結果時寫明原因（沒有對得上的掛牌、今天次數已用完、目前沒有開放、暫時讀不到）。
- **不加入 eBay 分潤計畫**：連結不帶任何追蹤參數；有測試擋聯盟參數。
- **帳號刪除通知**：本站不存 eBay 使用者資料（賣家名稱只在記憶體快取 1 小時、不入庫），已提交豁免申請（此點由使用者辦理，程式碼無法驗證）。

### 二、鑑定卡成交價：第三方彙整（`providers/graded-prices.mjs`，PokemonPriceTracker v2）

- **性質**：PokemonPriceTracker 彙整的 eBay／Fanatics 鑑定卡成交紀錄。來源不透明（站方不揭露收集方式），所以標題固定為「eBay 鑑定卡成交價（第三方彙整，未驗證）」，**標題不能省略「鑑定卡」**：它只有 PSA／BGS／CGC／TAG／SGC／ACE 的成交，沒有裸卡成交價。
- **範圍與對卡**：只有寶可夢。英文版用唯一的 TCGplayer 編號；日版用唯一的「系列代號＋卡號」且回傳恰好一筆、系列與卡號都對得上；自由文字搜尋會配錯卡，不接受。台版、其他遊戲沒有查詢條件，區塊寫「目前沒有成交資料來源。」，不留白。
- **額度**：免費方案每天 100 credit、每張卡 2 credit，固定 `limit=1`；每日最多 40 次、記憶體快取 24 小時、不入庫。金鑰 `POKEMONPRICETRACKER_API_KEY` 只放 Render 環境變數。
- **授權限制**：該站條款（2026-08-19 版）的免費層限個人非商業（「不賺錢的免費應用」包含在內），不得轉售或再散布原始資料。因此本站在**非營利**前提下可用；任何營利計畫（見計畫書第 2 節第 3 點）之前必須改付費方案或移除此來源。
- **顯示**：和掛牌價上下相鄰，各自成區；級別、成交中位數、美元、筆數、最低～最高、最後成交日。不把成交價與掛牌價混在同一個數字。

### 三、SNKRDUNK：只外連，等書面授權

- **現況**：註冊為 `link-only`、`metadataCollection: permission-pending`、`collectionEnabled: false`、`runtimeProvider: null`。伺服器與腳本不對 snkrdunk.com 發任何請求，不收價格、圖片或文字；`test/snkrdunk-no-fetch.test.mjs` 掃描全部原始碼擋下，主機名稱只能出現在 `price-timeline.js` 組外連網址的那一處。
- **顯示**：詳細側板「到 SNKRDUNK 查看」，網址由瀏覽器端組成（`https://snkrdunk.com/search?keywords=` 加日文名優先、否則英文名，再加卡號；只有卡號、沒有名稱不組），開新分頁並帶 `rel="noopener noreferrer"`，旁邊說明本站沒有取得它的資料授權，不顯示價格。
- **授權**：詢問信草稿 `docs/research/price-sources/inquiries-20261116.md`，**尚未寄出**；寄出日與回覆補記在該檔。寄出前公開頁面不寫「已申請」。30 天沒回音或被拒就維持外連；同意授權另開一包做 provider，不在本 ADR 範圍。

### 四、「各平台價格」總覽（P5）

- 總覽上半只有 Cardmarket／TCGplayer 的參考價表（價格性質、原幣、更新日）。
- 下半「其他來源」只標有／沒有／查不到並跳到該區：eBay 現售掛牌、eBay 鑑定卡成交價（跳到各自的區塊）、SNKRDUNK（外連）。**eBay 的數字不抄進總覽表**，因為價格性質不同（現售掛牌、第三方成交、參考價）。

## Consequences

- `source-registry.json` 補登 `pokemonpricetracker`（`approved-api`，限免費層非營利條件），`ebay` 的兩個圖片政策欄位對齊；`publicSourcePolicies()` 因此多一個 runtime 來源。
- 三個來源各有每日與快取限制，用量計數都在記憶體；Render 重啟後 eBay 當日額度會歸零重算。
- 之後要營利、要放 eBay 官方標誌、要啟用 SNKRDUNK 資料，都要回頭改本 ADR 與 registry。撤回：從 Render 移除對應環境變數即停用（端點回空結果）；程式目前只看金鑰有沒有設，registry 的 `collectionEnabled` 不是開關，改它不會停掉這兩個端點。
- 已知待辦（不在本 ADR 範圍）：`providers/registry.mjs` 的 `ebay.refreshHours` 為 24、`server.mjs` 的 `providerStatus()` 沒有 eBay 與鑑定價列、SNKRDUNK 狀態文字寫「授權申請中」，與上述不完全一致。
