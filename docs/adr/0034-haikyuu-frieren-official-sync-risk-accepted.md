---
status: accepted
---

# 排球少年、芙莉蓮官方卡表：使用者接受未確認條款的風險，開啟自動同步

**狀態：已採用（2026-10-11，使用者明確同意「1 接受」）。**

排球少年（TAKARA TOMY）與葬送的芙莉蓮（Weiß Schwarz）的資料只有 2026-08-31 一次性匯入，之後沒有更新：`data/source-registry.json` 的 `haikyu-official`、`weiss-schwarz-official` 為 `permission-pending`、`collectionEnabled: false`，而且專案裡沒有同步程式。主方案規定，啟用條款不明的來源屬於「必須接受新的法律／授權風險」，需由使用者決定；本次使用者已明確同意（航海王於 ADR 0027 已先開啟）。

決定：

- **範圍**：排球少年讀官方卡表的 JSON（`master.php` 系列、`itemsearch.php` 卡片）；芙莉蓮讀 Weiß Schwarz 官方卡表的 JSON（`filter-options` 擴充包清單、`searchJson`），只取作品編號 147（葬送のフリーレン）的擴充包。只收文字事實（卡號、名稱、讀音、稀有度、類別、系列名）與官方圖片網址。不新增其他網域、不收其他作品。
- **條款依據**：仍沒有書面許可或明確條款。`robots.txt`（2026-10-11 查）：takaratomy.co.jp 為 `Allow: /`；ws-tcg.com 只禁止 `/wordpress/wp-admin/`。`metadataCollection` 記為 `risk-accepted`，不表示已取得授權。
- **只新增**：官方有而資料庫沒有的系列、卡片、版本才寫入（PostgREST `resolution=ignore-duplicates`）；既有列一律不改，以免覆蓋手動整理的系列中文名與中文別名。官方與既有資料不同的卡號、名稱、稀有度只記在 `catalog_sync_runs.metadata.differences`。ID 規則沿用首次匯入：`haikyuu-<官方 ID>`、作品層 `haikyuu-<系列>-<卡號>`；`weiss-<官方 ID>`、作品層 `weiss-<卡號>`，系列 `weiss-frieren-<代碼>`（試玩牌組為 `-TD`）。
- **頻率與禮貌**：每 72 小時最多一次（`refreshHours: 72`）；單一連線、請求間隔至少 1.1 秒；非 200 重試兩次後停止。官方回報的總數與實際取得張數不符即停止、不寫入。
- **圖片**：顯示政策不變（`imageDisplayPolicies` 兩個來源本來就是 `risk-accepted`），只外連官方網址，不轉存。
- **撤回**：把 `collectionEnabled` 改回 `false` 即停止；已寫入的資料保留。

## Consequences

- 2026-10-11 比對：官方排球少年 533 張、芙莉蓮 751 張（41／223／238／249）；用同步程式的轉換函式產生的資料列與既有列的作品層、系列、卡號、名稱、圖片網址全部一致。資料庫缺排球少年 HV-PR-074～079 共 6 張特典卡，第一次同步會新增。
- 芙莉蓮 S136 有 88 張既有稀有度為 SR1／SR2／SR3（首次匯入時的細分），官方目前只給 `SR`；依「只新增」不修改，差異會出現在每次同步紀錄。需要官方依據才處理。
- 排球少年 HV-P04、HV-D04（2026-10-24 發售）的系列列已存在、0 張；官方卡表上架後會自動補卡。
- 管理端點 `POST /api/admin/catalog/sync?provider=haikyuu`（或 `weissfrieren`）可提前觸發。
