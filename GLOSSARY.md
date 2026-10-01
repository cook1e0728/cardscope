# CardScope

繁體中文玩家的跨語言、跨版本 TCG 查證與收藏探索入口。本詞彙表只定義領域用語，不記錄實作細節。

## Language

**Series（系列）**:
某一 IP、地區、語言下的一個官方發行單位，例如日版 SV4a。同一個系列代碼在不同地區是不同的 Series。
_Avoid_: 彈、set、擴充包（泛稱時）

**Card（卡片）**:
某一 IP 下一張可被辨識的卡，以來源提供的穩定識別碼為身分，不以名稱為身分。
_Avoid_: 單卡、卡牌（泛稱時）

**Printing（版本）**:
一張 Card 在特定語言、地區、系列與編號下的實際印刷版本。稀有度、編號、圖片與來源都屬於 Printing。
_Avoid_: 版別、variant

**Canonical card（作品層卡片）**:
跨語言保存角色與多語名稱的卡片層級。只有官方編號或可靠 Provider ID 能證明兩張 Card 屬於同一個 Canonical card；名稱相似只能當搜尋別名。
_Avoid_: master card、統一卡

**Provider ID（來源識別碼）**:
資料來源為某一筆 Series、Card 或 Printing 給的識別碼，與來源名稱合起來才具唯一性。
_Avoid_: 外部 ID、API ID

**Natural key（自然鍵）**:
不靠系統產生編號、單由資料本身特徵（卡、地區、語言、系列代碼、編號）決定的身分。日版 Printing 以 Provider ID 為主身分，自然鍵只作一致性檢查。
_Avoid_: 業務鍵

**Seed（舊種子資料）**:
未經來源驗證、由人手寫入的早期資料列。Seed 在被來源證據核對前，不視為可靠資料，也不作為匯入的基準。
_Avoid_: 範例資料、測試資料

**Quarantine（隔離）**:
來源資料與既有資料衝突或身分不明時，不匯入也不修改，只留下原因的處置。
_Avoid_: 跳過、過濾

**Metadata pilot（metadata 試點）**:
以單一乾淨 Series 驗證日版匯入機制的第一次真實寫入，只含 Series、Card、Printing 的文字 metadata，不含圖片、價格、商品或猜譯的中文名稱。
_Avoid_: 全量匯入、同步
