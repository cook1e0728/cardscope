# 好卡在 CardSeek 全站 Swarm 體檢、修復與驗證報告（2026-11-22）

本次任務由 Coordinator 統籌，先由 4 位唯讀體檢員（`ux-auditor`、`code-sec-auditor`、`func-qa`、`visual-auditor`）於雙環境（本機無 `.env`／無資料庫樣本目錄與正式站 `https://cardseektcg.com` 嚴格唯讀）及三視口（`1440×900`、`1024×768`、`375×812`，含平板 `820×900` 功能測試）進行全面檢核，共產出 **60 條原始問題與測試缺口編號**；去重歸併與拆分複合發現後為 **45 個獨立主題**，經 `css-fixer`、`js-fixer` 實作修復並由 `func-qa` 完成全量回歸與 Playwright 驗收。

所有程式碼／CSS／測試修改均維持純 LF（`\n`）換行，通過 `npm.cmd run check`（exit code `0`）與 `npm.cmd test`（**1,066 / 1,066 通過，0 失敗、0 略過**），並已整理為 3 筆乾淨的繁體中文修復 commit 與本報告＋截圖 commit。

---

## 一、權限阻擋指令紀錄

本輪與上一輪執行期間均嚴格遵守權限規範：先採標準沙盒模式執行指令，僅於遭遇系統組態錯誤 `sandbox configuration error: deny .env: non-absolute file path.` 時切換 `BypassSandbox: true`（維持相同 `toolSummary`）；凡遇使用者權限確認取消或拒絕，立即停手並改用非侵入替代方式或列為未驗證項目，絕不嘗試繞過。

| 階段 | 遭阻擋指令 | 需求原因 | 阻擋原因與錯誤訊息 | 無繞過處置與後續結果 |
| --- | --- | --- | --- | --- |
| 上一輪（既有記錄） | `Select-String -Path look-v2.css,catalog-layout.css -Pattern "\.brand\b\|coll-manage\|ptl-details\|coll-import\|brand-collection-toast\|mascot-gallery\|feature-tour" ...` | 快速定位 CSS 選擇器名稱與確切行號 | 因 Windows sandbox `.env` 路徑設定錯誤切換 `BypassSandbox: true` 後，於使用者權限確認階段遭取消／擋下 | 未嘗試任何繞過指令，改以內建唯讀工具 `read_file` 分段讀取對應 CSS 檔案完成定位 |
| 本輪 Part 1（`func-qa` 補拍 `before` 基準） | `node "C:\Users\99wye\.gemini\antigravity-cli\brain\52d1927f-e44b-4561-891f-1fecfa77c722\scratch\audit-shots.mjs" before 4185` | `func-qa` 修正收藏 `localStorage` 鍵名（`cardscope-watchlist`／`cardscope-watchlist-meta`）與詳情價格捲動後，嘗試補拍 `collection-before-375.jpg` 與 `detail-price-before-1440.jpg` | 標準沙盒回傳 `sandbox configuration error: deny .env: non-absolute file path.`；切換 `BypassSandbox: true` 後遭權限拒絕：`user denied permission to run command` | 依 `#19` 指示絕不重試或改寫重跑，直接跳過 `before` 補拍、沿用既有 8 張基準截圖，並於本報告「五、Before / After 截圖對照」及「七、未驗證」誠實說明；後續修復後之 `audit-shots.mjs after 4185` 獲使用者允許並一次通過 |

---

## 二、本次修復摘要與 Git Commits

以下 3 筆程式碼／測試 commit（皆位於本機分支 `claude/agy-swarm`，未 `git push`、未合併 `main`）已完成並經過最終驗證；第 4 筆 commit 為本文件與前後驗證截圖：

| Commit | 訊息標題 | 涵蓋範圍與檔案 |
| --- | --- | --- |
| `ff9a133` | `fix(sync,search): 補強雲端同步合併、權杖錯誤區分、收藏正規化與版本查詢` | `server.mjs`、`providers/search-query.mjs`、`collection-store.js`、`test/collection-store.test.mjs`、`test/collection-sync-ui.test.mjs`、`test/search-compound.test.mjs` |
| `a51ed6e` | `fix(nav,ui): 修正 ⓘ 提示框定位、SPA 導覽排隊、重試圖隱藏與介面細節` | `ui-actions.js`、`navigation-state.js`、`ui-enhancements.js`、`side-nav.js`、`series-band.js`、`index.html`、`test/info-tip.test.mjs` |
| `29c4815` | `fix(css,a11y): 修復版面特異性回歸、焦點對比、點擊目標與動態暫停` | `look-v2.css`、`look-effects.css`、`look-showcase.css`、`test/swarm-audit-fixes.test.mjs` |

### 整合驗證摘要
- **換行格式（EOL）檢查**：針對上述 16 個既有修改檔與新增測試檔 `test/swarm-audit-fixes.test.mjs`（以及本報告 `docs/research/swarm-audit-20261122.md`）執行 byte-level `\r\n`／`\r` 檢查，全部為 **0 CR（100% 純 LF `\n`）**，與 `git show HEAD:<file>` 一致。
- **靜態語法檢查（`npm.cmd run check`）**：通過（exit code `0`，全專案已追蹤 `.js`／`.mjs` 語法無誤）。
- **全量回歸測試（`npm.cmd test`）**：通過（exit code `0`，**1,066 / 1,066 通過**，0 失敗、0 取消、0 略過、0 todo，耗時 `9234.3489 ms`，含新增之 `test/swarm-audit-fixes.test.mjs` JS 與 CSS 靜態守護斷言）。
- **工作區潔淨度**：`TASK.md`、`px.pid` 與 `.env*` 均未暫存或提交。

---

## 三、重點追查：`normalizeSyncEntry` 與 `{favorite:true, quantity:0}` 處置

`code-sec-auditor`（`SEC-10`、`TEST-03`）指出 `collection-store.js` 的 `problem()`（第 19 行）僅拒絕 `(!favorite && quantity === 0)`，導致 `{id, favorite:true, quantity:0, updatedAt}` 可通過舊版 `normalizeSyncEntry` 寫入雲端，卻被前端 `collectionItems()` 濾除而形成孤兒 `watchlistMeta` 並於後續同步消失。經完整追查前後端與歷史資料鏈路，確認並採取以下雙重處理：

1. **前端主動寫入端已過濾或轉正**：
   - `collectionItems()`（`ui-enhancements.js:1026`）透過 `CS.itemsFromLegacy([], watchlist, watchlistMeta).filter(item => item.quantity > 0)`，已只取出 `quantity > 0` 的項目。
   - `migrateLegacyFavorites()`（`ui-enhancements.js:147-152`）於初次搬移舊 `cardscope-favorites` 清單時即直接將未有有效數量的星號項目轉為 `watchlist[id] = 1`。因此現行前端不會主動將 `quantity: 0` 上傳至 `/api/sync/push`。
