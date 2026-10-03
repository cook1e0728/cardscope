---
status: accepted
---

# 日版 SV4a 以原地認領手寫 Seed 的方式匯入官方系列

日版 SV4a（シャイニートレジャーex）在 Source archive 中被列入隔離清單（系列名稱與既有 Seed 不符，ADR 0005），一直沒有匯入；資料庫只有早期手寫的 Seed：系列 `pokemon-sv4a-jp` 與卡 `pokemon-mew-ex-sv4a-347-jp`（canonical `pokemon-mew-ex`，`source`／`provider_id` 皆空，ADR 0001 的唯一例外）。ADR 0012 的官方匯入要求系列代碼尚無其他來源的日版系列，且 `tcg_series (game_id, official_code, region)` 唯一，所以 SV4a 無法照常建立 `pokemon-official-ja-sv4a`。

決定（2026-10-04，照建議自動執行；AGENTS 規定的 Sol 資料完整性裁決在此環境不可用）：原地認領 Seed，不刪除、不改 ID。

- 認領：一次性函式 `private.claim_pokemon_jp_seed_series` 先核對 Seed 系列、卡與 Printing 仍是計畫記錄的原值（來源皆空、系列只有這一張卡、這張卡只有一個 Printing），且日本官方詳細頁的系列標記、卡號（`347/190` 的斜線前段）、日文名都相同，才把官方來源身分補到既有列上：系列 `source = 'pokemon-card-official-jp'`、`provider_id = 'SV4a'`；卡與 Printing 的 Provider ID 為官方 card ID，卡號改為官方格式 `347`，稀有度以官方為準（ADR 0007／0009）。所有被改的原值存入各列 metadata 的 `seedClaim.before`，稽核表 `private.catalog_jp_seed_claim_audit`（追加式）保存前後快照；相同計畫重播零異動。
- 匯入：其餘官方卡依 ADR 0012 匯入同一個系列 `pokemon-sv4a-jp`；卡 ID 仍為 `pokemon-official-ja-sv4a-<卡號>`。`private.import_pokemon_jp_official_series` 改為：已認領的系列代碼以 Seed 系列 ID 為目標、第 1 批不建立系列、總數檢查不含被認領的卡；未認領的系列行為不變。計畫排除已認領的卡號，若計畫含該卡號，Printing 碰撞檢查會中止。
- 既有網址 `pokemon-mew-ex-sv4a-347-jp`、系列 `pokemon-sv4a-jp` 與唯讀 fallback `data/catalog.json` 都保持可用。

## Considered Options

- 刪除 Seed 系列、改由官方匯入建立新系列：要刪列，且 fallback 目錄與既有網址引用 `pokemon-sv4a-jp`，不採用。
- 不匯入 SV4a：SV4a 是熱門高稀有度系列，日版資料會長期缺一整個系列。
- 把 Seed 的系列代碼改掉以避開唯一鍵：等於竄改來源事實，不採用。

## Consequences

- SV4a 是唯一一個系列 ID 不符合 `pokemon-official-ja-<系列>` 的官方來源系列；以系列 ID 推斷來源的查詢需改看 `source`。
- 被認領的卡保留 canonical `pokemon-mew-ex`；之後的台版連結（ADR 0015）照一般規則處理。
