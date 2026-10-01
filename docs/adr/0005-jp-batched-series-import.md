---
status: accepted
---

# 超過 100 張的日版系列以依序批次匯入

`private.import_pokemon_jp_metadata` 一次匯入整個系列且上限 100 張，延續專案「每批最多 100 筆」的寫入原則。朱紫世代有 13 個日版系列超過 100 張（103–237 張），無法一次匯入。

決定：新增 `private.import_pokemon_jp_metadata_batch`，同一份 Source archive 快照依 100 張分頁成有序批次；每批是獨立的全有或全無交易，沿用相同的身分規則、只新增、dry-run 與 digest 重播。第 1 批同時建立 Series；第 N 批必須在第 N−1 批已完成且來自同一快照（source/seed hash、observedAt、批次數與總張數一致）後才可執行；最後一批再核對整個系列的 Card／Printing 總數。批次稽核另存 `private.catalog_jp_import_batch_audit`，每系列每批一筆 import。

沒有提高單次上限：單一交易寫入數百張會拉長鎖定與逾時風險，也偏離既有批次原則；分批則讓任何一批失敗都只回滾該批，且可從下一批續傳。

## Consequences

- 系列在全部批次完成前是「部分匯入」狀態（例如 210 張的系列先出現 100 張）；`private.pokemon_jp_series_imported` 只在最後一批完成後才視為已匯入，中文化（enrichment）因此不會作用在未完成的系列。
- 單次匯入與批次匯入互斥：已單次匯入的系列不可再批次匯入，反之亦然。
- 排除 SV-P（日台編號錯位，見 ADR 0004）、SV4a（來源系列名稱與既有 Seed 不符，已在隔離清單）、SV5K／SV5M（隔離清單）。
- 中文化計畫同樣每次最多 100 張，超過 100 張的系列以多份 enrichment 計畫分次套用（函式允許同一系列多個不同 digest 的計畫，且只填空值）。切塊順序固定為先台版官方連結（系列名隨第一塊），再推導名稱，使同系列推導引用的官方名稱在套用時已存在；各塊沿用整份計畫的 evidenceHash。
