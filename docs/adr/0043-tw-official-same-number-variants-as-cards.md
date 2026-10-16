---
status: accepted
---

# 台版同號多個官方版本拆成同一作品層下的多張卡，以「版本 k」命名

**狀態：已採用（2026-10-16，使用者決定「台版同號多版本比照日版拆成版本卡」）。延伸 ADR 0035、ADR 0039 到台版，並取代 ADR 0031 補充中「同號多版本仍不寫圖」的暫時處理。**

台灣官方卡片搜尋中，同系列、同卡號、同名稱、同稀有度的詳細頁可能不只一頁（一般版、寶可夢球／大師球鏡面等）。台版匯入（ADR 0010、0015）把這些頁合併成一張卡，Printing 的 `metadata.officialDetailIds` 列出全部官方 ID，結果是：收藏者無法分開登記，ADR 0031 補充也因為「分不出卡片是哪一頁」而不能補官方卡圖（552 張台版卡仍顯示「圖片待補」）。

決定：

- 範圍：台版寶可夢卡中 `officialDetailIds` 至少 2 個、且 printing 與 `card_images` 都沒有任何圖的 552 張：M2a 118（每張 3 頁）、MC 120、SV11B 80、SV11W 80、SV2a 136（TCGdex 台版卡，沒有官方原卡）、SVI 15（2～4 頁）、M-P 2、SV-P 1。
- 官方詳細頁 ID 最小的一頁保留原卡（版本 1）；其餘各頁各新增一張卡 `<原卡 ID>-v<k>`（k 依官方詳細頁 ID 數字排序，從 2 起），與原卡同一個 Canonical card。既有收藏、分享連結、搜尋不受影響。
- 新卡的來源是 `asia-pokemon-card-official-tw`、Provider ID 是官方詳細頁 ID（與既有台灣官方匯入卡相同；`pokemon-tw-official` 是 `card_images` 的圖片來源名稱，不是卡片來源）。卡號、中文名（含依據）、稀有度、資料狀態沿用原卡；詳細頁網址與官方卡圖（ADR 0031，只寫 `card_images`，Printing 的 `image_url` 留空）用該頁自己的。新卡的 metadata 只帶白名單鍵（稀有度依據與標記、中文名依據、卡號狀態），不帶 TCGdex 的 `imageBase`、`tcgdexId` 等。
- 原卡沒有任何卡圖時補上版本 1 那一頁的官方卡圖；已有圖則不動。原卡 metadata 只新增 `officialDetailIds`（全部版本，作為拆分依據）、`variantIndex`、`variantName`、`variantRule`，Printing 只新增 `variantKey`、`variantName`。新卡與其 Printing 的 `officialDetailIds` 只含自己那一頁。
- 命名：`variantName` 為「版本 1」「版本 2」…（版本列另有 `variantKey` `v1`、`v2`）。台灣官方快取（系列清單與詳細頁）只有名稱、系列標記、卡號、稀有度篩選結果，圖片檔名 `tw<ID>.png` 不含版本資訊，稀有度在同號各頁也全相同，因此沒有任何明確證據能標示「鏡面」「球種」，一律用中性編號，不以人工描述命名。
- 身分核對：原卡的台版 Printing 來源、系列代碼、卡號、中文名必須與快取的官方頁相同（名稱依 ADR 0010 規則，系列標記一致，promo 頁以系列清單為準）；Printing 的官方 ID 清單與計畫相同且由小到大；台灣官方原卡的 Provider ID 是最小的官方 ID；官方 ID 不得已被台灣官方來源的其他卡片或 Printing 使用；新卡 ID 與圖片網址不得已存在。每個原卡的所有額外官方頁必須在同一份計畫，每次最多 100 張新卡，gated dry-run、digest 重播零異動、追加式稽核 `private.catalog_tw_variant_split_audit`。
- 日版不動（ADR 0024）：日版卡與這些台版卡的連結維持原作品層，不為了版本重新連結。SVI 的日版卡先前已依 ADR 0035 拆成版本卡（同一作品層），拆分後該作品層同時有台版與日版的「版本 k」，各自按地區顯示。

## Consequences