2. **雲端舊列相容與防同步卡死機制（`collection-store.js:232-235`）**：
   - 若既有帳號的雲端資料列已殘留舊格式 `{id, favorite:true, quantity:0, updatedAt}`，前端經 `mergeSync` 合併後重推 `/api/sync/push` 時，後端若對舊列直接拒收（回傳 `null`）將使 `/api/sync/push` 回傳 **HTTP 400**，導致該使用者帳號同步永久卡死。
   - 因此在 `normalizeSyncEntry(raw)`（`collection-store.js:232-235`）比照 `parseImport`／`applyItems` 規範進行正規化：
     ```js
     const {updatedAt,...rest}=raw,item=normalizeItem(rest);
     if(!item)return null;
     const quantity=collectedQuantity(item);
     return quantity>=1?{...item,quantity,...(item.quantity===0?{favorite:false}:{}),updatedAt}:null;
     ```
   - 當輸入為 `{favorite:true, quantity:0}` 時，`collectedQuantity(item)` 轉正為 `1`，並同步清掉 `favorite: false` 避免殘留不一致旗標，確保舊雲端列可平滑收斂並保持 `quantity >= 1`。
   - 當輸入為 `{favorite:false, quantity:0}` 時，`problem(rest)` 已阻擋而回傳 `null`，`normalizeSyncEntry` **嚴格回傳 `null`**（絕不回傳 `false`）。
   - 同時於 `collection-store.js:228` 補上 `(raw.canonicalId!=null&&UNSAFE_ID.has(raw.canonicalId))` 攔截原型污染鍵。
3. **回歸測試覆蓋**：
   - 單元測試（`test/collection-store.test.mjs:219-229`）：驗證 `{favorite:true, quantity:0}` 正規化為 `{quantity:1, favorite:false}`、`{favorite:false, quantity:0}` 嚴格 `strictEqual null`，以及 `canonicalId` 為 `__proto__`／`constructor`／`prototype` 時一律回傳 `null`。
   - 同步端到端測試（`test/collection-sync-ui.test.mjs:328-344`）：模擬雲端既含 `{id:'c-old', favorite:true, quantity:0}`，裝置端合併新增卡後推送 `/api/sync/push`，驗證回傳 HTTP 200（非 400）、雲端寫回 `{quantity:1, favorite:false}` 且 `revision` 推進至 `2`。

---

## 四、四位體檢員發現總覽與逐項處置表（60 條原始編號去重對應）

### 統計總覽

| 統計口徑 | 總數 | 已修 | 部分已修 | 建議未做 | 不做 | 說明 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| **原始體檢條目（60 條）** | **60** | **32** | **10** | **15** | **3** | `ux-auditor` 19、`code-sec-auditor` 19、`func-qa` 9、`visual-auditor` 13；其中 **42 條**含實質修復（32 完全已修＋10 部分已修） |
| **去重後獨立主題（原子拆分）** | **45** | **22** | — | **20** | **3** | 合併跨角色重複並將複合條目拆分為單一原子處置（未做合計 `20 + 3 = 23` 項） |

### 1. 去重後獨立主題歸併表（共 45 項：`已修` 22、`建議未做` 20、`不做` 3）

