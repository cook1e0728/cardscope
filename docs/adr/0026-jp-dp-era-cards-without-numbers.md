---
status: proposed
---

# 日版 DP 世代卡片沒有印卡號：以官方詳細頁 ID 為身分，卡號可為空

**狀態：提案（2026-10-05 研究；2026-10-06 依審查修改並在正式庫整批回滾測試通過，分支 `claude/dp-unnumbered`）。migration 已移到 `supabase/migrations/` 但尚未套用、尚未合併 `main`；正式套用需使用者決定。**

日版 DP 世代（DP1～DP5）的卡面沒有印卡號，官方卡片搜尋的詳細頁也沒有卡號。官方另有「（DPx の全てのカード）」總清單（商品 ID 55～59），列出每個系列的全部卡片頁。目前 `tcg_cards.official_card_number` 是 NOT NULL，所有日版匯入函式也都以卡號組成卡片 ID，所以 DP 世代一直沒有收錄（依序執行 33、44）。

提案：

- **身分**：每個官方詳細頁是一張卡，Provider ID 為官方詳細頁 ID；卡片 ID `pokemon-official-ja-<系列>-c<詳細頁 ID>`。系列歸屬以總清單為準，詳細頁的系列標記必須等於系列代碼（基本能量標記為 ENE，排除）。這符合詞彙表「可靠 Provider ID 能證明身分」。
- **卡號**：`official_card_number` 改為可為空（只改欄位屬性，不重寫表），但加 CHECK（先 `NOT VALID`，避免在獨佔鎖下掃描全部約 7 萬張卡；`20261006000100` 另以較輕的鎖 VALIDATE）：只有 metadata `numberStatus = 'not-printed'` 的卡可以沒有卡號；單純漏填仍會失敗（本機測試確認，且必須用 `coalesce`，否則 NULL 會讓 CHECK 通過）。Printing 的 `local_card_number` 也為空。
- **顯示**：網站把這類卡顯示為「未印卡號」，與「卡號待補」（資料缺漏）區分。系列卡表、全遊戲瀏覽、排序搜尋三個函式原本只帶出 metadata 的 `nameZhBasis`，需要多帶 `numberStatus`。
- **排序**：系列卡表在卡號之後以官方清單位置（`officialListPosition`）排序，維持官方順序；全遊戲瀏覽不改排序，以免失去 `tcg_cards_game_number_idx` 索引。
- **系列名**（2026-10-06 定案，照 ADR 0019：成對擴充包沒有自然共同名稱時以「／」並列官方商品名，不自組名稱）：DP1「拡張パック「時空の創造 パールコレクション」／拡張パック「時空の創造 ダイヤモンドコレクション」」、DP2 拡張パック「湖の秘密」、DP3 拡張パック「ひかる闇」、DP4「拡張パック「夜明けの疾走」／拡張パック「月光の追跡」」、DP5「拡張パック「秘境の叫び」／拡張パック「怒りの神殿」」。發售日取官方商品清單，成對擴充包皆同日：2006-11-25、2007-03-02、2007-07-05、2007-10-26、2008-03-14（`docs/research/dp-unnumbered/series-meta-dp-20261006.json`）。
- **稀有度**：照 ADR 0019 只保留 C／U／R／RR／SR／UR；DP 的 `ic_rare_s`（可能是★）留空。
- **寫入**：獨立函式 `private.import_pokemon_jp_official_unnumbered_series`（批次 ≤100、gated dry-run、digest 重播、追加式稽核 `private.catalog_jp_official_unnumbered_audit`）。

## 影響

- 全站資料模型第一次允許卡號為空；伺服器與網站已檢查過會讀卡號的地方（排序遇空值排最後、價格查詢遇空值跳過、顯示改用共用函式）。
- DP 世代沒有台版對應（台灣官方未收錄），中文名只能依 ADR 0013 推導；不建立日台連結。
- 研究細節、本機測試方法與結果見 `docs/research/dp-unnumbered/README.md`。

## 正式庫回滾測試（2026-10-06）

一個請求內：兩個 migration、5 個系列 10 批 gated 寫入、10 批重播、反向測試，最後拋例外回滾（約 29 秒）。結果：DP1 124、DP2 145、DP3 146、DP4 163、DP5 154，共 732 張無卡號；稽核 import 10／replay 10；沒有標記的空卡號被 CHECK 拒絕；VALIDATE 後約束為有效；`browse_series_cards` 第一張為ドダイトス（官方清單順序）且帶 `numberStatus: not-printed`；排序搜尋「ドダイトス」含 3 張 DP 卡。測試後正式庫零殘留（約束、函式、系列皆不存在，欄位仍為 NOT NULL）。審查另確認：三個公開函式與正式庫現行版只差 `numberStatus` 與系列卡表排序；`search_names` 以 COALESCE 處理空卡號；14 個讀卡號的資料庫函式中，匯入函式要求卡號格式、日台同號連結以卡號比對，空卡號不會誤入或誤連；伺服器與網站讀卡號處都有空值保護。