- 2026-10-16：8 個系列 552 張原卡（M2a 118、MC 120、SV2a 136、SV11B 80、SV11W 80、SVI 15、M-P 2、SV-P 1），新增 685 張版本卡（M2a 236、MC 120、SV2a 136、SV11B 80、SV11W 80、SVI 30、M-P 2、SV-P 1），12 份計畫寫入＋重播零異動；685 張新卡與 552 張原卡皆有官方卡圖。migration `20261016100000_pokemon_tw_official_variant_split`（`private.split_pokemon_tw_official_variants`），套用前以 migration＋12 份計畫＋12 份重播整批回滾測試（交易內新卡 685、新 Printing 685、新卡圖 685、原卡 552，回滾後零殘留）。證據 `docs/evidence/pokemon-tw/variant-split-20261016/`。
- 沒有拆的同號多版本台版卡：SV2a 17 張、SV8a 144 張已有 TCGdex 台版圖（不屬於「完全沒有圖」）。已於 2026-10-17 處理，見下方補充。
- 台版官方 ID 與日本官方卡片 ID 是不同編號空間，數字可能相同（SV2a 的 7 個台灣詳細頁 ID 15000～15006 同時是日版 EP08 官方卡片 ID）；唯一索引是（來源、Provider ID），來源不同不衝突，ID 碰撞檢查因此只看台灣官方來源。
- 之後 ADR 0010／0015 匯入或補號若再遇到同號多頁，應直接依本 ADR 拆成多張卡。

## 補充：原卡已有 TCGdex 台版圖的同號多版本（2026-10-17）

前面「沒有拆的」SV2a 17 張、SV8a 144 張（共 161 張，每張恰好 2 個官方 ID）已有 TCGdex 台版圖，先要知道這張圖是哪一頁。逐張把 TCGdex 的 `low.webp` 與兩個官方卡圖 `tw<ID 補零 8 位>.png` 縮成同尺寸後比對（平均像素差與 dHash；圖片只存在暫存資料夾、不進 repo，每 1.6 秒一個請求，全數 HTTP 200）：

- 161 張全部可明確判定，沒有模糊者：吻合的那一頁像素差 0.0046～0.0086，另一頁 0.0465～0.1682（兩個官方頁之間至少差 0.0465，256 位 dHash 吻合者差 ≤ 10 位、另一頁差 ≥ 28 位）。
- 沒有單一規則：SV2a 17 張全是官方 ID 較小的一頁；SV8a 144 張中 110 張是**較大的** ID（例如 SV8a-001 是 12319，不是 11526），34 張是較小的。因此逐張依圖片判定，不套「一律最小 ID」。
- 決定：原卡對應到它圖片所屬的那一頁，版本序號仍依官方 ID 由小到大排（「版本 1」永遠是最小的 ID）。原卡不是版本 1 時，原卡的 `variantIndex`／`variantName`／`variantKey` 就是它那一頁的序號（例如「版本 2」），較小 ID 的那一頁新增為 `<原卡 ID>-v1`（卡片 ID 的 `-v<k>` 一律等於版本序號，所以此時會出現 `-v1`）。原卡 metadata 另記 `variantOfficialDetailId`（它對應的官方 ID，其餘版本的 metadata 見上）。原卡既有的 TCGdex 圖不動、不加官方圖；新卡圖用該頁自己的官方圖。這樣每個版本只出現一次，不會讓同一張圖同時掛在「版本 1」和「版本 2」，也不會有一頁官方圖沒人顯示。
- 程式：migration `20261017100000_pokemon_tw_variant_split_base_version`（只 `create or replace` 同一個函式，計畫列新增選用欄位 `baseVersionIndex`，預設 1，與 10-16 的 12 份計畫完全相容；稽核表、100 張上限、重播零異動、ID 與圖片碰撞檢查不變）；`providers/pokemon-tw-official-variant-plan.mjs` 新增 `imageMatches`，原卡有 printing 圖但沒有比對結果時一律不拆（`base-image-version-unknown`）。
- 2026-10-17 結果：SV2a 17 張、SV8a 144 張原卡（3 份計畫：17、100、44 張新卡），新增 161 張版本卡（原卡為版本 1：SV2a 17＋SV8a 34；原卡為版本 2：SV8a 110），每張新卡有自己的官方卡圖、Printing 與同一作品層；原卡的 TCGdex 圖不變。3 份計畫寫入＋重播零異動。證據 `docs/evidence/pokemon-tw/variant-split-20261017/`（`image-match.json` 為逐張距離與對應表，`compare-images.py` 為比對程式）。
