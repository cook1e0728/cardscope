---
status: accepted
---

# Source archive 台版系列缺少的卡號，以台灣官方卡片搜尋補進同一系列

查證 TCGdex 的 `Ultra Rare` 對映是否影響台版時（2026-10-04），發現台版 Source archive（tcgdex-zh-tw）有 802 筆稀有度不是官方依據：其中 298 筆在台灣官方快取中有資料，全部與官方一致；其餘 504 筆屬於 S10a、S10P、S11、S11a、SV9、SV10 六個尚未抓取的系列，而且都只有 C／U／R／RR／RRR／K。補抓這六個系列的官方清單後，S 世代四個系列的張數與資料庫完全相同；SV9、SV10 官方各有 132 張，資料庫只有 100 與 98 張，祕密稀有卡整批缺漏。ADR 0015 的匯入只處理整個系列都沒有的情況，同代碼已有 Source archive 系列就拒絕。

決定（2026-10-04，使用者授權照建議執行）：

- 缺少的卡號補進**既有的 Source archive 系列**，使用者看到的仍是同一個系列；卡片本身的來源、ID 與欄位完全比照 ADR 0015（`asia-pokemon-card-official-tw`、`pokemon-official-tw-<系列>-<卡號>`、每號一張、同號各版本須同名、稀有度依 ADR 0010）。
- 對齊保護：系列中已有的每一個卡號，中文名都必須與官方同號卡一致（ADR 0010 名稱規則），官方清單也必須涵蓋所有已有卡號；任何一筆不符，整個系列不補。資料庫端再以已有名稱逐字核對，防止計畫產生後資料變動。
- 只新增、不修改既有列：`private.supplement_pokemon_tw_official_series`（每系列一批 ≤100 張、gated dry-run、digest 重播、追加式稽核 `private.catalog_tw_official_supplement_audit`）。
- 日版連結只依既有規則（ADR 0003／0015），不以名稱另行連結。
- Source archive 既有稀有度與官方不同時，依 ADR 0010 只記錄差異。

## Consequences

- 2026-10-04：SV9 補 32 張（101–132）、SV10 補 34 張（099–132），全部有官方稀有度（AR／SR／SAR／UR），重播零異動；兩系列已有卡號全部與官方對齊。S 世代四個系列沒有缺號。Source archive 802 筆非官方依據的稀有度與官方全部一致。
- 日版 SV9／SV10 祕密稀有卡的中文名是同名推導，不是身分證據，因此不連結。
- 台版 SV9、SV10 的祕密稀有卡進入卡表；同一系列內會有兩種來源的卡片，來源欄位可區分。
- 之後其他 Source archive 系列若發現缺號，可用同一流程補齊。
