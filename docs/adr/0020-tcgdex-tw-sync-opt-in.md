---
status: accepted
---

# TCGdex 台版自動同步改為明確啟用

伺服器啟動時，若 `tcgdex-zh-tw` 超過 72 小時未同步，會自動以 PostgREST merge-duplicates 把 TCGdex 的系列、卡片與 Printing 寫回。10-02 之後台版資料已改由台灣官方卡片搜尋維護：系列名更正（ADR 0014）、稀有度與「無標記」（ADR 0010）、狀態升級，以及 metadata 中的依據與官方詳細頁 ID。再同步一次會把四個系列名蓋回 TCGdex 的錯誤名稱、把 TCGdex 沒有稀有度的 Printing 降回 `incomplete`，並整欄覆寫 metadata。決定（2026-10-04，照建議自動執行）：

- 排程同步預設不含 TCGdex 台版（`catalogProvidersNeedingSync` 的 `includeTcgdexTw` 預設 false）；管理端點的 `all` 也不含，明確指定 `pokemonZhTw` 時回 409。需要時設定環境變數 `TCGDEX_TW_SYNC=true` 才會執行。
- TCGdex 台版從此只作 Source archive（與 ADR 0002 的日版封存同一角色）。

## Considered Options

- 讓同步改為「不覆蓋官方值」的合併：需要逐欄依據判斷，之後若要恢復同步再做。
- 維持現狀：下一次重啟（10-04 10:13 UTC 之後）就會回退官方補正，不採用。

## Consequences

- TCGdex 新增的台版系列不會自動進來；台版新系列改走台灣官方卡片搜尋（ADR 0015）。
