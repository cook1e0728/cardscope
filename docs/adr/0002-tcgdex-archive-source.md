---
status: accepted
---

# TCGdex API 不可用時，改讀固定 commit 的 TCGdex 開源資料庫

2026-10-01 準備第二個日版 pilot 時，`api.tcgdex.net` 在 Node、curl、PowerShell 下都拒絕連線（`ECONNREFUSED`），文件站與 GitHub 正常。TCGdex API 是由開源 repo `github.com/tcgdex/cards-database` 產生，日文資料位於 `data-asia/`，授權與 API 相同。因此當 API 不可用時，改從該 repo 的**單一固定 commit** 讀取同一份資料，而不是等待、猜值或改用未確認權利的其他來源（例如官方卡片網站）。

做法：`providers/pokemon-jp-tcgdex-archive.mjs` 把資料檔當作純物件字面值解析，**不執行**任何 repo 內的程式；任何呼叫、樣板字串、展開、運算式或非 import 的前置敘述都會被拒絕。產生的快照與 API 快照欄位一致，另帶 `sourceArchive {repository, commit, setFile}`，且每張卡記錄 `sourceFile`。Manifest 把 `sourceArchive` 納入 source hash 與 provenance，並在每筆 `sourceEvidence` 加上 `retrievedVia: 'github-archive'` 與 `archive.path`；卡片路徑不是 `<set>/<localId>.ts` 時隔離。無 `sourceArchive` 的 API 快照輸出逐位元組不變（SVLN 計畫已驗證）。

`source` 仍是 `tcgdex-ja`、`source_url` 仍是 API 端點：兩者描述的是同一個 provider 身分，且 `source_url` 一向標示為 `derived-provider-endpoint`（推導網址，不代表本次曾成功請求）；實際取得途徑由 metadata 裡的 commit 與檔案路徑如實記錄。正式匯入函式不需修改。

## Consequences

- 等價性證據：同一 commit 下以 repo 重建的 SVLN 匯入計畫，除 provenance metadata 外與 API 計畫的列內容完全相同。
- 「取回數＝`total`」在 repo 來源下恆成立（total 即檔案數）；挑選時另看 `official` 與可對應稀有度比例。
- 固定 commit 讓證據可重現；之後若 API 恢復，同系列不得再以不同計畫重匯（函式會拒絕不同 digest）。
- repo 內的 `rarity` 字串與 API 相同；無核准對映者（如 `ACE SPEC Rare`、`Mega Hyper Rare`）照舊寫空值，不猜。