| 主題編號 | 歸併來源編號 | 修復編號 | 主題摘要 | 結論 | Commit / 未做原因 |
| --- | --- | --- | --- | --- | --- |
| `T-01` | `UX-01`、`UX-05`（按鈕）、`SEC-03`、`VIS-04` | `FIX-01` | 拆離共用 `:is()` 內 ID 選擇器消除 `(1,2,2)` 特異性膨脹，修復 `.version-switch` 直排破版與側欄「展開全部」現形 | **已修** | `29c4815`（`look-v2.css:50-52, 84-90, 766`） |
| `T-02` | `UX-02` | `FIX-02` | 靠右 `ⓘ` 說明框點開 `toggle` 僅於 `delta!==0` 寫入位移，避免 `left:0px` 蓋掉 `right:0` 導致向右裁切 | **已修** | `a51ed6e`（`ui-actions.js:16-20`、`test/info-tip.test.mjs`） |
| `T-03` | `FUNC-01` | `FIX-03` | 補齊 `derivedPrinting.id`、`getCard` 查找 `physicalCardIds`/`printings`，及前端 `cardOpenId` 退回 `p.cardId` 消除直開實體卡 404 | **已修** | `ff9a133`（`server.mjs`）、`a51ed6e`（`ui-enhancements.js`）、`29c4815`（`test/swarm-audit-fixes.test.mjs`） |
| `T-04` | `UX-03` | `FIX-04` | 手機 `375px` 搜尋結果頁（`body[data-side="results"]`）顯示 `.side-sheet-btn` 與查詢上下文標籤，提供遊戲／版本篩選入口 | **已修** | `a51ed6e`（`side-nav.js:121-126`）、`29c4815`（`look-v2.css:297`） |
| `T-05` | `SEC-01`、`TEST-01`（前半） | — | `authToken()` 區分 400/401 與 502/503/斷線，暫時性斷線不再偽造 401 清空登入態並補測試 | **已修** | `ff9a133`（`test/collection-sync-ui.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1296-1315, 1465`） |
| `T-06` | `SEC-02`、`SEC-05`、`TEST-01`（後半）、`TEST-02`（部分） | — | `enableGoogleSync` 先拉 Google 雲端（既知卡採時間戳 0 防覆寫／防復活墓碑），`hadCode` 拉取失敗中止切換，儲存失敗完整回滾 | **已修** | `ff9a133`（`test/collection-sync-ui.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1351-1399`） |
| `T-07` | `SEC-04`、`TEST-02`（部分） | — | 攔截 `?error=` 清理網址參數與 `PKCE_KEY`，保留未呈現之 `syncUi.notice` 至對話框開啟後關閉才清除 | **已修** | `ff9a133`（`test/collection-sync-ui.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1405-1416, 1635-1643, 1675`） |
| `T-08` | `SEC-07`、`TEST-02`（部分） | — | `deleteCloud()` 改於 `syncPost('delete')` 成功後再讀最新 `authState?.accessToken` 呼叫 `/api/auth/logout` | **已修** | `ff9a133`（`test/collection-sync-ui.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1603-1607`） |
| `T-09` | `UX-06`、`FUNC-03` | — | `startSync('')` 先確認首次 `push` 成功（HTTP 200）才落盤 `syncState` 與顯示同步碼，消除 503 假成功 | **已修** | `ff9a133`（`test/collection-sync-ui.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1577-1589`） |
| `T-10` | `SEC-08`、`TEST-04`（部分） | — | `matchSeriesIndex` 先依 `region` 篩選再截斷 `MAX_SERIES_IDS`（50），避免跨區大量系列漏掉目標區 | **已修** | `ff9a133`（`providers/search-query.mjs:283-287`、`test/search-compound.test.mjs`） |
| `T-11` | `SEC-10`、`TEST-03`（部分） | — | `normalizeSyncEntry` 將 `{favorite:true, quantity:0}` 正規化為 `{quantity:1, favorite:false}`、`{favorite:false, quantity:0}` 嚴格回 `null` | **已修** | `ff9a133`（`collection-store.js:232-235`、`test/collection-store.test.mjs`、`test/collection-sync-ui.test.mjs`） |
| `T-12` | `FUNC-02`、`PROD-01` | `FIX-10` | 初次載入帶 `#hash`（無既定 `scrollY`）時捲至錨點並對焦；`restoring===true` 期間點擊 `a[data-spa]` 排隊於 `finally` 接續導覽 | **已修** | `a51ed6e`（`navigation-state.js`）、`29c4815`（`test/swarm-audit-fixes.test.mjs`） |
| `T-13` | `PROD-03`（重試隱藏）、`UX-11`（部分） | `FIX-12` | `FAILED['retry-type']` 首次失敗排程重試前以 `visibility='hidden'` 隱藏破圖並於 capture `load` 還原 | **已修** | `a51ed6e`（`ui-actions.js:34-40`）、`29c4815`（`test/swarm-audit-fixes.test.mjs`） |
| `T-14` | `FUNC-04` | — | 桌機搜尋清除 `#qClear` 於頂欄 `#q` 隱藏時改將焦點歸位 `#heroQ`，防止焦點掉回 `BODY` | **已修** | `a51ed6e`（`index.html:308`） |
| `T-15` | `VIS-01`、`VIS-02`、`VIS-03` | `FIX-14` | 首頁深底頂欄 `a.brand` 補 `#F6F1E6` 2px 實線焦點框、`.fx-pre` 鍵盤聚焦顯現、詳情價格區 `.ptl-seg-btn`/`a.pov-jump`/`a.ebay-title` 補齊 `>=44px` | **已修** | `29c4815`（`look-v2.css:339-340, 480, 501, 790`、`look-effects.css:45`） |
| `T-16` | `VIS-05`、`VIS-06`、`VIS-07`、`VIS-10`、`VIS-11` | `FIX-15` | `data-cs-paused` 停止 `l5-edge` 與動畫；系列篩選 placeholder 對比與各遊戲範例；`#syncJoinCode` 1.5px `#857D6E` 邊框；手機首頁底色與頁尾 `--v2-ink-2`；`#channels` 移除 `loading="lazy"` | **已修** | `a51ed6e`（`index.html:81`、`series-band.js:255`）、`29c4815`（`look-v2.css:141, 144, 253, 666, 911, 1048, 1070`、`look-showcase.css:294`） |
| `T-17` | `VIS-09`、`UX-10`（表頭與斷字） | `FIX-16` | 平台總覽 `.pov-th-sub` 改 `display:block;white-space:nowrap` 免斷開「新台幣」，`td:first-child` 改 `word-break:keep-all;overflow-wrap:break-word` | **已修** | `29c4815`（`look-v2.css:495, 1045`） |
| `T-18` | `VIS-08`（1024px `-4px` 偏移） | `FIX-18` | `1000–1199px` 頂欄 `.brand` `min-width` 改扣 `--s3`，消除搜尋框偏左 `4px` 誤差 | **已修** | `29c4815`（`look-v2.css:1003-1005`） |
| `T-19` | `VIS-12`、`UX-07`、`UX-17`、`UX-10`（摺疊提示） | `FIX-19` | 無卡號卡版本列省略雙中點；開詳細側板時收藏 Toast 移至右上角免遮 `.coll-edit`；`.ptl-details`／`.coll-import` `<summary>` 補 44px 與 `展開 ▾`／`收合 ▴` | **已修** | `a51ed6e`（`ui-enhancements.js:812`）、`29c4815`（`look-v2.css:1049-1059`） |
| `T-20` | `UX-09` | `FIX-20` | `<=760px` 收藏頁 `#cardTools` 垂直堆疊並將 `.coll-manage` 置於 `#cardControls` 上方靠右，消除擠壓裁切 | **已修** | `29c4815`（`look-v2.css:1072-1074`） |
| `T-21` | `SEC-13`（入口與同步防護） | — | `collect`/`normalizeSyncEntry` 阻擋危險 `canonicalId`、`migrateFavorites` 擋 `UNSAFE_ID`、`applyItems` 過濾 `__proto__`/`constructor`/`prototype` | **已修** | `ff9a133`（`collection-store.js:60, 127, 228`、`test/collection-store.test.mjs`）、`a51ed6e`（`ui-enhancements.js:1128`） |
| `T-22` | `UX-18`（核心警示文案） | — | 同步對話框明確標註「超過 180 天未同步或更新」與「同步碼就是密碼，遺失無法重設或找回」 | **已修** | `a51ed6e`（`ui-enhancements.js:1618`） |
| `T-23` | `UX-04` | — | 遊戲頁頂欄發動跨全站搜尋時，左側 `#sideNav` 仍停留原遊戲的上下文切換或限縮機制 | **建議未做** | 涉及全域搜尋與單遊戲瀏覽之導覽設計規則，留待產品拍板 |
| `T-24` | `UX-05`（抽屜收合） | — | 手機 `#sideNav` 切換遊戲後或遇 503 時之自動收合與錯誤引導 | **建議未做** | `side-nav.js:166-169` 刻意保留抽屜讓使用者挑系列，503／重選收合需體驗確認 |
| `T-25` | `UX-08` | — | 收藏牆單張卡片補 `rowPriceHtml`（單卡價或未計入原因）與總值旁標示「僅計入 N/M 款」 | **建議未做** | 會改變收藏卡牆固定三行結構與查價版面密度，留待使用者決定 |
| `T-26` | `UX-10`（版本對照搬出／SGC 10／YGOPRODeck） | — | 將「各版本價格對照」移出 `<details>`、375px `SGC 10` 列截斷調適、遊戲王頂部整合 YGOPRODeck 參考價 | **建議未做** | 涉及詳情資訊架構重整與平台價格顯示原則，需對齊 `PRODUCT_PLAN.md` 拍板 |
| `T-27` | `PROD-04`、`UX-11`（404 圖源與窄卡折行） | — | 資料庫清理 `pokemontcg.io/mcd14..18` 4 筆 404 網址；圖片重試期間卡名占位骨架與本機小卡「圖片待補」不折孤字 | **建議未做** | 404 圖源屬上游資料庫／同步清理工作；窄卡文字調整需兼顧字級 `>=12px` 規範 |
| `T-28` | `UX-12` | — | 首頁導覽第 1 步聚光燈涵蓋 `.home-examples` 及深底小兔頭像提亮 | **建議未做** | 導覽泡泡定位與頭像素材調整需對齊視覺與 `docs/BRAND_RABBIT.md` |
| `T-29` | `UX-13` | — | 跨遊戲搜尋結果中的寶可夢卡片呈現 `referencePrice`／價格排序，及手機卡牆保留價格說明 `ⓘ` | **建議未做** | 涉及 `/api/search` 資料擴充與手機卡牆工具列取捨，留待規劃 |
| `T-30` | `UX-14` | — | 直接載入 `?view=collection` 等待 `/api/catalog` 期間預先隱藏 `#loadMore` 與設標題為「我的收藏」 | **建議未做** | 需改動 `index.html` 內嵌啟動腳本並重新核對 SHA-256 CSP 與冷啟時序 |
| `T-31` | `UX-15` | — | 工具列 `#watchlistSummary` 補直連「前往我的收藏」按鈕，及 `?view=market` 明確標示僅統計寶可夢漲跌 | **建議未做** | 屬導覽捷徑與文案優化，無功能阻塞，留待下一階段調整 |
| `T-32` | `UX-16` | — | 單張無備註收藏按「−」歸零刪除時顯示含「復原」鈕之短暫 Toast | **建議未做** | 需設計收藏移除復原狀態與局部重繪邏輯 |
| `T-33` | `UX-18`（隱私連結與對等分流） | — | 同步對話框補連往 `?view=privacy` 與將「開啟新同步碼／加入既有同步碼」改為對等兩選一 | **建議未做** | 核心警語已於 `T-22` 補強；佈局重設與連結動線留待產品決定 |
| `T-34` | `UX-19` | — | 即時建議副標補地區標籤、`OP-05` 系列捷徑、搜尋後標題程式焦點改 `:focus-visible`、375px `.card-game` 地區縮寫 | **建議未做** | 屬搜尋細節與無障礙焦點策略選擇，無嚴重缺陷 |
| `T-35` | `SEC-06`、`TEST-02`（雙分頁並發） | — | 多分頁並發 refresh 單次輪替 `refresh_token` 互毀防護（`navigator.locks` + `storage` 事件同步）與雙沙盒並發測試 | **建議未做** | 涉及跨分頁狀態協調鎖與錯誤復原架構，列為「需要使用者決定」 |
| `T-36` | `SEC-09`、`TEST-04`（降級整合與實庫 SQL） | — | `PGRST202` 降級路徑大系列完整分頁與預取 `canonical_id` 兄弟卡，以及實連 Postgres 執行 `search_cards_ranked` 測試 | **建議未做** | 降級為套用 `20261121000000` SQL migration 前臨時路徑；正本應套用 migration 以免拖垮 DB |
| `T-37` | `SEC-11` | — | `supabaseAuth` / 同步請求補 `AbortSignal.timeout(12000)` 與 POST `/api/auth/*`・`/api/sync/*` 強制檢查 `Content-Type: application/json` | **建議未做** | 牽涉後端請求契約與既有限流／測試標頭相容性，列為「需要使用者決定」 |
| `T-38` | `SEC-12` | — | 調整 `look-v2.css:947` 與 `look-showcase.css:243, 274` 在 `1200px` 首頁雙欄 `.hero` 搜尋框上限衝突 | **建議未做** | 影響 1200px 首頁視覺比例，需實拍對照後調整 |
| `T-39` | `SEC-13`（底層無原型結構） | — | 將 `UNSAFE_ID` 下沉至 `problem()`/`idOf()` 並將 `watchlist`／`watchlistMeta` 容器改為 `Object.create(null)` | **建議未做** | `T-21` 已攔截寫入與同步入口，全域無原型重構留待前端清理排程 |
| `T-40` | `SEC-14`、`TEST-04`（詞界測試） | — | CSV `\t`/`\r` 防呆及 `'+1` 還原、`S8a-G 001` 雙連字號卡號判斷、`M6aPikachu`/`OP05Luffy` 全英文邊界拆詞 | **建議未做** | 修改 CSV 反轉義影響舊備份相容性；放寬英數邊界須防大量詞條誤拆 |
| `T-41` | `TEST-03`（其餘項）、`TEST-05` | — | 補齊 `collection-sync.test.mjs`（真實 `429`、`authCache` 到期/驅逐/logout、`authPublicUrl`、`+23h`）與 `server-hardening.test.mjs`（全 CSP 指令與偽造小 `Content-Length` 串流拒絕） | **建議未做** | 屬既有安全機制之額外測試補充，未發現對應實質漏洞 |
| `T-42` | `VIS-08`（`about`/`privacy` 頁寬） | — | `1440px` `about`/`privacy` `.wrap`（`1280px`）與首頁／圖鑑（`1440px` `--shell-max`）統一否 | **建議未做** | 屬閱讀欄寬與跨頁齊頭設計取捨，列為「需要使用者決定」 |
| `T-43` | `FUNC-05` | — | `?game=...&region=all` 被 `ensureRegion()` 強制收斂至可用單一版本（如 `JP`） | **不做** | 依 `PRODUCT_PLAN.md` 單一遊戲瀏覽採單版本視角，刻意維持版本收斂防跨區混計 |
| `T-44` | `PROD-02`、`PROD-03`（ORB 政策） | — | 航海王／遊戲王官網商品圖 `NotSameSite` 阻擋與 Weiß Schwarz `ws-tcg.com` ORB 阻擋 | **不做** | 涉及外部第三方資源授權、代理範圍與 CSP 政策，本輪依規定不擅自擴充圖片代理 |
| `T-45` | `VIS-13` | — | 1440px UA 卡牆長代號截尾、停用鈕透明度提升與 375px `.mobile-scope-sep` 分隔線對比 | **不做** | WCAG 1.4.3 對停用控制項與裝飾線豁免；提高透明度恐混淆可點狀態，保留給使用者視覺拍板 |

