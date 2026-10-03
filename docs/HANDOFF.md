# CardScope 工作交接

本文件是跨電腦、跨對話的短版 checkpoint。長期需求以 `docs/PRODUCT_PLAN.md` 為準；本文件只記錄目前已驗證狀態與下一個安全起點。

## 更新規則

在下列任一節點更新本文件：PR 合併、正式 migration、正式資料批次、Render 發布驗收。每次覆寫已過期的「目前里程碑」，不要累積聊天逐字稿。

每完成一個段落（上述節點，或一組可獨立驗證的程式／文件修改），立即把本文件與相關修改 commit 並 push 到目前工作分支，不必再等使用者指示，確保另一台電腦 `git pull` 即可接手。不 push 密鑰或本機產物；合併到 `main`（會觸發 Render 部署）仍需使用者確認。

用量檢查點：5 小時用量剩餘 5% 以下時，不再開始新步驟，立即在本文件「目前里程碑」記下進行中的動作（已完成步驟、下一個確切步驟、未提交狀態、暫存檔位置），commit 並 push 到工作分支，以便切換裝置接續。

本機直連資料庫：`node scripts/run-sql.mjs <檔案.sql>`（或 `-e "sql"`、唯讀加 `--read-only`）經 Supabase Management API 執行，整個請求是一個交易，出錯全部回滾（已實測）。需要 repo 根目錄的 `.env.local` 內有 `SUPABASE_ACCESS_TOKEN=sbp_…`（個人存取權杖，已被 .gitignore 排除；每台電腦各自建立，勿提交）。大批寫入一律用此工具執行檔案，不再把 SQL 貼進 MCP。

交接必須包含：

- GitHub `main` commit 與 PR。
- 本機測試、CI、Supabase 與 Render 各自的完成狀態。
- 資料批次範圍、候選數、實際異動數、重播結果與缺口原因。
- 尚未執行的唯一下一步，以及開始前必須重新核對的外部狀態。
- 未追蹤或屬於使用者的本機檔案，避免下一台電腦誤刪。

## 目前里程碑（2026-10-03，日版中文化、分批匯入、官方來源匯入；優先於下方所有段落）

- 分支 `claude/jp-zh-names`（依主方案第 0 節每主題一條；完成後快轉 main）。決策經 grill-with-docs 三輪定案：日版連結台版既有 Canonical card（ADR 0003）、同系列 Derived name、新增稀有度 `ACE`（ACE SPEC，排序在 RR 與 Rare Holo 之間）、SV6a 092–094 金卡維持空值、沒有台版的系列不猜譯。詞彙表新增 Source archive、Derived name。
- Migration `20261001114348_pokemon_jp_enrichment`：新增 `ACE`（`tcg_rarities` tier 14，原 ≥14 者 +1，比照 K 的先例）、追加式稽核表 `private.catalog_jp_enrich_audit`、只填空值的 `private.enrich_pokemon_jp_metadata(jsonb, text, boolean)`（dry-run、digest 重播、連結四項檢查、同名推導檢查、系列名須等於同代碼台版名）。套用前先在正式庫以「整批執行後拋例外」的交易完整測過 SV6a 寫入與重播，並確認全數回滾。
- 計畫：`scripts/build-pokemon-jp-enrich-plan.mjs`（`providers/pokemon-jp-enrich-plan.mjs`）由 Source archive 與匯入計畫產生；台版列以封存資料推導，9 個系列的指紋 md5 與正式庫逐一相同才使用。SQL 由 `buildPokemonJpEnrichSql`（gated：同一敘述先 dry-run，`changed` 完全相符才寫入）產生。證據 `docs/evidence/pokemon-jp/<系列>-enrich-plan-20261001.json`。
- 結果（每系列 enrich＋replay 各一筆稽核，重播零異動，共 18 筆）：SV6a 93 張（連結 64、推導 29、ACE 3）、SV2D 97（71/26）、SV2P 98（71/27）、SV3a 90（89/1）、SV4K 93（66/27）、SV4M 94（66/28）、SV5a 94（66/28）、SV7a 93（64/29）、SV9a 92（92/0）；9 個系列取得台版官方中文標題。SVLN、SVLS、SVK 無台版，本輪不變。
- 複核：日版 944 張中 844 張有中文名（連結 649、推導 195），仍待補 100 張（9 系列共 12 張無同名可推導，加上 3 個無台版系列 88 張）；台版 649 張仍是自己的作品層、指紋不變、作品層新增日文名；沒有作品層被超過 2 張卡共用；card／printing 稀有度不一致 0；台版 7,436／美版 20,635、SV4a 不變。
- 程式：詳細頁對同名推導名稱加註小字「同名推導」；`loadCardFromDatabase` 會一併帶出同一作品層的其他卡（日版詳細頁可看到台版 Printing）。`data/rarity-rankings.json` 新增 `ACE`（美版 `ACE SPEC Rare` 33 張隨之顯示為 ACE）。Node 全套 230/230。

- 部署：main 快轉到 `261c8fd` 後再到 `e5b99ec`（修正：同作品層合併時，若第一張卡沒有稀有度，改取其他卡的稀有度；新增回歸測試，Node 231/231）。正式網站抽查：SV6a-039 詳細頁顯示「桃歹郎ex｜モモワロウex、RR」並列「日版 SV6a 039」與「台版 SV6a 039」；SV6a-090 顯示「桃歹郎ex 同名推導、SAR」；SV6a-054 為 ACE；`/api/search?q=桃歹郎` 的 SV6a-039 合併為一筆（JP/TW、RR），082／090／092 亦可搜到；`黑夜漫遊者`、`ナイトワンダラー` 走系列搜尋；`/api/catalog/health` 200。已知小缺口：系列搜尋只帶出該系列自己的 Printing（`ナイトワンダラー` 結果只列日版），點進詳細頁才並列台版。

### 依序執行 1–2（2026-10-01 夜）

- 1 搜尋：`/api/search` 對命中的卡再查同作品層的其他卡（`canonical_id in (...)`，失敗只少帶 Printing），系列搜尋 `ナイトワンダラー` 結果改為日／台並列；`candidateCount` 只算直接命中。已部署 `5d64b50`。
- 2 剩餘中文名：全世代比對發現 SV-P 日台編號錯位（55 筆），已建立 9 個同系列連結經覆核無錯位。ADR 0004 允許跨系列同名推導（朱紫世代、排除 SV-P、日文名須唯一對應、須引用資料庫中同名台版卡）。Migration `20261001153532_pokemon_jp_enrichment_cross_series`（只替換函式，套用前已整批回滾測試）。9 個系列 73 張寫入＋重播零異動（稽核累計 36 筆）；名稱證據 `docs/evidence/pokemon-jp/cross-series-names-20261001.json`（49 個名稱），計畫 `<系列>-enrich-cross-plan-20261001.json`。
- 結果：日版 944 張中 917 張有中文名（台版官方 649、同系列推導 195、跨系列推導 73）；仍缺 27 張（劍盾世代再錄如かがやく系列、ネオラントV，及基本能量等在朱紫世代無唯一對應者）。台版 7,436／美版 20,635 不變。詳細頁「同名推導」標示涵蓋兩種推導。

### 依序執行 3：超過 100 張的系列分批匯入（2026-10-01～02）

- ADR 0005：同一快照依 100 張分頁成有序批次，第 1 批建立系列，第 N 批需第 N−1 批已完成且同快照，最後一批核對總數；稽核 `private.catalog_jp_import_batch_audit`（每系列每批一筆 import）。`private.pokemon_jp_series_imported` 只在最後一批完成後成立，中文化才可作用。Migration `20261001154929_pokemon_jp_metadata_import_batches`（套用前以 SV1a 在正式庫整批回滾測試，確認零殘留）。程式：`buildPokemonJpImportBatchPlans`、`scripts/build-pokemon-jp-import-batches.mjs`、SQL 產生器的 batch 模式。
- 匯入：13 個系列 1,925 張、28 批（SV1S 108、SV1V 108、SV1a 103、SV2a 210、SV3 141、SV6 133、SV7 135、SV8 138、SV8a 237、SV9 132、SV10 132、SV11B 174、SV11W 174），每批 gated（同一敘述先 dry-run，digest／before／inserted 完全相符才寫），每系列最後檢查總數，否則整組回滾。28 批 import＋28 筆重播，重播全數零異動。排除 SV-P（編號錯位）、SV4a、SV5K、SV5M（隔離清單）。
- 中文化：11 個系列台版指紋（md5）與正式庫逐一相同、無共用作品層；SV11B／SV11W 在來源封存中沒有台版資料，只用跨系列推導。跨系列名稱證據 `docs/evidence/pokemon-jp/cross-series-names-20261002.json`（111 個名稱，皆引用資料庫中同名台版卡的最小 id）。計畫超過 100 張時以 `chunkPokemonJpEnrichPlan` 切塊（先官方連結＋系列名，再推導），共 32 份計畫，寫入後重播 32 份全數零異動；11 個系列取得台版官方標題。
- 結果：日版 25 個系列 2,869 張，2,697 張有中文名（台版官方 2,026、同系列推導 384、跨系列推導 287），172 張無中文名（基本能量 4 張、SV11B 64 與 SV11W 77 張台灣未發行且朱紫世代沒有唯一對應的黑白寶可夢／訓練家，以及前一輪的 27 張）。日版卡的作品層都有日文名；台版 7,436／美版 20,634（`pokemontcg`，先前 20,635 含 1 筆 source 為空的 Seed）不變。中文化稽核累計 100 筆。
- 證據：`<系列>-snapshot-20261001.json`、`-import-batches-20261001.json`、`-enrich-plan-20261002.json`、`-enrich-chunks-20261002.json`。Node 全套 237/237。
- 觀察到的來源資料特性（未修改）：台版名稱帶有 `[支援者]`、`[進化前分岐α]`、`<火箭隊的>` 等標記，以及 SV8a-161 含零寬字元；日版連結沿用台版官方原字串。

### 依序執行 4：日版 data_status 升級（2026-10-02）

- ADR 0006＋詞彙表 Data status：日版 Card 已依 ADR 0003 連結到 `verified` 台版 Card（Provider ID、名稱、作品層仍一致）才升為 `verified`；其 Printing 沿用既有規則（有稀有度 `verified`、無則 `incomplete`）；未連結、只有推導名稱、無台版的系列維持 `pending`。只升不降。
- Migration `20261001162114_pokemon_jp_data_status_promotion`：追加式稽核 `private.catalog_jp_status_audit`、`private.promote_pokemon_jp_data_status(text, text, boolean)`（每次最多 100 張、dry-run CJ004）。套用前在正式庫以 SV6a／SV8a／SVLN 整批回滾測試（64／100+100+37／0，重播 0）。
- 執行：20 個系列 dry-run 後，以 28 次呼叫（每次 ≤100）正式升級 2,026 張，總數檢查通過；25 個系列重播全數 0。結果：Card verified 2,026／pending 843；Printing verified 1,698、incomplete 328（多為 SV8a、SV3a、SV9a 來源缺稀有度）、pending 843。台版、美版不變。

