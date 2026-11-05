# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-11-05（台灣）｜更新者：Claude Code（桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- 2026-11-06：系列橫列（遊戲頁 #seriesBand、首頁 #homeLatest）左右加翻頁鈕（main cfbf5b5，series-band.js `railNav`、look-clean.css `.rail-nav`）：一次捲約八成寬，捲到頭那側隱藏，沒溢出不出現；只在滑鼠裝置（hover:hover、pointer:fine）顯示，手機照常手滑。
- 2026-11-05：搜尋修正（main 219663c）。(1) 卡名後直接黏稀有度代碼（「阿爾宙斯UR」「ピカチュウSAR」）在 `parseSearchQuery` 先拆開再解析；只拆非 ASCII 字後接 2–5 個英文字母且是已知代碼的情況，噴火龍ex、阿爾宙斯VSTAR 不受影響。(2) 搜尋框（#q、#heroQ）輸入即時建議：`installSearchSuggest`（ui-enhancements.js 末段），停 0.25 秒查 `/api/search?limit=6`，列卡圖＋名稱＋遊戲／卡號／稀有度，點或 Enter 開卡，帶稀有度時第一列說明拆解結果，超過 6 筆給「查看全部 N 筆結果」。清單 position:fixed 掛在 body（.search 有 overflow:hidden），手機寬度至少 340px。測試 725/725。
- 2026-11-05：遊戲王日版（yugioh-neuron）從沒完成過一輪：每輪約 21 分鐘時 JavaScript heap out of memory（Render exit 134，11-04 17:27、11-05 00:18、06:53），整站跟著重啟。原因是 `parseYgoJpDetail` 取出的字串是整頁 HTML 的切片，留在 printings 裡讓整頁無法回收；`collectYugiohJp` 改成 JSON 來回複製（main 9d2bd09，本機 600 頁 248→7 MB）。開機後第一次排程把開機前的 catalog running 列標 failed（`closeInterruptedCatalogRuns`）。部署後 09:05 UTC 那輪首次 completed（09:33，處理 1,200 張、日版 printing 1,269 筆、補日文名 1,200 張，期間無 server_failed）；尚待 12,410 張，每小時接續一輪，約 11 輪跑完。下次確認：`catalog_sync_runs` 的 yugioh-neuron 持續 completed、Render 沒有 exit 134。缺圖盤點：寶可夢實際缺 23 張（日版 SM 時代 SR、M6 分割圖競技場、M6a B/G/R 夢幻、台版 SV-P no0～3），官網與 TCGdex 都沒有，未補；M6a 104～135 經台版同卡已有圖。遊戲王 26 張新卡 YGOPRODeck 已有圖，會在下次 ygoprodeck 同步（約 11-06 04:17 UTC）時由 `cacheYugiohImages` 快取。價格：寶可夢快照 11-05 已寫入，遊戲王由 YGOPRODeck 即時價，其他遊戲依使用者決定維持無價格。
- 2026-11-05：單卡視窗改版（main 8f888d6，和 agy gemini-4-argon-high 唯讀討論後取高效益項）。左欄順序：卡圖 → 遊戲 → 卡名 → 原文名副標（`.detail-subname`）→ 價格列 → 收藏＋分享並排（`.detail-actions`，分享鈕由 navigation-state.js 插入）→ 卡號／稀有度。中文名列只在待補、帶標記或同名推導時出現；原文名列移除。左欄固定 300px（拿掉價格分頁 340px 規則），切分頁不跳。參考價逾時時 server 在卡片資料加 `referencePriceFailed`，價格列改成重試鈕。無卡面文字時只留一行 `.card-text-empty`。沒採用：預設開價格分頁（違反 ADR 0042/0044 延遲載入）、手機 sticky 頂列（既有捲動容器問題未解）、滑動切卡、篩選鈕改分段控制（使用者之後同意，已做：main 2d58d57，`.ptl-chip.on` 白底細框、`.ptl-seg` 3px 內距分段、選中白底微陰影，外框仍 44px）。
- 2026-11-05：使用者看過 Collectr／TCGplayer 對照圖後要「三項都做」，已全部上線（main a25b7aa）。(1) 詳細頁卡名下價格列（`detailPriceMarkup`）：同來源同版本的即時價比快照新時改用即時價，漲跌以 `changeBase` 重算，和價格分頁數字一致。(2) 卡牆近 7 天漲跌：新 RPC `price_reference_prior`（migration 20261105120000，已套正式庫，只給 service_role），手機 4 欄漲跌放價格下方一行。(3) 走勢圖線尾實心圓點、左上角「這段 ↑/↓ X%」。另修：卡片 API 參考價查詢逾時（冷啟動 1.5 秒）時回 no-store，避免瀏覽器快取沒價格的版本。測試 722/722。注意：卡牆／價格列的「近 7 天」比的是 7 天前（含）最後一筆快照，價格分頁的「比 MM-DD」比的是範圍起點，兩者可能方向不同（例如噴火龍 ex 199：近 7 天 ▲12.8%、比 10-16 ↓12%）。
- 2026-11-05：遊戲王日版第二輪（11-04 17:06 UTC 開始）卡在 running，多半被部署打斷；6 小時後（約 23:06 UTC）排程視為過期會重跑，接手請查 `catalog_sync_runs` 的 `yugioh-neuron`。
- 2026-11-05：價格分頁／趨勢圖／卡牆改版上線（main `077e801`，使用者要求與 agy〔Gemini 4 Argon High〕討論「市售等級」後「連第二批一起做」）。修正：價格歷史 API 去掉 `tcgapi-` 前綴、均價改用 API 匯率、即時價與快照差一天同價不重複加點、週月資料不足時防呆、手機 `.ptl-head` 取消 sticky、首頁桌機改紅漲綠跌（全站 #C4000F／#1F6F43）。介面：進場停在最新不自動播放、拿掉卡圖跟著轉、控制列收成上下兩排、最高最低點直接標在圖上、單一墨色主線＋漸層、讀數改固定四格、「行情與比價」合併、TCGplayer 有 idProduct 直連商品頁（Cardmarket 的 sourceUrl 其實是 TCGdex，仍走搜尋）、卡牆參考價一行（NT$＋CM／TCG）、放大檢視雙擊 1x↔2.5x。未做：圖上加本卡系列發售日（前端拿不到發售日）。已知：手機詳細頁的分頁列 sticky 實際不生效（捲動容器問題，改版前就是如此）。測試 713/713。
- 2026-11-05：使用者回「都收 開始做」（ADR 0055）。(1) 航海王美版（806d55a）：同一個 syncOnePiece 也讀 en.onepiece-cardgame.com（61 系列），乾跑 4,945 張、4,609 張對到既有卡掛 region US 版本（`provider_id` `us:`）、336 張美版獨有另建卡（englishOnly）；美版圖有 SAMPLE 浮水印，前端已標。正式庫等下次航海王同步（約 11-06 05:17 UTC）自動寫入，接手請查 `select count(*) from tcg_printings where source='onepiece-official' and region='US'`。美版讀取失敗會讓整輪航海王同步失敗。(2) 遊戲王日版（c01d3fd、ad7e01f，精簡版）：`providers/yugioh-official-jp.mjs`，以 YGOPRODeck `misc_info.konami_id`（= 官方 cid）對到既有卡，每張卡每種卡圖（ciid）只寫一筆 region JP 版本（取最早日版收錄的卡號／稀有度，`provider_id` `jp:<cid>:<ciid>`，metadata.packCodes 最多 30 個），只補空的 name_ja，不建日版系列。約 1.4 萬筆、約 13 MB；每輪上限約 1,200 個請求，沒補完下個小時續跑（約 12 輪），補完後每 72 小時一輪。OCG 獨有、庫裡沒有的約 377 張只回報（`missingCardSample`），沒建卡。另修 `image-cache.mjs`：遊戲王快取圖只 PATCH `source=ygoprodeck` 的版本，避免蓋掉日版圖。官方站有 Imperva，Render IP 會不會被擋未驗證，接手請先看 `catalog_sync_runs` 的 `yugioh-official-jp`（provider 名以程式為準）前幾輪。
- 2026-11-05：資料庫容量：查到 440 MB（煞車線），`VACUUM FULL browse_card_keys_mat`（56→22 MB）與 `tcg_card_names` 後 406 MB。完整版遊戲王日版（約 7 萬版本、約 66 MB）放不下，所以改精簡版；日版與航海王美版都寫入後預估約 425 MB，只剩約 15 MB 空間。`tcg_card_names` 只有 2,011 筆卻 25 MB，VACUUM FULL 後沒變小，未查原因。
- 2026-11-05：芙莉蓮加美版（b3d88d2、6858ef0）。英文官方站 en.ws-tcg.com（作品編號 183）只有 S108 補充包（expansion 240）與試玩牌組（239），沒有新裝版／Vol.2；沒有 JSON API，讀 HTML（`/cardlist/` 取擴充包選項、`searchresults` 第一頁帶 max_page、之後 `cardsearch_ex`，約 20 個請求）。卡號 E001↔001、TE01↔T01 一對一，264 張全部對到日版卡，掛 region US 版本（`provider_id` `en:` 開頭）並補 name_en；英文獨有 5 張 PE 推廣卡另建卡（id `weiss-en-…`、metadata.englishOnly）。已用 Supabase MCP 直接寫入正式庫（269 個版本、5 張新卡），正式站搜尋「Frieren Dozing Off」英文卡圖正常顯示；之後每 72 小時的 Weiss 同步會自動跳過已有的列（下次約 11-07 UTC 10:20）。CSP img-src 加 `https://en.ws-tcg.com`；官方卡表名稱解碼改成支援所有數字實體（`&#039;`）。本機 Node 連不到 ws-tcg.com（連到 10.21.3.1），乾跑時日文 API 改用 curl，正式站不受影響。
- 2026-11-05：TCG API 補圖已寫入 175 張 `card_images`（source tcgplayer），寶可夢日版沒有圖的剩 48 張。
- 2026-11-05：漲跌榜卡圖修正（0c45949，migration `20261105090000` 已套用正式庫）：`price_movers` 原本只取版本列 image_url，官方日站補圖的卡（SM7-067、SM5S-031 稜鏡之星）顯示待補；改成沒有時用 `card_images` 主圖（排除 not-displayable），40/40 都有圖。`/api/price-movers` 快取一小時。
- 2026-11-05：芙莉蓮與七龍珠的美版版本都掛在原地區的系列下（系列地區是 JP／TW），所以遊戲頁的地區按鈕不會出現「美版」，美版只在詳細頁與搜尋出現；兩者一致，未改。
- 2026-11-05 評估剩下的三版補圖：(1) 遊戲王繁中版：官方 DB 語系有 ja／en／ae／cn／ko 等，沒有繁中，查不到官方繁中來源。(2) 遊戲王日版：source-registry `yugioh-neuron` 為 link-only、permission-pending，不收資料，需使用者決定。(3) 航海王美版：en.onepiece-cardgame.com（`/cardlist/` 會轉到 `?series=569117`；robots.txt 回 404）。ADR 0027 的風險接受只涵蓋亞洲英文與繁中卡表，但使用者 11-04 說三版補齊不需再詢問，可做；約 5,000 張、數十個系列，建議下個對話照航海王既有同步（`providers/catalog-sync.mjs` 的 syncOnePiece）加美版，卡號與亞洲英文版應相同，掛 region US 版本。
- 本機分支 `harden/ratelimit-socket-fallback` 有未推送的改動（限流沒有 cf-connecting-ip 時改用 socket IP、README 文案、.gitignore 加 claude-red），不是這次的工作，沒動。
- 2026-11-04：使用者要求「全部卡圖先補齊（台／美／日三版），不需再詢問」。盤點（以 tcg_printings 的 region 計）：寶可夢三版齊（日版缺 223 由 TCG API 補、台版 SV-P no0–no3 版本不明待補）；航海王台版 5,026 張即日文卡面（亞洲版就是日文卡），日本官網系列代號與台版完全相同，所以不另收日版；七龍珠 FW 台版圖即日文卡面，349d3d5 加美版：讀 fw/en/cardlist（31 個收錄彈頁＋7 個稀有度頁），既有 3,149 張掛英文版本（region US、`provider_id` 以 `en:` 開頭）並補 name_en，英文獨有約 1,200 個活動包平行版／英文推廣卡另建卡（metadata.englishOnly）。乾跑對官網驗證過；第一次正式寫入要等下次七龍珠同步（約 11-04 UTC 20:17）。遊戲王缺圖 26 張是新卡（含 1014020xx 暫時 ID 與正式 ID 重複各一），等下次 YGO 同步與快取。**還沒做**：航海王美版（en.onepiece-cardgame.com，與亞洲英文版圖幾乎相同，優先度低）（Weiss 依 PRODUCT_PLAN 只收芙莉蓮，日版與英文版 11-05 都齊了）、遊戲王日版（官方 DB 目前只放連結）與繁中版（是否有正式發行未查）。
- 2026-11-03：TCG API 補圖上線（`providers/tcgapi-pricing.mjs` 的 `matchSetImages`、RPC `image_tcgapi_targets`、`card_images.source='tcgplayer'`、前端標「TCGplayer 卡圖」）。每天的 TCG API 工作先補圖再抓價，補圖每 7 天一次；額度用完中斷時不記錄，隔天接著補。上線後第一輪（UTC 16:11）因當天額度已被 10:28 抓價與試查用掉，沒寫入任何圖（目標仍 41 系列、194 張）；預計 11-04 UTC 16:11 左右第一次真正補圖。接手方請查 `select count(*) from card_images where source='tcgplayer'`。風險：TCGplayer 商品圖外連條款未確認；TCG API 免費方案限非商業。
- 2026-11-03：TCG API 卡圖試查（臨時端點已上線再移除，正式站回 404）。卡片資料有 `image_url`，格式固定 `https://product-images.tcgplayer.com/fit-in/400x400/<tcgplayer_id>.jpg`（1000x1000 也可用）。缺圖的 SM／S 金卡與 HR 有收：SM3N 063/051、S8 119/100、S8b 280/184 都查到。若要正式用：照抓價的對應規則（系列名「代號:」唯一、卡號斜線前數字唯一）寫 `card_images`，每個系列約 1–2 次請求、約 45 個系列，要跟抓價共用每天 100 次；圖是 TCGplayer 的商品掃描圖，外連使用的條款未確認。待使用者決定。
- 2026-11-03：補洞第二輪。基本能量 21 張（M6a 8、MC 8、MF 5）用官方日站補圖：能量沒有卡號，改以「同系列＋同卡名、官方只有一張」對應，rights_note 註明。M6a 的 B／G／R 是字母編號的夢幻卡，不是能量，沒補。查過 Limitless TCG：卡片頁（S6H/84、SM12a/211、M6a/129）回 404、圖檔回 403，它的日版資料只收一般卡，不收 HR／UR／金卡，不能用。剩下 SM／S 時代約 150 張多是金色道具／能量（UR，資料庫標 SR）、HR 訓練家、少數 HR 寶可夢；可試的新來源只剩 TCG API 卡片資料裡可能附的 TCGplayer 商品圖（未驗證，要用 Render 上的金鑰，每天 100 次要跟抓價共用、非商業）。
- 2026-11-03：「圖片待補」全面盤點。全庫 280 張卡自己沒有圖（寶可夢日版 250、遊戲王 BETB 26、台版 SV-P 4）。修正：(1) 前端 `resilientImage` 原本在本卡沒圖時直接顯示待補、不看伺服器已給的 `fallbackImageUrls`；改成直接用其他版本同一張卡的圖並標「其他版本卡圖」，詳細頁同樣帶入；搜尋選了版本時，被濾掉的同作品層卡的圖也帶進 `fallbackImageUrls`（server `searchCatalogDatabase`）。M6a 的 AR／SAR 等 29 張因此有圖，正式站已確認。(2) 補 6 張自己的圖：TCGdex 新出的 SV1a-069、SV1S-076、SV1V-075，官方日站 M6-098、M6-099、M6a-156（官方日站逐張比對系列、卡號、卡名都相同才寫）。(3) 遊戲王 BETB：10 張是 YGOPRODeck 暫時編號（1014020xx）的舊列，各有一張同名正式密碼的卡，已把 canonical_id 併到正式卡（metadata `supersededBy`，可還原，未刪除）；另 16 張正式卡 YGOPRODeck 現在有圖了，下次遊戲王目錄同步時圖片快取會自動補上（沒有手動觸發，需要管理密鑰）。剩下真的沒有任何圖的：寶可夢 219 張，多為 SM／S 時代 HR、UR、隱藏 SR（官方日站卡片搜尋不收這類卡，已確認 M6a 的 104–135 也不收）、各系列基本能量、M6a 119／128／129／131／151／152（台版官方站也沒上），以及台版 SV-P 的 4 張未編號卡（官方台站同名卡有 3–4 個版本，分不出是哪一張，不猜）。
- 2026-11-03：日版卡補中文名 256 張（53 個日文卡名，`scripts/fill-pokemon-jp-zh-name-species.mjs`，nameZhBasis `jp-species-name`）：寶可夢名稱用 PokeAPI `pokemon_species_names.csv`（ja-Hrkt→zh-Hant，NFKC），規則有純寶可夢名＋ex/GX/V…、阿羅拉等地區形態、漢字前綴只在台版恰好有一張同字的卡名時才用（名探偵ピカチュウ→名偵探皮卡丘）。跟既有官方中文名衝突的寶可夢不用（サーナイト：官方 サーナイトEX 標成 M沙奈朵EX，疑似資料問題未修）。這次因 `run-sql.mjs` 的管理權杖失效（HTTP 401），改用 Supabase MCP 撈名單、離線算計畫再寫入；腳本本身的 `--apply` 要等權杖更新才能用。剩約 900 個沒中文名的日文卡名多是訓練家／道具／能量，沒有可靠來源，沒做。另：照片裡的伊布推測是 235/BW-P（2013 7-11 寶可夢祭），資料庫沒有 BW-P／XY-P／SM-P 特典卡系列。
- 2026-11-03：匯率（ExchangeRate-API，台銀有機器人驗證、央行 API 連不上，都不能用）加防呆：新抓的日圓／美元／歐元跟一週內上一筆差超過 5% 就不採用（`fxJump`）；抓不到或被擋時沿用資料庫最後一筆，不再退回寫死的值。搜尋：選了版本搜不到但其他版本有時，`meta.otherRegion` 帶出版本，空結果頁給「改看台版的結果」按鈕（`data-search-region`），不再猜錯字。起因：使用者在日版搜「名偵探皮卡丘」0 筆，那張是台版 SV-P 050；日版卡沒有中文卡名，「名偵探皮卡丘」對不到「名探偵ピカチュウ」（未做）。
- 2026-11-03：寶可夢日版系列沒有 Cardmarket 價時（221 個系列，例如 M6a；TCGdex 已不收 M6a），改用 TCG API（tcgapi.dev）的 TCGplayer 美元市價當參考價。`providers/tcgapi-pricing.mjs` 啟動 10 分鐘後跑一輪、之後每 24 小時一輪，每輪最多 70 次請求（免費 100 次/天、非商業；回應的 `daily_remaining` 剩 30 以下就停），照 `price_tcgapi_targets` 最久沒補的系列先補；系列以名稱「代號:」對應、卡號取斜線前數字，兩邊都要唯一才寫。寫進 `price_snapshots`（tcgplayer／USD／variant `tcgapi-<printing>`），`price_reference_best` 只在卡沒有 Cardmarket 價時才用（migration 20261103120000）。卡牆標「TCGplayer 參考」與 US$；系列內價格排序先換成歐元再比。Render 環境變數 `TCGAPI_KEY`（使用者已設）。shortcut：整個遊戲的價格排序歐元美元直接比。試查路徑 `/api/tcgapi-probe` 已移除。
- 2026-11-03：缺圖再補 160 張。158 張 SM／S 時代日版 HR（彩虹）、UR（金）寶可夢卡借用英文版同一張卡的圖：`card_images` 語言 en-US、source `pokemontcg`，rights_note 記錄對應的英文卡號。比對條件是同一組圖鑑編號、同類型（GX／VMAX／無）、彩虹對 Rare Rainbow、金對 Rare Secret、英文版在日版發售後 400 天內，而且只有一個候選。卡圖左下角標「英文版卡圖」（`cardEnglishStandIn`，條件是日版或台版＋images.pokemontcg.io）。S9-095、S9-097 改用 TCGdex 新出的日版圖。刻意沒補的：同一隻有多個候選的（例如白馬／黑馬蕾冠王、雙劍鎧拳的兩種流派、日蝕／黃昏的奈克洛茲瑪，共 22 張）；兩張日版對到同一張英文卡的（S8-119、S8b-280 夢幻 VMAX）；英文版沒有的 25 張；訓練家和能量 125 張（TCGdex 日版沒有英文名，對不上）；M 系列新卡。日版寶可夢還有 250 張沒有圖（含 M6a 46 張，畫面上會借用台版圖）。另：寶可夢系列整個沒有參考價時，價格排序會自動改回依編號，價格選項標「此系列沒有參考價」並停用（`noReferenceSeries`）。
- 2026-11-03：搜尋框加「×」清除鈕（`#qClear`、`leaveSearch()`）：在遊戲頁清掉搜尋會回到同一個遊戲的卡表，在首頁搜尋才回首頁。Logo 照舊回首頁。輸入框清空後按搜尋鈕也一樣會離開搜尋。已上線。
- 2026-11-03：卡圖補漏。日版官方來源 171 張卡（DPs-B 92、EP08 43、SC2 21、S8a-G 15）匯入時沒存圖，已從官方詳細頁抓圖寫進 `card_images`（source `pokemon-card-official-jp`，rights_note ADR 0031），正式站 SC2 已確認顯示。剩 373 張 TCGdex 日版卡沒有任何圖：多為 SM／S 時代的 HR、UR、隱藏 SR（例 SM3p 078–082 超夢GX），日本官方卡片搜尋本來就沒收錄，TCGdex 也沒圖，不是資料過舊；要補只能找新來源或用英文版圖對應，尚未處理。M6a 的 AR／SAR 會借用台版官方圖。另：HV-D04 商品圖網址大小寫錯（`hv-d04`→`HV-D04`）已直接改 `tcg_products`；卡牆參考價改新台幣大字、歐元小字（server 在 browse 回應加 `referencePrice.amountTwd`）。
- 2026-11-03：鑑定卡成交價已上線：寶可夢卡價格分頁的「鑑定卡成交價」區（`providers/graded-prices.mjs`、`/api/graded-prices`、`PriceTimeline.loadGraded`）。英文版用市場紀錄裡唯一的 TCGplayer 編號；沒有時用唯一的日版「系列代號＋卡號」；有多個候選就不查。只顯示 PSA 10/9、BGS 10/9.5、CGC 10/9.5、TAG 10、SGC 10、ACE 10，筆數少於 3 標「筆數少」。快取只在記憶體 24 小時（Render 重啟會重扣點），每天最多 40 次查詢（約 80 credit）。試查路徑已刪除。正式站已確認 SV2a 201（日）與 sv3 125（英）都顯示正確。台版卡若沒有日版版本就不會顯示。之前的實測：
  - 英文版用 `tcgPlayerId` 精準對到（151 噴火龍 ex 199 → 517045，我們的 TCGdex `thirdParty.tcgplayer` 有這個 ID）。
  - 日版用 `language=japanese&set=SV2a&search=201` 精準對到（total=1）；日文卡名搜尋不支援，只會照卡號亂配。
  - 自由文字搜尋會配錯（`Espeon 48` 回冠軍賽版），正式版只接受 tcgPlayerId 或「系列代號＋卡號且 total=1」，否則不顯示。
  - 回傳 `ebay.salesByGrade.{psa10,psa9,cgc10,bgs9_5,...}`：count、averagePrice、medianPrice、min/max、lastSaleDate、smartMarketPrice{price,confidence}、salesBySource（ebay/fanatics）。count 的統計期間文件沒寫。
  - 計費照 `limit` 算：每張卡 2 credit（基本 1＋eBay 1），`limit=3` 就扣 6。正式版用 `limit=1`，每日 100 credit 約 50 張卡，需長快取與每日上限。免費方案歷史價只給 3 天，但鑑定成交彙總照給。
  免費方案只限無營收；來源不透明，要標「第三方彙整，未驗證」。遊々亭已拒絕授權，不再處理。

