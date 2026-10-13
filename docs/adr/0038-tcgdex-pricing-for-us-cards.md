---
status: accepted
---

# 美版寶可夢以系列對照表找到 TCGdex 英文卡，顯示 TCGplayer 與 Cardmarket 參考價

**狀態：已採用（2026-10-13，依使用者「決策照建議執行」的授權）。擴大 ADR 0036 的範圍；同一來源（`tcgdex-pricing`，已登記為 risk-accepted），不是新來源。**

美版寶可夢（PokemonTCG 資料，約 2 萬張）一直沒有價格。TCGdex 英文 API（`api.tcgdex.net/v2/en/cards/<id>`）在 `variants_detailed[].pricing` 同時提供 Cardmarket（EUR）與 TCGplayer（USD）；TCGplayer 是美版卡的主要市場。但 TCGdex 的系列 ID 與 PokemonTCG 不同（`sv03.5` 對 `sv3pt5`），卡號補零方式也依系列而異。

決定：

- **系列對照表** `data/tcgdex-en-set-map.json`：由逐卡比對產生（證據 `docs/evidence/pokemon-us/tcgdex-en-match-20261013.json`），只收對應唯一、我們的卡號在系列內唯一、且英文名相同的卡 ≥ 90% 的系列。每個系列記錄 TCGdex 系列 ID 與卡號格式（`numberFormat`）。
- **每次查詢核對英文名**，不同就不顯示，比照 ADR 0037。英文名比較放寬：NFKC、不分大小寫與重音、彎引號視同直引號、連字號視為空白（Shuckle-GX／Shuckle GX）、去掉結尾 LV.X、去空白。
- **TCGplayer**：`marketPrice` 記為平台參考價（market）、`lowPrice` 記為最低掛牌價（listing），依 finish（normal、holofoil、reverse-holofoil 等）分開；`midPrice`、`highPrice`、`directLowPrice` 不顯示。Cardmarket 規則同 ADR 0036。
- 有些卡只在卡片層級提供價格（各 variant 沒有），此時 TCGplayer 照 finish 分開，Cardmarket 只取 `trend`／`low`、不標 finish（`-holo` 欄位不讀）。
- 新台幣換算、7 天新鮮度、24 小時記憶體快取、撤回開關都沿用 ADR 0036。

## 盤點結果（2026-10-13）

- 美版 176 個系列、20,634 張；對應 171 個系列，其中 20,145 張卡號與英文名相同（全體 97.6%）。卡號格式只有兩種：`none`（142 系列，卡號原樣）、`pad3`（29 系列，swsh9 以後與 svp，數字補到 3 位）。
- 未對應 5 個：`zsv10pt5`（我們的 60 號重複，疑似 Antique Cover Fossil 卡號寫錯）、`cel25c`／`me55c`（重印沿用原卡號）、`ex10`（27 張 Unown 在 TCGdex 另一個系列 `exu`）、`sve`（基本能量名稱寫法不同）。

## Consequences

- 美版卡詳細頁可看到美國與歐洲市場參考價（換算新台幣），標示「不是台灣行情」。
- 新系列要等對照表重新產生才會有價格；對照表不自動更新。