### 依序執行 5：台版名稱標記顯示整理（2026-10-02，程式，未動資料庫）

- 詞彙表新增 Source name markup（來源名稱標記）。正式庫盤點：`<X的>` 所有者前綴（火箭隊、阿響、竹蘭、派帕、小霞等）約 195 筆、`[支援者]` 12、`[進化前分岐α]` 4、零寬字元 2（`招式學習器 ‌衰退`）；`未知圖騰 [A]`、`博士的研究（山梨博士）`、`基本【雷】能量`、航海王 `(異圖卡)` 屬名稱本體，不處理。
- 前端 `zhParts`（`index.html`）：顯示時去零寬字元與角括號、名稱後含中文的方括號改為詳細頁小字附註；資料庫原字串不變。
- 搜尋：`normalizeSearch` 忽略 `<>[]` 與零寬字元；`/api/search` 對含「的」的查詢加送 `<前綴的>後段` 變體（最多 3 個），`火箭隊的超夢` 可命中 `<火箭隊的>超夢ex`。Node 全套 241/241。
- 部署（2026-10-02，經使用者確認）：main 快轉 `55848c4..1771e15`，Render 自動部署。正式抽查：`/api/search?q=火箭隊的超夢` 由 0 筆變為 4 筆（TW SV10-039 RR、JP SV10-114／125／130）；`坂木的領導力` 4 筆含兩張 `[支援者]`；瀏覽器詳細頁 SV10-039 顯示「火箭隊的超夢ex」、SV2a-207 顯示「坂木的領導力」加小字「支援者」、SV8a-161 顯示「招式學習器 衰退」（零寬字元已去除，長度 8）；API 仍回傳原字串；`/api/catalog/health` 200。

### 依序執行 6：搜尋／詳細頁延遲（2026-10-02，程式）

- 正式量測（部署前）：`/api/catalog/health` 暖機約 0.32 秒，`/api/search` 約 2.4–3.8 秒（冷啟動 8 秒）；DB 名稱 ilike 循序掃描 5.1 萬列僅約 160 ms。主因是 `loadCatalog()` 每次請求都重抓全部 1,082 個系列（分頁）、250 張卡與其 printing／圖片，且在 DB 搜尋之前依序執行；`getCard`（詳細頁）同樣受影響。
- 修正：`loadCatalog` 成功結果快取 60 秒並合併同時進行的載入（回傳 clone；fallback 失敗結果不快取）；`/api/search` 讓 catalog 載入與 DB 搜尋並行。新增快取測試（已驗證關閉快取時會失敗）。Node 全套 242/242。
- 部署後量測（同一查詢連續 3 次，秒）：噴火龍 5.61/2.72/2.21 → 3.92/1.26/1.67；モモワロウ 2.62/2.20/2.20 → 1.91/1.47/1.46；火箭隊的超夢 3.03/2.14/2.10 → 1.92/1.25/1.23；Pikachu 2.43/2.23/2.50 → 1.17/1.11/2.06；詳細頁 SV10-039 1.06／1.43。暖機約由 2.2 秒降到 1.1–1.7 秒。剩餘時間主要是 DB 搜尋的三段依序請求（卡片、同作品層、printing），首次請求仍需載入 catalog。

- 本機 `.claude/settings.local.json`（全域 gitignore）新增 `Bash(git checkout main)`、`Bash(git checkout claude/jp-zh-names)`、`Bash(git merge --ff-only claude/jp-zh-names)`，經使用者指示；串成一行的指令不會套用這些規則，需分開執行。

### 依序執行 7：搜尋少一次 DB 來回（2026-10-02，已部署）

- 本機量測（publishable key 打 PostgREST）：空請求約 0.28 秒、卡片 ilike 約 0.4 秒，同一請求嵌入 printing 幾乎不增加時間。匿名金鑰受 RLS 限制讀不到資料，無法在本機以正式資料驗證嵌入。
- `searchCatalogDatabase` 的卡片查詢（名稱、search_text、系列 fallback、同作品層）改為嵌入 `tcg_printings!tcg_printings_card_id_fkey(...)`，省掉最後的 printing 請求；嵌入被拒時記錄錯誤、改用原 select 並分開抓 printing（與舊行為相同）。新增 2 個測試（嵌入成功時零 printing 請求、嵌入失敗時退回且結果不變）。Node 全套 244/244。
- 部署（經使用者確認）：main 快轉 `1771e15..31ea34f`。GitHub 沒有 Render 部署狀態可查，以健康檢查連續 2 分鐘正常判斷切換完成；新實例首次搜尋（噴火龍 4.7 秒）顯示快取重建，符合新版上線。
- 正確性：`火箭隊的超夢` 4 筆、`モモワロウ` 7 筆、`ナイトワンダラー`（系列 fallback）40 筆，全部 `databaseSearch=available`、無缺 printing 的卡，日台 printing 合併正常（如 SV10-039 JP RR／TW RR）。
- 延遲（連續 3 次，秒；括號為執行 6 部署後）：噴火龍 4.69/1.41/1.32（3.92/1.26/1.67）；モモワロウ 1.32/0.90/0.91（1.91/1.47/1.46）；火箭隊的超夢 1.05/1.06/1.13（1.92/1.25/1.23）；Pikachu 1.59/1.29/1.23（1.17/1.11/2.06）。多數查詢再降約 0.1–0.5 秒；若嵌入失敗走退回路徑會多一次失敗請求而變慢，實測變快，推斷嵌入有效，但未能直接查看 Render log 確認沒有 `search printing embed failed`。

### 依序執行 8：日版稀有度與身分以日本官方卡片頁補正（2026-10-02，已完成）

- grill-with-docs 決策：ADR 0007（官方卡片搜尋為日版稀有度來源，只取文字事實）、ADR 0008（官方頁系列標記＋卡號＋日文名一致即升為 verified，使用者同意）、ADR 0009（既有值與官方不同時改為官方值，舊值存 `rarityBeforeOfficial`，使用者選 a）。詞彙表新增 No rarity mark。實查發現：官方頁沒有稀有度圖示不代表卡面無記號（SV6a-063 ACE SPEC 也沒有），所以無圖示一律隔離；牌組（SVK／SVLN／SVLS）與 SV8a 大部分維持未知；圖示 `_c` 後綴去掉後對映（u_c 與既有 U 7/7 一致）；TCGdex 的 `Ultra Rare` 在日版其實是 SR。
- 程式：`providers/pokemon-jp-official.mjs`、`scripts/fetch-pokemon-jp-official-rarity.mjs`（單一連線、間隔 ≥1.5 秒、非 200 即停、快取可接續）、`scripts/build-pokemon-jp-official-rarity-plan.mjs`（fill／correct／identity 三種計畫與受檢查 SQL）。證據快取 `docs/evidence/pokemon-jp/official-rarity-20261002.json`（只含文字事實）。
- Migration（皆先在正式庫整批回滾測試）：`20261002095027_pokemon_jp_official_rarity`（fill，函式 md5 `20ab149b…`）、`20261002110000_pokemon_jp_official_correction_and_identity`（correct＋identity，md5 `1f7e85b1…`／`978aea3d…`；以本機工具執行並寫入 schema_migrations）。
- 第一批寫入（官方頁 900 頁時的快取）：fill 414 筆（20 批）、correct 13 筆（7 批）、identity 326 張（20 批），全部重播零異動（稽核 fill 20+20、correct 7+7、status 20）。結果：日版 Card verified 2,352／pending 517；Printing verified 2,139、incomplete 213、pending 517；稀有度空值 707→293；Card／Printing 稀有度不一致 0。寶可夢台版 7,436、美版 20,635 不變。
- 隔離：官方頁無圖示 186、日文名不一致 5（官方標題沒有括號人名，如「ボスの指令」vs「ボスの指令（ゲーチス）」，未放寬規則）、SV2P-099 找不到官方頁。
- 第二、三批（增量，快取 1,889 頁後）：fill 1＋3、correct 52＋1、identity 393＋4，全部重播零異動。使用者同意兩項：名稱比對允許「官方標題＋一組全形括號說明」（如「ボスの指令（ゲーチス）」，ADR 0007 已更新）；詳細頁標示「依官方修正（原資料為 X）」。累計：fill 418、correct 66、identity 723；日版 Card verified 2,749／pending 120；Printing verified 2,536、incomplete 213、pending 120；稀有度空值 289。
- 部署（使用者同意 Q2 即同意部署）：main 快轉 `31ea34f..3bc4fa1`；瀏覽器確認 SV6a-080 稀有度欄顯示「SR 日版依官方修正（原資料為 UR）」。
- 背景工作上限 10 分鐘會中止抓取；改由使用者在自己的 PowerShell 執行抓取指令（App 終端機面板的 shell integration 載入失敗）。
- 完成：使用者在自己的 PowerShell 跑完全量抓取，快取 2,869 頁（25 個系列清單、無找不到的卡），提交為 `docs/evidence/pokemon-jp/official-rarity-20261002.json`（695 KB，只含系列標記、卡號、日文名、稀有度圖示與 card ID）。第四批：fill 39、correct 25、identity 120，重播零異動。
- 最終累計：fill 457（稽核 25＋25 重播）、correct 91（16＋16；UR→SR 87、HR→UR 3、SR→UR 1，舊值在 `rarityBeforeOfficial`）、identity 843 張（狀態稽核 35 筆）。日版 2,869 張 Card 全部 verified；Printing verified 2,619、incomplete 250；Card／Printing 稀有度不一致 0；官方依據 548 筆。寶可夢台版 7,436、美版 20,635 不變（最後更新仍為 10-01／09-30）。
- 仍為空值 250（官方頁無稀有度圖示，依 ADR 0007 維持未知）：SV8a 152、SVK 44、SVLS 22、SVLN 22、ACE SPEC 等 10（SV5a、SV7、SV7a 各 3，SV8 1）。

### 依序執行 9：台版稀有度以台灣官方卡片搜尋補齊、無標記 NONE（2026-10-02，已完成）

