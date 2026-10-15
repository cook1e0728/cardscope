---
status: accepted
---

# 寶可夢日版與台版卡圖外連官方卡片搜尋：使用者接受風險

**狀態：已採用（2026-10-09，使用者選擇「接受風險，日台都外連」）。**

寶可夢日版 18,831 張 printing 幾乎沒有卡圖（ADR 0007 只從官方卡片搜尋收文字事實，明寫不讀不存圖片）；台版 12,669 張只有 2,146 張有 TCGdex 圖。商品圖已依 ADR 0029／0030 外連官方。使用者要求完善卡圖，經說明卡圖的著作權風險高於商品圖後，明確選擇日台都外連。

決定：

- **存放**：寫入 `card_images`（每張卡一列，`is_primary = true`，`image_rights_status = 'not-provided'`，`rights_note = 'ADR 0031'`），不改 `tcg_printings` 既有的 `image_url`／`source`。顯示由來源政策決定：日版 `source = 'pokemon-card-official-jp'`、台版 `source = 'pokemon-tw-official'`，兩者在 `data/source-registry.json` 的圖片顯示政策皆為 `risk-accepted`。
- **外連不轉存**：只存官方圖片網址，不下載、不重新託管、不改圖。
- **對應方式（不拿其他版本冒充）**：
  - 台版：printing 的 `metadata.officialDetailIds` 恰好一個時，圖片為 `https://asia.pokemon-card.com/tw/card-img/tw<詳細頁 ID 補零 8 位>.png`。同號多版本（多個 ID）不寫。只補目前沒有任何卡圖的卡；已有 TCGdex 圖的不動。
  - 日版：官方卡片 ID 來自官方來源 printing 的 `provider_id`，或先前官方核對快取中「系列標記＋卡號」唯一對應的卡片 ID；圖片路徑取自官方卡片清單 API 的 `cardThumbFile`（同一份清單、同一個卡片 ID）。對不到或不唯一的不寫。
- **撤回**：刪除 `card_images` 中 `rights_note = 'ADR 0031'` 的列，或移除來源政策，即停止顯示；權利人要求時立即執行。

ADR 0007 的「只收文字事實」仍適用於快取與證據檔：證據只存卡片 ID 與圖片路徑文字，不存圖片本身。

## 補充：後來匯入或補號的台版卡（2026-10-16）

10-09 回填之後匯入的台版卡（ADR 0041 特典系列、補號系列，以及 TCGdex 台版卡先前對不到官方 ID 的）仍顯示「圖片待補」。同一規則、同樣只補「完全沒有圖」的卡（printing 沒有 `image_url`、`card_images` 沒有任何列），寫入格式與 10-09 的列相同（`source = 'pokemon-tw-official'`、`language = 'zh-Hant-TW'`、`source_url` 為官方詳細頁、`not-provided`、`rights_note = 'ADR 0031'`、主圖）。1,863 張候選，寫入 1,307 張：

- printing 的 `officialDetailIds` 恰好一個：932 張，並與快取的官方詳細頁核對名稱、系列標記（沒有卡號的能量等以系列清單為準）。
- 沒有官方 ID（TCGdex 台版卡）：375 張。官方系列清單快取中「同系列、同卡號、同名稱、系列標記相符」恰好一筆者 303 張；沒有卡號的條目（基本能量、V-UNION、樂園度假地）只在該系列清單中同名恰好一筆、且資料庫該系列同名只有一張時才配對，72 張。
- 不寫（556 張）：同號多版本（多個官方 ID，例如一般版與寶可夢球鏡面版；M2a、MC、SV11B、SV11W、SV2a、SVI 與少數 M-P、SV-P）552 張，仍依本 ADR 不拿其中一個冒充；SV-P 的 樂園度假地 與勝利之證（冠軍／亞軍／季軍）4 張，官方同名條目不只一筆、分不出名次。
- 一個官方 ID 只給一張卡；寫入前以 12 個樣本確認圖片網址回應 200 且為 PNG；證據與 SQL 在 `docs/evidence/pokemon-tw/images-20261016/`。
