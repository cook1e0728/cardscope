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

- 程式基準：本輪從 GitHub `main` commit `7a65bef` 開始；卡片詳細視窗歷史導覽修正為 commit `f79127c`。返回到不含 `card` 的網址會關閉詳細視窗，前進／重新整理會重開正確卡片，Esc 只在圖片縮放未開啟時關閉詳細視窗。
- 驗證：Node 全套測試 `169/169` 通過；新增測試涵蓋返回、前進、重新整理、Esc 與縮放互斥。正式 Render 是否已取得本輪 GitHub commit，須在推送後另行核對；不可把本機 `127.0.0.1` 驗收當成正式部署完成。
- Supabase：正式專案 `ubiaftrvmywwmifqzmik` 的既有 schema／migration 維持不變；本輪只使用既有私有候選與交易式升級函式，沒有新增 DDL。安全與效能 advisor 仍只有既有 INFO。
- S10P 第一批：`pokemon-tcgdex-s10p-001-050-20260923` 提升 100 個候選，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `ad55e62be6dd89ca4224a62d5ed01aaa`，立即重播 `replay=true` 且再次異動為 0。
- S10P 第二批：`pokemon-tcgdex-s10p-051-067-20260923` 提升候選 `489–522` 共 34 筆，補上 17 張 card 與 17 個 printing 稀有度；17 個既有官方繁中名核對成功。checksum `db2aed5dd153fc894e7b4edf990f0978`，立即重播 `replay=true` 且再次異動為 0。
- S10P 完整結果：全系列 67 張，card／printing 稀有度缺口皆為 0、互相不一致為 0、缺少排名為 0；facets 為 `C:29`、`U:21`、`R:8`、`RR:6`、`RRR:3`。精確來源只提供前 20 張圖片，另 47 張維持缺圖；不得借用其他 printing 或推測圖片。
- S10b 阻擋證據：TCGdex `zh-tw` 的 001–050 可取回 50 個名稱但稀有度欄位為 0；051–071 可取回 21 個名稱但稀有度欄位仍為 0；072–079 為 404。正式庫既有 79 張 card／printing 皆缺稀有度，故本輪建立 0 個候選，不以其他語言、其他 printing 或推測值填補。
- 本機保留：`pnpm-lock.yaml` 目前未追蹤，不加入提交，也不得清除。若下一台電腦另有 `.playwright-cli/` 或 `output/`，同樣視為本機產物，不得誤刪或提交。

## 下一個安全起點

先替 TCGdex 候選 CLI 增加「精確系列 + 數字卡號範圍」篩選，避免目前字串排序把 `10` 排在 `2` 前面；必須保留每批最多 100 個 provider group、checksum／cursor 冪等與 dry-run 預設。通過單元測試後，再完整預檢 S11 `001–050`；只有來源逐張提供官方繁中名稱與非空稀有度、正式目標仍空白且 exact provider ID 唯一時，才可建立下一批候選。S10b 維持 `source-field-missing`，除非同一來源後續補回欄位或另有來源完成治理審核，不得直接升級。
