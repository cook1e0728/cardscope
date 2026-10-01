# CardScope 工作交接

本文件是跨電腦、跨對話的短版 checkpoint。長期需求以 `docs/PRODUCT_PLAN.md` 為準；本文件只記錄目前已驗證狀態與下一個安全起點。

## 更新規則

在下列任一節點更新本文件：PR 合併、正式 migration、正式資料批次、Render 發布驗收。每次覆寫已過期的「目前里程碑」，不要累積聊天逐字稿。

每完成一個段落（上述節點，或一組可獨立驗證的程式／文件修改），立即把本文件與相關修改 commit 並 push 到目前工作分支，不必再等使用者指示，確保另一台電腦 `git pull` 即可接手。不 push 密鑰或本機產物；合併到 `main`（會觸發 Render 部署）仍需使用者確認。

交接必須包含：

- GitHub `main` commit 與 PR。
- 本機測試、CI、Supabase 與 Render 各自的完成狀態。
- 資料批次範圍、候選數、實際異動數、重播結果與缺口原因。
- 尚未執行的唯一下一步，以及開始前必須重新核對的外部狀態。
- 未追蹤或屬於使用者的本機檔案，避免下一台電腦誤刪。

## 目前里程碑（2026-10-01 夜，日版中文化；優先於下方所有段落）

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

下一個安全起點：依序執行 3（>100 張系列分批匯入）、4（日版 data_status 升級定義）。後續候選：>100 張日版系列的分批匯入、SVLN／SVLS／SVK 的中文名來源、日版 `data_status` 升級定義。日版修改一律走 `enrich_pokemon_jp_metadata`，只填空值。

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
