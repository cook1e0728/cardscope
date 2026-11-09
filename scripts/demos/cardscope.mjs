// CardScope 首頁 → 搜尋建議 → 卡片詳細頁（版本、參考價走勢）→ 遊戲頁系列。正式站、只搜尋不送出任何表單，沒有登入與個資。
const SITE='https://cardscope.onrender.com';
export default {
  start:SITE+'/',
  warm:SITE+'/api/search?limit=1&q=pikachu', // Render 免費方案會休眠，先叫醒
  settle:4000,
  init:"try{localStorage.setItem('cs-tour-done','1')}catch{}", // 跳過首次造訪的三步導覽

  ending:{image:SITE+'/assets/brand/web/rabbit-explore.webp',imgWidth:260,title:'CardScope',subtitle:'跨版本卡牌圖鑑 · Cross-edition TCG catalog'},
  async prime(d){ // 先開一次同一張卡與價格分頁，正式錄影時就不會卡在骨架
    await d.goto(SITE+'/');await d.type('#heroQ','噴火龍SAR',{delay:0});await d.key('Enter');await d.waitFor('#cards .card',{timeout:30000});
    await d.click('#cards .card:nth-child(3) .card-open-hit');await d.waitFor('text:點擊查看此版本的卡圖',{timeout:45000});
    await d.click('#detail [role=tab]:nth-child(2)');await d.waitFor('#detail .ptl-chart',{timeout:30000});
  },
  async run(d){
    d.caption('日版、台版、美版卡牌，一個圖鑑查到底','One catalog for Japanese, Taiwanese and US card editions');
    await d.wait(3200);
    await d.focus('.hero-intro',{pad:120});
    await d.wait(1200);
    d.caption('邊打字邊出建議，卡名後接稀有度也能查','Suggestions as you type, even with a rarity glued to the name');
    await d.type('#heroQ','噴火龍SAR',{delay:160});
    await d.waitFor('#heroQ-suggest li[data-index="0"]:not(.ss-stale)');
    await d.wait(600);
    await d.focus('#heroQ-suggest');
    await d.wait(2600);
    await d.unfocus();
    await d.key('Enter');
    await d.waitFor('#cards .card');
    await d.wait(1500);
    d.caption('「SAR」自動拆成稀有度篩選，日版台版美版一起列','“SAR” becomes a rarity filter; every edition in one list');
    await d.focus('#appliedFilters',{pad:24});
    await d.wait(2400);
    await d.unfocus();
    await d.wait(800);
    await d.click('#cards .card:nth-child(3) .card-open-hit');
    await d.waitFor('text:點擊查看此版本的卡圖',{timeout:30000}); // 詳細頁先出骨架，等真的內容
    await d.wait(1200);
    d.caption('同一張卡的日版、台版並列，點一下就換卡圖','Japanese and Taiwanese editions side by side; tap to swap the art');
    await d.wait(1200);
    await d.click('text:點擊查看此版本的卡圖');
    await d.wait(2800);
    d.caption('價格分頁：歐洲平台參考價的走勢，換算成新台幣','Price tab: European reference prices over time, in NT$');
    await d.click('#detail [role=tab]:nth-child(2)');
    await d.wait(2200);
    await d.waitFor('#detail .ptl-chart',{timeout:30000});
    await d.focus('#detail .ptl-chart',{pad:90});
    await d.hover('#detail .ptl-chart');
    await d.wait(3000);
    await d.unfocus();
    await d.click('#close');
    await d.wait(1200);
    d.caption('也可以從遊戲入口，一個系列一個系列翻','Or browse game by game, one set at a time');
    await d.click('#channels .channel[data-ip="pokemon"]');
    await d.wait(3500);
    await d.focus('#seriesBand');
    await d.wait(2800);
    await d.unfocus();
    await d.scroll(520);
    await d.wait(1500);
    d.caption('點任何一張卡，就能看完整資料與價格','Tap any card for its full details and prices');
    await d.hover('#cards .card');
    await d.wait(2800);
  },
};
