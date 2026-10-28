# CardScope BUG 排查報告（2026-10-28，sonnet-worker）

方法：套用 matt diagnosing-bugs（先建可重現的迴路、再看根因）與 code-review（標準＋規格）規則，只讀、未改 repo、未寫正式庫。
基準：`npm test` 574 通過、0 失敗（無紅燈）。
實測工具：正式站公開 API（node fetch）、內建瀏覽器（Browser pane，用 JS 注入延遲 fetch 模擬慢網路）、`run-sql.mjs --read-only`、HEAD 抽樣 36 張卡圖（全 200）。測試瀏覽器的 localStorage 已還原。
行號為 repo 目前版本（cardscope/ 下）。

## 一、確認 bug（皆已重現）

| # | 嚴重度 | 位置 | 重現步驟 | 實際 vs 預期 | 根因與建議修法 | 改動大小 |
|---|---|---|---|---|---|---|
| 1 | 高 | index.html:121、131、150（`loadCardsPage`）；觸發點 index.html:271 附近 `rarityFilter/priceFilter/cardSort.onchange` | 開 `/?game=pokemon&region=JP&series=pokemon-tcgdex-ja-m6a`。把 `/api/cards?` 延遲 2.5 秒（模擬手機慢網路或 Render 冷啟動），請求還在途中把稀有度改 SAR、0.5 秒後再改 AR。 | 實際：卡牆永遠停在 12 格骨架畫面、「載入更多」鈕停在「載入中…」、`browse.loading` 永遠 true；之後再改稀有度（含改回「全部」）全被忽略，只有切換系列／遊戲才恢復。預期：以最後一次選擇為準，重新載入。 | 第 121 行 `if(browse.loading…)return` 會把「請求進行中又改篩選」的新請求直接丟掉；舊請求回來時因稀有度已變，第 131 行判定過期而 return，第 150 行 finally 也因「不是目前請求」不重設 `loading=false`，狀態卡死。建議：reset 載入（`loadCardsPage(true)`）時不要被 `loading` 擋，而是先 `invalidateBrowseRequest()`（本來就會 `loading=false` 並遞增版本）再發新請求；只有「載入更多」才用 `loading` 擋。手機稀有度快選盤、篩選面板都是 dispatch 同一個 change，同樣受影響。 | 小（約 3 行） |
| 2 | 中 | ui-enhancements.js:506（`openCard`，沒有任何過期檢查；index.html 的 `detailRequestVersion` 宣告了沒使用） | 開系列卡表，把 `/api/cards/<第1張>` 延遲 3 秒；點第 1 張後 0.3 秒再點第 2 張（或快速按「下一張」）。 | 實際：先顯示第 2 張，3 秒後被第 1 張覆蓋——畫面是蛋蛋，但網址、`activeDetailCardId`、位置「2 / 48」都是第 2 張；之後「下一張」從第 2 張算起（畫面與內部狀態脫鉤）；收藏鈕的 key 是第 1 張，分享網址指到第 2 張。預期：畫面永遠對應最後一次點的卡。 | 非同步回應沒有版本檢查。建議：openCard 開頭 `const v=++detailRequestVersion`，每個 await 之後 `if(v!==detailRequestVersion)return`（含 catch）。 | 小 |
| 3 | 中 | navigation-state.js:110（wrapper `window.openCard=async id=>…` 只收一個參數）；呼叫端 ui-enhancements.js 版本列 `openCard(button.dataset.versionCard,{keepPosition:true})` | 開 `?game=pokemon&region=JP&series=pokemon-tcgdex-ja-m6a` 第 1 張（有 JP＋TW 兩個版本），點「點擊查看此版本的卡圖」。 | 實際：位置列變「目前卡片」，上一張／下一張按鈕與 ←→ 鍵全部失效（`activeDetailCardId` 變成不在清單內的 TW id，`openAdjacentCard` 找不到 index 直接 return），網址 card 也被換成 TW id。預期：切版本不離開原本在清單中的位置（程式本意就是 keepPosition）。 | wrapper 把 `options` 吞掉，`keepPosition` 無效。建議：wrapper 改 `async (id,options)=>…` 並轉傳；切版本不要 push 歷史（或用 replace）。 | 小 |
| 4 | 中 | navigation-state.js:111（wrapper 每次 openCard 都設 `openedFromList=true` 並 push）、116–119（`closeDetailWithHistory`） | 開系列卡表 → 點第 1 張 → 按「下一張」→ 按關閉。 | 實際：關閉後 modal 已收起，但網址停在 `...&card=...-001`（歷史是 back 一步回到「第 1 張」那筆），重新整理或複製網址會重新開出第 1 張；再按返回鍵才真正回到列表。分享連結直開卡後按下一張再關閉同理。預期：關閉後網址不帶 card，且返回鍵回到列表之前的頁面。 | `history.back()` 只退一步，但上一張/下一張/切版本各 push 一筆。建議：只有「從列表第一次開啟」才 push，之後的上一張/下一張/切版本用 `replaceState`；或關閉時記下開啟時的歷史深度，back 對應步數。 | 小～中 |
| 5 | 中（誤導） | index.html:141（`rarityGap`／`unknownRarity`） | 直接開 `/?game=pokemon&region=JP&series=pokemon-tcgdex-ja-m6a&rarity=AR`。 | 實際：摘要寫「完整圖鑑符合 20 張，目前顯示 20 張（其中 15 張稀有度待補，不在稀有度分組內）」。20 張全都是 AR，「15 張待補」是整個系列的數字（API facets 不隨 rarity 篩選縮小，`rarity=AR` 與 `rarity=all` 回傳的 facets 完全相同）。預期：篩選稀有度時不顯示這段提醒（或只在 rarity=all 顯示）。 | 只要 `cardFilters.rarity==='all'` 才算 `rarityGap`。 | 極小（1 行） |
| 6 | 中 | server.mjs:1112（`return !q||values.some(...)`）；`postgrestLike`（server.mjs:826）會把 `. _ % * ( ) , \` 拿掉 | `GET /api/search?q=.`（或 `_`、` `、`　`）。前端只擋「全空白」，輸入「.」「_」會真的送出。 | 實際：回 200、total=159，列出寶可夢／遊戲王等不相干的 159 張備援樣本卡，UI 顯示「「.」的搜尋結果（159）」。預期：視同空白查詢（提示或零結果）。 | 標準化後 `q` 為空字串時，第 1112 行 `!q` 為真→整份備援目錄全回。建議：`/api/search` 在 `normalizeSearch(searchName)===''` 且無稀有度/版本條件時直接回空＋提示；前端 `$('go').onclick` 也可用同樣規則。 | 小 |
| 7 | 低 | collection-store.js:48–49（`readBackupJson`）、`parseBackup` | 把匯出的 JSON 另存成「UTF-8 含 BOM」（Windows 記事本舊版、PowerShell `Out-File` 常見）再匯入。 | 實際：「沒有匯入：不是有效的 JSON 檔案」（`JSON.parse` 遇 BOM 丟錯；CSV 則有處理 BOM，兩者不一致）。預期：可匯入。 | `JSON.parse(text.replace(/^﻿/,''))`。 | 極小 |
| 8 | 低 | series-band.js:15、68；ui-enhancements.js:784、1006 | 以台灣時間 10-29 04:00（UTC 10-28 20:00）模擬：`today()`=2026-10-28，發售日 10-29 的系列 `releaseDate>today()` 為真（node 模擬輸出已驗證）。日版以 JST 算則 00:00–09:00 同樣差一天。目前資料中尚無「今天發售」系列所以正式站未直接看到。 | 實際：發售當天台灣 00:00–08:00 仍標「即將發售」，`openLatestSeries`、兔子「最新系列」格、手機入口角標都排除它；匯出檔名日期（`cardscope-collection-YYYY-MM-DD.json`）也晚一天。預期：以台灣（UTC+8）日期比較。 | `today()` 改用 `new Date(Date.now()+8*3600e3).toISOString().slice(0,10)`（或 `toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})`），三處共用一個函式。 | 小 |
| 9 | 低 | ui-enhancements.js:831（全域 keydown：ArrowLeft/Right → `openAdjacentCard`）；放大檢視 `zoom.onkeydown` 沒擋方向鍵 | 打開卡片詳細頁 → 點卡圖進放大檢視 → 按 →（或對 `#cardZoom` 派送 ArrowRight）。 | 實際：放大檢視還開著，但背後的詳細頁已換成下一張（呆呆獸→拉普拉斯），關掉放大才發現。預期：放大時方向鍵不動背後內容。 | 全域 keydown 在 `#cardZoom.open` 時 return。 | 極小 |
| 10 | 低（資料） | 資料表 tcg_cards.rarity 與 tcg_printings.rarity（遊戲王 925 張卡） | `select … from tcg_cards c … where c.rarity 不在任何 printing.rarity`：遊戲王 925 張。例：`yugioh-ygoprodeck-10136446`（Darklord Eveningstar）卡級 rarity=Secret Rare，但唯一印刷（BPRO-EN036）是 Starlight Rare。 | 實際：系列卡牆（BPRO）顯示 Secret Rare，同一張卡同時出現在 Secret Rare 與 Starlight Rare 兩個篩選；詳細頁稀有度欄寫「Secret Rare、Starlight Rare」；稀有度分組會把它歸到 Secret。預期：卡牆以該版本印刷的稀有度為準。 | 卡牆／詳細頁的稀有度應優先取「目前系列／版本的 printing.rarity」，卡級 rarity 只當備援；或資料端重算卡級 rarity。其餘 OP（SP卡 vs SP CARD，143 張）屬別名，不算錯。 | 中（改顯示邏輯）或資料修補 |
| 11 | 低（搜尋） | server.mjs `parseSearchQuery`（稀有度單字母不拆） | `/api/search?q=OP05-001 R` | 實際：0 筆且沒有建議（`OP05-001`、`OP05-001 L` 都能找到；`OP05-001 SR` 會給 name-only 建議）。預期：至少給「OP05-001」建議。 | 無稀有度條件時、若去掉最後一個單字母 token 就有結果，也提供 suggestion。 | 小 |

