---
status: accepted
---

# Source archive 缺少的台版系列，以台灣官方卡片搜尋匯入，並連結對應的日版卡

台版 Printing 原本只來自 Source archive（TCGdex zh-tw，98 個系列）。台灣官方卡片搜尋的系列清單（ADR 0014 的證據）有 134 個代碼，缺少整個 MEGA 世代（M1L～M6a、MC、MF）、SV11B／SV11W、SVK 等。這些系列的台灣官方清單、詳細頁與稀有度篩選，在 ADR 0010／0011 的作業中已完整快取（`docs/evidence/pokemon-tw/official-rarity-20261002.json`）。

決定（2026-10-03，使用者授權照建議執行），比照 ADR 0012：

- 來源身分 `asia-pokemon-card-official-tw`；ID `pokemon-official-tw-<系列>-<卡號>`、系列 `pokemon-official-tw-<系列>`；Provider ID 為該卡號各版本中最小的官方詳細頁 ID，全部版本 ID 記在 metadata `officialDetailIds`。
- 每個卡號一張卡；同卡號的各版本須顯示相同系列標記（或系列代碼作分母）與相同中文名，否則整號隔離。稀有度只在每個版本恰好屬於一個稀有度篩選且彼此一致時採用（ADR 0010），否則留空。
- 卡片身分由官方頁確認，Card 為 `verified`；Printing 有稀有度為 `verified`，否則 `incomplete`。系列名取官方標籤「」內文字（無引號則用完整標籤），發售日留空。
- 寫入：`private.import_pokemon_tw_official_series`（批次 ≤100、gated、digest 重播、追加式稽核、同代碼已有台版系列即拒絕）。
- 連結：日版卡若依 ADR 0011 取得中文名（`tw-official-same-number`），且引用的官方詳細頁 ID 是新台版卡的版本之一、系列代碼與卡號相同、中文名相同，則依 ADR 0003 的方式加入該台版卡的 Canonical card（`private.link_pokemon_jp_tw_official`）。同名推導（ADR 0004／0013）的日版卡不據此連結。

## Consequences

- 2026-10-03：14 個系列 2,366 張台版卡匯入；2,117 張日版卡連結，詳細頁與搜尋可並列日版與台版 Printing。
- SVK 的台灣官方卡號排列與日版不同（ADR 0011 對齊被拒），台版仍匯入，但不連結。
- 官方快取尚未涵蓋的台版系列（牌組、戰術牌組、SM 時期的 AS／AC 等）需另行抓取後以同一流程匯入。
