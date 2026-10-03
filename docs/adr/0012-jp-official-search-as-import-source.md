---
status: accepted
---

# Source archive 沒有日文名的日版系列，以日本官方卡片搜尋作為匯入來源

Source archive（TCGdex `c5c0a8a`）的 data-asia/S 中有 9 個日版系列有日文上市日卻沒有任何日文卡名：S4、S4a、S5a、S5R、S6a、S7R、S8a、S10b、S10D（共 745 張），現有匯入流程（ADR 0001、0002、0005）無法匯入。日本官方卡片搜尋（ADR 0007）對這些系列都有系列清單與詳細頁（系列標記、卡號、日文名、稀有度圖示）。決定（2026-10-03，使用者同意；AGENTS 規定的 Sol 架構裁決在此環境不可用，已向使用者說明）：這類系列直接以日本官方卡片搜尋作為匯入來源。

- 來源身分：`source = 'pokemon-card-official-jp'`，Provider ID 為官方 card ID；ID 為 `pokemon-official-ja-<系列>-<卡號>`、系列 `pokemon-official-ja-<系列>`，不得冒用 `tcgdex-ja`。Canonical card 與 Card 1:1（同 ADR 0001），不自動連結台版。
- 只收詳細頁的文字事實：系列標記須等於系列代碼、卡號、日文名；稀有度依 ADR 0007 對映（含 CSR、MA；無圖示為未知，不視為 No rarity mark）。同一卡號在官方有多張時整個卡號 Quarantine。
- 身分已由官方頁確認，Card 直接為 `verified`；Printing 依既有規則（稀有度已知為 `verified`，否則 `incomplete`）。
- 寫入：新的 private 匯入函式，比照 `import_pokemon_jp_metadata_batch`——每批 ≤100、同一敘述 dry-run 後才寫、digest 重播零異動、追加式稽核、與既有日版列（同系列代碼或同 Provider ID）任何碰撞即中止；系列代碼已有 `tcgdex-ja` 系列時一律拒絕。
- 中文名之後依 ADR 0011（台灣官方同卡號，須通過對齊檢查），不在匯入時填。
- 適用範圍補充（2026-10-03，照建議）：封存中有卡片但因來源異常被列入隔離清單的系列（SV5K ワイルドフォース；同期姊妹包 SV5M サイバージャッジ一併）同樣以本決定匯入，判準相同（系列代碼尚無 `tcgdex-ja` 系列）。
- 實作（2026-10-03）：系列的日文名與日文發售日取自 Source archive 的系列檔（`data-asia/S/<系列>.ts` 的 `name.ja`、`releaseDate.ja`；卡片層沒有日文名，系列層有），依據記在 series metadata `seriesNameBasis`。卡數以官方系列清單為準；官方清單可能漏列個別卡（先前 SV6a-092 的例子），漏列者不補、不猜。函式 `private.import_pokemon_jp_official_series`（migration `20261003080000`），證據為整個系列的官方頁快取與每系列 evidenceHash。

## Considered Options

- 等 TCGdex 補日文名：沒有時程。
- 把官方資料包裝成 `tcgdex-ja` 匯入：會讓來源紀錄失真，不採用。

## Consequences

- 日版資料從此有兩個來源身分；查詢、統計與稽核需以 `source` 區分。
- 若日後 Source archive 補上這些系列，同系列不得再以 `tcgdex-ja` 重複匯入，需另立決策（例如只補充欄位）。
