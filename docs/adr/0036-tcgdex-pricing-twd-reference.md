---
status: accepted
---

# 寶可夢日版詳細頁顯示 TCGdex 轉供的 Cardmarket 價格，以新台幣為主

**狀態：已採用（2026-10-11，使用者同意候選 A，並要求以台幣價格為主）。**

價格來源盤點（`docs/research/price-sources/`）找不到風險可接受的台灣新台幣行情來源。TCGdex 的卡片 API（`api.tcgdex.net/v2/ja/cards/<id>`）在 `variants_detailed[].pricing` 提供 Cardmarket（EUR）與 TCGplayer（USD）價格，不需要金鑰。我們的日版 `tcgdex-ja` 卡片的 `provider_id` 就是 TCGdex ID。原本 `data/source-registry.json` 只核准 TCGdex 的目錄（metadata）用途，這次使用者同意擴大到價格。

決定：

- **範圍**：只用在 `source = tcgdex-ja` 的日版寶可夢卡，以 `provider_id` 即時查詢，伺服器記憶體快取 24 小時，不存資料庫。官方來源匯入的日版卡（`pokemon-official-ja-*`）、台版、美版都不推測對應，不顯示。
- **價格性質分開**：Cardmarket `trend` 記為 `market`（平台參考價），`low` 記為 `listing`（最低掛牌價）；`avg` 系列不顯示（Cardmarket 未公開它是否只算成交）。每個 variant（holo、normal、reverse 等）分開列出，不合併。
- **台幣為主**：介面主數字是換算後的新台幣（ExchangeRate-API 每日匯率，`withTwd`；使用者 2026-10-11 選定），原幣金額、匯率日期與來源列在小字。匯率退回預設值（`source = fallback`）時要標示「匯率為預設估計」。標籤寫「Cardmarket 歐洲市場參考價（換算新台幣）」，不能寫成台灣行情。
- **歸屬**：每筆附 TCGdex 卡片頁與 Cardmarket 更新時間（`updated`）；超過 7 天未更新就不顯示。
- **撤回**：把註冊表 `tcgdex-pricing` 的 `collectionEnabled` 改成 `false` 即停止。

## Consequences

- 匯率：原本的 Frankfurter（歐洲央行資料）沒有新台幣，正式站一直落到寫死的預設值（EUR 35、USD 32、JPY 0.22；實際約 35.8、32.0、0.202）。台灣銀行牌告匯率網站有機器人驗證，不繞過。改用 ExchangeRate-API 免金鑰端點（`open.er-api.com/v6/latest/TWD`），頁面附「Rates By Exchange Rate API」連結；遊々亭的台幣換算一併受惠。

- 授權鏈不明：價格的底層是 Cardmarket，Cardmarket 是否授權 TCGdex 轉供查不到。`metadataCollection` 記為 `risk-accepted`，不表示已取得授權。
- 歐洲市場價格不等於台灣行情；換算台幣只是方便比較，介面必須寫清楚。
- 台灣新台幣行情仍需要店家書面同意才能取得，不受本 ADR 影響。