- 查證：台版沒有任何 UR／SR／HR，原先「台版 UR 錯對映」的疑慮不存在；但台版 7,436 筆中 6,634 筆缺稀有度（83 系列）。台灣官方（asia.pokemon-card.com/tw，robots.txt 空白）詳細頁無稀有度，但搜尋可依稀有度篩選，含「無標記」。SV8a 試查：無標記 288、RR 35、SAR 33、SR 12、ACE 8、UR 5（清單 380 筆含同卡號多版本）。
- 決策（使用者授權照建議）：ADR 0010——台版稀有度取自台灣官方稀有度篩選、身分以詳細頁系列標記＋卡號＋中文名（去 Source name markup）核對、同卡號多版本須一致；官方「無標記」存為新代碼 `NONE`（顯示「無標記」、排序最低）；日版官方頁無圖示且已連結同系列同卡號台版、台版已有台灣官方值時，日版沿用。詞彙表 No rarity mark 已更新。記憶：之後決策直接照建議執行。
- 程式：`providers/pokemon-tw-official.mjs`、`scripts/fetch-pokemon-tw-official-rarity.mjs`（三階段：全系列稀有度清單→各系列清單→詳細頁；`--max-requests` 可分段）、`scripts/build-pokemon-tw-official-rarity-plan.mjs`（tw-official／jp-via-tw）。`normalize.mjs` 防止來源字串 `None` 被當成 NONE。前端 `rarityText` 把 NONE 顯示為「無標記」（尚未部署）。Node 260/260。
- Migration `20261002140000_pokemon_tw_official_rarity`（NONE tier 27、`private.catalog_official_rarity_audit`、`private.fill_pokemon_official_rarity_tw` md5 `d124aecd…`）：先在正式庫以 SV8a-001 回滾測試（日版在台版前被拒、錯值被拒、台／日填入與重播零異動），已套用並寫入 schema_migrations；尚未寫入任何稀有度。
- 稀有度清單 22 種完成：14,582 張、無任何一張同時出現在兩個清單；無標記 6,273。抽查一般擴充包 S11 無標記為 0，確認「無標記」不是舊系列的預設值。官方系列標記圖檔名不一致（`SV6a_F`、`sv1a_f`、`SV2a F@4x`），後又出現 `exp_sv4K`、`twhk_sv4a_exp`，改為以官方系列篩選（expansionCodes）的清單歸屬為準，圖檔名只需以獨立字詞含系列代碼（`twSetMarkMatches`，SV4 不會配到 SV4a）。SV-P 特典卡系列標記為 `PROMO.MARK`、卡號格式不同，94 筆隔離。
- 第一批台版寫入（SV1a／SV1S／SV1V／SV2a／SV2D／SV2P／SV3／SV3a）：805 筆、11 批，重播零異動，皆升 verified。SV2a 台版分布與日版依日本官方修正後完全相同（C66 U62 R25 AR18 SR16 RR12 SAR8）。第二批 SV4a 314 筆（4 批，重播零異動；001–190 C/U/R/RR、191–319 S、SSR 18、AR 4、SR 5、SAR 8）。第三批台版 729 筆＋日版沿用 9 筆（全為 ACE SPEC：SV5a 053/055/059、SV7 094/096/101、SV7a 052/056/064），重播零異動。台版累計 1,848（空值 4,786）、日版空值 241。第四批：台版 205（含 SV8a）＋日版沿用 153；SV8a 日台完全一致（NONE 144、RR 35、SAR 33、SR 12、ACE 8、UR 5＝237），日版空值只剩牌組 88（SVK／SVLN／SVLS 無台版連結）。累計台版 2,053、日版沿用 162。瀏覽器確認 SV8a-001 詳細頁「稀有度 無標記」、篩選選單 `NONE=無標記`。抓取視窗中途遇非 200 停止（依規則不重試），官方站隨即恢復 200，Claude 另開視窗接續並以 Tee-Object 記錄到 scratchpad `tw-fetch-resume.log`。SV9a 圖檔名 `SV9aF_exp`，允許代碼後緊接 F；SVAL 基本能量官方無卡號，隔離。台版名稱比照日版允許省略括號小字（SVD 妮莫（過去）／（未來））；基本能量（官方無卡號）隔離。台版空值降至 3,400，再一批後 2,275（NONE 971），再一批後 1,032（NONE 1,649）。抓取第二次中斷是 EPERM：增量寫入複製快取時抓取程式正在 rename，已改為忙碌時重試。因正式庫已有 NONE，main 快轉 `3bc4fa1..4430529` 部署「無標記」顯示。先前 jp-via-tw 為 0（SV8a 台版詳細頁未完成；牌組 88 筆無台版連結）。另發現既有台版有稀有度的 802 筆狀態為 incomplete（先前即存在，未處理）。
- 抓取完成：Claude 以 `Start-Process` 開獨立 PowerShell 視窗（使用者授權）執行三次（兩次中斷：一次非 200、一次 EPERM），最後 `done: 2019 requests, 7817 detail pages cached`；證據 `docs/evidence/pokemon-tw/official-rarity-20261002.json`（1.28 MB，只含清單 ID、稀有度篩選歸屬、系列標記檔名、卡號、中文名）。
- 最終：tw-official 6,465 筆（106 批＋106 重播，零異動）、jp-via-tw 162 筆（6＋6）。台版 Printing verified 6,465（NONE 2,512）、incomplete 971（其中 169 空值＋802 筆先前即有稀有度卻為 incomplete 的既有狀態）；日版 verified 2,781（NONE 144）、incomplete 88（牌組 SVK／SVLN／SVLS，無台版連結）。日台已連結配對稀有度不一致 0；Card／Printing 不一致 0；美版 20,635、遊戲王、航海王不變。
- 台版仍空值 169：SV-P 特典 85（系列標記 PROMO.MARK、卡號格式不同）、基本能量 79（官方無卡號）、SP5 3、S8a 1、S8b 1。

### 依序執行 10：台版既有稀有度的狀態修正（2026-10-02）

- 802 筆台版 Printing 有稀有度、Card verified，卻是 incomplete：來源是 9 月 TCGdex enrichment 只填稀有度未更新狀態（SV8、S11、SV9、SV10、S12、S10a、S11a、S10P、SV9a、SV8a、SV6a、SC1a）。其中 298 筆所在系列有台灣官方證據，與 TCGdex 值 298/298 一致。
- Migration `20261002160000_pokemon_tw_printing_status`（`private.promote_pokemon_tw_printing_status`，md5 `34c2b38a…`，只升不降、每次 ≤100、稽核 kind 'status'；先以 SV8 回滾測試）已套用。13 次呼叫升級 802 筆，續呼叫皆 0。台版現為 verified 7,267、incomplete 169（全為空值）。之後 SV-P 特典改以「001/SV-P」斜線後系列作一致性檢查，補 80 筆；台版空值剩 88：基本能量 78（官方無卡號，不以名稱代替）、V-UNION 4（S8a-025、S8b-056、SP5-001/005/009 等分片編號）、SV-P 特殊編號 6（no0–no3、56 等）。Node 263/263。

### 依序執行 11：日版以台灣官方同系列同卡號補中文名（2026-10-03）

- 發現台灣官方收錄 SV11B、SV11W、SVK（Source archive 沒有）。ADR 0011：日版可直接採用台灣官方同系列同卡號的中文名與稀有度，但每個系列須先通過對齊檢查（日版已有的名稱／稀有度與台灣官方同卡號全部一致），只填空值，依據 `tw-official-same-number`，不建立 Canonical 連結。
- Migration `20261003000000_pokemon_jp_from_tw_official`（`private.fill_pokemon_jp_from_tw_official`，md5 `16cadad2…`；先以 SV11B-001 回滾測試：名稱寫入、Canonical 同步、重播 0、衝突拒絕）已套用。
- 抓取 SV11B 254、SV11W 254、SVK 50 詳細頁（另開視窗，約 20 分鐘）。對齊：SV11B、SV11W 各 174 筆已有值全部一致 → 寫入中文名 64＋77，重播零異動，兩系列 174/174 皆有中文名；SVK 29 筆中 28 筆不一致（台版 SVK 卡號排列不同，如 006 夢幻ex≠怒鸚哥ex）→ 整系列不採用。日版無中文名 172→31（SVK 14 劍盾再錄、SVLS 5、SVLN 4、基本能量 8）。
- 觀察：`tcg_cards.rarity_tier` 全站與 `tcg_rarities` 不一致（美版 17,140 筆等），伺服器排序未使用此欄（用 rarity-rankings.json），未處理。

### 依序執行 12：日版劍盾（S）世代匯入（2026-10-03，匯入與台版連結完成）

- 依主方案「日版全系列」：Source archive `tcgdex/cards-database` `c5c0a8a` 的 data-asia/S 中有日文名的 14 系列（S5I 91、S6H 95、S6K 95、S7D 90、S8 129、S8b 285、S9 127、S9a 93、S10P 88、S10a 99、S11 127、S11a 94、S12 125、S12a 258，共 1,796 張）。S4、S4a、S5a、S5R、S6a、S7R、S8a、S10b、S10D 封存無日文名，跳過；SC*／SI 等為中文版商品，不屬日版。
- 流程 `scripts/import-pokemon-jp-series.sh <SET>`（`CARDSCOPE_WORK` 指定含封存 checkout、`existing-jp-rows.json`、`s-observed-at.txt` 的工作夾）：快照→匯入（≤100 一次、>100 依 ADR 0005 分批，皆 gated）→重播→enrich 計畫（台／日指紋須與正式庫相同）→gated enrich（`scripts/emit-pokemon-jp-enrich-sql.mjs`）→重播→ADR 0006 升級。可重跑（已匯入批次以 dry-run replay 視為完成）。證據 `docs/evidence/pokemon-jp/s-era/`（現有日版列只存一份 `existing-jp-rows-20261003.json`，快照內以檔名參照）。
- 已完成：S10P 88（連結 67、推導 20，87 有中文名，verified 67）、S5I 91（70／21，91，70）、S8 129（2 批；100／25，125，100）；皆重播零異動。
- 其餘 11 系列同流程完成（指紋全部相符、重播零異動）：S6H 95（92 中文名）、S6K 95（92）、S7D 90（88）、S9 127（127）、S9a 93（92）、S10a 99（98）、S11 127（126）、S11a 94（94）、S12 125（123）、S8b 285（3 批；連結 181、推導 89、270）、S12a 258（3 批；250／4、254）。合計 14 系列 1,796 張：中文名 1,759、verified 1,395、稀有度空值 438。台版 7,436、美版 20,635 不變。
- 日本官方核對（另開視窗抓 1,796 筆，中途一次因 git 切換分支觸碰快取檔而 UNKNOWN 開檔失敗，已改為暫存檔＋重試存檔後接續；最終 `done: 4830 detail pages cached`）：fill 128、correct 144（各系列 UR→SR，S12a SR→UR 4）、identity 323，重播零異動。官方頁無圖示者沿用台灣官方（ADR 0010）262 筆：S8b NONE 140、S12a NONE 119、S9a K 3。官方圖示 `ic_rare_csr` 為新稀有度 CSR：migration `20261003040000_pokemon_rarity_csr`（tier 7，S 以下順移，NONE 變 28）、rarity-rankings.json 與官方對映同步，補 44 筆。劍盾世代剩：待核 78（官方頁找不到）、稀有度空值 4（S8b 251–254）。日版全體稀有度空值 92（牌組 88＋S8b 4）。部署時改以 `git push origin claude/jp-zh-names:main` 推送，避免切換分支觸碰工作目錄。

