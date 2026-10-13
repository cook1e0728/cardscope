---
status: accepted
---

# TCGdex 匯入的日版系列，同號同名的多個官方頁同樣拆成「版本 k」卡

**狀態：已採用（2026-10-14，依使用者「照建議做」）。延伸 ADR 0035 到 Source archive（`tcgdex-ja`）系列。**

官方來源完整度稽核（2026-10-14，`docs/evidence/audit-20261014/pokemon-jp.md`）發現 S9a、S10a、S11a、S12a 四個強化擴充包在日本官方卡片搜尋中，有 226 組「同系列標記＋同卡號＋同日文名＋同稀有度圖示」的兩個官方頁（S9a 44、S10a 47、S11a 46、S12a 89）。資料庫這四個系列是 `tcgdex-ja` 匯入，每個卡號只有一張卡，ADR 0035 的函式只接受官方來源的原卡，因此沒有拆。S9a 第二頁的官方卡圖檔名都帶 `_m`（ミラー），另外三個系列的官方資料沒有標出差異。這四個系列的原卡也大多沒有官方卡圖（ADR 0031 當時要求系列標記＋卡號＋日文名唯一相符，同號兩頁就不唯一）。

決定：

- 比照 ADR 0035：官方卡片 ID 最小的一頁對應既有的 `tcgdex-ja` 原卡（版本 1），其餘各頁新增一張卡 `<原卡 ID>-v<k>`（k 依官方卡片 ID 數字排序，從 2 起），與原卡同一個 Canonical card。
- 新卡的來源是 `pokemon-card-official-jp`、Provider ID 是官方卡片 ID（不能沿用 `tcgdex-ja`：該來源的 Provider ID 會被拿去查 TCGdex 價格）。卡號、日文名、中文名（含依據）、稀有度、資料狀態沿用原卡；詳細頁網址與官方卡圖用該頁自己的。
- 命名：`variantName` 為「版本 k」；官方卡圖檔名帶 `_m` 的頁面為「版本 k（ミラー）」。原卡記為「版本 1」，並在 metadata 記下 `officialCardIds`。
- 原卡沒有官方卡圖時，補上版本 1 那一頁的官方卡圖（ADR 0031 規則：`not-provided`、`rights_note = 'ADR 0031'`），已有圖則不動。
- 身分核對：原卡的日版 Printing 系列代碼、卡號、日文名必須與官方頁相同；官方 ID 不得已被任何官方來源卡片或 Printing 使用；新卡 ID 不得已存在。每次最多 100 張新卡，gated dry-run、digest 重播零異動、追加式稽核。

## Consequences

- 四個系列多 226 張可分開收藏登記的版本卡，皆有官方卡圖；原卡補上官方卡圖。
- 新卡在搜尋與瀏覽中和原卡並列，詳細頁「收錄版本」可切換。
- TCGdex 價格只掛在原卡（`tcgdex-ja`）的 Printing 上；版本卡因同一作品層，詳細頁仍看得到原卡的價格，但價格不區分版本。
- 2026-10-14 執行：migration `20261014090000_pokemon_jp_archive_variant_split`（`private.split_pokemon_jp_archive_variants`，稽核 `private.catalog_jp_archive_variant_audit`），套用前以 migration＋4 份計畫＋4 份重播整批回滾測試（交易內 226／226／226／226，回滾後零殘留）。4 份計畫寫入 S9a 44、S10a 47、S11a 46、S12a 89 張版本卡，原卡補官方卡圖 226 張，重播零異動。新 Printing 的 `image_url` 留空、卡圖只在 `card_images`（同 ADR 0035），撤回 ADR 0031 時刪一張表即可。報告 `docs/evidence/pokemon-jp/official-series/archive-variant-split-report-20261014.json`。
