# 價格來源盤點：全球／英語圈 API 與資料服務

調查日期：2026-10-11（以下「實測」皆為當日對公開端點的唯讀請求）
範圍：主方案第 6 階段（市場資料與趨勢）的候選價格來源。只做調查，未改程式、未啟用任何來源、未建立帳號或申請金鑰。
判讀原則依 `docs/PRODUCT_PLAN.md`：`listing`、`buyback`、`sale` 分開；`market` 只代表平台參考價；沒有可靠資料就不顯示。

## 一、現況盤點（本專案程式）

- **pokemontcg 同步沒有「拿到卻丟掉」價格。** `providers/catalog-sync.mjs` 第 235 行只向 `api.pokemontcg.io/v2/sets` 取系列清單；卡片資料來自 GitHub 靜態檔 `PokemonTCG/pokemon-tcg-data/cards/en/{set}.json`（第 243 行）。實測 `base1`、`sv3pt5`、`swsh12` 三份靜態檔，`tcgplayer`／`cardmarket` 出現次數皆為 0，所以靜態資料根本沒有價格欄位；價格只存在於 live API（`api.pokemontcg.io/v2/cards`）。
- **副作用：** 目前系列同步仍呼叫已宣告停用的 live API（見下方 pokemontcg 小節），這是與價格無關的既有依賴風險。
- **YGOPRODeck：** `providers/ygoprodeck.mjs` 已讀 `card_prices[0]` 的五個平台價（Cardmarket EUR、TCGplayer USD、eBay USD、Amazon USD、CoolStuffInc USD），24 小時記憶體快取；`server.mjs`（約 821–826 行）只用 Cardmarket 與 TCGplayer，包成 `normalizeMarketRecord({priceType:'market', ...})` 再 `withTwd`。搜尋以名稱 `fname` 查詢，完全同名優先、否則取第一筆（有誤配風險，且價格是「卡名層級」而非單一 printing）。
- **market record 形狀：** `provider, market, marketplaceId, cardId, providerCardId, cardName, cardNumber, setCode, rarity, language, priceType, amount, currency, shippingAmount, priceTwd…, condition, imageUrl, sourceUrl, observedAt`（`providers/normalize.mjs` 第 155 行起）。
- **價格歷史門檻：** `providers/price-history.mjs` 的 `assertPriceSourceAllowed` 要求來源在 `data/source-registry.json` 有 `collectionEnabled:true` 的條目；因此要寫入任何新價格來源的觀測值，都要先有註冊表條目（需使用者核准）。
- **註冊表現況：** `pokemontcg`、`tcgdex`／`tcgdex-zh-tw`、`ygoprodeck` 都標為「目錄用」（metadata）；`ebay` 已核准但 `server.mjs` 第 81 行標示已停用。價格用途並未被明確核准給任何目錄型來源。

## 二、總表

