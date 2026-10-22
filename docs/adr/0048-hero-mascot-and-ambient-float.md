---
status: accepted
---

# 首頁第一屏吉祥物、緩慢漂浮動畫與活頁卡冊首屏設計

**狀態：已採用（2026-10-22，使用者於多版視覺預覽後確認採用吉祥物持劍兔＋字形 C 昭源圓黑體＋精簡導覽文案＋方案 4＋5 變化 V5 實體活頁打孔卡冊）。延伸 ADR 0047。**

使用者希望首頁第一屏放入吉祥物兔子插畫（`rabbit-explore.webp`），並透過 `taste-skill` 調整首頁標題字形、導覽對齊、簡介文案與卡冊分區質感。

決定：

- **吉祥物配置（`index.html`、`look-clean.css`）**：在 `<section class="hero" id="hero">` 加入 `<figure class="hero-art" aria-hidden="true">`（裝飾性圖片，`alt=""`、`fetchpriority="low"`）；只在 `body[data-view="landing"]` 顯示，其他頁面 `display: none`。桌面（`>760px`）`.hero` 為兩欄 grid，左欄第 1–3 列放標題簡介、搜尋框與範例詞，右欄跨 1–3 列置中擺放 `.hero-art`（寬 240px、`aspect-ratio: 63/88`、`object-fit: cover`、`object-position: 50% 36%`、圓角 12px、3px `#2B2F35` 槍鐵灰卡套框）；手機（`≤760px`）縮為標題上方置中 96px 寬小圖。
- **持續緩慢漂浮（ADR 0047「無新持續動畫」之唯一例外）**：僅對首頁 `.hero-art` 單一裝飾元素套用 `lc-hero-float`（`translateY(0)` ↔ `translateY(-4px)`、6 秒循環 `ease-in-out`），不影響卡片格或文字閱讀；只在 `@media (prefers-reduced-motion: no-preference)` 且 `html:not([data-cs-paused])`（未開啟左下角「暫停動態」開關）時播放。
- **標題字形、導覽對齊與文案**：主標題與區段標題採用 `Chiron GoRound TC`（昭源圓黑體 700）；首頁標題定為「跨版本卡牌圖鑑」，副標定為「直接搜卡名或卡號，或是從下方選一個遊戲開始翻閱；同一張卡的日、台、美版並列對照。」；頂欄 `.nav` 靠右垂直置中對齊，手機底部導覽 `.bottom` 改三欄等寬 grid 與統一 24×24px 圖示盒。
- **首頁 4＋5 變化 V5（實體活頁打孔＋雙色章節書籤）**：首頁採用深炭黑頂欄（`#1F1B16`）與暖石桌面襯底（`#E6DFD3`）；第一屏 `.hero` 與下方 `#channels` 各自成一張圓角活頁卡紙（`#FBF9F4`），左側分別配置 12px 深鐵灰書脊（配活頁打孔圓點與 `#C83E2B` 磚紅搜尋主鍵）與 12px 金黃章節書脊（`#D49B1B`）。

## Consequences

- 主方案第 5 節關於持續動畫的說明新增本例外（首頁 `.hero-art` 緩慢漂浮 4px／6s，受系統減少動態與「暫停動態」開關雙重控制）。
- 桌面 1440px、手機 390px／320px 首頁搜尋框均維持在第一屏且無橫向捲動，文字與按鈕對比符合 WCAG AA。
