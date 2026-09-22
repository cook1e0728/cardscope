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

- 基準：GitHub `main` commit `7a3ca98`。PR #16、#17、#18 已合併且 CI 成功；分別完成 health v2 單次彙總、函式級 `work_mem=64MB` 與函式級 `statement_timeout=15s`。
- Supabase：`optimize_catalog_health_snapshot_v3`、`tune_catalog_health_work_mem`、`set_catalog_health_function_timeout` 已正式套用。設定只作用於 `catalog_health_snapshot_v2()`，未提高角色、資料庫或一般瀏覽查詢的 timeout。安全與效能 advisor 只有既有 INFO，沒有本階段新增警告或錯誤。
- Health v2：正式 Render `/api/catalog/health` 冷啟動約 11 秒後成功回傳 `supabase-health-snapshot-v2`，`healthCompatibilityWarning=null`、圖片指標為 `per-source-policy`、所有 orphan 計數為 0；已不再退回 legacy snapshot。快取 TTL 為 5 分鐘。
- 資料批次：`pokemon-tcgdex-s10a-051-071-20260922` 已提升 42 個候選；21 張卡片稀有度與 21 個 printing 稀有度完成，21 個既有官方繁中名核對成功，名稱與圖片均未被重寫。
- 冪等驗證：立即重播為 `replay=true`，卡片、printing、名稱與圖片的再次異動數均為 0。TCGdex 的 S10a-072 至 075 為 404；此系列實際止於 071，不列為資料缺口。
- Render：S10a 全系列共 71 張，稀有度 facets 為 `C:26`、`U:23`、`R:10`、`RR:6`、`RRR:3`、`K:3`，未知稀有度為 0；抽查 051、057、062、071 的 card／printing 稀有度一致，printing／image 查詢錯誤皆為 `null`。
- 圖片狀態：TCGdex 的 S10a 051–071 精確來源回應均未提供圖片 URL，所以本批圖片異動為 0；不得以其他 printing 圖片代填。這是來源覆蓋缺口，不是卡片名稱或 printing 關聯失敗。
- 本機保留：`.playwright-cli/`、`output/`、`pnpm-lock.yaml` 目前未追蹤，不加入提交，也不得清除。

## 下一個安全起點

從 `pokemon-tcgdex-tw-s10b`（Pokémon GO）001–050 開始下一個精確來源批次。該系列目前共 79 張，79 張 card／printing 稀有度待補、59 張缺圖；因每張卡會建立 card 與 printing 兩個稀有度候選，第一批最多處理 001–050（100 候選），第二批再處理 051–079（58 候選）。開始前必須重新抓取並逐筆核對 TCGdex `zh-tw` 名稱、稀有度與圖片欄位，先 dry-run；名稱只補空值，圖片只在同一 printing 有精確來源 URL 且通過既有權利／探測門檻時建立候選，不得借用其他 printing。完成後重播驗證冪等，並在 Render 核對總數、facets、名稱、稀有度及圖片狀態。