| 來源 | 價格性質 | 幣別 | 涵蓋 IP／版本 | 身分對應 | 費用／門檻 | 條款是否明確允許顯示 | 風險 |
|---|---|---|---|---|---|---|---|
| pokemontcg.io `tcgplayer`／`cardmarket` | market（平台參考） | USD／EUR | 寶可夢美版（英文）；無日版／台版 | `provider_id` 直接相同 | 免費；**API 已宣告停用、新註冊關閉** | 否（僅說價格「僅供參考」，其餘未規定） | 中高 |
| Scrydex（pokemontcg.io 後繼） | market＋成交（僅 graded） | 未確認 | 寶可夢含日版、航海王（Beta）；遊戲王「即將」；WS 無 | 與舊 ID 相容 | 付費 $29/月起，無免費層 | 否（未寫顯示／快取／歸屬） | 高（違反不付費原則） |
| TCGdex pricing | market | EUR（Cardmarket）／USD（TCGplayer，僅英文版有） | 寶可夢（含日版、台版，皆以 Cardmarket 日版商品計價）；其他 IP 無 | 已有 TCGdex ID；美版需 set 對照 | 免費、免金鑰 | 否（無條款頁；文件把它當功能介紹） | 中 |
| YGOPRODeck `card_prices` | market（跨版本最低參考價） | EUR／USD | 遊戲王（英文卡名層級，非日版 OCG 專屬） | `providerCardId`＝卡片密碼 | 免費；20 req/s | 未明文，無 ToS 頁 | 低中 |
| TCGplayer 官方 API | market／listing | USD | 多 IP | productId | **不再發新金鑰** | 條款頁 403，無法確認 | 高（拿不到） |
| Cardmarket 官方 API | market | EUR | 多 IP | idProduct | **不接受申請** | 無法確認 | 高（拿不到） |
| Cardmarket 公開價格檔（S3） | market | EUR | 寶可夢（含日版商品）、遊戲王等 | `idProduct`；檔內無 set code／編號 | 免費、免金鑰 | 無法確認 | 高（授權未知、難對應） |
| eBay Browse API | listing（現售、僅固定價） | 多幣別 | 全部（以關鍵字） | 無，關鍵字比對 | 免費層 5,000 call/日，但**正式環境限夥伴核准** | 有顯示規定（見小節） | 中高 |
| eBay Marketplace Insights | sale（近 90 天已售） | 多幣別 | 部分類別 | 關鍵字／GTIN | **限量釋出，僅選定開發者** | 無法確認 | 高（拿不到） |
| PriceCharting API | sale 為主（含 graded） | USD | 含日版寶可夢（網站有日版系列頁） | 自有 ID | 付費訂閱（Legendary） | 無法確認（站台被 Cloudflare 擋） | 高 |
| JustTCG | market（成交加權） | 文件未說明 | 日版寶可夢、遊戲王、航海王；WS 無 | 自有 UUID；SDK 支援 tcgplayerId | 免費層僅限個人非商用；公開網站顯示須付費 | 付費方案才允許顯示 | 高（需付費） |
| TCGCSV | market（TCGplayer 轉載） | USD | 寶可夢美／日、遊戲王、航海王（英文版）、WS（英文版）；排球少年無 | `productId`；有編號與稀有度 | 免費、免金鑰 | 無條款，無法確認 | 高 |
| PokemonPriceTracker | market／graded sale | USD／EUR | 寶可夢（含日版，自稱） | 自有 | 免費層 100 credit/日；商用須 Business+ | 免費層限無營收專案 | 中高 |
| CardTrader API | listing | 多幣別 | 多 IP（以 blueprint） | blueprint 含 Cardmarket／TCGplayer ID | 金鑰來自個人帳號設定 | 無法確認 | 高 |
| Collectr／Card Ladder | — | — | — | — | 查無公開 API | 無法確認 | 不適用 |

## 三、各來源

### 1. pokemontcg.io（`tcgplayer.prices`／`cardmarket.prices`）

1. **價格性質與涵蓋：**
   - `tcgplayer`：USD，依 variant（`normal`、`holofoil`、`reverseHolofoil`、`1stEditionHolofoil`、`1stEditionNormal`）給 `low/mid/high/market/directLow`，另有 `updatedAt`（YYYY/MM/DD）與商品連結。官方欄位說明把 `market` 描述為通常最能代表買家願付價格。
   - `cardmarket`：EUR，`averageSellPrice`、`lowPrice`、`trendPrice`、`avg1/7/30`、reverse holo 對應欄位、`updatedAt`。
   - 性質：平台參考價，對應 `priceType:'market'`；不是成交價。
   - 實測新鮮度（2026-10-11）：TCGplayer 的 `updatedAt` 為 2026/10/11（每日更新）；但 Cardmarket 的 `updatedAt` 為 `sv3pt5-1`＝2026/07/01、`sv8-100`＝2025/12/28、`base1-4`＝2026/07/01，且 `base1-4` 的 `avg1`（14,950）與 TCGdex 同日資料（281）差距極大。**Cardmarket 欄位已過期且不可信，不應使用。**
   - 涵蓋：僅英文版（美版）。無日版、台版、航海王、WS、排球少年。
   - 身分對應：本專案 `tcg_cards.provider_id`／`tcg_printings.provider_id` 就是 pokemontcg 卡片 ID（如 `sv3pt5-1`），可直接 `q=id:...` 對應，不需轉換。
   - 文件未說明更新頻率，只有 `updatedAt`。
