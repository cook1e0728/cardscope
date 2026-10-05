# DP 世代（未印卡號）匯入研究

狀態：研究完成，**沒有上線**（2026-10-05，分支 `claude/dp-unnumbered-research`）。使用者選擇「只做研究不上線」：草稿 migration 沒有套用到正式庫、沒有合併 `main`。決策紀錄見 `docs/adr/0026-jp-dp-era-cards-without-numbers.md`（proposed）。

## 官方資料（日本官方卡片搜尋，ADR 0007 節流：單一連線、間隔 1.5 秒、只存文字）

- 總清單「（DPx の全てのカード）」，以 `pg=<商品 ID>` 讀取：55＝DP1 132 頁、56＝DP2 153、57＝DP3 154、58＝DP4 171、59＝DP5 162；去重後 740 頁。快取：`official-dp-cache-20261005.json`。
- 每個清單都含同樣 8 張基本能量（詳細頁沒有系列標記），排除後 DP 卡 **732 張**：DP1 124、DP2 145、DP3 146、DP4 163、DP5 154。
- 詳細頁一律沒有卡號。稀有度圖示：C 192、U 183、R 202、`ic_rare_s` 21（LV.X 系主力卡，可能是★，ADR 0019 不對映）、無圖示 134（多為牌組收錄的同名卡與訓練家卡）。依 ADR 0019 只保留 C／U／R，其餘 155 張稀有度未知。
- 同名不同卡：例如 DP1 的ドダイトス有擴充包版（`ic_rare_s`）與牌組版（無圖示），各有自己的官方詳細頁；以詳細頁 ID 為身分可以分開，但系列卡表會出現兩張同名卡，沒有卡號可區分。

## 修改內容（本分支）

- 網站：`ui-enhancements.js` 的 `cardNumberLabel` 對 `metadata.numberStatus = 'not-printed'` 顯示「未印卡號」，否則仍是「卡號待補」；詳細頁改用同一函式；`index.html` 兩處卡號顯示同步；`server.mjs` 日版價格查詢遇到沒有卡號直接跳過。測試 `test/browse-contract.test.mjs`。
- 計畫產生器：`providers/pokemon-jp-official-unnumbered-plan.mjs`（測試 `test/pokemon-jp-official-unnumbered-plan.test.mjs`）。
- 草稿 migration：`20261005020000_pokemon_jp_official_unnumbered_series.sql`（刻意不放在 `supabase/migrations/`）。內容：卡號可為空＋CHECK、DP 匯入函式與稽核表、三個公開函式帶出 `numberStatus`、系列卡表以官方清單順序排序。

## 本機測試（PGlite，未連正式庫）

`local-check.mjs` 依 `schema-snapshot-*.json`（2026-10-05 從正式庫唯讀取得的欄位定義、觸發器、兩個公開函式、遊戲與稀有度資料）重建最小 schema，套用草稿 migration，匯入五個系列、重播，並做反向測試。重跑方式：

```bash
mkdir dp-check && cp docs/research/dp-unnumbered/local-check.mjs docs/research/dp-unnumbered/schema-snapshot-*.json docs/research/dp-unnumbered/official-dp-cache-20261005.json dp-check/
cd dp-check && npm init -y && npm install @electric-sql/pglite@0.3
CARDSCOPE_REPO=<repo 路徑> node local-check.mjs official-dp-cache-20261005.json '[{"code":"DP1","listKey":"55","name_ja":"拡張パック「時空の創造」"}]'
```

結果（五個系列）：732 張寫入、10 批＋10 批重播全為 replay；系列卡表第一張為ドダイトス（官方清單順序）並帶出 `numberStatus=not-printed`；詳細頁 Printing 卡號為空；「沒有卡號又沒有標記」與「計畫帶卡號」皆被拒絕。

測試過程發現並修正的問題（上線前不會被注意到）：

1. CHECK 寫成 `metadata->>'numberStatus' = 'not-printed'` 時，metadata 沒有該鍵會得到 NULL，CHECK 視為通過；改用 `coalesce`。
2. 系列卡表在卡號都為空時退回以 ID 排序（第一張變成ヘラクロス），改為卡號後接 `officialListPosition`。
3. 系列卡表、全遊戲瀏覽、排序搜尋只帶出 `nameZhBasis`，網站拿不到 `numberStatus`，會顯示「卡號待補」；三者都改為一併帶出。
4. 全遊戲瀏覽不改排序：它依賴 `tcg_cards_game_number_idx`，加入運算式排序會失去索引。

## 上線前仍需決定或補做

- 系列名（成對擴充包的寫法）與發售日來源。
- 正式庫回滾測試（整份 migration＋五個系列＋重播）後才能套用；Management API 約 100 秒切斷，需分請求。
- 中文名只能依 ADR 0013 推導；DP 沒有台版對應，不建立日台連結。
