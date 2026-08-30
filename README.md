# CardScope

CardScope 是卡牌市場比價原型，目前後端為 Node.js `server.mjs`，前端為單頁 `index.html`。

## 目前資料來源

- **JustTCG**：官方 API；卡牌目錄、品相與北美市場價格。
- **eBay Browse API**：官方 API；多市場在售掛牌。掛牌價不可當作已成交價。
- **遊々亭**：買取頁資料擷取，存入 Supabase `jp_buyback_prices`。
- **Supabase**：使用者成交回報、日版買取行情、卡片多語名稱與匯率快取。
- **卡拍拍 / SNKRDUNK**：目前仍有示範資料，尚未接正式授權來源。

## 更新頻率

目前先採 **24 小時**策略：

- JustTCG 同一查詢：24 小時記憶體快取。
- eBay 同一關鍵字 + marketplace：24 小時記憶體快取。
- Frankfurter 匯率：成功後 24 小時更新一次。
- 遊々亭：管理端抓取功能保留，正式排程建議每日一次。
- 若 Supabase 已建立 `exchange_rates`，Render 重啟後會優先讀取 24 小時內的已存匯率。

## TWD 匯率

`GET /api/exchange-rates`

目前支援 TWD、JPY、USD、EUR。Frankfurter 暫時失效時使用 `JPY_TO_TWD`、`USD_TO_TWD` 保底值。正式市場資料應同時保存原始幣別、原始價格、換算匯率與 TWD 價格。

## 多語卡名

`GET /api/card-identities?q=關鍵字&cardNumber=卡號`

Supabase `card_identities` 使用 `name_zh`、`name_ja`、`name_en`、`card_number`、`aliases`。跨市場對應應以自己的 `card_id` / 卡號為主，名稱只作搜尋與別名輔助。

## 圖片

目前來源可包含 JustTCG 回傳卡圖、遊々亭 `image_url`、eBay listing 圖片。`supabase/migrations/20260830_market_data.sql` 新增 `card_images`，供之後把不同語言與來源圖片統一對到同一 `card_id`。

## eBay 多市場

`GET /api/providers/ebay/search?q=Mew%20ex&marketplace=EBAY_US`

目前允許：`EBAY_US`、`EBAY_CA`、`EBAY_GB`、`EBAY_DE`、`EBAY_FR`、`EBAY_IT`、`EBAY_ES`、`EBAY_AU`。

## Supabase migration

`supabase/migrations/20260830_market_data.sql` 會建立：

- `exchange_rates`：每日 TWD 匯率快取 / 歷史。
- `card_images`：同卡不同語言與來源的圖片索引。

注意：把 SQL 檔推到 GitHub **不代表遠端 Supabase 一定會自動執行 migration**；是否自動套用取決於你的 Supabase CI / deployment 設定。

目前 `server.mjs` / `index.html` 仍保留部分示範市場數字，正式版應逐步改成只顯示帶有來源、抓取時間、幣別、價格類型與品相的真實資料。
