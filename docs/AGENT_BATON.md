# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-30 下午（台灣）｜更新者：Claude Code（桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- 2026-10-29：10-28 盤點除需使用者同意的項目外全部修完並上線（main `9181691`），處理狀態見 `docs/AUDIT_20261028.md`。`npm test` 621/621，煙霧測試通過，正式站驗收 36 項通過。
- 資料清理：空系列與 8-31 示範卡（migration `20261029090000`）、遊戲王 88 筆殘留 unspecified 與 596 張無 TCG 系列的卡（`20261029100000`），備份在 `docs/evidence/cleanup-20261029/`；遊戲王 14,117 張、系列 1,396 個。
- 資料庫約 384 MB；`browse-keys-publish` 每小時 :25；價格快照每日恢復（10-28 寫入 13,562 筆）。

- 2026-10-30：CSP 改為強制（仍允許 inline，擋外部腳本與未列出的圖片主機；轉強制前正式站各遊戲／地區頁與詳細頁實測 0 違規）。首頁副標改為「寶可夢同一張卡的日版與台版並列對照」（#15）。Render 區域照建議維持現狀（搬遷要重建服務，目前延遲可接受）。
- 2026-10-30：收錄七龍珠超 Fusion World（`dragonball-fw`，ADR 0052 Q7 使用者同意 risk-accepted）。官方繁中站 27 個系列由 `dbs-fw-official` 定時同步（insert-only）；正式庫 3,167 張卡／3,167 筆版本（平行版各自一張卡、canonical 指回基本卡，與航海王一致）。正式站驗收：遊戲頁、系列頁、詳細頁桌機與手機皆通過，CLS ≤ 0.03、CSP 0 違規。
- 2026-10-30 夜間（使用者睡覺時授權大更動）：CSP 收緊為 script-src 'self'＋inline script 的 SHA-256 雜湊（伺服器啟動時從 index.html 計算）、script-src-attr 'none'，所有 inline 事件改 `ui-actions.js` 事件委派；正式站 40 頁次（桌機＋手機，各遊戲／地區系列頁、詳細頁分頁、搜尋、收藏、404）0 違規 0 錯誤。卡牆參考價窗口 7→14 天（migration `20261030150000` 已套用，有參考價的卡 14,862→15,107）。七龍珠超同步改為「補空欄位」（系列發售日／圖、卡片日文名，只補 null）並從日文收錄彈補能量標記日文名（正式庫已回填，缺日文名 0）。手機快速入口拿掉「新手導覽」格，回到 10 格兩排。`yuyuteiMarket` 卡號跳脫已修。

- 2026-10-30 下午：首頁（及寶可夢遊戲頁）原本停用的遊々亭「趨勢」區塊改放「近 14 天參考價漲跌（寶可夢）」：資料庫函式 `price_movers`（migration `20261031090000`，已套用正式庫，約 0.4 秒）比同一張卡同一 variant 的 Cardmarket EUR 快照，兩端 ≥ €5、起訖相隔 ≥ 7 天、倒數第二筆同方向才列入，漲跌各 20；`/api/price-movers` 換算新台幣、快取一小時；前端 `price-movers.js`，點卡開本站詳細頁。使用者想看能否賺價差，已說明這份資料做不到（只有單一平台參考價，沒有買入價、台灣行情、運費手續費），榜單標明不是買賣建議，變動 ≥ 200% 另加「成交稀少」提醒。

- 2026-10-30 下午：遊戲頁頂部改「商標牆」（使用者從五版預覽選 B）：七格等寬放大官方商標、手機 4 欄兩列，去掉標題列下方 48px 空白；搜尋鈕改 SVG 圖示、56 寬貼齊右側。樣式在 `look-clean.css` 檔尾；首頁（landing）的遊戲格未改。

- 2026-10-30 下午：TCGdex 會把不同的卡對到同一個 Cardmarket idProduct（已確認 base3-19／4、xyp XY202／XY95、neo2-22／3、smp SM57／SM80，價格完全相同）。新增 `price_product_links`（migration `20261031100000`，已套用；每日快照順手記錄）與 `price_products_shared`；`price_movers` 排除共用的卡，`/market` 回 `meta.sharedPriceCardIds`，詳細頁價格分頁顯示一句提醒。目前表內只有手動寫入的那 8 張。

- 2026-10-30 晚間：詳細頁「價格」與「走勢」合併成一個分頁，改互動時間軸（`price-timeline.js`，取代已刪除的 `price-history-chart.js`）：可拖圖表或滑桿選日期、播放、範圍切換、跳到跌最多／最高／最低；打開分頁時自動播一次（減少動態或暫停動態時不播）。沒紀錄的日子沿用前一筆並標明；走勢相同的版本併成一個選項；停更的來源不列；低於 €0.1 的最低賣價不顯示。原比價內容收進「這個價格怎麼來的？各版本明細」，沒有走勢資料時自動展開。桌機卡片欄放大到 340px，手機時間軸上方有小卡和價格固定。