### 2. 60 條原始編號逐項處置總表

#### A. `ux-auditor`（#5：`UX-01`–`UX-19`，共 19 條）

| 原始編號 | 類別 | 頁面 / 檔案 | 歸併主題 / 修復編號 | 處置狀態與結論（Commit Hash / 原因） |
| --- | --- | --- | --- | --- |
| `UX-01` | 版面破版 / 版本切換 | 卡片詳細頁 / `look-v2.css:50-53, 761-762` | `T-01` / `FIX-01` | **已修**（`29c4815`）：拆出 ID 選擇器並於 `.version-switch` 設 `display:block;width:100%` |
| `UX-02` | 說明框裁切 / 交互 | 卡片詳細頁 `ⓘ` / `ui-actions.js:14-18`、`look-v2.css:1010` | `T-02` / `FIX-02` | **已修**（`a51ed6e`）：僅於 `delta!==0` 改寫 `left`/`right`，不寫 `left:0px` 蓋過 `right:0` |
| `UX-03` | 手機搜尋導覽斷鏈 | 全域搜尋結果 / `look-v2.css:187, 293`、`side-nav.js:11` | `T-04` / `FIX-04` | **已修**（`a51ed6e`、`29c4815`）：375px `body[data-side="results"]` 顯示 `.side-sheet-btn` 並動態更新標題 |
| `UX-04` | 搜尋範圍與側欄不一致 | 遊戲頁頂欄搜尋 / `index.html:233, 239` | `T-23` | **建議未做**：涉及遊戲內搜尋 vs 全站搜尋切換行為，留待產品設計決定 |
| `UX-05` | 手機抽屜交互與異常按鈕 | 手機遊戲切換 / `look-v2.css:50, 248`、`side-nav.js:166-169` | `T-01` (`FIX-01`) + `T-24` | **部分已修**：側欄幽靈「展開全部」鈕已於 `29c4815` 隱藏；`side-nav.js:166-169` 切換遊戲不收抽屜設計留待決定（**建議未做**） |
| `UX-06` | 雲端同步假成功風險 | 雲端同步對話框 / `ui-enhancements.js:1533-1552` | `T-09` | **已修**（`a51ed6e`、`ff9a133` 測試）：`startSync('')` 先推 200 成功才落盤 `syncState` 並顯示同步碼 |
| `UX-07` | 操作回饋遮擋編輯區 | 詳情收藏編輯 / `ui-enhancements.js:401-406`、`look-v2.css` | `T-19` / `FIX-19` | **已修**（`29c4815`）：`body:has(#modal.open)` 時將 `.brand-collection-toast` 移至右上角 |
| `UX-08` | 總值說明與卡牆不一致 | 我的收藏頁 / `ui-enhancements.js:1053, 1064, 275-284` | `T-25` | **建議未做**：涉及收藏牆卡片行數擴充與批量價格顯示設計，留待產品拍板 |
| `UX-09` | 手機工具列裁切藏控制項 | 我的收藏頁 / `look-v2.css:432, 592` | `T-20` / `FIX-20` | **已修**（`29c4815`）：375px 下 `.coll-manage` 移至 `#cardControls` 上方靠右獨立成排 |
| `UX-10` | 價格明細可讀性與位置 | 卡片詳細頁價格區 / `look-v2.css:495, 1045, 1056`、`price-timeline.js:291, 349` | `T-17` (`FIX-16`) + `T-19` (`FIX-19`) + `T-26` | **部分已修**：`29c4815` 已修「新台幣」斷行、表格文字斷詞與摺疊按鈕提示；移出 `<details>`、SGC10 與 YGOPRODeck 整合留待決定（**建議未做**） |
| `UX-11` | 空白卡圖與破圖體驗 | 卡牆與搜尋結果 / `ui-actions.js:31`、`ui-enhancements.js:184-201` | `T-13` (`FIX-12`) + `T-27` | **部分已修**：`a51ed6e` 已於 `retry-type` 重試期間隱藏破圖；404 圖源清理與窄卡「圖片待補」斷字留待資料與版面決定（**建議未做**） |
| `UX-12` | 導覽氣泡遮擋與圖示隱形 | 首頁導覽 / `look-showcase.js:169, 188` | `T-28` | **建議未做**：需配合首頁聚光燈目標與品牌頭像視效整體確認 |
| `UX-13` | 搜尋結果無價格與手機提示難讀 | 卡牆參考價 / `index.html:124-130`、`look-v2.css:117` | `T-29` | **建議未做**：涉及跨遊戲搜尋價格欄位擴充與手機卡牆介面密度取捨 |
| `UX-14` | 收藏頁冷啟閃現錯誤標題 | 直接開啟 `?view=collection` / `index.html:6, 10, 299` | `T-30` | **建議未做**：需調整 `index.html` 內嵌啟動邏輯並重測 CSP 雜湊與冷啟流程 |
| `UX-15` | 收藏入口與行情頁面落差 | 導覽與摘要列 / `ui-enhancements.js:483-489`、`price-movers.js` | `T-31` | **建議未做**：屬入口按鈕與行情頁遊戲範圍文案優化，非功能阻塞 |
| `UX-16` | 減至 0 張靜默刪除缺復原 | 加減收藏數量 / `ui-enhancements.js:389-399` | `T-32` | **建議未做**：涉及單張無備註刪除交互與復原機制設計 |
| `UX-17` | 摺疊元件缺視覺展開暗示 | 匯入預覽與明細 / `look-v2.css:1056-1059` | `T-19` / `FIX-19` | **已修**（`29c4815`）：補上 `min-height:var(--btn-h)`、`展開 ▾`／`收合 ▴` 與焦點外框 |
| `UX-18` | 同步文案易引發誤操作與焦慮 | 雲端同步對話框 / `ui-enhancements.js:1618` | `T-22` + `T-33` | **部分已修**：`a51ed6e` 已補強「超過 180 天未同步或更新」與「遺失無法重設或找回」文案；隱私連結與雙選項重排留待決定（**建議未做**） |
| `UX-19` | 搜尋細節（建議／系列詞／焦點框／標籤） | 搜尋與卡牆 / `index.html:250-256`、`ui-enhancements.js:1756` | `T-34` | **建議未做**：分別屬 suggest 地區副標、系列代碼捷徑、焦點樣式與手機膠囊字數設計決策 |

