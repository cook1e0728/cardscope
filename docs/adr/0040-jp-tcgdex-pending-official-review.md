---
status: accepted
---

# 日版只存在於資料庫的 TCGdex 待核卡：依官方抽查標示、覆蓋或對卡

**狀態：已採用（2026-10-14，使用者同意抽查報告的四項建議）。延伸 ADR 0008（官方頁確認身分才升 verified）、ADR 0009（官方稀有度修正）、ADR 0031（官方卡圖外連）、ADR 0039（官方卡片 ID 記在 metadata）。**

官方來源完整度稽核（`docs/evidence/audit-20261014/pokemon-jp.md`）發現 TCGdex 封存匯入的日版系列，有一批 pending 卡在日本官方卡片搜尋找不到同號的卡。M6a 的 35 張已另案決定保留並標示。其餘 42 個 `tcgdex-ja` 系列的 348 張，用 pokemon-card.com 一般請求（228 次、間隔 ≥1.6 秒、無 stealth、不存圖）逐張抽查，報告在 `docs/evidence/audit-20261014/pokemon-jp-pending-spotcheck.{md,json}`。分四類，各自決定：

1. **UNRESOLVED 323 張與 OFFICIAL_OMITS_REAL_CARD 7 張：保留、標示、不刪。**
   - 323 張沒有逐卡的官方證據，但結構證據（官方資料庫在 S9 以前完全沒有 HR／UR 圖示、TCGdex 的卡號從官方最大號連續）偏向官方漏收，不是 TCGdex 亂編。Printing 與卡片 metadata 標 `officialListing: 'jp-not-listed'`，介面顯示琥珀色「待日本官方確認」（與 M6a 相同）。
   - 7 張（S5I 084／085、S6H 084／085、S6K 084／085／086）的官方商品頁文字或圖檔名證實 SA 版 VMAX 存在，但官方卡片搜尋沒收。標 `officialListing: 'jp-search-omitted'`，介面顯示綠色「官方商品頁已證實」（提示文字：日本官方商品頁證實這張卡存在，但官方卡片搜尋沒有收錄）。
   - 兩組都記 `officialListingCheckedAt` 與 `officialListingEvidence`（報告 JSON 路徑）。狀態維持 pending，稀有度不改。TCGdex 的稀有度標籤（道具與能量標 SR 等）不可當定論。
   - 前端：`ui-enhancements.js` 的 `listingBadge`／`listingNote` 依 `officialListing` 值選標籤，綠色變體 `.listing-badge-confirmed` 在 `theme-binder.css`。RPC 的 Printing metadata 白名單已含 `officialListing`（migration `20261014140000`），不需要新 migration。
2. **SM12a 184、197：以官方資料覆蓋。** 官方 184（卡片 ID 37452）是メルメタルGX SR、197（37465）是ホミカ SR；TCGdex 寫成ルカリオ&メルメタルGX UR、ホミカの演奏 UR，名稱與稀有度都與官方抵觸。
   - 日文名與稀有度改官方值；舊值留在卡片 metadata（`nameJaBefore`，沿用 ADR 0013 對調 M6 098／099 時的鍵；`nameJaBasis`）與 Printing metadata（`rarityBeforeOfficial`，詳細頁會顯示「依官方修正」）。`rarityBasis` 記 `pokemon-card-official-jp`，`officialCardIds` 記官方卡片 ID。
   - 中文名：197 的「霍米加的演奏」是依 ADR 0013 從 M4 077 ホミカの演奏同名推導的，日文名改為ホミカ後依據不成立；資料庫沒有其他日文名ホミカ且有官方依據的中文名可重新推導，所以清為待補，舊值與依據記在 `nameZhBeforeBasis`／`nameZhBefore`，並移除 `nameZhBasis`、`nameZhRule`、`nameZhSourceCardId`。184 原本就沒有中文名。
   - 名稱同步：卡片 `aliases`、`search_text`，以及 `tcg_canonical_cards`（`sync_tcg_canonical_from_card` 觸發器對既有名稱取舊值，不會更新）。每張卡自己一個 Canonical card，沒有共用。
   - 官方頁確認身分，依 ADR 0008 升 verified；補官方卡圖（ADR 0031：`not-provided`、`rights_note = 'ADR 0031'`）。
   - **TCGdex 價格會消失**：這兩張的 Provider ID 仍是 `SM12a-184`／`SM12a-197`（不改），價格查詢用 TCGdex 回傳的名稱與資料庫日文名比對（`sameTcgdexName`），改名後不符，所以不再顯示 TCGdex 價格。這是正確的：價格屬於 TCGdex 那張 UR 卡，不是官方這張 SR。