### 依序執行 13：搜尋延遲（Server-Timing 與單次往返 RPC，2026-10-03，已部署）

- `/api/search` 新增 `Server-Timing`（catalog、db、names／text／rpc／siblings／printings、total）。部署 `a5b0020` 後量得：catalog 快取約 10 ms，names 250–800 ms、siblings 200–700 ms（依序），伺服器總計 465–1,300 ms；資料庫端名稱查詢實際僅約 160 ms。
- Migration `20261003020000_search_cards_with_siblings`：`public.search_cards_with_siblings(text[], integer)`（唯讀、service_role 限定，anon 無權）一次回傳命中卡（≤100）與同作品層卡（≤200）及 printings；資料庫端 45–200 ms。伺服器先呼叫 RPC，失敗或格式不符時退回原兩次 PostgREST 查詢。部署 `a629f4e` 後伺服器總計 270–915 ms（固定驗收詞 luffy、魯夫、噴火龍、Charizard、リザードン、超夢、夢幻、黑魔導女孩皆有結果）。
- 剩餘瓶頸：RPC 回應 250–900 ms，但モモワロウ僅 22 KB 仍約 500 ms，推斷是 Render 與 Supabase（ap-northeast-1 東京）之間的固定往返；Render 服務區域未知（需使用者在 Render 後台確認）。若在美國，新建同區域（如 Singapore）服務才能明顯改善，屬基礎設施變更，未自行處理。暖機 P95 < 800 ms 目前尚未達成。
- 搜尋結果快取（`845078e`）：同一 region＋查詢 60 秒內直接回傳（最多 200 筆、LRU），`Server-Timing: cache;desc="hit"`；正式命中時伺服器 0 ms、本機量得約 0.3 秒。

### 依序執行 14：日版 MEGA（M）世代匯入（2026-10-03，已完成）

- 封存 data-asia/M 有日文名的 12 系列；匯入 9 個擴充包：M1L 92、M1S 92、M2 116、M2a 250（3 批）、M3 117、M4 120、M5 118、M6 113、M6a 176，共 1,194 張，皆 gated＋重播零異動（同 `scripts/import-pokemon-jp-series.sh`）。暫不匯入 M-P（特典）、MC（スタートデッキ100，742）、MF（牌組）。封存無台版 → 無 Canonical 連結、無中文名；稀有度空值多在 M2a 167、M6a 136、M6 37。證據 `docs/evidence/pokemon-jp/m-era/`。
- SM 世代（封存 SM1p–SM5p，強化拡張パック，官方代碼同為 SM1p 等）：匯入 68＋65＋82＋125＋63＝403 張（重播零異動，無台版、無中文名）；日本官方 correct 32（UR→SR）、identity 366；官方頁無圖示 235 筆維持原值或未知（稀有度空值 227）。證據 `docs/evidence/pokemon-jp/sm-era/`。
- MEGA 牌組商品：MF 49、MC 774（8 批）匯入；日本官方頁全無稀有度圖示 → identity 810（MC 766、MF 44）；台灣官方收錄 MC、MF，以名稱字典對齊（MC 680/774、MF 39/49 可比對且全一致）→ 中文名 761＋44、稀有度 NONE 766＋44。M-P（特典）比照 svp 不匯入。
- 日版總計（2026-10-03）：55 系列、7,085 張；中文名 6,573；verified 6,903。
- ADR 0011 補強：可比對卡少於系列一半時不採用（`REJECTED_UNVERIFIABLE`），M 世代須先以日本官方補正稀有度再以稀有度對齊。
- 日本官方（1,194 筆，另開視窗）：fill 42、correct 91（UR→SR）、identity 1,140，重播零異動。台灣官方 M 系列同時抓取（不同網站，各一條連線）。
- ADR 0011 中文名：M1L、M1S、M2、M3、M4、M5、M6 以稀有度對齊（可比對筆數全數一致）→ 寫入 762 名（M6 另補稀有度 2）。M2a、M6a 稀有度多未知而被 REJECTED_UNVERIFIABLE；加入「官方名稱字典」證據（同日文名已有台版官方／同卡號中文名者，唯一對應才算；`--name-dictionary`）後 M2a 233/250、M6a 133/176 可比對且全數一致 → 寫入名 250＋159、稀有度 166＋121（多為 NONE）。
- MA（Mega Attack Rare）：日本官方 `ic_rare_ma` 與台灣官方 MA 一致 → migration `20261003060000_pokemon_rarity_ma` 新增，再以 `20261003070000_pokemon_rarity_ma_rank` 更正排序到 SAR 之後（M2a 卡號 SR 214–222 < MA 223–232 < SAR 233–249）；M2a 10 張 UR→MA（ADR 0009）。
- M 世代結果：1,194 張、中文名 1,171（M6 6、M6a 17 官方缺卡號）、M6a 稀有度空值 15、verified 約 1,140。

### 依序執行 15：ADR 0012 日本官方卡片搜尋匯入 S 世代 9 系列（2026-10-03，已完成）

- 抓取：`scripts/fetch-pokemon-jp-official-rarity.mjs --whole-series <代碼,...> <cache>` 新模式，開每個系列清單的全部詳細頁（本次用 Bash 背景工作、上限設 2 小時，約 25 分鐘跑完，991 頁全 200）。快取 `docs/evidence/pokemon-jp/official-series/official-series-cache-20261003.json`（只含文字事實）。系列日文名／日文發售日取自封存系列檔（`series-meta-20261003.json`，ADR 0012 已補註）。
- Migration `20261003080000_pokemon_jp_official_series_import`：`private.import_pokemon_jp_official_series`（md5 `a7006c9c…`；批次 ≤100、gated、digest 重播、追加式稽核 `private.catalog_jp_official_import_audit`、同代碼已有 tcgdex-ja 系列即拒絕）；同時讓 `private.fill_pokemon_jp_from_tw_official`（md5 `0cc40d87…`）接受官方來源系列。套用前以 S4 在正式庫整批回滾測試（批次 2 先跑被拒、雙批匯入、重播零異動、SV6a 碰撞被拒、ADR 0011 填名與重播，零殘留）。
- 程式：`providers/pokemon-jp-official-series-plan.mjs`、`scripts/build-pokemon-jp-official-series-plan.mjs`、`scripts/import-pokemon-jp-official-series.sh`（可重跑：已匯入批次以重播確認）。官方圖示 `_2` 後綴比照 `_c` 去掉（S4a 200–303 `ic_rare_s_2` → S，ADR 0007 已補註）。ADR 0011 名稱字典比對：只差結尾括號附註（`老大的指令` vs `老大的指令（坂木）`、`博士的研究（山梨博士）` vs `(木蘭博士)`）不算不一致，因日本官方標題省略該附註。Node 272/272。
- 結果（每批 import＋重播零異動，稽核 import 13 筆）：S4 111、S4a 326（4 批）、S5a 84、S5R 81、S6a 87、S7R 79、S8a 25、S10b 93、S10D 88，共 974 張，全部 Card／Printing verified、稀有度無空值（S4a 166 與 S8a 17 張官方無圖示者依 ADR 0011 取台灣官方 NONE；S10b 5 張同理）。隔離：S8a 9（V-UNION 與基本能量無卡號）、S10b 8（基本能量無卡號）。中文名（ADR 0011，S4a／S8a 另用名稱字典 `name-dictionary-20261003.json`）728 張；其餘 246 張為台版未收錄的高卡號（SR／HR／UR、S4a 色違 S／SSR 等），維持空值。證據 `docs/evidence/pokemon-jp/official-series/`。
- 這些卡不與台版連結（ADR 0012），搜尋會與台版各列一筆；正式網站 `pokemon-official-ja-s4-104` 詳細頁顯示「ピカチュウV、SR、日版 S4 104」，無需改程式或部署。
- 複核：台版 7,436、美版 20,634（＋source 空值 2）、日版 tcgdex-ja 7,085 不變；日版合計 8,059 張。

### 依序執行 16：搜尋延遲（2026-10-03，已部署，伺服器端暖機 P95 582 ms）

- `public.search_cards_ranked(p_patterns, p_needles, p_limit, p_region)`（migration `20261003090000`→`…100000`→`…110000`→`…120000`，最終 md5 以正式庫為準）：SQL 內評分（完全相同 0／開頭 1／包含 2／其他 3，與伺服器 `normalizeSearch` 同樣的折疊 `public.tcg_search_fold`），依 canonical 分組只取前 40 組並回傳組內所有卡與 printings；metadata 只留 UI 用到的 `nameZhBasis`、`variantKey`、`variantName`、`imageId`、`rarityBeforeOfficial`；`p_region` 在 SQL 內先篩有該版本 Printing 的組；名稱無命中才比對 `search_text`，再無則列出系列（≤5 個系列、前 100 個 printing 依卡號），回傳 `matchedBy`（name／text／series）、`matchedSeries`、`matchCount`、`groupCount`。伺服器先呼叫它，失敗或格式不符才退回 `search_cards_with_siblings`，再退回 PostgREST 查詢（測試涵蓋三層）。
- `tcg_cards.search_names`（生成欄位：小寫的名稱＋卡號，`chr(1)` 分隔）＋ trigram 索引 `tcg_cards_search_names_trgm_idx`，以 `like` 比對：非 ASCII 的 `ilike` 每列轉小寫，在微型實例 CPU 節流時兩字中文詞會掃到 2.8 秒；現在約 25 ms，三字以上約 1 ms。加欄位時重寫整表、鎖表約 15 秒（已在同一交易中驗證後套用）。舊的表達式索引已移除。
- 伺服器：目錄快取過期後先回舊資料、由單一背景載入更新（之前每分鐘有一個搜尋要等 2–4 秒重載），TTL 改 10 分鐘以減少與搜尋爭用資料庫；搜尋結果快取 60 秒→10 分鐘（上限 200 筆）。可用環境變數 `CATALOG_CACHE_TTL_MS` 覆寫。Node 276/276。
- 正式量測（45 個查詢：15 詞 × 全部／日版／韓版，暖機後、快取未命中）：伺服器 total p50 267 ms、p95 582 ms、最大 1,021 ms（魯夫全部，141 KB、93 張卡：海賊王同一 canonical 下卡多）；用戶端（台灣，curl 每次新 TLS）p50 586 ms、p95 1,177 ms。改動前：rpc 370–990 ms、空版本結果多 400–1,000 ms、系列搜尋 1.4–2.0 s、每分鐘一次 2–4 s 目錄重載。Render 回應已有 brotli 壓縮。瀏覽器實測搜尋「桃歹郎」結果正常。
- 已知：Supabase 實例為小型（shared_buffers 224 MB），其他工作（瀏覽、匯入）平均查詢約 150 ms，負載時仍會偶發尖峰；升級運算規格涉及費用，未處理（如需進一步穩定 P95，這是下一個槓桿）。用戶端 P95 包含台灣到 Ohio 的往返約 300 ms。