#### B. `code-sec-auditor`（#7：`SEC-01`–`SEC-14` 與 `TEST-01`–`TEST-05`，共 19 條）

| 原始編號 | 類別 | 檔案:行號 | 歸併主題 / 修復編號 | 處置狀態與結論（Commit Hash / 原因） |
| --- | --- | --- | --- | --- |
| `SEC-01` | Token 換新誤登出 / 資料流失 | `ui-enhancements.js:1295-1312, 1465` | `T-05` | **已修**（`a51ed6e`、`ff9a133` 測試）：以 `authToken.lastStatus` 區分 400/401 與 5xx/斷線 |
| `SEC-02` | Google 同步覆寫雲端資料 | `ui-enhancements.js:1351-1399` | `T-06` | **已修**（`a51ed6e`、`ff9a133` 測試）：切換前先拉 Google 雲端，既知項與墓碑設時間戳 `0` |
| `SEC-03` | CSS 特異性回歸（`fb7f0d5`） | `look-v2.css:50-53, 248, 761` | `T-01` / `FIX-01` | **已修**（`29c4815`）：拆離共用 `:is()` 內 ID 並補 `.version-switch{display:block;width:100%}` |
| `SEC-04` | Google 登入失敗靜默與狀態遺失 | `ui-enhancements.js:1405-1416, 1635, 1675` | `T-07` | **已修**（`a51ed6e`、`ff9a133` 測試）：偵測 `?error=`、清 `PKCE_KEY`、保留 `syncUi.notice` 至對話框關閉 |
| `SEC-05` | 升級 Google 吞掉拉取失敗與半套狀態 | `ui-enhancements.js:1354-1399` | `T-06` | **已修**（`a51ed6e`、`ff9a133` 測試）：`hadCode` 非 200 中止切換，儲存／合併失敗完整回滾 |
| `SEC-06` | 多分頁並發與 Refresh Token 互毀 | `ui-enhancements.js:1278-1312, 1492-1529` | `T-35` | **建議未做**：需導入 `navigator.locks` 與 `storage` 事件協調跨分頁輪替與狀態，列入使用者決定 |
| `SEC-07` | `deleteCloud` 送出過期舊 Token 登出 | `ui-enhancements.js:1603-1607` | `T-08` | **已修**（`a51ed6e`、`ff9a133` 測試）：改於 `syncPost('delete')` 成功後才取最新 `authState?.accessToken` |
| `SEC-08` | `matchSeriesIndex` 先截斷再篩地區 | `providers/search-query.mjs:283-287` | `T-10` | **已修**（`ff9a133`）：先依 `reg` 篩選後再 `.slice(0, MAX_SERIES_IDS)` |
| `SEC-09` | 複合搜尋 PostgREST 降級截斷與漏兄弟卡 | `server.mjs:1207-1220` | `T-36` | **建議未做**：屬未套用 `20261121000000` SQL migration 前臨時降級路徑，正式解法應套用該 migration |
| `SEC-10` | 收藏「0 張收藏星號」規格矛盾 | `collection-store.js:232-235` | `T-11` | **已修**（`ff9a133`）：`normalizeSyncEntry` 以 `collectedQuantity(item)` 轉正為 `quantity:1, favorite:false`，`quantity===0 && !favorite` 回 `null` |
| `SEC-11` | 上游 Auth/Sync 缺逾時與 `Content-Type` 檢查 | `server.mjs:844-847, 879, 909` | `T-37` | **建議未做**：需於 `supabaseAuth`／`supabaseFetch` 增設 `AbortSignal.timeout` 並確認測試標頭相容性 |
| `SEC-12` | Hero 桌機寬度覆寫回歸 | `look-v2.css:947`、`look-showcase.css:243, 274` | `T-38` | **建議未做**：調整 `1200px` 首頁 `.hero` 寬度需重新目視核對雙欄比例 |
| `SEC-13` | 舊版/本機匯入與 `watchlistMeta` 缺 `UNSAFE_ID` 防護 | `collection-store.js:60, 127, 228`、`ui-enhancements.js:1128` | `T-21` + `T-39` | **部分已修**：`ff9a133`／`a51ed6e` 已封堵 `collect`/`migrateFavorites`/`normalizeSyncEntry`/`applyItems` 之原型污染鍵；容器改 `Object.create(null)` 留待重構（**建議未做**） |
| `SEC-14` | CSV 公式轉義邊界與複合拆詞盲區 | `ui-enhancements.js:491`、`collection-store.js:96`、`providers/search-query.mjs:153, 343` | `T-40` | **建議未做**：避免影響舊備份 CSV 相容性與英文連字號/駝峰拆詞誤傷，留待專題評估 |
| `TEST-01` | Google Refresh 失敗誤登出與覆寫未測 | `test/collection-sync-ui.test.mjs` | `T-05` + `T-06` | **已修**（`ff9a133`）：補齊 502/斷線不登出與無同步碼直連 Google 不覆寫測試 |
| `TEST-02` | OAuth 失敗恢復、`deleteCloud` 輪替、多分頁競態空白 | `test/collection-sync-ui.test.mjs` | `T-06` + `T-07` + `T-08` + `T-35` | **部分已修**：`ff9a133` 已補 `?error=`、notice 保留、`hadCode` 失敗中止與 `deleteCloud` 401 refresh 後撤銷；雙分頁測試隨 `SEC-06` 留待實作後補（**建議未做**） |
| `TEST-03` | Auth 限流、快取過期/驅逐、0 張星號與 `+23h` 未測 | `test/collection-sync.test.mjs` | `T-11` + `T-41` | **部分已修**：0 張星號相容規則已於 `collection-store.test.mjs` 與 `collection-sync-ui.test.mjs`（`ff9a133`）驗證；其餘 `collection-sync.test.mjs` 補充測試留待排程（**建議未做**） |
| `TEST-04` | `>50` 系列截斷、降級路徑上限與真實 SQL 行為未測 | `test/search-compound.test.mjs` | `T-10` + `T-36` + `T-40` | **部分已修**：`ff9a133` 已補 `matchSeriesIndex >50` 筆跨區截斷測試；降級/詞界/實庫 SQL 測試留待實作與測試環境（**建議未做**） |
| `TEST-05` | CSP 全指令與偽造小 `Content-Length` 串流拒絕缺口 | `test/server-hardening.test.mjs` | `T-41` | **建議未做**：屬安全測試補強清單，本輪優先完成高風險功能／視覺回歸測試 |