3. **對卡問題 16 張：用官方卡片 ID 對卡，不隔離、不改 Provider ID。** 卡片 metadata 記 `officialCardIds`（同 ADR 0039）。
   - 一對一的 9 張（S12a 255–258 對官方無卡號頁 42948–42951、SM5p 037／048、SM6a 050、SM6 094、SM8b 150）：升 verified（Printing 有稀有度才 verified，沒有則 incomplete，同既有的 `promote_pokemon_jp_data_status`），沒有卡圖者補官方卡圖。名稱寫法不同（ワタル♢、闘悪妖）維持原樣，因為改名會讓 TCGdex 價格查詢對不上。SM8b 150 官方頁沒有稀有度圖示，Printing 維持空值，狀態 incomplete。S12a 255–258 的 TCGdex 稀有度 UR 官方頁沒有圖示可驗證，維持原值。
   - SM5p 037／048 與 SM6a 050 的 TCGdex 稀有度「Rare Holo」換成官方 Prism Star 圖示對映的 `Rare Prism Star`（資料庫與 `data/rarity-rankings.json` 已有此代碼，顯示標籤「Prism Star」，其他 Prism Star 卡早已使用）；原值記 `rarityBeforeOfficial`。
   - 莫魯貝可 V-UNION 7 張（S8b 057–059、226–229）：官方只有 2 個無卡號頁（RRR 一頁 40208、CSR 一頁 41057），與資料庫的 3＋4 張不是乾淨的一對一，不強行拆。兩個官方 ID 都記在 7 張上，標 `officialListing: 'jp-matched-unnumbered'`，維持 pending，不補卡圖（對不唯一，ADR 0031 規則）；介面不顯示標籤。
4. **M6 098（ポケモンキャッチャー SR）與 099（とくちゅうチョッキ SR）升 verified。** 重抓官方詳細頁 50539、50540 確認系列標記、卡號、日文名、SR 圖示與資料庫完全相同，記 `officialCardIds`。

## Consequences

- 330 張卡在瀏覽與詳細頁帶標籤；其中 323 張提示「待日本官方確認」，7 張提示「官方商品頁已證實」。沒有任何一張被刪除。
- 寶可夢 `tcgdex-ja` 的 pending 卡 415 → 402（升 verified 13 張：SM12a 2、對卡 9、M6 2）。V-UNION 7 張仍是 pending。
- UNRESOLVED 的方向是推論不是證明；要提高確定性需要官方以外的第二個來源（印刷卡表或實體照片），本次沒有啟用任何新來源。若日後找到逐卡證據，改 `officialListing` 值或升 verified 即可，不需改程式。
- 撤回：標示只加三個 metadata 鍵，移除即可；覆蓋與升級的修改前完整列在 `docs/evidence/audit-20261014/jp-pending-review-20261014-before.json`；新增的卡圖刪 `card_images` 中這 11 張卡 `rights_note = 'ADR 0031'` 的列。
- 執行：`docs/evidence/audit-20261014/jp-pending-review-20261014.sql`，每個陳述式核對受影響列數；先以整批（寫入加重播）回滾測試，再寫入，重播零異動。報告 `jp-pending-review-20261014-report.json`。