2. **條款**（`https://dev.pokemontcg.io/terms`，頁面無條號，只有標題）：
   - 「Acceptable Use」：不得對服務造成不當負擔；一人一把金鑰，金鑰不得分享或轉讓。
   - 價格：頁面說明價格資訊僅供參考、不保證，應向商店確認最終價格。
   - 快取期限、歸屬標示、商用、再散布：頁面未規定（無法確認，不等於允許）。
   - 第三方資料：只說明 API「可能包含第三方產品或卡片的價格」，未提 TCGplayer／Cardmarket 的授權。
   - **停用公告**（同頁與 `https://docs.pokemontcg.io/`）：API 已 deprecated，新帳號註冊關閉，現有金鑰到 2027-03-01 仍可用，並要求遷移到 Scrydex。
3. **費用與門檻：** 免費。無金鑰上限 1,000 次/日、30 次/分；有金鑰預設 20,000 次/日（`https://docs.pokemontcg.io/getting-started/rate-limits`）。**新金鑰已無法申請**，所以本專案只能用無金鑰額度。實測 2026-10-11 多次請求回 HTTP 500／502，間歇不穩。
4. **風險：中高。** 資料新鮮度只有 TCGplayer 欄位可信；服務已宣告終止、不穩；價格條款對第三方資料未說明。短期可試，但不能當長期主線。

### 2. Scrydex（pokemontcg.io 官方後繼）

1. **價格性質與涵蓋：** 官網稱含原始價、鑑定價、走勢、歷史、人口報告；已售資料目前僅 graded（來源 eBay 等拍賣）。遊戲：寶可夢（含日版系列與 TCG Pocket）、Magic、Lorcana、Gundam、航海王（Beta）、Riftbound（Beta）；遊戲王與 Digimon 標示「即將」；WS 未列；排球少年未列。FAQ 稱價格「至少每日更新」、舊 ID 相容、Cardmarket 仍在評估中。幣別與欄位定義：無法確認（文件頁內容未取得）。
2. **條款**（`https://scrydex.com/terms`）：§4 轉售、再授權、再散布、鏡像服務須書面授權，且禁止把服務主要當作競品的後端或批量資料來源；§7 輸出（含價格）可能不準確或延遲，不應作為唯一依據；§9 第三方卡片資料歸原所有人；§10 Beta 功能可隨時變更。顯示、快取、歸屬：條款頁沒寫（價格頁只建議自行快取以省 credit）。
3. **費用：** Starter $29/月（5,000 credit）、Growth $99、Professional $399；**無免費層**（`https://scrydex.com/pricing`、`/faq`）。
4. **風險：高。** 與「不使用付費服務」原則衝突，僅記錄，除非使用者另行核准。

### 3. TCGdex pricing

