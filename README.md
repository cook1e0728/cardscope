# CardScope

CardScope 是卡牌市場比價原型，目前後端為 Node.js `server.mjs`，前端為單頁 `index.html`。

## 目前資料來源

- **JustTCG**：既有 API adapter 保留，目前不作為首頁搜尋或卡盒資料依賴。
- **eBay Browse API**：既有多市場 adapter 保留，目前不自動查詢；掛牌價不可當作已成交價。
- **遊々亭**：既有買取資料可查詢；新的自動擷取在來源條款／許可確認前由來源政策暫停。
- **Supabase**：使用者成交回報、日版買取行情、卡片多語名稱與匯率快取。
- **Pokémon TCG API + TCGdex**：Pokémon 美版與台版繁中 metadata；不同語言只在有可靠 ID 時合併，不猜測跨語 printing。卡圖另行接受權利審核。
- **ONE PIECE CARD GAME 官方網站**：保留官方導覽連結；自動抓取在適用條款或書面許可確認前暫停。
- **YGOPRODeck**：遊戲王卡片與卡組 metadata。依 API 指引不持續 hotlink；在卡圖權利依據確認前不自動保存或公開顯示。
- **卡拍拍 / SNKRDUNK**：尚未接入；網站不再顯示這兩個來源的示範價格。

## 更新頻率

目前先採 **24 小時**策略：

- JustTCG 同一查詢：24 小時記憶體快取。
- eBay 同一關鍵字 + marketplace：24 小時記憶體快取。
- Frankfurter 匯率：成功後 24 小時更新一次。
- 遊々亭：管理端抓取功能保留，正式排程建議每日一次。
- 若 Supabase 已建立 `exchange_rates`，Render 重啟後會優先讀取 24 小時內的已存匯率。
- Catalog 成功同步後預設 72 小時內不重跑，進行中的來源也不會重複啟動；可用 `CATALOG_SYNC_MAX_AGE_HOURS` 調整冷卻時間，或以 `CATALOG_SYNC_ON_START=false` 停用啟動檢查。
- 遊戲王卡圖只會在遊戲王 Catalog 確實需要同步後自動續傳，不再每次 Render 啟動都掃描整庫；`CARD_IMAGE_CACHE_ON_START=true` 可強制續傳、`false` 可完全停用，並可用 `CARD_IMAGE_CACHE_CONCURRENCY` 控制同時下載數。

## TWD 匯率

`GET /api/exchange-rates`

目前支援 TWD、JPY、USD、EUR。Frankfurter 暫時失效時使用 `JPY_TO_TWD`、`USD_TO_TWD` 保底值。正式市場資料應同時保存原始幣別、原始價格、換算匯率與 TWD 價格。

## 多語卡名

`GET /api/catalog`（Supabase 與 `data/catalog.json` 合併；資料庫暫缺資料時不會再把公開備援覆蓋掉）

`GET /api/card-identities?q=關鍵字&cardNumber=卡號`

Supabase Catalog 使用 `tcg_games`、`tcg_series`、`tcg_canonical_cards`、`tcg_cards`、`tcg_printings`。API 依 `canonical_id` 合併去重，實際美版／日版／台版／韓版仍保留為 printing；中文、英文、日文、韓文名稱與 `language` / `region` 不互相覆蓋。跨市場對應以 canonical identity、printing 與官方卡號為主，名稱只作搜尋與別名輔助。

## 稀有度排序

圖鑑的「稀有度高到低／低到高」與稀有度分組依 `data/rarity-rankings.json` 的各遊戲獨立順序排列；不同 IP 不共用同一套排名。未收錄或無法辨識的稀有度一律排在最後。這份順序只用於圖鑑導覽，不代表市場價格或跨遊戲價值。

## 圖片

詳細頁只顯示 `licensed`、`partner-provided` 或 `user-provided` 且未過期的圖片；`image_url` 存在不代表可展示。其他情況會降級成清楚的圖片待補狀態。每筆保留來源、來源網址、權利狀態與到期時間，方便後續審核。

`GET /api/catalog/health` 提供五個 IP 的卡片、中文名、稀有度、圖片網址與可顯示圖片數；`GET /api/catalog/sources` 公開來源政策摘要。管理端可用 `GET /api/admin/catalog/health` 搭配 `Authorization: Bearer ...` 或 `x-scrape-token` 查看缺失樣本。管理密鑰不接受 query string，避免被瀏覽器歷史與伺服器紀錄保存。

`GET /api/catalog/image-status` 可查看遊戲王唯一卡面已保存／待補數量；受 `SCRAPE_SECRET` 保護的 `POST /api/admin/catalog/cache-images` 可手動續跑。

## 統一市場輸出

`GET /api/cards/:cardId/market`

所有可確認版本的資料統一輸出 `provider`、`market`、`priceType`、原幣價格、TWD 換算、品相、來源 URL 與觀測時間。eBay 是 `listing`、遊々亭是 `buyback`、YGOPRODeck 是跨平台 `market` 參考價；只有能驗證為成交的資料才可標 `sale`。不同類型不混算中位價。

## eBay 多市場

`GET /api/providers/ebay/search?q=Mew%20ex&marketplace=EBAY_US`

目前允許：`EBAY_US`、`EBAY_CA`、`EBAY_GB`、`EBAY_DE`、`EBAY_FR`、`EBAY_IT`、`EBAY_ES`、`EBAY_AU`。

## Supabase migration

`supabase/migrations/20260830_market_data.sql` 會建立：

- `exchange_rates`：每日 TWD 匯率快取 / 歷史。
- `card_images`：同卡不同語言與來源的圖片索引。

`supabase/migrations/20260831_canonical_multilingual_catalog.sql` 以非破壞方式新增 canonical identity、韓文原名欄位、指定卡片與可用圖片索引。

`supabase/migrations/20260831_catalog_sync_pipeline.sql` 新增 `tcg_products`、`catalog_sync_runs` 與 provider/search 欄位。`tcg_products` 只接受 `sealed-product` 或 `series-logo`，一般單卡不會進入卡盒資料。

管理端可用 `POST /api/admin/catalog/sync?provider=all`（`Authorization: Bearer ...` 或 `x-scrape-token`）手動重跑；只有 `data/source-registry.json` 明確啟用的來源會執行。`GET /api/catalog/sync-status` 提供不含密鑰的同步摘要。

注意：把 SQL 檔推到 GitHub **不代表遠端 Supabase 一定會自動執行 migration**；是否自動套用取決於你的 Supabase CI / deployment 設定。

目前最低保證 Catalog 包含噴火龍、超夢、夢幻、魯夫與黑魔導女孩，並支援指定中／英／日搜尋名稱。首頁與 API 不顯示假交易量、假漲跌、假中位價、假市值，也不把掛牌／買取誤標成成交／店售。

