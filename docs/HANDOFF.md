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

- 程式基準：本輪從 GitHub `main` commit `bf291f3` 開始；精確系列與數字卡號範圍功能為 commit `7dc89a4`。Pokémon 候選規劃／執行 CLI 現在支援 `--series`、`--card-number-from`、`--card-number-to`，使用正規化後的精確系列比對、含頭尾的數字範圍與數值排序，並拒絕無效或反向範圍。明確系列／卡號若與 provider ID 衝突會被排除。
- 驗證：Node 全套測試 `175/175` 通過；既有 dry-run、每批最多 100 個 provider group、checksum／cursor 冪等與斷點續傳行為維持不變。Render 在本輪推送前的正式版本仍為 `bf291f3`；推送後必須重新確認最新 `main` 已為 Live，且正式 `/api/catalog/health` 回傳 HTTP 200。不可把本機 `127.0.0.1` 驗收當成正式部署完成。
- Supabase：正式專案 `ubiaftrvmywwmifqzmik` 的既有 schema／migration 維持不變；本輪只使用既有私有候選與交易式升級函式，沒有新增 DDL。安全與效能 advisor 仍只有既有 INFO。
- S11 第一批：`pokemon-tcgdex-s11-001-050-20260923` 提升候選 `523–622` 共 100 筆，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `ade16efcdeedc77f552d3dc6e6ef61f2`，立即重播 `replay=true` 且再次異動為 0。
- S11 第二批：`pokemon-tcgdex-s11-051-100-20260923` 提升候選 `623–722` 共 100 筆，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `1f972e9c66d04240a3722e418237e300`，立即重播 `replay=true` 且再次異動為 0。
- S11 完整結果：全系列 100 張，card／printing 稀有度缺口皆為 0、互相不一致為 0、缺少排名為 0；facets 為 `C:44`、`U:34`、`R:10`、`RR:8`、`RRR:4`。精確來源只提供前 20 張圖片，另 80 張維持缺圖；不得借用其他 printing 或推測圖片。
- 已完成系列：S10a `001–071`、S10P `001–067` 與 S11 `001–100` 的 card／printing 稀有度均已補齊，且官方繁中名稱均完成逐張核對。
- S10b 阻擋證據：TCGdex `zh-tw` 的 001–050 可取回 50 個名稱但稀有度欄位為 0；051–071 可取回 21 個名稱但稀有度欄位仍為 0；072–079 為 404。正式庫既有 79 張 card／printing 皆缺稀有度，故本輪建立 0 個候選，不以其他語言、其他 printing 或推測值填補。
- 本機保留：`pnpm-lock.yaml` 目前未追蹤，不加入提交，也不得清除。若下一台電腦另有 `.playwright-cli/` 或 `output/`，同樣視為本機產物，不得誤刪或提交。

## 下一個安全起點

使用新的精確範圍 CLI 完整預檢 S11a `001–050`；只有來源逐張提供官方繁中名稱與非空稀有度、正式目標仍空白且 exact provider ID 唯一時，才可建立候選並升級。第一批驗證及冪等重播通過後，再處理 S11a `051–068`。目前 S11a 共有 68 張，card／printing 稀有度各缺 68，另有 48 張缺少來源圖片；不得借用其他 printing 或推測圖片。S10b 維持 `source-field-missing`，除非同一來源後續補回欄位或另有來源完成治理審核，不得直接升級。