### 依序執行 17：詳細頁單次往返（2026-10-03，已部署）

- Migration `20261003130000_get_card_detail`：`public.get_card_detail(p_id)` 一次回傳卡片群組（id 或 canonical_id 為 p_id，及其所屬其他 canonical 的卡）、全部 printings、系列與遊戲（選取規則同 `loadCardFromDatabase`，失敗或格式不符時退回原 PostgREST 查詢）。`getCard` 與目錄載入並行啟動，結果快取 10 分鐘（上限 500）並共用進行中的載入，詳細頁與市場資料分頁只載一次。正式量測（台灣端）：詳細頁 1.1–2.5 s → 約 0.5 s，市場資料 1.4–2.2 s → 約 0.5 s。Node 277/277。

### 依序執行 18：ADR 0013 以資料庫中的官方中文名推導日版名稱（2026-10-03，已完成）

- ADR 0013（使用者授權照建議）：日版卡沒有中文名時，若資料庫中日文名完全相同的日版卡已有官方依據的中文名（`tw-official` 或 `tw-official-same-number`），且該日文名只對應唯一一個中文名，就採用為 Derived name（`derived-cross-series`，`nameZhRule: 'adr-0013'`，記錄 `nameZhSourceCardId`）；不限世代與來源、只填空值、不連結 Canonical card。詞彙表 Derived name 已更新。
- Migration `20261003140000_pokemon_jp_derived_names_from_official`：`private.derive_pokemon_jp_names_from_official`（每次 ≤100，逐列重驗唯一性，追加式稽核 `private.catalog_jp_derived_name_audit`）。先以全部 6 份計畫在正式庫整批回滾測試，再套用。
- 結果：508 張（官方來源 235、tcgdex-ja 273），6 批寫入＋6 批重播零異動。日版缺中文名 758 → 250（官方來源剩 11、tcgdex-ja 剩 239，多為 SM 世代台版未收錄的名稱，以及 博士の研究 這類一對多的名稱）。候選清單 `docs/evidence/pokemon-jp/derived-names/adr-0013-candidates-20261003.json`。詳細頁提示文字改為不限同世代。
- 正式網站：`pokemon-official-ja-s4-105` 顯示「胡地V 同名推導、SR、日版 S4 105」。

### 依序執行 19：瀏覽與商品延遲（2026-10-03，已部署）

- 加 `search_names` 欄位重寫 `tcg_cards` 後，visibility map 被清空，瀏覽總數的 `count(*)` 變成 3.3 s；已對 `tcg_cards`、`tcg_printings`、`card_images`、`tcg_canonical_cards`、`tcg_series` 執行 `VACUUM (ANALYZE)`（45 ms）。**之後若再重寫大表，要記得 VACUUM。**
- Migration `20261003150000`：索引 `tcg_cards (game_id, official_card_number, id)`，瀏覽首頁排序 115 ms → 7 ms。
- Migration `20261003160000`／`170000`：`public.browse_cards_page(game, limit, offset, desc)`（預設瀏覽頁、精確總數、printings、圖片一次回傳，DB 18–28 ms）與 `public.browse_series_cards(game, series)`（系列頁三組資料一次回傳，取代分頁＋分批的 PostgREST 查詢，DB 6–30 ms）；兩者 metadata 只留列表會讀的鍵（詳細頁另由 `get_card_detail` 讀完整資料），日版 237 張系列 607 KB → 255 KB。伺服器先用 RPC，失敗時退回原查詢；結果與其他瀏覽資料一樣快取 5 分鐘（瀏覽快取超過 400 鍵時清掉過期與最舊項目）。
- `/api/products` 改為快取 10 分鐘並在背景更新（讀不到已存商品時不快取），1.5–2.1 s → 快取命中約 0.4 s（台灣端）。
- 測試：`node --test` 偶發「fetch failed: bad port」——作業系統會配到 fetch 規格禁止的埠；兩個測試檔的取埠函式已改為避開。Node 280/280。
- 量測（台灣端、`curl --compressed`）：預設瀏覽頁約 0.6 s（原 0.8–2.6 s）、日版大系列首次 1.0–1.7 s（原 1.5–3.3 s，之後走快取）、詳細頁約 0.5 s。

### 依序執行 20：伺服器處理與首頁載入（2026-10-03，已部署）

- 稀有度查詢索引化：`providers/normalize.mjs` 的 `rarityEntry`／`rarityRank` 原本每次都重建整份定義並對每個別名做 NFKC＋正規表示式；改為每個遊戲建一次 token 索引（與舊程式對 852 組遊戲／值逐一比對無差異）。瀏覽排序改用共用 `Intl.Collator`（`localeCompare` 帶選項每次都建新的 collator）。Render 上系列頁組裝 300–800 ms → 5–8 ms；快取命中的系列頁約 0.33 s（台灣端）。`/api/cards` 的系列路徑回傳 Server-Timing（rpc／clone／page）。
- 啟動預熱：伺服器 listen 後立即載入目錄、商品與趨勢（`CATALOG_WARM_ON_START=false` 可關閉；會攔截或計數 mock 請求的測試已關閉），部署後第一個搜尋不再等 3.5 s 目錄。買取價查詢走 5 分鐘瀏覽快取。
- 首頁品牌圖：原本一開頁就下載 3.8 MB（1471 px 標誌縮成 24–42 px 顯示、收合的角色圖庫也全部下載）。`assets/brand/web/` 放依用途縮放的 WebP（共 224 KB，原檔保留），favicon 改 64 px PNG，展示區與圖庫 lazy loading。正式站首屏品牌圖 14 KB，`load` 2.5 s → 1.7 s，CLS 0.06–0.08（< 0.1）。LCP 在隱藏的瀏覽器面板中無法量測，尚未驗證。
- Node 280/280。

### 依序執行 21：首頁版面穩定（CLS，2026-10-03，已部署）

- 量測工具：scratchpad 的 `cwv.mjs`（headless Edge＋Chrome DevTools Protocol，不需安裝套件；桌機 1440×900、手機 390×844 DPR3、CPU 4x）。隱藏的 App 瀏覽器面板量不到 LCP，CLS 也不準。
- 原本正式站桌機 CLS 0.25–0.54、手機 0.15–0.48：遊戲選單載入後才填入（+118 px）、趨勢區塊插在最上方（557／627 px）、載入提示在內容流中出現又消失，以及趨勢區在資料回來前先渲染較矮的「無資料」版本。修正：`#channels:empty` 與 HTML 中的 `#trendsSection` 佔位保留最終高度、載入提示改為浮在底部、趨勢區只在請求完成後渲染（`window.trendsLoaded`）。
- 結果（本機連正式資料）：桌機 CLS 0.005、LCP 0.40–0.53 s；正式站部署前一版桌機 CLS 0.03–0.05、LCP 0.5–1.6 s。手機 LCP 0.5–0.8 s，CLS 多為 0，但有時回報一筆 0.204，歸因於視窗外（y≈1541）的 `#series` 水平捲動列；1.8–3.3 s 逐格截圖像素完全相同，畫面無可見位移。真實使用者是否受影響需看 CrUX／RUM 數據，待觀察（已排除：重複 id、標頭遊戲按鈕寬度——後者已修為依網址 `?game=` 直接顯示名稱）。
- INP（scratchpad `inp.mjs`，以 CDP 點擊開卡片／關閉／清單與圖鑑切換／系列卡／分頁）：正式站桌機最慢一次互動 48 ms、手機（CPU 4x）88 ms，低於 200 ms。正式站桌機最新 CLS 0.005–0.009、LCP 0.5–0.9 s；手機 LCP 0.5–1.1 s（曾有一次 20 s 極端值，重跑 4 次未重現）。

### 依序執行 22：SV5K／SV5M 以日本官方卡片搜尋匯入（2026-10-03，已完成）

- 這兩個朱紫擴充包在 Source archive 中被列入來源異常隔離清單，一直未匯入；ADR 0012 補充適用範圍（封存資料被隔離不可用者同樣以官方卡片搜尋匯入），系列名與發售日取自封存系列檔（`series-meta-sv5-20261003.json`）。
- 官方各 100 張，零隔離；匯入＋重播零異動；ADR 0011 對齊（可比對 99／100 筆全一致）後 200 張全部取得台灣官方中文名，6 張官方頁無圖示者取台灣官方 ACE。200 張全部 verified、無稀有度空值。快取 `official-series-sv5-cache-20261003.json`。

### 依序執行 23：朱紫／MEGA 牌組類商品 27 個系列（2026-10-03，已完成）

- 官方卡片搜尋頁內嵌的擴充包選單（`pg` 值＝商品 ID）逐一查第一頁，建立「代碼 → 商品名」對照（scratchpad `pg-product-codes.json`）；系列日文名取官方商品名（多款共用代碼者取共同名稱：SVD exスタートデッキ、SVM スタートデッキGenerations、SVI バトルアカデミー），發售日官方清單沒有，留空。`series-meta-decks-20261003.json`。這些代碼在封存中都沒有日文卡名，依 ADR 0012 匯入。
- 抓取 1,092 頁；匯入 1,006 張（SVAL 18、SVAM 20、SVAW 20、SVB 28、SVC 18、SVD 139、SVEL 18、SVEM 18、SVF 38、SVHK 53、SVHM 53、SVP1 7、SVG 52、SVI 50、SVM 175、SVN 45、SVOD 19、SVOM 20、SVJL 21、SVJP 19、WCS23 30、MA 43、MBD 22、MBG 22、MEE 20、MEZ 20、MEM 18），全部 verified，重播零異動。隔離 86 張：同卡號在官方有兩張（牌組不同卡圖）整號隔離、基本能量官方無卡號。
- 中文名：ADR 0011 對齊通過 11 個系列（SVAL／SVAM／SVAW／SVB／SVC／SVD／SVEL／SVEM／SVF／SVP1）並取得台灣官方「無標記」；SVHK／SVHM 台版同代碼卡號排列不同（18–21 筆名稱不一致）整系列拒絕；其餘台灣官方快取無資料。之後以 ADR 0013 推導 611 張（7 批，重播零異動，候選 `derived-names/adr-0013-candidates-decks-20261003.json`）。官方頁無稀有度圖示且無台版者維持空值（Printing incomplete）。
- 日版合計：94 個系列、9,266 張卡；中文名 8,945；`pokemon-card-official-jp` 38 系列 2,180 張（稀有度空值 682，多為牌組）。台版 7,436、美版 20,635 不變。正式站 `pokemon-official-ja-svm-059` 顯示「小仙奶 同名推導、日版 SVM 059」；`マホミル` 日版搜尋 8 筆。