1. **價格性質與涵蓋：**
   - 價格嵌在卡片物件的 `pricing`（及每個 variant 的 `variants_detailed[].pricing`），無獨立端點。
   - Cardmarket（EUR）：`avg`、`low`、`trend`、`avg1/7/30` 與 `-holo` 版本、`idProduct`、`updated`。TCGplayer（USD）：`lowPrice/midPrice/highPrice/marketPrice/directLowPrice`、`productId`、`updated`。官方文件稱 TCGplayer 每小時至每日、Cardmarket 每日；實測英文 `swsh3-136` 的 Cardmarket `updated` 為 2026-10-10T13:00Z、TCGplayer 為 13:01Z，新鮮。
   - 性質：平台參考價（`market`）。
   - 涵蓋：僅寶可夢。實測日版 `ja/SV2a-001` 與台版 `zh-tw/SV2a-001` 都**只有 Cardmarket、`tcgplayer` 為 null**，且兩者指向同一個 Cardmarket 商品 `719442`（對照 Cardmarket 公開商品檔，該商品所屬擴充包新增日 2023-06-20，與日版 SV2a 發售日 2023-06-16 吻合；英文版 `sv03.5-001` 則是另一商品 `733596`，2023-09-22）。**結論：台版沒有獨立價格，TCGdex 顯示的是日版同號卡的 Cardmarket 價；若顯示在台版 printing 上，必須標明「日版同號卡參考價」，否則不可顯示。**
   - 抽樣覆蓋（實測，樣本小）：日版 SV2a／SV8a／S12a／SM12a 與台版 SV2a／SV8a／SV1S，共約 57 張抽樣卡全部有 Cardmarket 價；不能外推到整體覆蓋率。
   - 官方 FAQ 自承：部分卡片 `pricing` 為 null 或缺漏，部分 printing 價格或 ID 可能不正確，並以 `variants_detailed` 修正中。
   - 身分對應：本專案日版／台版卡片來自 TCGdex（`providers/pokemon-jp-import-sql.mjs`、`catalog-sync.mjs` 第 252 行），`provider_id` 與 TCGdex ID（如 `SV2a-001`）同形，可直接 `GET /v2/{ja|zh-tw}/cards/{id}`。美版 pokemontcg ID 與 TCGdex 英文 ID 在舊系列相同（`swsh3-136`、`base1-4` 實測相同），但新系列不同（pokemontcg `sv3pt5-1`↔TCGdex `sv03.5-001`；用 `sv3pt5-1` 查英文端點實測 404），需要 set 對照表（對照表的完整度未驗證）。
2. **條款：**
   - 無獨立使用條款頁。文件站 FAQ（`https://tcgdex.dev/faq`）：免金鑰、免費；「沒有公布硬性速率限制，但請體諒」，建議本地快取。
   - 價格功能頁（`https://tcgdex.dev/markets-prices`）把價格寫成可供應用程式直接取用的功能，並提供 SDK 範例；未寫歸屬、商用、再散布規定。
   - 卡片資料庫程式庫 `tcgdex/cards-database` 授權為 MIT（GitHub 授權檔），但價格是轉自 Cardmarket／TCGplayer 的第三方資料，MIT 並不等同取得這兩家的再散布授權（無法確認 TCGdex 與兩家之間的協議）。
   - 現有註冊表只核准 TCGdex 用於 metadata／繁中比對，`notes` 寫明圖片尚未分類；價格用途未涵蓋。
3. **費用與門檻：** 免費、免金鑰、無申請；贊助走 GitHub Sponsors。
4. **風險：中。** 服務穩定度、免費且為社群維運；底層是 Cardmarket／TCGplayer 的第三方價格，授權鏈不明；台版價格語意容易誤導。

### 4. YGOPRODeck `card_prices`

1. **價格性質與涵蓋：** `card_prices` 陣列，欄位 `cardmarket_price`（EUR）、`tcgplayer_price`、`ebay_price`、`amazon_price`、`coolstuffinc_price`（皆 USD）。官方說明這些值是「跨多個版本的最低價」，所以是**卡名層級的最低參考價，不是特定 printing 的價格**（實測 `Dark Magician` Cardmarket＝0.02，明顯是最便宜版本）。另有 `card_sets[].set_price`（USD，每個 set code／稀有度一筆，來源與算法文件未說明），比 `card_prices` 更接近 printing 層級。更新頻率文件未說明；API 回應快取 2 天（`cardinfo` 說明）。涵蓋：遊戲王全卡（英文卡名）；無日版 OCG 專屬價。
2. **條款**（`https://ygoprodeck.com/api-guide/`，頁面無條號）：
   - 速率 20 req/s，超過封鎖 1 小時。
   - 要求把取得的資料存在本地以減少呼叫，否則可能封 IP 或停用 API；圖片不可持續 hotlink，需自行下載重新託管。
   - 頁面稱 API「永遠免費」；頁尾標明卡片文字與圖片版權屬 4K Media 與 Konami，網站未獲其背書。
   - 未寫商用、價格顯示、歸屬、再散布；網站沒有可讀取的 ToS 頁（嘗試的 `/terms/`、`/terms-of-service/` 皆 404），無法確認。
   - 價格來源與授權：頁面未說明，只在頁尾放 TCGplayer／Cardmarket 合作夥伴標誌，關聯性未說明。
