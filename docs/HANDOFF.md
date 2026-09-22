# CardScope 工作交接

本文件是跨電腦、跨對話的短版 checkpoint。長期需求以 `docs/PRODUCT_PLAN.md` 為準；本文件只記錄目前已驗證狀態與下一個安全起點。

## 更新規則

在下列任一節點更新本文件：PR 合併、正式 migration、正式資料批次、Render 發布驗收。每次覆寫已過期的「目前里程碑」，不要累積聊天逐字稿。

交接必須包含：

- GitHub `main` commit 與 PR。
- 本機測試、CI、Supabase 與 Render 各自的完成狀態。
- 資料批次範圍、候選數、實際異動數、重播結果與缺口原因。
- 尚未執行的唯一下一步，以及開始前必須重新核對的外部狀態。
- 未追蹤或屬於使用者的本機檔案，避免下一台電腦誤刪。

## 目前里程碑

- 基準：GitHub `main` commit `6b28d1d`，PR #14 已合併；CI 成功，寶可夢官方 `K`（Radiant Rare）正規化與 migration 已進入 `main`。
- Supabase：`add_pokemon_radiant_rarity` 已正式套用；`K` 為 tier 11，既有較低稀有度只位移一次。安全與效能 advisor 只有既有 INFO 項目，沒有本批新增錯誤。
- 資料批次：`pokemon-tcgdex-s10a-026-050-20260922` 已提升 50 個候選；25 張卡片稀有度與 25 個 printing 稀有度完成，25 個既有官方繁中名核對成功，名稱與圖片均未被重寫。
- 冪等驗證：立即重播為 `replay=true`，卡片、printing、名稱與圖片的再次異動數均為 0。
- Render：S10a-027「光輝沙奈朵」與 S10a-050「光輝大鋼蛇」均顯示 `K`；S10a-031「眷戀雲V」顯示 `RR`；系列 facets 含 `K: 3`，printing／image 查詢錯誤皆為 `null`。
- 圖片狀態：TCGdex 的 S10a 026–050 精確來源回應均未提供圖片 URL，所以本批圖片異動為 0；不得以其他 printing 圖片代填。
- 已知營運項目：`/api/catalog/health` 可回傳 fresh legacy snapshot，但 v2 查詢仍會遇到 statement timeout；這不是本批資料提升造成，需在可靠性階段續辦。
- 本機保留：`.playwright-cli/`、`output/`、`pnpm-lock.yaml` 目前未追蹤，不加入提交，也不得清除。

## 下一個安全起點

從 S10a 051–075 開始下一個最多 100 候選的精確來源批次。先重新抓取並核對每筆 TCGdex `zh-tw` 名稱、稀有度與圖片欄位，再建立 dry-run；圖片只在同一 printing 有來源 URL 且通過既有權利／探測門檻時才建立候選。另一條獨立工作是查明 health v2 statement timeout，故障時繼續保留最後成功快照。
