# CardScope 兔子角色規格（唯一素材來源）

網站、示範影片、社群圖或之後任何地方要用到兔子，都只用本頁列的檔案；要新姿勢就照「新增姿勢」流程，從這些參考圖生成。
不要另外找圖、重畫，也不要讓生成工具「自由發揮」角色外觀。對照表：`assets/brand/rabbit-model-sheet.jpg`。

## 角色設定
- 名字：**煤炭**（英文 Coal），**男生**。自稱「我是煤炭」，口吻是活潑的小男孩嚮導。
- 聲音：**台灣口音**男孩聲（不要大陸口音），像爆紅的 AI 小貓影片那種奶音。目前用剪映專業版「文本朗讀」的「萌娃」音色（免費、不用 VIP）逐句產生，存在 `assets/brand/voice/mengwa/`（第 n 句＝`n.wav`），錄影時加速 1.15 倍；口音待使用者審核。本機開源方案（2026-11-12 試聽中）：BreezyVoice 唸台灣腔 → Seed-VC 換成 Qwen3-TTS 設計的童聲，工具與作法在專案外的 `C:\Users\99wye\voice-lab\README.md`；選定後把 8 句放進 `assets/brand/voice/<名稱>/n.wav`、腳本 `voice.dir` 指過去即可。備案：edge-tts `zh-TW-YunJheNeural` 升調 1.25 倍、加速 1.12 倍（樣本 J）。
- 重做剪映旁白：新草稿加一段文字 → 貼一句台詞 → 「朗讀」分頁搜「萌娃」選取 → 開始朗讀，音檔會出現在 `%LOCALAPPDATA%\JianyingPro\User Data\Cache\ttsTemp\`（最新的那個）；一次只放一句，整段 8 句一起唸會卡住不回。

## 角色外觀（每張都要符合）
- 黑色兔子，毛色帶深灰層次；耳朵直立、內耳粉紅；粉紅小鼻子；大而亮的深色眼睛，有白色反光點。
- 紫色項圈，正中一顆**發光的白色四角星吊墜**（最好認的特徵，不能少）。
- 斜背一把**星空紋紫藍色長劍**（劍柄在右肩上方、劍身往左下）；**金框紫色寶箱**（側背或後背），寶箱面有紫色漩渦紋。
- 像素畫風格，邊緣硬、不羽化；去背版本有一圈淺灰外框光暈。
- 場景色：宇宙紫（#1B1733 系）、星點、銀河。網站淺色頁面上用去背版本。
- 不加文字、浮水印或其他角色。

## 檔案與用途
| 檔案 | 用途 |
|---|---|
| `assets/brand/rabbit-hero.jpg`（web：`rabbit-hero.webp`） | 首頁主視覺、社群分享預設圖（`providers/seo.mjs`） |
| `assets/brand/rabbit-hero-mobile.jpg` | 手機首頁主視覺 |
| `assets/brand/rabbit-explore.jpg` | 跳躍探索；首頁展示區、示範影片片尾 |
| `assets/brand/rabbit-success.jpg` | 加入收藏成功提示 |
| `assets/brand/rabbit-profile.jpg` | 頭像、底部導覽「我的」 |
| `assets/brand/rabbit-offline.png` | 離線頁（`sw.js`） |
| `assets/brand/rabbit-silhouette.jpg`、`cardscope-rabbit-mark.png` | 剪影標誌、「全部遊戲」圖示、PWA 圖示來源 |
| `assets/brand/guide/*.png` | 嚮導姿勢（512×512 透明 PNG，同一裁切框，換姿勢不會跳）：`wave-a/b` 揮手兩格、`talk-a/b` 說話閉口／開口、`idle`（＝talk-a 複本）、`point` 指向右邊、`cheer` 雙手歡呼；`hop-1`～`hop-4` 側面四腳跳躍（蹲、蹬、騰空、落地＝蹲的複本），已縮到 80% 和坐姿同大小，缺淺灰外框 |

網頁實際載入的是 `assets/brand/web/` 的縮圖與 webp；原圖改了要重新輸出那裡的檔案。

## 新增姿勢（例如：思考、驚訝、拿放大鏡）
1. 交給 agy 的 `image-generator`，參考圖給 `rabbit-explore.jpg`、`rabbit-hero.jpg` 和 `guide/talk-a.png`；提示詞照抄「角色外觀」一節，加上：坐姿、身體 3/4 朝右、全身、純 #00FF00 綠幕背景、和 talk-a 同大小同位置。同一動作的第二格要「以第一格為底圖編輯」。
2. agy 的生圖只能存在它自己的 brain 資料夾，把原圖複製出來後用 `python scripts/rabbit-key.py <輸出資料夾> 原圖...` 去背：硬邊去背、去綠溢色，所有圖共用一個裁切框，輸出 512×512。
3. 和 `rabbit-model-sheet.jpg` 並排檢查：項圈星星、劍、寶箱都在，劍不要一張背著一張咬著（會在動畫裡跳位置）。
4. 新姿勢加進本頁表格，並更新對照表。

## 示範影片的嚮導
- 開關與位置：腳本的 `guide:{dir:'assets/brand/guide',size,x,bottom}`；時間軸在 `scripts/guide-track.mjs`。
- 動作：開場從下方滑入、揮手時一跳一跳；平常上下輕晃、左右擺 ±2.5°；每句字幕開頭說話，講到旁白結束；`pose:'point'|'cheer'` 指定講完的姿勢。
- 跟著操作跳：`d.guide(選擇器,{side:'left'|'right',pose,closest})` 跳到元素旁，`d.guide('home')` 回左下角。像真兔子沿地面一蹬一蹬（每跳約 220px、0.28 秒，四格步態），途中面向前進方向、落地後面向元素。落點由 `placeGuide` 挑：避開目標元素、底部字幕、游標，擋到就換另一側或上下。大小預設 320px（輸出 1920 寬）。換頁或捲動後原落點會變成別的內容，要先 `d.guide('home')`。
- 聲音：腳本的 `voice`（見「角色設定」；`dir` 用現成音檔，`shift` 是 edge-tts 的升調倍率）；`DEMO_VOICE=...` 可臨時換。台詞寫在每句的 `say`，和字幕幾乎同一句（看字聽聲才對得上），開場先打招呼。