#### C. `func-qa`（#8：`FUNC-01`–`FUNC-05` 與 `PROD-01`–`PROD-04`，共 9 條）

| 原始編號 | 類別 | 頁面 / 檔案:行號 | 歸併主題 / 修復編號 | 處置狀態與結論（Commit Hash / 原因） |
| --- | --- | --- | --- | --- |
| `FUNC-01` | 404 誤判／實體卡 ID 錯位 | `server.mjs:1048, 1294`、`ui-enhancements.js:250` | `T-03` / `FIX-03` | **已修**（`ff9a133`、`a51ed6e`、`29c4815` 含回歸測試）：補 `derivedPrinting.id`、`getCard` 查找實體卡與 `cardOpenId` fallback |
| `FUNC-02` | 錨點捲動失敗 | `navigation-state.js:164-174` | `T-12` / `FIX-10` | **已修**（`a51ed6e`、`29c4815` 含回歸測試）：初載帶 `#hash` 且無既定 `scrollY` 時捲動並對焦錨點 |
| `FUNC-03` | 雲端同步狀態錯置 | `ui-enhancements.js:1577-1589` | `T-09` | **已修**（`a51ed6e`、`ff9a133` 測試）：503 失敗不寫入 `cardscope-sync` 也不切換為已開啟畫面 |
| `FUNC-04` | 焦點遺失 | `index.html:308` | `T-14` | **已修**（`a51ed6e`）：桌機點 `#qClear` 後若 `#q` 不可見改將焦點移至 `#heroQ` |
| `FUNC-05` | 網址參數與預設地區衝突 | `series-band.js:29-33`、`navigation-state.js:146-155` | `T-43` | **不做**：依 `PRODUCT_PLAN.md` 單一遊戲瀏覽採單版本視角，刻意收斂為可用版本避免跨區混計 |
| `PROD-01` | 無反應連結（SPA 競態） | 全站 `a[data-spa]` / `navigation-state.js:138-140, 206-211` | `T-12` / `FIX-10` | **已修**（`a51ed6e`、`29c4815` 含回歸測試）：`restoring===true` 期間點擊排隊，於 `finally` 完成後接續導覽 |
| `PROD-02` | 大量請求失敗／`console.error` | `onepiece`／`yugioh` 外部商品圖 / `server.mjs:96-102` | `T-44` | **不做**：涉及第三方網站商品圖代理授權與 CSP 政策，未經確認不擅自擴充圖片代理 |
| `PROD-03` | ORB 阻擋與重試期間短暫破圖 | Weiß Schwarz 卡牆 / `ui-actions.js:34-40` | `T-13` (`FIX-12`) + `T-44` | **部分已修**：`a51ed6e`／`29c4815` 已於 `retry-type` 重試前隱藏破圖並於載入還原；`ws-tcg.com` ORB 阻擋屬外部圖源政策（**不做**） |
| `PROD-04` | 上游圖片 HTTP 404 | 寶可夢搜尋「皮卡丘」 / `pokemontcg.io/mcd*` | `T-27` | **建議未做**：屬上游資料庫圖源 URL 清理（前端已有「圖片待補」fallback） |

#### D. `visual-auditor`（#10：`VIS-01`–`VIS-13`，共 13 條）