- 2026-10-30 晚間：時間軸圖表加價格軸、日期軸、跟著游標的日期價格標籤；讀數顯示完整日期與來源更新時間（台北）。事件來自手動維護的 `providers/market-events.mjs`（只收官方來源、整個遊戲層級），經 `/price-history` 的 `meta.events` 送出；目前只有寶可夢 2 筆，沒有單卡新聞來源。

- 2026-10-30 晚間：時價與時事補齊（ADR 0054）。詳細頁「現在行情」加近 7／30 天平均與比較句；首頁、遊戲頁加「卡牌時事」（`market-events.js`、`/api/market-events`），資料是手動官方消息＋`tcg_series` 發售日。自動新聞與單卡新聞未做。

## 下次要確認
- 共用商品：下一輪完整快照（約 10-31 晚間跑完）後查 `select count(*) from price_products_shared(null)`、`price_movers` 執行時間（手動 8 張時約 1.4 秒）。
- 漲跌榜：漲幅前 20 目前全是 ≥ +266% 的老卡／推廣卡（成交稀少），且有幾組不同卡號共用同一個 Cardmarket 價格（如 xyp XY202 與 XY95），疑似 TCGdex 對應錯誤，未處理。資料累積到幾個月後再評估門檻。
- 七龍珠超：系列發售日與包裝圖取自官方商品頁（推廣卡 PR 沒有發售日）；能量標記另列「能量標記」稀有度分組；系列分組為補充包／特別補充包／起始牌組／推廣卡。仍待：官方卡圖帶 SAMPLE 浮水印（未放進首頁展示卡）。稀有度順序 SCR＞SR＞L＞R＞UC＞C＞PR＞能量標記為自訂，在 `data/rarity-rankings.json`。
- 七龍珠超同步的「補空欄位」PATCH（PostgREST `or=(…is.null)`、`name_ja=is.null`）只在 mock 測試驗過；下一次自動同步（約 11-02，72 小時一次）後看 `catalog_sync_runs` 的 dbs-fw-official 是否 completed、metadata.filledSeries／filledJa。
- CSP 已收緊：新增卡圖來源主機要加進 `server.mjs` CSP 的 img-src；index.html 新增或修改 inline <script> 不用手動算雜湊（啟動時自動），但不能再寫 onclick=／onerror= 等屬性，改用 `ui-actions.js` 的 data-do／data-img-error（`test/csp-strict.test.mjs` 會擋）。
- 收藏估值與詳細頁各版本價格表仍以 7 天判定過期（`providers/tcgdex-pricing.mjs` 的 TCGDEX_PRICING_MAX_AGE_MS，刻意與詳細頁一致，未改）；桌機卡格最小字級 11px（未改）。
- admin 端點仍回 e.message（需管理密鑰，保留診斷）。
- 首頁 <title>／description 在 `providers/seo.mjs` 的 homeSeo 有一份，改 index.html 文案要同步；Chiron Hei HK 用 text= 子集化，改首頁大標或導覽小卡標題要同步 text=。

## 卡住的地方／需要規劃方決策
- （無）#3 Render 舊金鑰已由使用者於 10-30 刪除。暫停中的新加坡服務 `cardscope-1` 也已刪除，Render 只剩正式服務 `cardscope`（Ohio）。

## 本機檔案（不在 git，換電腦不會帶過去）
- `.env.local`：`SUPABASE_ACCESS_TOKEN`（`scripts/run-sql.mjs` 用），每台電腦各自建立。
- `docs/design-previews/`：10-22 首頁 5 版預覽截圖（已加入 `.git/info/exclude`），可不用。
- 這台的 Claude Code 工作階段在 `cardscope` 上一層開啟時，讀不到 `cardscope/.claude/agents/sonnet-worker.md`；改用通用 agent＋`model: sonnet`、`effort: high`，並把 sonnet-worker 規則貼進封包。

## 開始前必須重新核對
- `git pull` 後 `git log -1` 應為本檔提交或更新；`npm test` 基準 650。
- 10-30 接手核對：排球少年 HV-P04（148）／HV-D04（15）版本全有官方卡圖且網址回 200，此項結案。皇巢／晴れる屋2 至 10-30 仍未回覆（晴れる屋2 只有自動受理信），使用者 10-30 決定放棄：航海王、排球少年、芙莉蓮、遊戲王日版維持無價格，不再追這兩家。
- 之後要等的事：約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