## 二、疑點（未重現或僅程式碼推論）

1. 手機稀有度快選盤／篩選面板（ui-enhancements.js:524、571）：都是設定 `#rarityFilter` 後 dispatch change，推論與 #1 同一個卡死路徑，但未在手機視窗實測。
2. `resolveCollection` 一次最多補 200 筆（ui-enhancements.js:952 `.slice(0,200)`）：匯入超過 200 張未補快照的卡，其餘會顯示「卡片資料載入中」直到下次開收藏視窗才再補 200 筆。未實測（需數百次 API 請求）。不影響數量與匯出資料，只是顯示。
3. 日版同系列「-v2」重複卡號（pokemon JP 436 組、TW 713 組：同系列同卡號兩張，如 `pokemon-official-ja-bb-004` 與 `-004-v2`）：是否算兩張？集卡進度分母（`meta.total`）會把它們各算 1 張，使用者可能湊不滿 100%。需產品決策，非程式錯誤。
4. `pokemon-pokemontcg-zsv10pt5-80`（Antique Cover Fossil）的 local_card_number 是 60，與 `-60`（騎士蝸牛）同號，疑為來源資料錯（僅 1 筆）。
5. `/api/search` 在 offset 超過結果數時 `total` 回 1（例 `q=リザードン&offset=200` total=1、data 空）；前端「載入更多」只在 hasMore 時出現，實務不會觸發。
6. PWA sw.js：所有導覽都共用快取鍵 `/`，離線時回傳的是「最後一次導覽」的 HTML（若伺服器對 `?card=` 注入單卡 SEO meta，離線殼會帶別張卡的 title/canonical）。影響很小，未驗證伺服器是否對 `?card=` 注入。
7. 收藏合併（`resolveCollectionEntry` → `mergeItems`）把「作品層 id 舊資料」與「實體卡 id」合併時取 max 而不是相加；若兩筆都有數量會少算（設計是「重複匯入不翻倍」，但這個遷移情境下未必期望）。未重現（需兩筆同卡不同 id 的舊資料）。