| 原始編號 | 類別 | 頁面 / 檔案:行號 | 歸併主題 / 修復編號 | 處置狀態與結論（Commit Hash / 原因） |
| --- | --- | --- | --- | --- |
| `VIS-01` | 焦點對比度 | 桌面首頁頂欄 `a.brand` / `look-v2.css:339-340` | `T-15` / `FIX-14` | **已修**（`29c4815`）：首頁頂欄 `a.brand:focus-visible` 設 `#F6F1E6` `2px solid` 外框 |
| `VIS-02` | 鍵盤焦點隱形 | 首頁 `.trend-card.fx-pre` / `look-effects.css:45` | `T-15` / `FIX-14` | **已修**（`29c4815`）：聚焦 `.fx-pre:is(:focus-visible,:focus-within)` 立即設 `opacity:1;translate:none` |
| `VIS-03` | 觸控目標 `< 44px` | 詳情價格區 / `look-v2.css:480, 501, 790` | `T-15` / `FIX-14` | **已修**（`29c4815`）：`.ptl-seg-btn`、`.ebay-title` 設 `min-height:var(--btn-h)`，`.pov-jump` 補 `min-width:var(--btn-h)` |
| `VIS-04` | CSS 特異性回歸 | 遊戲側欄與詳情版本 / `look-v2.css:50-52, 766` | `T-01` / `FIX-01` | **已修**（`29c4815`）：ID 自 `:is()` 拆離並補 `.version-switch{display:block;width:100%}` |
| `VIS-05` | UI 邊界對比 `< 3:1` | 雲端同步對話框 / `look-v2.css:666` | `T-16` / `FIX-15` | **已修**（`29c4815`）：`.sync-input` 改 `1.5px solid #857D6E` 與 `var(--v2-page)` 底色 |
| `VIS-06` | 文字對比 `< 4.5:1` 與硬編碼文案 | 側欄系列篩選 / `look-v2.css:253`、`series-band.js:255` | `T-16` / `FIX-15` | **已修**（`29c4815`、`a51ed6e`）：設 `::placeholder{color:var(--v2-ink-2);opacity:1}` 並依遊戲給範例詞 |
| `VIS-07` | 文字對比 `< 4.5:1` | 手機首頁頁尾與吉祥物圖庫 / `look-v2.css:911, 1048, 1070` | `T-16` / `FIX-15` | **已修**（`29c4815`）：手機 `landing` 改 `background:var(--v2-page)`，頁尾／圖庫／導覽小字統一 `var(--v2-ink-2)` |
| `VIS-08` | 對齊線與跨頁跳位 | `1024` 搜尋框＋`1440` 關於／隱私 / `look-v2.css:1003-1005`、`look-clean.css:22` | `T-18` (`FIX-18`) + `T-42` | **部分已修**：`29c4815` 已於 `1000–1199px` 調整 `.brand` `min-width` 消除 1024px `-4px` 偏移；`about`/`privacy` `1280px` 頁寬是否統一為 `1440px` 留待決定（**建議未做**） |
| `VIS-09` | 中文斷字與表頭排版 | 詳情各平台價格表 / `look-v2.css:495, 1045` | `T-17` / `FIX-16` | **已修**（`29c4815`）：`.pov-th-sub` 改 `display:block;white-space:nowrap`；`td:first-child` 改 `word-break:keep-all;overflow-wrap:break-word` |
| `VIS-10` | 首屏圖片延遲載入空白 | 首頁 `#channels` Logo / `index.html:81` | `T-16` / `FIX-15` | **已修**（`a51ed6e`）：移除 `#channels` 7 張小型遊戲導覽 Logo 之 `loading="lazy"` |
| `VIS-11` | 暫停動態遺漏動畫 | 頁尾「暫停動態」開關 / `look-v2.css:141, 144`、`look-showcase.css:294` | `T-16` / `FIX-15` | **已修**（`29c4815`）：補 `animation-duration:.01ms!important` 並將 `l5-edge` 加上 `:not([data-cs-paused])` |
| `VIS-12` | 動態多餘分隔符 | 詳情版本列 / `ui-enhancements.js:812` | `T-19` / `FIX-19` | **已修**（`a51ed6e`）：僅於 `p.localCardNumber` 非空時輸出分隔中點與卡號 |
| `VIS-13` | 長代號截斷與次要對比 | UA 卡牆／停用鈕／手機分隔線 / `look-v2.css:66, 375, 452` | `T-45` | **不做**：WCAG 1.4.3 對 disabled 與裝飾線豁免；調高停用透明度恐干擾可點擊狀態，保留給使用者拍板 |

---

## 五、Before / After 截圖對照與 Playwright 程式化驗收

### 1. 截圖檔案清單與對照總表（`docs/research/swarm-audit-20261122/`，全數 `< 400 KB`）

| 畫面與視口 | Before 檔名與大小 | After 檔名與大小 | 實際目視對照重點與誠實備註 |
| --- | --- | --- | --- |
| 首頁（`1440×900`） | `home-before-1440.jpg`（`101.9 KB`） | `home-after-1440.jpg`（`101.2 KB`） | Before 左上角 `a.brand` 僅見微弱暗邊框；After 明確呈現 `#F6F1E6` 2px 實線焦點框（導覽泡泡淡出為點擊後過渡殘影） |
| 首頁（`375×812`） | `home-before-375.jpg`（`29.7 KB`） | `home-after-375.jpg`（`30.7 KB`） | Before 手機 `landing` 沿用 `--lc-page` 偏灰米底色與 `#666` 小字；After 切換 `--v2-page` 並讓頁尾「認識 CardSeek 吉祥物」、「官方網站與圖片說明」、「聲明 ⌄」使用 `--v2-ink-2` 清晰呈現、0 橫向溢位 |
| 搜尋側欄（`1440×900`） | `sidebar-search-before-1440.jpg`（`73.6 KB`） | `sidebar-search-after-1440.jpg`（`72.5 KB`） | Before 左側欄誤出現大顆無用「展開全部」鈕且篩選 placeholder 較淡；After 「展開全部」成功隱藏、placeholder 清晰且側欄與卡牆對齊 |
| 手機搜尋結果（`375×812`） | `search-results-before-375.jpg`（`30.2 KB`） | `search-results-after-375.jpg`（`31.1 KB`） | Before 結果頁完全無篩選遊戲／版本入口；After `#cardsTitle` 上方正確顯示 `.side-sheet-btn`「篩選結果『皮卡丘』・全部遊戲」（捲動略高於自動定位處即可見） |
| 詳情側板（`1440×900`） | `detail-before-1440.jpg`（`116.4 KB`） | `detail-after-1440.jpg`（`121.3 KB`） | Before 多版本按鈕文字擠成直排、且點擊「收錄版本」右上 `ⓘ` 彈窗向右飛出視口裁斷；After `.version-switch` 恢復橫向寬版塊狀排版、`ⓘ` 氣泡向內完整展開不裁切 |
| 詳情價格區（`1440×900`） | **缺席（權限拒絕未補拍）** | `detail-price-after-1440.jpg`（`125.6 KB`） | **限制註記**：`detail-price-before-1440.jpg` 因 Part 1 執行 `audit-shots.mjs before 4185` 遭權限拒絕而未產出；After 確認 `.pov` 平台總覽表「新台幣」與 `(原幣・更新日)` 不拆行、連結靠右、價格走勢清晰 |
| 手機詳情頁（`375×812`） | `detail-before-375.jpg`（`29.1 KB`） | `detail-after-375.jpg`（`24.9 KB`） | Before 同樣有版本直排擠字與 `ⓘ` 彈窗右出視窗外破版；After 手機全螢幕詳情無破圖重疊、0 橫向溢位 |
| 雲端同步（`1440×900`） | `collection-sync-before-1440.jpg`（`49.2 KB`） | `collection-sync-after-1440.jpg`（`56.1 KB`） | Before `#syncJoinCode` 僅有微弱 `1px #E7E1D4` 框線；After 具備明確 `1.5px solid #857D6E` 邊框與 `#F8F5EE` 底色，且補齊「未同步或更新」及「遺失無法重設或找回」警語 |
| 手機收藏頁（`375×812`） | `collection-before-375.jpg`（`29.1 KB`） | `collection-after-375.jpg`（`28.1 KB`） | **限制註記**：`collection-before-375.jpg` 係修正測試鍵前所拍之**空收藏頁**（「還沒有收藏…」）；After 已改以 `cardscope-watchlist`／`cardscope-watchlist-meta` 寫入 2 款 3 張收藏卡，確認「管理 ▾」穩居 `#cardControls` 上方靠右且不擠壓篩選列 |