3. **費用與門檻：** 免費，免金鑰。
4. **風險：低中。** 已核准且已上線；唯一的疑慮是價格性質（跨版本最低）與名稱誤配（`server.mjs` 以名稱比對）。

### 5. TCGplayer 官方 API

1. 價格性質：market（市價）與 listing，USD；多 IP。身分：`productId`。
2. 條款：開發者文件首頁（`https://docs.tcgplayer.com/docs/getting-started`）寫「We are no longer granting new API access」；2026-09-15 官方部落格說明正在重整 API 計畫、清查速率與協議（`https://seller.tcgplayer.com/blog/building-a-more-scalable-and-secure-api-program-at-tcgplayer`）。API 條款頁（`help.tcgplayer.com` 的 API Terms & Conditions）回傳 403，**顯示／快取／歸屬條款無法確認**。
3. 費用與門檻：無法申請。
4. 風險：高（拿不到）。

### 6. Cardmarket 官方 API

1. 價格性質：market（Price Guide：avg、low、trend、avg1/7/30），EUR。
2. 條款：Cardmarket 說明頁（`https://help.cardmarket.com/en/cardmarket-api`）寫目前不接受 API 申請；既有使用者不得把專用憑證交給第三方軟體。API 文件站 `api.cardmarket.com/ws/documentation` 回傳 410 Gone。完整條款無法確認。
3. 費用與門檻：不接受申請；舊文件曾寫僅專業賣家、人工審核。
4. 風險：高（拿不到）。

### 7. Cardmarket 公開價格檔（S3）

1. 實測 `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json`（寶可夢，約 15.6 MB、79,765 筆，建立時間 2026-10-11T02:44+02:00）與 `productCatalog/productList/products_singles_6.json`（74,694 筆）可免登入下載，欄位與 TCGdex 的 Cardmarket 價相同（`avg/low/trend/avg1/avg7/avg30` 與 `-holo`）。價格是 EUR 平台參考價。
2. **商品檔沒有 set code 與卡號**，只有 `idProduct`、名稱（含招式名，如 `Bulbasaur [Leech Seed | 151]`）、`idExpansion`、`idMetacard`，直接對應本專案卡片非常困難；TCGdex 其實已做完這個對應。
3. 條款：找不到這些檔案的使用條款或授權說明，**無法確認**能否顯示、快取、再散布；也未找到官方文件說明檔案的更新頻率保證。
4. 風險：高（授權未知、對應成本高）。不建議直接使用，透過 TCGdex 取得相同資料較省事但同樣有授權未知的問題。

### 8. eBay Browse API

1. 價格性質：現售掛牌（`listing`），只有進行中的刊登，無成交資料；幣別依 marketplace。無卡片 ID，只能關鍵字搜尋，身分對應不可靠。
2. 條款與規定：
   - 正式環境（`https://developer.ebay.com/api-docs/buy/static/buy-requirements.html`）：Buy API 的正式環境「僅限 eBay 夥伴」，要先加入 eBay Partner Network 申請、EPN 約 10 個工作天回覆、再開支援單、簽合約後才開通，不保證核准。
   - 顯示規定（同頁，針對 Browse 與 guest checkout）：只呈現固定價（`FIXED_PRICE`）、不得停用 eBay 排序、須顯示 eBay 標誌與商品圖、完整標題、含運分開標示的價格、狀態與賣家名稱，頁尾要有 eBay 使用者協議連結。
   - API License Agreement（`https://developer.ebay.com/join/api-license-agreement`）在本次環境回傳 403，**快取期限與資料保存條款無法確認**。有第三方文章說協議要求顯示的刊登資訊不得比 eBay 現況舊超過 6 小時，我無法在 eBay 官方文件確認，不採信。