## 三、已檢查、沒問題

- `npm test` 574/574 通過。
- 搜尋：噴火龍／リザードン／Charizard／皮卡丘／黑魔導女孩／Dark Magician Girl／青眼白龍／ブラック・マジシャン／日向翔陽／排球少年（給遊戲提示）／SV6a 090／SV6a-090／sv6a090／OP-05／OP 17 118／op17118／BETB EN060／「噴 火 龍」／全形ＳＡＲ／噴火龍 SAR／pikachu ar／皮卡丘 日版／OP-05 SEC 皆回合理結果；單獨 SAR／SR 回提示＋範例。
- 搜尋穩健：`% _ * , " \ ' () or=(id.eq.1) --` 與 101 字長查詢皆 200 無 500；`/api/cards` 的 limit／offset／sort／region 異常值皆正確夾住或回 400；不存在卡 id 回 404 友善訊息。
- 分頁：寶可夢系列卡牆（M6a 176 張）、航海王全部卡片、遊戲王 BPRO 三種排序逐頁抓取，無重複、total 與實抓數一致。
- 網址狀態：`?series=…&rarity=AR&sort=rarity-desc&pages=2` 可還原稀有度與排序；首頁／遊戲頁 console 無錯誤。
- 收藏：舊 ☆ 清單＋舊數量一次遷移正確（數量保留、無數量補 1、旗標寫入、舊鍵保留）；匯出 JSON 內容、匯入預覽（新增／更新／略過）、取代全部（confirm 後正確只留檔案內容、移除計數正確）、集卡進度（2/176）皆正確；JSON／CSV 往返（引號、逗號、換行、`=` 開頭備註）無損；v1 備份的星號項目算 1。
- 資料一致性：canonical 指向不存在的卡 0；孤立 printing／無 printing 的卡 0；printing.series_id 指向不存在系列 0；系列與 printing 的 region／game 不一致 0；系列重複代碼 0；發售日格式皆 YYYY-MM-DD；card 與 printing 稀有度不一致只有遊戲王（見 #10）與航海王別名。
- 圖片：card_images 三大來源（www.pokemon-card.com、asia.pokemon-card.com、supabase storage）各抽 12 張 HEAD，36/36 回 200。
- 圖片備援（resilientImage 重試一次→fallbackImageUrls）、系列磚 onerror 重試邏輯，程式碼檢視無誤。
- 首頁最新系列磚、首頁星圖手牌的 `dataset.key` 檢查（series-band.js:151）可擋過期重繪；`browseRequestIsCurrent` 對切換遊戲／地區／系列有效（唯獨 #1 的 finally 缺口）。
- 已有 `docs/AUDIT_20261023.md` 修過的項目未重報。

## 四、未檢查的部分

- 手機視窗的實機操作（快速入口、稀有度快選盤、篩選面板）、Chrome 無頭截圖視覺比對、深色模式。
- 收藏數百筆匯入的效能與 localStorage 配額滿載行為。