### 依序執行 24：SM 世代 30 個擴充包與 XY 的 CP1／CP2（2026-10-03，已完成）

- 發現：Source archive 的 data-asia/SM 其實有 SM1S～SM12a 的日文卡名（先前只匯入 SM1p–SM5p），所以走原本的封存流程（`scripts/import-pokemon-jp-series.sh`，`CARDSCOPE_WORK` 必須用 Windows 路徑如 `C:/Users/...`，否則腳本內的 `node require` 失敗）。重新產生既有日版列快照 `sm-era/existing-jp-rows-sm-20261003.json`（9,266 列），observedAt `2026-10-03T06:04:38Z`。
- 匯入 30 個系列 2,736 張（SM6／SM7／SM8／SM9／SM10／SM11／SM12 各 2 批、SM8b／SM12a 3 批），全部 gated＋重播零異動；無台版，所以無台版連結。ADR 0013 推導中文名 1,601 張（17 批，重播零異動，候選 `derived-names/adr-0013-candidates-sm-20261003.json`）。
- 日版合計：124 個系列、12,002 張，10,546 張有中文名。SM 世代（含 SM1p–SM5p）3,139 張：中文名 1,820、verified 366。
- XY 世代：封存只有 CP1（34）、CP2（27）有日文名（BW 以前沒有），已同流程匯入（重播零異動），ADR 0013 推導 22 名；既有列快照 `xy-era/existing-jp-rows-xy-20261003.json`。其餘 XY 以前的系列只能走 ADR 0012（日本官方卡片搜尋），尚未查證官方是否收錄。
- 日本官方核對（2026-10-03 完成）：逐卡找頁模式在 SM 世代太慢（官方清單順序與封存卡號不一致，每卡要多抓數頁），改用 `--whole-series` 抓 32 個系列 2,569 頁，快取 `official-series/official-sm-cache-20261003.json`。計畫（報告 `sm-era/official-rarity-report-20261003.json`）：correct 342（UR→SR 259、UR→S 45、UR→SSR 38，後兩者為 SM8b 色違，ADR 0009）、identity 2,519，共 70 份計畫全部執行、重播零異動。隔離：未知圖示 `ic_rare_tr` 36（未對映，待查證）、名稱不符 50（多為 SM12a 稜鏡之星◇卡，官方標題含圖示而解析不到名稱）、官方頁無圖示 258；官方清單沒有的封存卡 228（每系列約 7 張，多為能量等）。
- 結果：SM＋CP 3,200 張，Card verified 2,885、Printing verified 2,401、稀有度空值 486、Card／Printing 稀有度不一致 0。日版合計 126 個系列、12,063 張，中文名 10,568、verified 11,603。台版 7,436、美版 20,635 不變。

待使用者決定（2026-10-03 查證）：遊戲王 14,634 張中只有 1 張有中文名。PRODUCT_PLAN 指定的官方 Neuron（db.yugioh-card.com）只有簡體中文 `request_locale=cn`、沒有繁體，且站台有 Imperva（Incapsula）防爬；robots.txt 回 404。簡轉繁不是台灣官方譯名，啟用此來源涉及授權與防爬政策，依自主決策邊界未自行處理。

下一個安全起點（擇一，建議依序）：
1. 手機 CLS 的 0.204 歸因需以真實使用者數據確認（可考慮加入 web-vitals RUM 回報）。
2. 日版剩 250 張無中文名：多為 SM 世代（台灣官方未收錄），需要新的官方來源或維持空值。
3. Supabase 實例偏小（shared_buffers 224 MB），負載時查詢會偶發尖峰；升級運算規格涉及費用，需使用者決定。
其他後續候選：Singapore 測試服務 `https://cardscope-1.onrender.com` 已證實區域不是瓶頸，建議由使用者刪除或停用；M-P 特典（ADR 0012 的流程可沿用，但特典卡號格式需另訂）；SM 世代中文名（台灣官方未收錄 SM）；SV-P 特典與基本能量的對應規則；牌組商品 88 筆的日版稀有度；SV8a 與牌組商品的稀有度需要官方頁以外的證據（ADR 0007：無圖示不等於無記號）；台版 UR 是否同樣受 TCGdex `Ultra Rare` 對映影響（台版官方站另行查證）；Render log 抽查 `search printing embed failed`；SVLN／SVLS／SVK 與 SV11B／W 的中文名來源、日版缺稀有度的 328 筆。日版修改一律走既有函式（enrich 只填空值、status 只升不降）。

## 前一里程碑（2026-10-01 晚，SVLN 已正式匯入）

- 分支 `claude/grill-with-docs-4i2eha`（尚未合併 main、未開 PR）；本輪只改文件，無程式變更、Render 無需部署。
- 執行前複核：正式函式 `prosrc` md5 `d9ce6c66c2704bb304cc2e4100342e10` 與交接一致；SV4a Seed 1/1/1（card md5 `50098b2093bf91ef2fd336c258291024`、printing md5 `c6f030ffab6701f5eda2e77627734c38`）；台版 7,436／美版 20,635；SVLN／`tcgdex-ja` 零碰撞、稽核 0 筆。
- 正式 dry-run：`replay=false`、planDigest `48f1dbfe08d5775ba2c2b5dc1deaca7f86910721e1f7a346fcbf249913d91b46`、`before` 全 0、`inserted` series 1／cards 22／canonical 22／printings 22；執行後零殘留。
- 真實匯入（actor `claude-code-local:aa26488931`，2026-10-01 10:08:44 UTC）結果同上；立即重播（10:10:27 UTC）`replay=true`、`inserted` 全 0、`present` 1/22/22。稽核表恰 import、replay 各一筆，digest 相同。
- 唯讀複核：台版 7,436／美版 20,635 不變；SV4a Seed 兩個 md5 不變；SVLN 22 card／22 canonical／22 printing 全 `data_status='pending'`，圖片、繁中名、稀有度皆 0。
- 正式網站：`/api/cards?series=pokemon-tcgdex-ja-svln` HTTP 200、22 筆；`/api/search?q=ニンフィア` 命中 `pokemon-tcgdex-ja-svln-005`（`マンタイン` 命中 001）；詳情 `/api/cards/pokemon-tcgdex-ja-svln-005` HTTP 200；永久網址 `/?game=pokemon&card=pokemon-tcgdex-ja-svln-005` 顯示「中文名稱待補｜ニンフィアex」、圖片待補、稀有度待補、日版 SVLN 005。注意 `/api/cards` 不吃 `q`，日文名搜尋要用 `/api/search`。

### 第二個 pilot：SV6a（已正式匯入，2026-10-01 晚）

- 真實匯入與立即重播皆以 digest 守門 SQL 執行（actor `claude-code-local:aa26488931`）：匯入 `inserted` 1／94／94／94；重播 `replay=true`、零異動、`present` 1/94/94。稽核共 4 筆（SVLN、SV6a 各 import／replay）。
- 唯讀複核：台版 7,436／美版 20,635、SV4a card md5、SVLN cards／printings md5 全與匯入前基準相同；SV6a 94 card／94 canonical／94 printing 全 pending、無圖、無繁中名，printing 稀有度 C28／U20／R7／RR6／AR12／UR10／SAR5／空 6，card 與 printing 稀有度不一致 0。
- 正式網站：`/api/cards?series=pokemon-tcgdex-ja-sv6a` 94 筆，rarity facets 與上相同（空值顯示 `unknown:6`）；`/api/search?q=モモワロウ` 命中 039 RR／082 UR／090 SAR／092 空，`カシオペア` 命中 061／085／091；永久網址 `/?game=pokemon&card=pokemon-tcgdex-ja-sv6a-090` 顯示 モモワロウex、SAR、日版 SV6a 090。已知限制：搜尋系列名「ナイトワンダラー」無結果（`search_text` 只含卡名與卡號，非本輪問題）；首次搜尋冷啟動約 27 秒。

以下為 dry-run 時的紀錄：

- `api.tcgdex.net` 拒絕連線（ECONNREFUSED），依 ADR 0002 改讀 `tcgdex/cards-database` commit `c5c0a8a63fe81746d05b9c95e8f51ed6931f7e78`（解析不執行）。同 commit 重建的 SVLN 計畫與 API 計畫列內容完全相同。Node 全套 221/221。
- SV6a（ナイトワンダラー，2024-06-07）94 張零隔離零碰撞；稀有度 C28／U20／R7／RR6／AR12／UR10／SAR5，6 張留空（054、055、063 為 `ACE SPEC Rare`；092–094 來源標 `Mega Hyper Rare`）。證據 `docs/evidence/pokemon-jp/SV6a-*-20261001.json`；manifestHash `fdad7649…e538`，planDigest `bcbdb5889dee08b4752889f042d693f9e22bae5ca1a0bff3485debf00a9f6b6b`。
- 計畫 80 KB 太大不手貼：SQL 以「卡號、名稱、稀有度」短表加常數重建 jsonb，函式只在 digest 等於上值時呼叫（本機以 PostgreSQL jsonb 文字規則計算 digest，已用 SVLN 驗證）。
- 正式 dry-run：`replay=false`、digest 相符、`before` 全 0、`inserted` 1／94／94／94，零殘留；稽核仍 2 筆。匯入前基準：台版 7,436／美版 20,635、SV4a card md5 `50098b20…1024`、SVLN cards md5 `76043fb70654b199f5580daf891fe29f`、SVLN printings（去 updated_at）md5 `62331c1ab63d26eee321d191fc1daa6a`。

### 擴大匯入：朱紫 10 個系列（2026-10-01 晚，使用者指示「全部執行」）

- 同一 commit `c5c0a8a…`、同一 observedAt `2026-10-01T10:54:37.173Z`、同一既有列快照（SV4a+SVLN+SV6a，三組 md5 與正式庫一致，seedHash `a46a6c05…8dff`）。證據在 `docs/evidence/pokemon-jp/<系列>-*-20261001.json`。
- 新工具 `scripts/emit-pokemon-jp-import-sql.mjs`（`providers/pokemon-jp-import-sql.mjs`）：以短表在 SQL 內重建計畫並以 digest 守門；`gated-import` 模式在同一敘述先 dry-run，結果須 `replay=false`、digest 相同、`before` 全 0、`inserted` 1/N/N/N 才寫入。SVLN 以此工具 dry-run 得相同 digest（重播路徑零寫入）。
- 結果（全部 import＋replay 各一筆稽核、重播零異動）：SV2D クレイバースト 99（稀有度 71）、SV2P スノーハザード 99（71）、SV3a レイジングサーフ 92（62）、SV4K 古代の咆哮 95（66）、SV4M 未来の一閃 95（66）、SV5a クリムゾンヘイズ 96（63）、SV7a 楽園ドラゴーナ 94（61）、SV9a 熱風のアリーナ 92（63）、SVK デッキビルドBOX ステラミラクル 44（0）、SVLS スターターセット ソウブレイズex 22（0）。SV2D 為逐步 dry-run→匯入→重播；其餘為 gated-import 後統一重播。
- 複核：日版 12 系列共 944 張，全部 pending、無圖、無繁中名，card／printing 稀有度不一致 0；台版 7,436／美版 20,635、SV4a 與 SVLN md5 不變；稽核 24 筆（12 系列各 import／replay）。
- 未匯入：SV5K／SV5M（SV5K 在來源異常隔離清單，SV5M 為同期姊妹包一併保留）；>100 張系列（SV1S、SV1V、SV1a、SV3、SV6、SV7、SV8、SV9、SV10 等）需先設計多批交易；`data-asia/SV` 下僅有繁中／其他語言日期的系列不屬日版。

