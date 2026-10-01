---
status: accepted
---

# 日版 Card 以相同 Provider ID 併入台版既有 Canonical card，並以同名推導補中文名

ADR 0001 讓日版 metadata pilot 的每張 Card 先自成 Canonical card，並預留「有官方編號或可靠 Provider ID 時再連結」。2026-10-01 已匯入的 9 個朱紫系列與台版系列代碼相同，且 TCGdex 對同一張卡在日文與繁中使用同一個 Provider ID（例如 `SV6a-039`），同一個資料檔同時保存 `ja` 與 `zh-tw` 名稱。這就是可靠 Provider ID 的對應，所以把日版 Card 併入台版既有的 Canonical card：台版作品層已公開使用，保留其 ID 不動，只移動尚未對外使用的日版 Card。

連結以 `private.enrich_pokemon_jp_metadata` 執行：只填空值、整批全有或全無、先 dry-run、追加式稽核與重播零異動。每張卡須同時成立：Provider ID 相同、系列代碼相同、Source archive 的 `ja` 等於日版名稱且 `zh-tw` 等於台版名稱、台版 Canonical card 尚未被其他卡共用；任一不符即隔離。日版原本的 Canonical card 保留不刪（不再被任何 Card 引用），以便連錯時還原。

台版沒有對應的祕密稀有卡，只在同一來源、同一系列內有日文名完全相同且已取得台版官方名的卡時，沿用該名稱作為 Derived name（同名推導名稱）；它不是身分證據，不連結作品層，並在資料中標記 `nameZhBasis: derived-same-name`，詳細頁另行標示。系列中文標題只採用同代碼台版系列的官方名稱；沒有台版的系列維持日文原名，不猜譯。

## Consequences

- 詳細頁可並列同一作品的日版與台版 Printing；作品層同時有中文與日文名稱，搜尋任一語言都會命中。
- 被取代的日版 Canonical card 成為無引用列；網站統計不以作品層數量計算，因此不影響公開數字。
- Derived name 可能在極少數「同名不同卡」情況下產生誤導，所以只限同一系列內、且所有同名的已連結卡對應到唯一中文名；多個候選即隔離。
- 跨系列推導、沒有台版的系列（SVLN、SVLS、SVK）與日版 `data_status` 升級不在本決策範圍。
- 同一函式也補上缺漏的稀有度（例如新增的 `ACE`），一樣只填空值。
