# CardScope 公開 Beta 資料與營運手冊

本文件定義目前五個 IP 的資料補全、來源狀態、故障處理與發布驗收。它不把目前資料列數當成官方完整卡表分母，也不把抽樣成功率描述成全庫完整度。

## 資料身分與缺口

- `tcg_cards` 是卡片身分；`tcg_printings` 保存地區、語言、卡號、稀有度、圖片與來源。平行版不得只因名稱相似而合併。
- 中文名稱需保存 `official`、`community` 或 `pending-review` 的來源狀態。沒有可核實來源時維持待核對，不推測官方譯名。
- 系列缺口固定分為 `uncollected`、`missing-fields`、`not-published`、`update-failed` 與 `complete`。
- 未取得可追溯的系列總數時，分母必須是 `null/unknown`；不得用已收錄數反推完整率。

產生系列級缺口清單：

```powershell
npm run catalog:gaps -- path\to\snapshot.json --output output\series-gaps.json
```

輸入快照可包含 `series`、`cards`、`printings`、`updates` 與 `baselines`。輸出是唯讀、可重現且帶 checksum 的 JSON，不會修改 Supabase。

## 寶可夢增量補全

目前已驗證的 TCGdex 工作先建立候選資料：每批最多 100 個 provider ID、只接受 provider ID 精確配對、只補空欄位、支援游標續傳。預設不抓圖片；圖片必須加 `--include-images`，通過實際圖片回應探測後仍標記為 `not-provided`，需另行審核展示權利。

```powershell
npm run catalog:enrich:pokemon -- path\to\snapshot.json --fields rarity,name_zh --output output\pokemon-plan.json
```

下一批將前一份輸出的 `cursor.next` 傳回 `--cursor`。此命令拒絕 `--apply` 與 `--write`；正式提升只能走私有、限量、精確配對且可重播的 `private.promote_pokemon_tcgdex_candidates`。一個批次可同時處理稀有度、官方繁中名與同 printing 圖片，但每個欄位都獨立計數：既有正確中文名只核對、不重寫；來源端沒有的圖片標記為 `not-published`，不得用其他版本圖片補洞。這能避免每次全庫重抓，也保留原始 printing、來源 URL、觀測時間與稽核記錄。

優先處理順序：

1. 寶可夢：稀有度與同一 printing 的卡圖缺口。
2. 遊戲王：繁體中文名與名稱來源狀態。
3. 航海王：缺少系列關聯的記錄；以每次 live 查核值為準，不把過往觀測的 60 筆寫成永久常數。

2026-09-18 的 Supabase 唯讀查核基準（之後會變動）為：寶可夢 28,073 張中卡片稀有度缺 7,721、printing 圖片缺 5,290、printing 稀有度缺 7,734；遊戲王 14,598 張中 14,598 張尚無 `official` 繁中名稱列，39,120 個 printing 缺圖；航海王 4,284 張中 60 張缺系列關聯。這些是目前列的欄位缺口，不是官方完整卡表分母。

## 來源更新狀態

每個來源都要保存：`lastSuccessAt`、`lastAttemptAt`、`nextUpdateAt`、`lastFailure`、`retryCount` 與 `enabled`。失敗不得覆蓋最近成功時間。停用或只能人工查核的來源必須顯示 `disabled/manual-only`，不得宣稱自動更新。

`providers/source-update-ledger.mjs` 會把來源正規化為 `healthy`、`failed`、`not-run` 或 `disabled`，並明確列出是否有待重試。這份狀態可嵌入日後的排程或健康報告，但目前不代表已有外部排程器。

## 行情與漲勢

- 過期價格只顯示為「歷史參考」。
- 只有相同 printing、相同價格種類，且有至少兩次可核實的觀測時間，才可顯示漲幅。
- 店家買取、平台掛牌、可驗證成交與未驗證使用者回報不得混算。
- 未取得可靠成交來源時，不顯示虛構成交價、成交量或市場熱度。

## 勘誤、故障與回復

- 卡片詳細視窗的「資料有誤？」是公開勘誤入口；回報故障不得阻塞查卡。
- 圖片失敗、API 失敗、合法零結果與載入中要保持不同畫面狀態，並提供重試。
- coverage 使用最後成功快照；更新失敗時標示 stale 與時間，不以空值覆蓋。
- 發布失敗時回復到上一個已驗證的 Git commit/Render deploy，再用相同五 IP 驗收腳本確認。

## 備份與還原演練

正式資料異動前需記錄 Supabase 備份點或可還原快照，並先在交易中 dry-run。每次演練記錄：日期、備份識別、還原目標、執行者、資料列／約束檢查及結果。

目前這個版本只完成流程與記錄格式，**尚未執行正式環境的破壞式還原演練**。在第一次批次提升候選資料前，必須完成一次非正式環境還原並保存證據。

若不建立付費開發分支，第一次三欄位 canary 必須先在正式資料庫用單一 `BEGIN … ROLLBACK` 交易演練 migration、候選提升、錯誤 checksum 拒絕、精確重播與 before snapshot。因 DDL 即使回滾仍可能取得短暫資料表鎖，執行前需另行取得正式庫 schema 演練核准；未核准時只能完成本機測試與 PR，不得直接套用 migration。

## 每次發布驗收

1. 執行 `npm run check` 與 `npm test`。
2. 在 390px、430px 與桌面尺寸連續切換五 IP 各 20 次，包含慢網路、亂序回應、API 失敗、失效圖片與零結果。
3. 驗證分享網址、重新整理、上一頁、稀有度升降序與詳細視窗底部可見。
4. 每個 IP 抽查至少 20 個 printing，記錄抽樣時間、範圍、成功率與失敗原因；抽樣不可宣稱全庫完成。
5. 合併後確認 Render 實際 commit、`/api/catalog/health` 快照版本與五 IP API 結果，再對外描述為已部署。