### 系列名稱搜尋（程式）

- `/api/search` 在卡名與 `search_text` 皆無結果時，改查 `tcg_series` 名稱／官方代號（最多 5 個系列），依 `series_id, local_card_number` 列出該系列卡（上限 100），`meta.match='database-series'`。新增 mock 測試；Node 全套 226/226。需部署後才在正式網站生效。

### 稀有度對映（已由上方目前里程碑處理：ACE 已新增，金卡維持空值）

- `ACE SPEC Rare`：DB 已有此代碼（美版 33 筆）但排序表無；與既有 `Rare ACE` 是否同義、日版是否應顯示 `ACE` 需產品決定。加入別名會改變全站顯示與 facets，且已匯入日版列需 UPDATE（匯入函式只允許 INSERT，需另寫 migration）。
- `Mega Hyper Rare`：TCGdex 在 Mega 世代代表 MUR，但 SV6a 092–094 金卡也被標成此值，來源不一致，不能全域對映；維持空值。

### 部署（2026-10-01 晚）

- main 快轉到 `d51fefa` 並推送（`a88900c..d51fefa`），Render 自動部署後正式 `/api/search?q=ナイトワンダラー` 回 `match=database-series`、40 筆、依卡號從 SV6a-001 起；`モモワロウ`、`噴火龍`、`SV9a` 搜尋與 `/api/catalog/health` 皆 HTTP 200。
- 本機 `.claude/settings.local.json`（全域 gitignore，不進版控）已加入允許規則 `Bash(git push origin main)`，經使用者指示；其他電腦需各自設定。

（當時的下一步：稀有度對映等使用者決定；>100 張系列需先設計多批交易。匯入稽核表 24 筆。）

## 前一里程碑（2026-10-01，SVLN 匯入前）

- 分支 `claude/grill-with-docs-4i2eha`（尚未合併 main、未開 PR）。設計見 `docs/PRODUCT_PLAN.md` Phase 2C、`docs/adr/0001-jp-canonical-isolation.md`、`GLOSSARY.md`；pilot 系列定為 **SVLN**（スターターセット テラスタイプ：ステラ ニンフィアex，22 張，2024-08-30）。
- 來源證據：2026-10-01 一般 GET 共 26 次全 HTTP 200；快照 `docs/evidence/pokemon-jp/SVLN-snapshot-20261001.json`，manifest 零隔離（1 series／22 card／22 printing），22 張來源稀有度皆 `None`，匯入後稀有度全空。匯入計畫 `docs/evidence/pokemon-jp/SVLN-import-plan-20261001.json`：manifestHash `e399ef342f0473f948c98e1707de2bbb120fe77f4458b33fd6b47b32ba6ecc4f`，預期函式回傳 planDigest `48f1dbfe08d5775ba2c2b5dc1deaca7f86910721e1f7a346fcbf249913d91b46`（不同即表示貼上內容有誤，不得寫入）。
- 程式：manifest 改為可讀 ID `pokemon-tcgdex-ja-<系列>-<編號>`；新增 `providers/pokemon-jp-import-plan.mjs`、`scripts/build-pokemon-jp-import-plan.mjs`。Node 全套 216/216；本機 PostgreSQL 16 情境測試 `scripts/test-pokemon-jp-import-sql.sh` 全通過（權限、dry-run、中途回滾、匯入、既有列不變、重播零異動、不同計畫拒絕、SV4a／canonical 碰撞、稽核禁止修改）；不在 CI。
- Supabase：已套用正式 migration `20261001095010_pokemon_jp_metadata_import`（private 追加式稽核表 `private.catalog_jp_import_audit` 與僅 `service_role`／postgres 可執行的 `private.import_pokemon_jp_metadata(jsonb, text, boolean)`）。正式函式與稽核表結構 md5 與 repo 一致（函式 `d9ce6c66c2704bb304cc2e4100342e10`）。**尚未執行 dry-run 或任何資料寫入**；匯入前正式庫日版寶可夢仍只有 SV4a Seed（1 series／1 card／1 printing），SVLN 與 `pokemon-tcgdex-ja-*` 零碰撞。
- Render：本輪沒有應用程式變更需要部署。

下一個安全起點（依序，任一步不符預期即停止）：
1. 正式 dry-run：以 SQL 執行 `select private.import_pokemon_jp_metadata('<SVLN-import-plan 內容>'::jsonb, '<actor>', true);`，必須回傳 `replay=false`、`planDigest` 等於上方值、`before` 全 0、`inserted` 為 series 1／cards 22／canonical 22／printings 22，且正式庫無殘留列。
2. 同一內容以 `false` 真實匯入一次，再以相同內容 `false` 重播：必須 `replay=true`、零異動、稽核各一筆 import／replay。
3. 唯讀複核：台版 7,436／美版 20,635 printing 與 SV4a Seed 未變；新列 `data_status='pending'`、無圖片、無繁中名。
4. 正式 `/api/cards`、日文名搜尋（如 `ニンフィア`）、詳情永久網址抽查；之後更新本文件與 Phase 2C 狀態。第二個 pilot（含稀有度的擴充包）沿用同一函式，另跑 manifest 預檢。

## 前一里程碑（2026-09-28）

- GitHub main runtime checkpoint `4710f71`；正式網站回傳的程式確認包含完整關聯分頁與獨立查詢重疊。Dashboard 曾確認 `65f8b99` Live（20.1 秒），目前不能把 Dashboard 登入延續視為已驗證。本輪 metadata-only 工具及交接文件另隨後續提交發布。本機全套 Node 測試 213/213 通過；390px 手機版無橫向溢出，200% 縮放及完整五 IP 互動驗收尚未全部完成。
- 完整 Supabase 搜尋已修復，線上「魯夫」「噴火龍」有結果；保留 `catalog.json` fallback。圖片展示數與缺口現在使用同一政策集合，URL 存在數／原始連結稽核另列。趨勢標示「單一來源買取漲幅」，不冒充成交或人氣。
- 正式 coverage 觀測 48,269 張（寶可夢 28,073、航海王 4,284、遊戲王 14,634、芙莉蓮 751、排球少年 527），`sample=false`、六類查核 complete；完整官方分母仍 unknown。既有遊戲王同步持續變動，以上不是全系列已齊。
- 同步空值不覆寫防護已部署；migration `20260926200419_repair_pokemon_tw_printing_rarity` 恢復 786 個台版 printing 的三個稀有度欄位。完成新 TW 同步後唯讀複核 786/786 仍與 after_snapshot 一致。私有 audit 保存 796 候選、10 筆排除證據及 786 筆前後快照；不是 7,436 個台版 printing 全面補齊。
- 商品盤點：32 個實體封面商品皆有圖（航海王 10、排球少年 18、芙莉蓮 4）；寶可夢／遊戲王沒有實體卡盒商品列。先前系列快照 1,041 個／740 有圖／301 缺圖，可能隨同步變動；系列圖不能算卡盒，缺正式繁中主名不猜譯補值。
- coverage 完整關聯 keyset 分頁已上線，失敗或重複頁面不報假 complete；獨立查詢並行但保留 browse 每表 <=4、每批 <=100、URL <=8 KiB。暖快取實測 815 ms，冷查詢仍曾超過 60 秒，不能宣稱冷啟動效能達標。
- SV8a `074–237` 164 張全部重新取得 HTTP 200，逐張核對來源與台版。只提升 16 張明確 Double rare 為 RR（16 card +16 printing），兩批重播零異動；148 張原值 None 未寫。全系列 35/237 稀有度已知、202 未知、不一致 0；詳見 `docs/SV8A_SOURCE_RESUME_20260928.md`。
- 日版 metadata-only manifest 與 CLI 已完成（每批 <=100、source/seed hash、cursor、碰撞隔離、來源時間與來源 URL），真實 PMCG1-001 canary 零寫入。SV4a 來源／seed 與變體計數異常須先協調；正式日版 importer、觸發器與自然鍵檢查尚未完成，不以 dry-run 假稱日版全量匯入。詳見 `docs/JP_METADATA_PREFLIGHT.md`。
- 整合工作區 `cardscope-coverage-integrate`／`codex/coverage-integrate`。原 checkout 的未追蹤 `pnpm-lock.yaml` 保留。筆電先保留 dirty files，再於乾淨 main 執行 `git pull --ff-only origin main`；密鑰與登入不在 Git，不聲稱另一台全域設定已同步。
- 模型活動：Luna Max workers 實作與測試，Sol advisor 裁決資料完整性／coverage 路徑；repo 保留 `luna_worker`／`sol_advisor`。不得因 config 存在就宣稱另一台 live inference 已驗證。
- 來源未恢復或新增封面權利未確認時不猜資料、不複製卡拍拍／Pinterest、不付費、不繞過反爬；尚未取得可靠資料的項目不能標成計畫完成。

下一個安全起點：先核對正式 DB 自然鍵、canonical trigger 與日版來源異常，完成單一系列的交易式 metadata pilot 設計後再導入；冷啟動、五 IP 鍵盤及 200% UI 驗收另列未完成。缺失官方封面／Logo 的可展示權利與 SV8a None 值需要新證據，不能靠重播本次來源補出。

## 歷史紀錄（狀態以本文件上方與正式稽核為準）

