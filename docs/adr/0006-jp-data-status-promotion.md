---
status: accepted
---

# 日版卡以台版連結作為 data status 升級依據

日版 Card／Printing 匯入時一律是 `pending`，理由是 tcgdex 的 localId 尚未被證明是官方卡號。其他來源的 Card 都是 `verified`；Printing 則是有稀有度為 `verified`、缺稀有度為 `incomplete`（美版、遊戲王皆如此，圖片不列入）。

決定：日版 Card 已依 ADR 0003 連結到台版 Card（同 Provider ID、同系列代碼、Source archive 中日文名與台版官方名都一致，且共用同一個 Canonical card），而該台版 Card 本身是 `verified`、名稱與 Provider ID 仍相同時，升級為 `verified`。它的 Printing 依既有規則：有稀有度為 `verified`，沒有則為 `incomplete`。其餘日版 Card（未連結、只有 Derived name、沒有台版的系列）維持 `pending`，Printing 也維持 `pending`。升級由 `private.promote_pokemon_jp_data_status` 執行，每次最多 100 張，只把 `pending` 往上調、不降級，並寫入追加式稽核。

不採用的替代方案：向日本官方卡片資料庫逐張核對卡號（需要爬取官方網站，違反「不繞過反爬、不使用付費服務」的原則）；把 Derived name 也視為證據（Derived name 只證明名稱，不證明卡號，見詞彙表）。

## Consequences

- 升級的信任度等同台版資料；若日後發現台版某系列編號與日版錯位（如 SV-P），對應的日版 Card 不會被連結，也就不會升級。已連結者若事後證明有誤，需另立決策處理，函式本身不降級。
- `pending` 從此只代表「尚無第二個可靠證據」，不是錯誤；介面與搜尋不因此隱藏資料。
