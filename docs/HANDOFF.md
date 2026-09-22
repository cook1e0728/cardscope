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

- 基準：GitHub `main` commit `2ff97e8`，已包含 PR #13 的系列範圍查詢改善。
- 進行中：PR #14，分支 `codex/pokemon-s10a-026-050`，加入寶可夢官方 `K`（Radiant Rare）正規化與無碰撞 migration。
- 本機驗證：`pnpm run check` 通過；`pnpm test` 162 項通過；正式庫已用 `BEGIN … ROLLBACK` 重跑 migration 兩次，第二次未再次位移稀有度階層，回滾後無殘留。
- 待完成：PR #14 CI 與合併、正式套用 migration、提升 S10a 026–050 的 50 個稀有度候選、驗證 25 個既有官方繁中名、Render 正式站核對。
- 圖片狀態：TCGdex 的 S10a 026–050 精確來源回應均未提供圖片 URL，因此本批圖片異動應為 0；不得以其他 printing 圖片代填。
- 本機保留：`.playwright-cli/`、`output/`、`pnpm-lock.yaml` 目前未追蹤，不加入本批提交，也不得清除。

## 下一個安全起點

先重新讀取 PR #14 的 CI 與合併狀態。只有 CI 成功並合併後，才將 `20260921095540_add_pokemon_radiant_rarity.sql` 套用到 Supabase；之後對 S10a 026–050 候選先 dry-run、核對 checksum 與預期計數，再正式提升並立即重播驗證冪等性。