3. 費用：開發者免費層 5,000 call/日；但正式環境需夥伴核准與簽約。
4. 現況：註冊表已核准，但 `server.mjs` 第 81 行標示已停用，且需要 `EBAY_CLIENT_ID`／`EBAY_CLIENT_SECRET`。
5. 風險：中高。掛牌價不等於行情，且受大量顯示規定約束。

### 9. eBay Marketplace Insights（成交資料）

- 提供近 90 天已售項目（`item_sales`），可用關鍵字、GTIN、ePID、類別搜尋；文件標示為**限量釋出，僅限事業單位核准的選定開發者**，且不支援所有類別，類別需審核後白名單（`https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html`，經搜尋摘錄；本次直接抓取該頁未成功）。
- 費用與門檻：非自助申請，無法確認標準。2025-06-24 起 Restricted API 資料禁止餵入生成式 AI（搜尋摘錄）。
- 結論：**成交資料受限，目前拿不到**。風險：高（拿不到）。

### 10. PriceCharting API

1. 價格性質：以已售資料為主，含 graded；USD；文件稱歷史價格與歷史成交不支援。網站有日版寶可夢系列頁（姊妹站 sportscardpro 可見），官方 API 涵蓋哪些系列：無法確認。
2. 存取：官方文件頁與條款頁對本環境回傳 Cloudflare 驗證／403。依規則不繞過，**條款與欄位細節無法確認**。搜尋摘錄顯示 API 僅限付費訂閱（方案頁寫 Free 與 Collector 無 API，Legendary 完整存取），並可下載價格檔。
3. 費用：付費訂閱，金額未確認。
4. 風險：高。付費，條款不明。

### 11. JustTCG

1. 價格性質：官網稱結合線上市場成交與合作實體店銷售，做成交量加權；幣別文件未明確說明。涵蓋：Pokémon Japan、Yu-Gi-Oh!、One Piece；WS 與排球少年未列。身分：自有 UUID／slug，SDK 提供以 TCGplayer 商品 ID 查詢；無 set code＋編號的明確欄位（文件未說明）。
2. 條款（`https://justtcg.com/terms`）：§6 免費層「僅限個人非商用」，禁止爬取與轉售；§7.1 付費訂閱者才可向終端使用者顯示價格與趨勢、快取回應與歷史價（訂閱期間，且僅供自家功能）；§7.3 所有方案禁止轉售、再散布、批量資料集或做替代 API；§7.4 歸屬不強制。「非商用」未定義。
3. 費用：Free $0（1,000 call/月、100/日、每請求 20 張、每分鐘 10 次）；Starter $19/月起。
4. 風險：高。免費層不涵蓋公開網站顯示，顯示須付費。

### 12. TCGCSV（tcgcsv.com）

1. 價格性質：TCGplayer API 資料的公開鏡像（類別→群組→商品→價格，JSON／CSV／分類壓縮檔），每日約 20:00 UTC 更新，資料可能晚約 24 小時；USD；欄位 `lowPrice/midPrice/highPrice/marketPrice/directLowPrice/subTypeName`；不含條件、語言（SKU 不提供）；`highPrice` 站方自承不可靠；每日歷史壓縮檔自 2024-02-08 起。實測最後更新檔 `2026-10-10T20:06:02+0000`。
2. 涵蓋（實測分類清單）：寶可夢（3）、Pokemon Japan（85，例如 SV2a 群組 520 件）、遊戲王（2）、One Piece Card Game（68，英文版，系列 OP01–OP18 等）、Weiss Schwarz（20，出現英文版 `Frieren: Beyond Journey's End SFN/S108` 群組）；**沒有排球少年**。身分：`productId`，`extendedData` 有 `Number`（如 `001/165`）與稀有度，可做 set＋編號對應；但 TCGplayer 的 One Piece 與 WS 是**英文版**，不等同本專案的日版／亞洲版卡片，不能直接當作它們的價格。
3. 條款：站方 FAQ（`https://tcgcsv.com/faq`）只說可用 scraping 取得、要使用可識別的 User-Agent 並在請求間暫停；**沒有任何使用條款、授權、歸屬或顯示規定**，且說明資料直接來自 TCGplayer API 而 TCGplayer 已不輕易發金鑰。這是對一個已停發 API 的第三方鏡像：TCGplayer 是否允許這種再散布，無法確認。
4. 費用：免費、免金鑰；站長接受 Patreon 贊助；個人維運的興趣專案。
5. 風險：高。授權鏈不明；可用性取決於單一維護者。

