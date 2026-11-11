// CardScope 首頁 → 搜尋建議 → 卡片詳細頁（版本、參考價走勢）→ 遊戲頁系列。正式站、只搜尋不送出任何表單，沒有登入與個資。
// 節奏：每個畫面停 1～1.6 秒就換下一個動作；放大不到 1.2 倍的鏡頭不放（看不出來，只像畫面晃）。
const SITE='https://cardscope.onrender.com';
// 每句：字幕中英文＋煤炭講的旁白（和字幕幾乎同一句，只多語氣詞，看字聽聲才對得上）＋講完後的姿勢
const L=[
  {zh:'嗨，我是煤炭！帶你逛逛 CardScope',en:"Hi, I'm Coal! Let me show you around CardScope",say:'嗨！我是煤炭，帶你逛逛 CardScope！',talkAs:'wave'},
  {zh:'日版、台版、美版卡牌，一個圖鑑查到底',en:'One catalog for Japanese, Taiwanese and US card editions',say:'日版、台版、美版卡牌，一個圖鑑查到底！'},
  {zh:'邊打字邊出建議，卡名後接稀有度也能查',en:'Suggestions as you type, even with a rarity glued to the name',say:'邊打字邊出建議，卡名後面接稀有度也能查喔。'},
  {zh:'「SAR」自動變成稀有度篩選，各版本一起列',en:'“SAR” becomes a rarity filter; every edition in one list',say:'SAR 自動變成稀有度篩選，各版本一起列出來。'},
  {zh:'同一張卡的日版、台版並列，點一下就換卡圖',en:'Japanese and Taiwanese editions side by side; tap to swap the art',say:'同一張卡的日版、台版並列，點一下就換卡圖。'},
  {zh:'價格分頁：歐洲參考價走勢，換算成新台幣',en:'Price tab: European reference prices over time, in NT$',say:'價格分頁看歐洲參考價走勢，換算成新台幣囉。'},
  {zh:'也可以從遊戲入口，一個系列一個系列翻',en:'Or browse game by game, one set at a time',say:'也可以從遊戲入口，一個系列一個系列翻。'},
  {zh:'點任何一張卡，就能看完整資料與價格',en:'Tap any card for its full details and prices',say:'點任何一張卡，就能看完整資料和價格。一起來尋寶吧！',pose:'cheer'},
];
const CARD='#cards .card:nth-child(3) .card-open-hit',OTHER='text:點擊查看此版本的卡圖',TAB='#detail [role=tab]:nth-child(2)',READY='#detail:not([aria-busy]) [role=tab]:nth-child(2)'; // 換版本時舊內容會留著變淡，要等忙碌標記拿掉才算載好
export default {
  start:SITE+'/',
  warm:SITE+'/api/search?limit=1&q=pikachu', // Render 免費方案會休眠，先叫醒
  settle:2500,
  init:"try{localStorage.setItem('cs-tour-done','1')}catch{}", // 跳過首次造訪的三步導覽

  lines:L,voice:{name:'zh-TW-YunJheNeural',shift:1.25,tempo:1.12}, // 煤炭是小男生：台灣男聲雲哲升調成男孩聲並加快（樣本 J，口音待使用者審核）
  guide:{dir:'assets/brand/guide'}, // 兔子嚮導姿勢圖（512×512 透明 PNG）：idle、talk-a/b、wave-a/b、point、cheer
  ending:{image:SITE+'/assets/brand/web/rabbit-explore.webp',imgWidth:260,title:'CardScope',subtitle:'跨版本卡牌圖鑑 · Cross-edition TCG catalog'},
  async prime(d){ // 錄影前把要用到的卡、兩個版本、價格分頁都先開過，正式錄影就不會出現骨架畫面
    await d.goto(SITE+'/?q='+encodeURIComponent('噴火龍SAR')); // 預熱不用拍，直接開搜尋網址（極快打字後按 Enter 有時沒送出）
    await d.waitFor('#cards .card',{timeout:30000});
    // 搜尋建議走另一個查詢（fields=suggest），沒熱過會在影片裡卡在「搜尋中…」好幾秒；每個打字中途的字都先查一次
    await d.eval("Promise.all(['噴','噴火','噴火龍','噴火龍S','噴火龍SA','噴火龍SAR'].map(q=>fetch('/api/search?limit=6&fields=suggest&region=all&q='+encodeURIComponent(q)))).then(()=>1)");
    await d.click(CARD);await d.waitFor(OTHER,{timeout:45000});
    await d.click(OTHER);await d.wait(800);await d.waitFor(READY,{timeout:45000});
    await d.click(TAB);await d.waitFor('#detail .ptl-chart',{timeout:30000});
    await d.goto(SITE+'/?game=pokemon');await d.waitFor('#seriesBand',{timeout:30000});
  },
  async run(d){
    await d.caption(L[0]); // 開場在左下角邊揮手邊打招呼
    await d.focus('.hero-intro',{pad:120});
    await d.caption(L[1]); // 這句留在左下角：首頁大圖右邊本來就有一隻兔子，跳過去會疊在一起
    await d.caption(L[2]);
    await d.guide('#heroQ',{side:'right',closest:'form',pose:'point'});
    await d.type('#heroQ','噴火龍SAR',{delay:90});
    await d.waitFor('#heroQ-suggest li[data-index="0"]:not(.ss-stale)');
    await d.wait(900);
    await d.unfocus();
    await d.key('Enter');
    await d.waitFor('#cards .card');
    await d.wait(1000); // 按 Enter 後網站會平滑捲到結果區，捲完才量位置、點卡
    await d.guide('home'); // SAR 標籤會在點卡前被網站捲到標題列下面，站過去會懸在卡片上；這句回左下角
    await d.caption(L[3]);
    await d.wait(1200);
    await d.click(CARD);
    await d.waitFor(OTHER,{timeout:30000});
    await d.guide('#detail',{side:'left',pose:'point',closest:'.dialog'});
    await d.caption(L[4]);
    await d.wait(600);
    await d.click(OTHER);
    await d.wait(400);
    await d.waitFor(READY,{timeout:30000}); // 換版本時詳細頁會先出骨架
    await d.wait(600);
    await d.click(TAB);
    await d.waitFor('#detail .ptl-chart',{timeout:30000});
    await d.wait(900); // 打開分頁會自動播一次走勢，播完再放大
    await d.focus('#detail .ptl-chart',{pad:150});
    await d.guide('#detail .ptl-chart',{side:'left',pose:'point'});
    await d.caption(L[5]);
    await d.hover('#detail .ptl-chart');
    await d.wait(1200);
    await d.unfocus();
    await d.click('#close');
    await d.goto(SITE+'/'); // 回首頁再點遊戲入口；在搜尋結果頁直接捲回去會先閃過時事區
    await d.guide('#channels .channel[data-ip="pokemon"]',{side:'left',pose:'point'});
    await d.caption(L[6]);
    await d.wait(500);
    await d.click('#channels .channel[data-ip="pokemon"]');
    await d.waitFor('#seriesBand');
    await d.guide('home'); // 換頁後原位置變成別的內容，先回左下角
    await d.wait(900);
    await d.scroll(520);
    await d.caption(L[7]);
    await d.hover('#cards .card');
    await d.wait(1000);
  },
};
