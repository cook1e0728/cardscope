# CardScope

CardScope 是卡牌市場比價原型，目前後端為 Node.js `server.mjs`，前端為單頁 `index.html`。

## 目前資料來源

- **JustTCG**：既有 API adapter 保留，目前不作為首頁搜尋或卡盒資料依賴。
- **eBay Browse API**：既有多市場 adapter 保留，目前不自動查詢；掛牌價不可當作已成交價。
- **遊々亭**：買取頁資料擷取，存入 Supabase `jp_buyback_prices`。
- **Supabase**：使用者成交回報、日版買取行情、卡片多語名稱與匯率快取。
- **Pokémon TCG API + TCGdex**：Pokémon 美版與台版繁中系列、卡片及圖片；不同語言只在有可靠 ID 時合併，不猜測跨語 printing。
- **ONE PIECE CARD GAME 官方網站**：逐系列同步亞洲英文版與台版繁中官方卡表、卡面及產品封面。
- **YGOPRODeck**：遊戲王卡片與卡組索引；卡圖會先保存至 CardScope 的 Supabase Storage，再由本站顯示，不大量 hotlink。
- **卡拍拍 / SNKRDUNK**：尚未接入；網站不再顯示這兩個來源的示範價格。

## 更新頻率

目前先採 **24 小時**策略：

- JustTCG 同一查詢：24 小時記憶體快取。
- eBay 同一關鍵字 + marketplace：24 小時記憶體快取。
- Frankfurter 匯率：成功後 24 小時更新一次。
- 遊々亭：管理端抓取功能保留，正式排程建議每日一次。
- 若 Supabase 已建立 `exchange_rates`，Render 重啟後會優先讀取 24 小時內的已存匯率。
- Catalog 成功同步後 72 小時內不重跑；Render 啟動會在背景檢查，`CATALOG_SYNC_ON_START=false` 可停用。
- Render 啟動會續傳尚未保存的遊戲王卡圖；可用 `CARD_IMAGE_CACHE_ON_START=false` 停用，或以 `CARD_IMAGE_CACHE_CONCURRENCY` 調整同時下載數。

## TWD 匯率

`GET /api/exchange-rates`

目前支援 TWD、JPY、USD、EUR。Frankfurter 暫時失效時使用 `JPY_TO_TWD`、`USD_TO_TWD` 保底值。正式市場資料應同時保存原始幣別、原始價格、換算匯率與 TWD 價格。

## 多語卡名

`GET /api/catalog`（Supabase 與 `data/catalog.json` 合併；資料庫暫缺資料時不會再把公開備援覆蓋掉）

`GET /api/card-identities?q=關鍵字&cardNumber=卡號`

Supabase Catalog 使用 `tcg_games`、`tcg_series`、`tcg_canonical_cards`、`tcg_cards`、`tcg_printings`。API 依 `canonical_id` 合併去重，實際美版／日版／台版／韓版仍保留為 printing；中文、英文、日文、韓文名稱與 `language` / `region` 不互相覆蓋。跨市場對應以 canonical identity、printing 與官方卡號為主，名稱只作搜尋與別名輔助。

## 圖片

詳細頁圖片優先順序是 `card_images` 的 primary 圖、`tcg_printings.image_url`、合法公開 Catalog 圖源，最後才是文字佔位；圖片載入失敗會降級為卡名與卡號。YGOPRODeck 卡圖依其 API 條款先下載至公開讀取、僅服務端可上傳的 `card-images` bucket。遊々亭與 eBay 圖只跟著對應市場列顯示，不冒充官方卡圖。每筆保留 `source` 與 `source_url`。

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

管理端可用 `POST /api/admin/catalog/sync?provider=all`（`x-scrape-token`）手動重跑；`GET /api/catalog/sync-status` 提供不含密鑰的同步摘要。

注意：把 SQL 檔推到 GitHub **不代表遠端 Supabase 一定會自動執行 migration**；是否自動套用取決於你的 Supabase CI / deployment 設定。

目前最低保證 Catalog 包含噴火龍、超夢、夢幻、魯夫與黑魔導女孩，並支援指定中／英／日搜尋名稱。首頁與 API 不顯示假交易量、假漲跌、假中位價、假市值，也不把掛牌／買取誤標成成交／店售。

