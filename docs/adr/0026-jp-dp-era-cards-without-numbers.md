---
status: proposed
---

# 日版 DP 世代卡片沒有印卡號：以官方詳細頁 ID 為身分，卡號可為空

**狀態：提案（2026-10-05，研究分支 `claude/dp-unnumbered-research`）。使用者選擇「只做研究不上線」：本 ADR 的 migration 只在本機 PGlite 測試過，沒有套用到正式庫，也沒有合併到 `main`。採用前需使用者決定。**

日版 DP 世代（DP1～DP5）的卡面沒有印卡號，官方卡片搜尋的詳細頁也沒有卡號。官方另有「（DPx の全てのカード）」總清單（商品 ID 55～59），列出每個系列的全部卡片頁。目前 `tcg_cards.official_card_number` 是 NOT NULL，所有日版匯入函式也都以卡號組成卡片 ID，所以 DP 世代一直沒有收錄（依序執行 33、44）。

提案：

- **身分**：每個官方詳細頁是一張卡，Provider ID 為官方詳細頁 ID；卡片 ID `pokemon-official-ja-<系列>-c<詳細頁 ID>`。系列歸屬以總清單為準，詳細頁的系列標記必須等於系列代碼（基本能量標記為 ENE，排除）。這符合詞彙表「可靠 Provider ID 能證明身分」。
- **卡號**：`official_card_number` 改為可為空，但加 CHECK：只有 metadata `numberStatus = 'not-printed'` 的卡可以沒有卡號；單純漏填仍會失敗（本機測試確認，且必須用 `coalesce`，否則 NULL 會讓 CHECK 通過）。Printing 的 `local_card_number` 也為空。
- **顯示**：網站把這類卡顯示為「未印卡號」，與「卡號待補」（資料缺漏）區分。系列卡表、全遊戲瀏覽、排序搜尋三個函式原本只帶出 metadata 的 `nameZhBasis`，需要多帶 `numberStatus`。
- **排序**：系列卡表在卡號之後以官方清單位置（`officialListPosition`）排序，維持官方順序；全遊戲瀏覽不改排序，以免失去 `tcg_cards_game_number_idx` 索引。
- **系列名**（照 ADR 0012 取官方商品名，DP 有成對擴充包，名稱為提案）：DP1 拡張パック「時空の創造」、DP2 拡張パック「湖の秘密」、DP3 拡張パック「ひかる闇」、DP4 拡張パック「夜明けの疾走」「月光の追跡」、DP5 拡張パック「秘境の叫び」「怒りの神殿」。發售日：成對擴充包同日發售者填該日，否則留空（待查）。
- **稀有度**：照 ADR 0019 只保留 C／U／R／RR／SR／UR；DP 的 `ic_rare_s`（可能是★）留空。
- **寫入**：獨立函式 `private.import_pokemon_jp_official_unnumbered_series`（批次 ≤100、gated dry-run、digest 重播、追加式稽核 `private.catalog_jp_official_unnumbered_audit`）。

## 影響

- 全站資料模型第一次允許卡號為空；伺服器與網站已檢查過會讀卡號的地方（排序遇空值排最後、價格查詢遇空值跳過、顯示改用共用函式）。
- DP 世代沒有台版對應（台灣官方未收錄），中文名只能依 ADR 0013 推導；不建立日台連結。
- 研究細節、本機測試方法與結果見 `docs/research/dp-unnumbered/README.md`。