- 目前工作基準：分支 `codex/detail-history-sync`，前次 GitHub `main` checkpoint `54c74a6`（商品 API 來源與圖片覆蓋資訊；Render Live，20.4 秒）。本輪新增誠實的系列圖替代導覽，沒有更動 schema；每次推送後須重新檢查 Render 部署狀態。
- 程式基準：本輪從 GitHub `main` commit `bf291f3` 開始；精確系列與數字卡號範圍功能為 commit `7dc89a4`。Pokémon 候選規劃／執行 CLI 現在支援 `--series`、`--card-number-from`、`--card-number-to`，使用正規化後的精確系列比對、含頭尾的數字範圍與數值排序，並拒絕無效或反向範圍。明確系列／卡號若與 provider ID 衝突會被排除。
- 驗證：Node 全套測試 `175/175` 通過；既有 dry-run、每批最多 100 個 provider group、checksum／cursor 冪等與斷點續傳行為維持不變。程式與 S11 checkpoint 已推到 GitHub `main` commit `c5a7b10`；Render 自動部署成功、狀態為 Live（29.0 秒），正式 `/api/catalog/health` 回傳 HTTP 200。不可把本機 `127.0.0.1` 驗收當成正式部署完成。
- Supabase：正式專案 `ubiaftrvmywwmifqzmik` 的既有 schema／migration 維持不變；本輪只使用既有私有候選與交易式升級函式，沒有新增 DDL。安全與效能 advisor 仍只有既有 INFO。
- S11 第一批：`pokemon-tcgdex-s11-001-050-20260923` 提升候選 `523–622` 共 100 筆，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `ade16efcdeedc77f552d3dc6e6ef61f2`，立即重播 `replay=true` 且再次異動為 0。
- S11 第二批：`pokemon-tcgdex-s11-051-100-20260923` 提升候選 `623–722` 共 100 筆，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `1f972e9c66d04240a3722e418237e300`，立即重播 `replay=true` 且再次異動為 0。
- S11 完整結果：全系列 100 張，card／printing 稀有度缺口皆為 0、互相不一致為 0、缺少排名為 0；facets 為 `C:44`、`U:34`、`R:10`、`RR:8`、`RRR:4`。精確來源只提供前 20 張圖片，另 80 張維持缺圖；不得借用其他 printing 或推測圖片。
- S11a 第一批：`pokemon-tcgdex-s11a-001-050-20260923` 提升候選 `723–822` 共 100 筆，補上 50 張 card 與 50 個 printing 稀有度；50 個既有官方繁中名核對成功。checksum `9c3db4afeca54d97cf4bbe8cc2dd0ad6`，立即重播 `replay=true` 且再次異動為 0。
- S11a 第二批：`pokemon-tcgdex-s11a-051-068-20260923` 提升候選 `823–858` 共 36 筆，補上 18 張 card 與 18 個 printing 稀有度；18 個既有官方繁中名核對成功。checksum `81522404a83ecee3d91ad8a7c8f1e3bf`，立即重播 `replay=true` 且再次異動為 0。
- S11a 完整結果：全系列 68 張，card／printing 稀有度缺口皆為 0、互相不一致為 0、缺少排名為 0；facets 為 `C:25`、`U:21`、`R:10`、`RR:6`、`RRR:3`、`K:3`。精確來源只提供前 20 張圖片，另 48 張維持缺圖；不得借用其他 printing 或推測圖片。
- S12 第一批 `001–050`：TCGdex `zh-tw` 逐張核對官方繁中名稱及 provider ID 後，建立 96 個已核准候選（ID `859–954`），補上 48 張 card 與 48 個台版 printing 稀有度；checksum `6eaa59f95044dd65dda5ce63d565d1f6`。立即重播為零異動。來源未提供稀有度的 `S12-034`、`S12-036` 保留空值。
- S12 第二批 `051–100`：46 筆來源資料通過同樣核對，建立 92 個已核准候選（ID `955–1046`），補上 46 張 card 與 46 個台版 printing 稀有度；checksum `d3f2fa89101310d0c30bb68e9fa12774`。立即重播為零異動。`S12-077`、`S12-080`、`S12-099`、`S12-100` 來源未提供稀有度，保留空值。
- S12 `101–114`：來源 14 筆均沒有稀有度，未建立候選、未寫入正式資料。S12 暫為部分完成：114 筆中 94 筆 card 與 printing 稀有度皆已填入、零筆互相不一致；20 個待補編號為 `034`、`036`、`077`、`080`、`099–114`。全系列仍有 94 個 printing 缺少可靠圖片，沒有以其他版本圖片代填。
- SV10：`001–050` 候選 `1047–1146`（checksum `84c9d2bdb77b90dbbd8bb5366c858854`），`051–098` 候選 `1147–1242`（checksum `f06a91f710e073b2c640d1cb7239264a`）。逐張核對來源 provider ID、官方繁中名稱與台版 printing，分別補上 50／48 張 card 及 printing 稀有度；兩批立即重播均為零異動。正式庫 98/98 稀有度完整、缺圖 0、卡片與 printing 不一致 0、缺少排名 0。
- SV9：`001–050` 候選 `1243–1342`（checksum `f417dc03a5352c614a56089ec2e22673`），`051–100` 候選 `1343–1442`（checksum `4b28cd5f5d4720604f635b4254f7ea75`）。同樣逐張核對並各補上 50 張 card 及 printing 稀有度；兩批立即重播均為零異動。正式庫 100/100 稀有度完整、缺圖 0、不一致 0、缺少排名 0。正式 `/api/cards` 兩系列均回傳 HTTP 200 並顯示對應稀有度 facets。
- SV9a 部分完成：來源 `001–092` 全數 HTTP 200，名稱、provider ID、台版 printing 與正式庫逐張一致；其中 `001–063` 稀有度可確定。`001–050` 候選 `1443–1542`，checksum `0ca1e0f65ec81bcf11a68958b6b5dd4a`；`051–063` 候選 `1543–1568`，checksum `07d37a33d88c3a3d77d65604dcdf2f3d`。兩批共補 63 張 card 與 63 個 printing 稀有度，立即重播皆零異動。`064–092` 共 29 張來源原值為 `None`，沒有受支援映射，未建立候選或猜值。正式庫 63/92 已補、29 張保留空值，卡片／printing 不一致 0、已填入者缺排名 0、缺圖 0；正式 `/api/cards` 顯示 `unknown:29`。
- SV8 部分完成：`001–106` 來源逐張 HTTP 200，exact provider ID、官方繁中名稱及台版 printing 全部與正式庫一致。三批候選分別為 `1569–1668`（`001–050`，checksum `2d47498b221512874953798a44a67c3f`）、`1669–1762`（`051–100` 中 47 張，checksum `0d046f0ca03e08b7b01715a59431a078`）、`1763–1774`（`101–106`，checksum `b26285f3436664fa6eb08bf34e28876c`）。每批最多 100 個候選，均經零異常驗證與立即冪等重播；共補 103 張 card 和 103 個 printing 稀有度，名稱／圖片未異動。`SV8-095` 來源 `rarity: None`；`SV8-097`、`SV8-098` 來源為 `ACE SPEC Rare`，與現有 `Rare ACE` 無核准對映，均保留空值、不建立候選。正式庫 103/106 已填、互相不一致 0、缺圖 0；正式 `/api/cards` HTTP 200，facets `C:52`、`U:34`、`R:9`、`RR:8`、`unknown:3`。
- SV8a 局部完成：2026-09-24 逐張嘗試讀取 `001–237`，`001–073` 回傳 HTTP 200，其中 54 張來源 `rarity: None`、19 張明確為 `Double rare`；`074–237` 回傳 503，停止請求，未將服務錯誤視作資料缺失或嘗試繞過限制。19 張與正式庫 exact provider ID、官方繁中名稱、台版 printing、目標空值及既有圖片全部核對；候選 `1775–1812` 共 38 筆，批次 `pokemon-tcgdex-sv8a-001-073-verified-20260924`，checksum `83286875d65350c38b3af52cecc25bc7`，補上 19 張 card 與 19 個 printing 的 `RR`，立即重播零異動，名稱／圖片未異動。正式庫 19/237 已填、218 張保留空值、不一致 0、缺圖 0；正式 `/api/cards` HTTP 200，facets `RR:19`、`unknown:218`。
- 跨 IP 商品導覽：`openProduct` 現在等待 `choose` 完成，避免遊戲切換後的清理動作覆蓋已選商品。新增回歸測試；Node 全套 `176/176` 通過、`server.mjs` 語法檢查通過，未加入未追蹤的 `pnpm-lock.yaml`。
- 商品圖盤點：正式 `/api/products` 在 2026-09-24 有 32 個實體商品（航海王 10、排球少年 18、WS 4，皆有圖片），另有 1,045 個系列索引（遊戲王 648／有圖 564、寶可夢 276／有圖 176、航海王 119／有圖 0、排球少年 2／有圖 0）。寶可夢與遊戲王目前沒有實體商品封面列，不能把系列圖算成卡盒。API 原本固定宣稱日版寶可夢與美版遊戲王官方商品來源，與實際回傳不符；現在改由實際回傳項目計算各 IP 商品／系列數、圖片數與來源，並明示系列圖不是卡盒封面。
- 無實體商品的 IP 現在以明確標示「系列圖・非卡盒」的系列索引作為導覽替代；只在預設原盒分類與該 IP 實體商品數為 0 時出現。點擊系列圖會用精確 `seriesId` 載入卡表，不改寫商品數；切換不同 IP 仍等待狀態完成。新增 2 項回歸測試，全套 Node 測試 `178/178` 通過。
- 本輪阻擋複查：S12 原先保留的 20 張來源詳細資料再次回傳 20/20 HTTP 200，但稀有度與圖片仍全空；S10D `001–067` 回傳 67/67 HTTP 200、稀有度全空，正式庫 67 張稀有度缺值、47 張缺圖。兩者皆未建立新候選，也未以其他版本推測。
- 已完成系列：S10a `001–071`、S10P `001–067`、S11 `001–100`、S11a `001–068`、SV9 `001–100`、SV10 `001–098` 的 card／printing 稀有度均已補齊，且官方繁中名稱均完成逐張核對。
- S10b 阻擋證據：TCGdex `zh-tw` 的 001–050 可取回 50 個名稱但稀有度欄位為 0；051–071 可取回 21 個名稱但稀有度欄位仍為 0；072–079 為 404。正式庫既有 79 張 card／printing 皆缺稀有度，故本輪建立 0 個候選，不以其他語言、其他 printing 或推測值填補。
- 本機保留：`pnpm-lock.yaml` 目前未追蹤，不加入提交，也不得清除。若下一台電腦另有 `.playwright-cli/` 或 `output/`，同樣視為本機產物，不得誤刪或提交。

## 歷史下一步（已由目前里程碑取代）

下一個安全起點是來源恢復後唯讀預檢 SV8a `074–237`，不要密集重試 503；正式庫目前 218/237 張稀有度待補，其中 `001–073` 已確認的 54 張 `None` 保持空值。對恢復可讀的資料逐張核對 exact provider ID、官方繁中名稱、台版 printing、來源稀有度及受支援映射；未通過者保持空值，每批最多 100 個候選。SV8 的 3 張例外與 SV9a `064–092` 的 `rarity: None` 在可靠來源或明確映射到位前不猜值。S12 的 20 張、S10D 的 67 張及 S10b 仍為來源缺口；S12 的 94 張缺圖也不借用其他 printing。