### 2. Playwright `after` 程式化驗收數據（`audit-shots.mjs after 4185`，無 `.env`）
- **執行期錯誤**：`pageErrors` = **0 筆**（`[]`）。
- **水平溢位檢核（`scrollWidth <= innerWidth`）**：`home1440Overflow`、`topbar1024Overflow`、`home375Overflow`、`detail375Overflow`、`collection375Overflow` 全數 **`true`（0 溢位）**。
- **關鍵修復斷言實測值**：
  - `home1440FocusClass`: `"brand"` ／ `home1440BrandOutline`: `"rgb(246, 241, 230)"`（`#F6F1E6`）
  - `channelsLazyCount`: `0` ／ `seriesPlaceholder`: `"篩選系列：SV6a、151…"`
  - `resultsSideBtnDisplay`: `"flex"` ／ `resultsSideBtnHeight`: `44` ／ `resultsBodySide`: `"results"` ／ `searchResultsCount`: `2`
  - `detailVersionDisplay`: `{ display: "block", width: 358 }`
  - `detailInfoTipBounds`: `{ left: 1053, right: 1413, innerWidth: 1440 }`（右側零裁切）
  - `povHeadingWrap`: `"block"` ／ `ptlControls`: `{ segBtnHeight: 44, hasDetailsSummary: true }`
  - `syncInputBg`: `{ bg: "rgb(248, 245, 238)", border: "rgb(133, 125, 110)" }`
  - `collectionManageBox`: `{ manageTop: 198, manageBottom: 242, controlsTop: 246 }`（`.coll-manage` 完整位於 `#cardControls` 上方）

---

## 六、需要使用者決定

以下項目在本輪體檢後刻意保留不動，因其涉及產品規則、資安架構取捨、資料庫維運或法務／授權政策，需由使用者拍板後再行排入：

1. **跨分頁 Token 輪替鎖與 `storage` 同步（`SEC-06`、`TEST-02` 部分）**：是否採用 `navigator.locks` 與 `storage` 事件協調多分頁同時 refresh 單次輪替 `refresh_token` 及同步本地收藏／`revision` 狀態，防止兩分頁互毀登入態。
2. **伺服器 Auth／Sync 逾時、`AUTH_RATE_LIMIT` 與 `Content-Type` 強檢（`SEC-11`、`TEST-03`）**：是否於 `supabaseAuth()`／`supabaseFetch()` 加上 `AbortSignal.timeout(12000)`、對 POST JSON 端點強制要求 `Content-Type: application/json`，並補測 `AUTH_RATE_LIMIT` 真實 `429` 與快取到期／驅逐。
3. **`PGRST202` 降級大系列分頁與 SQL Migration 套用時程（`SEC-09`、`TEST-04`）**：主庫與第二庫 `ip2` 應確認是否已套用 `supabase/migrations/20261121000000_search_cards_ranked_series_filter.sql`；未套用前之降級路徑是否要承擔額外 DB 請求成本去補齊 `>400` 筆與跨 `canonical_id` 兄弟卡。
4. **視覺對齊與低對比次要元素取捨（`VIS-08` 後半、`VIS-13`、`SEC-12`、`UX-12`）**：
   - `about`／`privacy` `.wrap`（`1280px`）是否統一改用 `--shell-max`（`1440px`）消除跨頁頂欄 80px 跳動。
   - `1200px` 首頁 `.hero` 雙欄搜尋框上限（`look-v2.css:947` 與 `look-showcase.css:243`）調整。
   - 停用按鈕透明度（目前 `0.4`）是否調升至 `0.55–0.65`、UA 6 欄長代號截斷是否微縮間距、`.mobile-scope-sep` 裝飾線調整、及首頁導覽第 1 步聚光框涵蓋範例按鈕／深底兔頭像提亮。
5. **外部圖片政策與上游 404 資料清理（`PROD-02`、`PROD-03` 後半、`PROD-04`）**：
   - 航海王／遊戲王外部官方商品圖遭 `NotSameSite` 擋下與 Weiß Schwarz `ws-tcg.com` 圖片遭 ORB 阻擋：需確認是否向官方取得授權後納入 `/api/images/*` 代理，或停止輸出必被瀏覽器阻擋之外連圖片網址（直接改顯示代碼磚）。
   - 資料庫清理 `pokemontcg.io/mcd14..18` 4 筆 HTTP 404 圖源網址。
6. **正式站 `Cache-Control` / SEO 時程與已停用源相關顯示文案**：確認正式站部署時程、SEO 頁面快取標頭策略與已停用來源（如遊々亭或未授權來源）在介面上的顯示文字是否需調整。
7. **UX 操作體驗深化項目（`UX-04`、`UX-05` 後半、`UX-08`、`UX-10` 後半、`UX-13`–`UX-16`、`UX-18` 後半、`UX-19`）**：遊戲頁搜尋跨遊戲時之左側欄上下文、手機抽屜切換後自動收合時機、收藏牆單卡價與「復原」刪除 Toast、版本對照表搬出摺疊與遊戲王頂部整合 YGOPRODeck、跨遊戲搜尋結果顯示參考價、收藏頁冷啟骨架與同步對話框雙欄改版。

---

## 七、未驗證

本輪驗證明確受限於以下條件，下列範圍尚未於真實環境驗證：

1. **無 `.env`、無資料庫連線與無外部 API 金鑰**：
   - 本機測試（`npm test` 1,066 項與本機 `PORT=4185` Playwright 驗收）均在無 `.env`、無連接 Supabase 主庫／副庫（`union-arena` 本機為 503 降級）、無 Google OAuth／eBay／PokemonPriceTracker 金鑰下運行，僅使用 `data/catalog.json` 樣本資料及測試用 Mock／沙盒。
   - 因此，真實 Supabase Postgres 7 參數 `search_cards_ranked` RPC 執行、`/api/sync/*` 真實資料庫讀寫與 180 天清理、Google OAuth 真實跳轉與 `/api/auth/refresh` 上游行為均**未於本輪實連驗證**。
2. **正式站尚未部署本次修復且僅執行唯讀抽查**：
   - 體檢階段對 `https://cardseektcg.com` 嚴格唯讀（未送出勘誤表單、未登入 Google、未操作任何雲端寫入或刪除）；且本次 3 筆修復 commit 僅提交於本機 `claude/agy-swarm` 分支，尚未推播與部署至正式站。
3. **Part 1 基準截圖與部分 `after` 視覺限制**：
   - `detail-price-before-1440.jpg` 因權限拒絕而缺席；`collection-before-375.jpg` 為修正測試鍵前之空收藏頁，故無法對照修復前之實卡收藏工具列與價格表實圖。
   - `after` 截圖於本機無價格資料庫環境採用 Playwright 路由攔截之模擬價格歷史（`buildMockPriceHistory`）驗證 `.pov` 價目表與走勢圖版面。
4. **裝置與輔助科技實測限制**：
   - 所有雙端／三視口驗證皆於 Windows 桌機 Chromium 無頭瀏覽器模擬（`1440×900`、`1024×768`、`820×900`、`375×812`），未於真實 iPhone／Android 手機觸控實機（含陀螺儀／Safari iOS 行為）或 NVDA／VoiceOver 螢幕閱讀器實測。
5. **未涵蓋的邊界實測**：
   - `SEC-09`（`PGRST202` 降級路徑 `>400` 筆與跨 `canonical_id` 兄弟卡）、`SEC-06`（多分頁並發競態實際交錯執行）與 `TEST-03`／`TEST-05` 剩餘測試項目僅止於靜態程式碼審查。