- 2026-11-03：價格分頁加每天／每週／每月（週 K、月 K 由每日參考價算，不足 3 個月顯示資料不夠）、近 5／20 天平均線、前一天差與原幣、單筆差 3 倍以上的成交稀少提醒、各平台比價（近期與過期分開，連到平台搜尋頁）、每筆價格紀錄表（`price-timeline.js`）。最低掛牌低於 €0.1 仍不顯示（沿用 MIN_LOW）。全套測試曾有一次 `csp-strict` 失敗，單跑與重跑都過，未查出原因。

- 2026-11-03：補價格：遊戲王配不到單版本 set price 時，顯示標明的「跨版本最低參考價」（只有日版的卡不顯示，也不掛版本對照表）；`ex10` 加入對照表（117 張，28 張 Unown 字母卡在 TCGdex `exu`，未對應）。bwp、sma、basep、30th、30th-c 抽樣來源無價；cel25c、sve 卡號或名稱對不上，需逐卡對應，未做。

- 2026-11-03：價格走勢圖加動畫與互動（`price-timeline.js`）：進場快速掃線、按播放連續前進、價格變動處圓點擴散、範圍／版本切換雙軸滑動、新增「從這天開始比較」區間。底圖與讀數頭分層，播放時不重畫底圖；減少動態時不做動畫。

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

- 2026-10-31 凌晨：查明參考價差異：TCGdex 依地區解析到不同主機，更新時間不同，Render 走北美主機，時價最多可能晚約一天（ADR 0054 末節）。沒有改程式。

- 2026-11-02：免費速度改善：`getCard` 查不在 250 張內的卡時不再複製整包目錄；價格 API 每張卡快取 5 分鐘（有來源失敗不快取）；覆蓋率每小時才重算；覆蓋率、健康檢查、漲跌榜過期 24 小時內先回舊值、背景更新。UptimeRobot 監測早已存在（每 5 分鐘），GitHub keep-warm 實際約 240 分鐘才跑一次，只算備援。

## 下次要確認
- **資料庫容量**：11-02 `VACUUM FULL browse_card_keys_mat` 後 399 MB（原 436 MB，該表 59→22 MB）。重建排序鍵後該表可能再長回 30～40 MB，碰近 440 MB 煞車線時可再做一次（避開每小時 :25，事後補一般 VACUUM）。舊稽核表不能刪：有防竄改觸發器，`pokemon_jp_series_imported` 也會讀。快照保留不能縮成 14 天：`price_movers` 需要 14 天前的起點。
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