### 13. PokemonPriceTracker

1. 自稱 TCGplayer、eBay、Cardmarket 三來源，每日更新，日版以 Cardmarket EUR 計價；graded 價來自 eBay 已售（皆為站方說法，未獨立驗證）。
2. 條款（`https://www.pokemonpricetracker.com/terms`，2026-08-19 版）：§6 免費層僅限個人非商業（含「不賺錢的免費應用」）；營收相關須 Business／Enterprise；在商業產品顯示價格也算商用；任何方案都不得轉售或再散布原始資料；可快取並服務自家終端使用者，需合理頻率更新；未規定歸屬；站方**不揭露資料收集方式與來源**，也不提供第三方權利賠償。
3. 費用：Free 100 credit/日；$9.99/月 20,000 credit/日；$99/月 200,000。
4. 風險：中高。來源不透明，免費額度對全站同步太小。

### 14. CardTrader API

- 價格性質：`listing`（`/marketplace/products` 每個 blueprint 最便宜 25 筆刊登，價格以分為單位），blueprint 含 Cardmarket／TCGplayer／Scryfall 外部 ID。金鑰取自個人帳號設定頁，**需先有帳號，依規則我不建立**。速率：整體 200 次/10 秒、marketplace 端點 10 次/秒（同頁另一處寫 1 次/秒，以較嚴者為準）。各遊戲支援度（遊戲王、航海王、WS）與使用條款：**無法確認**（文件未提；未找到 API 條款）。風險：高。

### 15. Collectr／Card Ladder

- 搜尋未找到 Collectr 或 Card Ladder 的公開開發者 API；Card Ladder 使用條款頁（`https://www.cardladder.com/terms`）對本環境回傳 403。**無法確認**是否有私下授權方案；沒有可用資料，記為不適用。

## 四、IP 涵蓋摘要（免費且可自助取得者）

| IP／版本 | 有候選價格來源？ | 備註 |
|---|---|---|
| 寶可夢美版 | 有：pokemontcg.io（TCGplayer USD）、TCGdex | pokemontcg.io 已停發新金鑰且不穩；Cardmarket 欄位已過期 |
| 寶可夢日版 | 有：TCGdex（Cardmarket EUR） | 僅 Cardmarket；抽樣皆有價 |
| 寶可夢台版 | 無獨立價格 | TCGdex 回傳日版同號卡 Cardmarket 價，不可當台版價 |
| 遊戲王 | 有：YGOPRODeck（已上線） | 卡名層級最低價；`set_price` 更貼近 printing |
| 航海王 | 無可用免費來源 | TCGCSV 為英文版且授權不明 |
| 芙莉蓮（Weiß Schwarz） | 無可用免費來源 | TCGCSV 為英文版且授權不明 |
| 排球少年 | 無 | 上述來源皆未收錄 |

## 五、建議最小一條

**建議：寶可夢日版（與同號卡）先接 TCGdex `pricing.cardmarket`，以 `market`／EUR／「Cardmarket 平台參考價（日版商品）」顯示；遊戲王維持現狀。**

