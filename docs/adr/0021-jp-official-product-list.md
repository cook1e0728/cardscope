---
status: accepted
---

# 日版寶可夢實體商品以官方商品清單的文字事實匯入

主方案第 2 項要求寶可夢日版的卡盒與商品，但 `/api/products` 的寶可夢商品一直是 0：伺服器內的即時載入因 `pokemon-jp` 來源仍為 permission-pending 而關閉。官方商品清單 `https://www.pokemon-card.com/products/resultAPI.php` 可分頁讀出 1,963 筆（商品名、種類、發售日、價格文字、卡片清單與詳細頁連結、縮圖路徑）。決定（2026-10-04，grill-with-docs 形式提出建議並照建議執行）：

- 一次性靜態匯入 `tcg_products`，只收文字事實：商品名（`name_ja`）、種類（`product_type`，原文）、發售日、官方詳細頁或清單網址、官方卡片清單連結。不收圖片（官方網站政策限制轉載；`image_url` 空、`imageRightsStatus: not-provided`），不收價格。即時載入維持關閉。
- ID 沿用既有即時載入規則 `pokemon-jp-product-<sha1(種類:商品名:發售日) 前 16 碼>`。
- 系列連結：只有官方卡片清單連結的 `pg` 能經商品 ID 掃描（`official-product-ids*.json`）對到單一系列代碼，且資料庫已有該日版系列時才填 `series_id`／`official_code`；不以名稱比對。
- 中文名留空，由既有的顯示規則（同代碼台版系列名或類別名）處理，`translationStatus: category-only`。
- 寫入只新增（同 ID 已存在即略過），重播零異動；證據 `docs/evidence/pokemon-jp/products/official-products-20261004.json`。

## Consequences

- 商品頁的寶可夢日版分類（原盒、牌組、周邊道具、其他）有實際資料，但沒有圖片，顯示佔位。
- 官方日後新增的商品不會自動進來，需重跑清單並以同規則增量匯入。
