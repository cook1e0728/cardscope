---
status: accepted
---

# 官方來源匯入的日版卡，以同系列同卡號且日文名相同的 TCGdex 卡顯示價格

**狀態：已採用（2026-10-13，依使用者「決策照建議執行」的授權）。補充 ADR 0036 的範圍。**

ADR 0036 只讓 `source = tcgdex-ja` 的日版卡顯示 TCGdex 轉供的 Cardmarket 價格，官方來源匯入的日版卡（`pokemon-card-official-jp`，約 1.1 萬個 printing）都沒有價格。盤點（2026-10-13）：這些卡分布在 217 個系列，TCGdex 日文資料中只有 31 個系列代碼存在，而其中 26 個只有空殼（沒有卡）；有卡、有日文名、有價格的只有 SV4a、SV-P、M-P、SV5K、SV5M。這五個系列在資料庫中同系列卡號都唯一、沒有 ADR 0035 的版本卡、都有日文名；以系列代碼＋卡號對 TCGdex `<代碼>-<卡號>` 比對日文名（NFKC、去空白），904 張完全相同、1 張不同（SV-P 136 我們多了括號附註）、63 張 TCGdex 沒有（M-P 21、SV4a 40、SV-P 2）。證據 `docs/evidence/pokemon-jp/tcgdex-pricing-official-match-20261013.json`。

決定：

- **適用**：寶可夢日版 printing，來源不是 `tcgdex-ja`，`localSetCode` 屬於核准清單（目前為上述五個系列），卡片 ID 不是版本卡（`-v<k>` 結尾）。TCGdex ID 取 `<localSetCode>-<localCardNumber>`。
- **身分在每次查詢時核對**：TCGdex 回傳的日文名必須與該 printing 的日文名完全相同（NFKC、去空白），否則視為沒有價格。不存對應表、不寫資料庫，TCGdex 資料改變時自動失效。括號附註不同也不算相同（比 ADR 0007 嚴格，因為價格錯配的代價高於名稱）。
- **核准清單**擴充時，要先像本次一樣盤點：該系列在資料庫內卡號唯一、TCGdex 有日文名，並保存比對證據。
- 價格性質、新台幣顯示、7 天新鮮度、撤回方式都沿用 ADR 0036。

## Consequences

- 約 900 張官方來源日版卡（SV4a 的色違、SV-P／M-P 特典、SV5K／SV5M）有參考價；其他官方來源系列仍沒有，因為 TCGdex 沒有資料，不是規則擋掉。
- 每次查詢多做一次名稱比較，沒有額外請求（名稱與價格在同一回應中）。
