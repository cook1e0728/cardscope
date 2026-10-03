---
status: accepted
---

# 台版系列中文名以台灣官方卡片搜尋的系列清單為準

台版系列名稱來自 Source archive（TCGdex zh-tw）。2026-10-03 以台灣官方卡片搜尋頁（asia.pokemon-card.com/tw/card-search/）的系列勾選清單（`expansionCode` 值與標籤，134 個）逐一比對資料庫 98 個台版系列，發現 4 個名稱錯位：S11（三連音爆→迷途深淵）、SP5（強大→甲賀忍蛙V-UNION）、SVHK（未來密勒頓ex→古代故勒頓ex）、SVHM（閃色寶藏ex→未來密勒頓ex）。卡片內容可佐證：SVHK 為小火馬、吼叫尾等古代系，SVHM 為來電汪、鐵臂膀等未來系。

決定（2026-10-03，使用者授權照建議執行）：台版系列中文名與台灣官方清單不一致時改為官方名稱（去掉「擴充包」「起始組合」等商品類型前綴，與既有寫法一致），舊值記在 series metadata `nameZhBeforeOfficial`，並記錄官方原標籤、依據與規則。由台版連結取得名稱的日版系列（日版 S11）同步更正。

## Consequences

- 證據：`docs/evidence/pokemon-tw/official-expansion-names-20261003.json`。
- 官方清單沒有的 15 個台版系列不變。之後若官方清單更名，以同一方式比對。
