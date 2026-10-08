---
status: accepted
---

# 台版寶可夢實體商品與卡盒圖取自台灣官方商品頁：使用者接受風險

**狀態：已採用（2026-10-09，使用者選擇「接受風險，外連台灣官方圖」）。**

系列橫幅的方形磚需要卡盒圖。日版已依 ADR 0029 外連日本官方商品圖；台版 146 個系列都沒有圖，也沒有任何台版實體商品資料。台灣官方網站 `https://asia.pokemon-card.com/tw/products/` 單一頁面列出全部商品（擴充包、構築牌組、其他商品、周邊道具），每件有官方商品 ID、名稱、縮圖與商品資訊連結。來源註記中台灣官方原本只有連結項目 `pokemon-tw`（`external-only`）。使用者經說明風險後明確選擇接受。

決定：

- **範圍**：一次性靜態匯入擴充包、構築牌組、其他商品三類共 185 件到 `tcg_products`（`source: pokemon-tw-official`、`region: TW`、ID `pokemon-tw-product-<官方商品 ID>`）。周邊道具（310 件）不收。只收文字事實（名稱、類別）與官方圖片網址；官方列表沒有發售日，留空。
- **外連不轉存**：`image_url` 存官方網址，不下載、不重新託管、不改圖。來源註記新增 `imageDisplayPolicies["pokemon-tw-official"] = "risk-accepted"`；單筆 `imageRightsStatus` 為 `not-provided`。
- **系列連結**：只用兩個官方事實裡的代碼——商品資訊連結 `/archive/special/card/<代碼>/`，或縮圖檔名中恰好一個等於台版系列代碼的片段（如 `tw_M2a_pkg.png`）。兩者都有但不同時不連（1 件）。不以名稱比對。118 件連到 85 個系列。
- **分類**：商品類型存官方分頁名稱（擴充包→原盒、構築牌組→牌組、其他商品→其他）。
- **證據**：`docs/evidence/pokemon-tw/products/official-products-20261009.json`。
- **撤回**：刪除 `imageDisplayPolicies` 中的 `pokemon-tw-official` 即停止顯示圖片；權利人要求時立即執行。

風險：未取得授權；外連不等於取得授權。早期中文版系列（AC、AS、CS 等 61 個）官方頁沒有對應商品，維持代碼磚。