理由：
- 免費、免金鑰、不用申請。
- TCGdex 已在註冊表核准，且本專案日版／台版卡片的 `provider_id` 就是 TCGdex ID，不需另做身分對應；資料實測當日新鮮；官方文件明確以「應用程式內顯示」為使用情境。
- 不涉及圖片，也不需要付費或建帳號。

**這一條是否只改程式？** 大致是，但有一個不可跳過的核准點：
- 註冊表目前把 `tcgdex`／`tcgdex-zh-tw` 限定為 metadata 與繁中比對。把它用於價格是用途擴大，且價格源自 Cardmarket／TCGplayer 的第三方授權不明。這應由使用者決定是否接受（比照 ADR 0027 的風險接受格式），而不是 worker 自行放行。
- 核准後不需要資料庫 migration，先採「即時查詢＋24 小時記憶體快取」（與 `providers/ygoprodeck.mjs` 相同模式），不寫入資料庫。若要做趨勢（需同一來源、兩次觀測相隔 24 小時以上），才需要寫入價格歷史表，那是另一個需要核准的資料庫寫入。

若核准，預計要改的檔案：
1. `providers/tcgdex-pricing.mjs`（新增）：用 `GET https://api.tcgdex.net/v2/{ja|zh-tw|en}/cards/{id}` 取 `pricing.cardmarket`，24 小時快取，輸出符合 `normalizeMarketRecord` 的記錄（`provider:'tcgdex'`、`market:'Cardmarket'`、`priceType:'market'`、`currency:'EUR'`、`observedAt` 取 `pricing.cardmarket.updated`、`sourceUrl` 指向 Cardmarket 商品或 TCGdex 卡片，並保留 `idProduct`）。
2. `server.mjs`（`unifiedMarket`，約 821–826 行）：對 `card.game==='pokemon'` 且日版 printing 加一個與 `yuyutei`、`ygoprodeck` 並列的任務。
3. `data/source-registry.json`：登記價格用途（新增 `tcgdex-pricing` 條目或擴充 `tcgdex` 的 `notes`／`refreshHours`），這是需使用者核准的部分。
4. 台版 printing：不顯示該價，或明確標示「日版同號卡參考價」，避免被讀成台版價。
5. 測試：以固定 fixture 測欄位對應、台版標示、`pricing` 為 null 時顯示「尚未取得可靠資料」。

**不建議現在做的：** pokemontcg.io 的 `tcgplayer.market`（雖是已核准來源，但新金鑰已停發、API 近期回 500／502，且將被關閉，Cardmarket 欄位已過期）；Scrydex、JustTCG、PokemonPriceTracker（付費或免費層不含公開顯示）；TCGCSV、Cardmarket 公開檔（授權不明）。航海王、WS、排球少年沒有可用的免費全球來源，這三個 IP 的價格暫時只能依賴日本來源（另一份調查）。

## 六、無法確認的點

- TCGplayer API 條款（`help.tcgplayer.com` 回 403）：顯示、快取、歸屬規定。
- Cardmarket 一般條款與公開價格檔（`downloads.s3.cardmarket.com`）的使用授權，以及價格檔的更新承諾。
- eBay API License Agreement（`developer.ebay.com` 回 403）：快取期限、資料保存、價格顯示條款；Marketplace Insights 的實際申請標準。
- PriceCharting 官方文件與條款（Cloudflare 驗證，未繞過）；API 涵蓋哪些系列、費用金額。
- TCGdex 與 Cardmarket／TCGplayer 之間的資料授權協議；Cardmarket 價格是否按語言與品況區分（僅知欄位本身未標示條件）。
- Scrydex 的價格欄位定義、幣別、日版價格是否實際提供，以及顯示／快取規定。
- JustTCG 的價格幣別與卡片欄位（`/games` 的實際 slug 與編號欄位）。
- CardTrader 的 API 使用條款與各遊戲支援度；Collectr、Card Ladder 是否提供私下 API。
- 美版 pokemontcg ID 對 TCGdex 英文 ID 的 set 對照表完整度。
- 寶可夢台版是否有可信的獨立價格來源（本次來源皆沒有）。
