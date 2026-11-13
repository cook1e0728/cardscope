// 首頁「最新｜最夯｜最熱」（重新設計 v2，REDESIGN_PLAN 第 3 節）：夜空展示區下方的一組分段按鈕＋三個面板。
// 最新＝原本的 #homeLatest（series-band.js 照舊畫，標記直接放在 index.html 的面板裡）。
// 最夯＝本彈大獎（/api/pack-prizes）：寶可夢、航海王、黑白雙翼各一排，近 90 天最新主流彈的最高稀有度卡；手動置頂排最前。漲跌榜只在行情頁（?view=market），這裡留一個連結。
// 最熱＝/api/hot-cards 近 7 天被開最多次的卡前 12 張；沒有這支 API（404）或還沒有資料時顯示安靜的空白狀態。
(root=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const TABS=['latest','trending','hot'],HOT_LIMIT=12,PICK_WAIT=1200;
  const shared=()=>root.priceMoversShared;
  const gameName=id=>(root.CARD_GAMES||[]).find(game=>game.id===id)?.name||'';
  const cleanHot=body=>(Array.isArray(body?.data)?body.data:[]).filter(row=>row&&typeof row==='object'&&row.cardId).slice(0,HOT_LIMIT);
  const cleanRows=list=>(Array.isArray(list)?list:[]).filter(row=>row&&typeof row==='object'&&row.cardId);
  const cleanPrizes=body=>({pinned:cleanRows(body?.pinned),games:(Array.isArray(body?.games)?body.games:[]).map(g=>({...g,data:cleanRows(g?.data)})).filter(g=>g.data.length),meta:body?.meta||{}});
  const head=(title,note,info)=>`<div class="rails-head"><h3>${title}</h3><div class="title-note"><span class="meta">${note}</span>${info}</div></div>`;
  const quiet=text=>`<p class="rails-note" role="status">${text}</p>`;

  function hotCard(row){
    const name=row.name||row.nameJa||row.cardNumber||'未命名卡片';
    return `<button type="button" class="trend-card" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${shared().image(row.imageUrl,name)}</div>`+
      `<div class="trend-card-head"><b>${esc(name)}</b></div>`+
      `<span class="trend-card-number">${esc([row.seriesCode,row.cardNumber].filter(Boolean).join(' · '))}</span>`+
      `<small>${esc([gameName(row.game),row.seriesName].filter(Boolean).join(' · '))}</small></button>`;
  }
  // hot：undefined＝還在讀；{rows,meta}＝讀完（rows 可能是空的，API 失敗也一樣當空的）
  function hotPanel(hot){
    const meta=hot?.meta||{},days=Number(meta.windowDays)||7,min=Number(meta.minOpens)||0;
    const info=root.infoTip('熱門排行的算法',`<p><b>來源</b>依本站近 ${days} 天卡片被開啟的次數排序，不記錄是誰開的。</p>${min?`<p><b>門檻</b>被開啟至少 ${min} 次才會上榜。</p>`:''}`);
    const body=!hot?quiet('讀取中…'):hot.rows.length?`<div class="rails-rail">${hot.rows.map(hotCard).join('')}</div>`:
      `<div class="rails-empty"><img src="/assets/brand/web/rabbit-offline.webp" alt="" width="128" height="85" loading="lazy"><p>熱門排行統計中，累積幾天後就會出現</p></div>`;
    return head(`近 ${days} 天最多人開的卡`,'本站被開啟次數',info)+body;
  }
  function prizeCard(row){
    const name=row.name||row.cardNumber||'未命名卡片',twd=row.game==='pokemon'?Number(row.referencePrice?.amountTwd):0;
    return `<button type="button" class="trend-card" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${shared().image(row.imageUrl,name)}</div>`+
      `<div class="trend-card-head"><b>${esc(name)}</b></div>`+
      `<span class="trend-card-number">${esc([row.rarity,row.altArt?'異圖':'',row.cardNumber].filter(Boolean).join(' · '))}</span>`+
      `<small>${esc(twd>0?`參考價約 NT$${Math.round(twd).toLocaleString('en-US')}`:[gameName(row.game),row.seriesCode].filter(Boolean).join(' · '))}</small></button>`;
  }
  const prizeRail=(title,rows)=>`<h4 class="rails-sub">${esc(title)}</h4><div class="rails-rail">${rows.map(prizeCard).join('')}</div>`;
  // prizes：undefined＝還在讀；{pinned,games}＝讀完（API 失敗也當空的）
  function trendingPanel(prizes){
    const days=Number(prizes?.meta?.windowDays)||90;
    const info=root.infoTip('本彈大獎怎麼挑',`<p><b>系列</b>寶可夢、航海王、黑白雙翼各取近 ${days} 天最新的主流補充包（不含預組、禮盒、周邊、特典；航海王只看 OP／EB／PRB），優先台灣版。</p><p><b>卡片</b>只列最高稀有度（寶可夢 SAR 以上、航海王 SEC／SP／TR、黑白雙翼 SP 以上），航海王異圖排在原版前；寶可夢有參考價時同稀有度價高的先，參考價不是成交價。</p>`);
    const rows=prizes?[...(prizes.pinned.length?[prizeRail('精選',prizes.pinned)]:[]),...prizes.games.map(g=>prizeRail([gameName(g.game)||g.game,g.seriesName].filter(Boolean).join(' · '),g.data))]:[];
    const body=!prizes?quiet('讀取中…'):rows.length?rows.join(''):quiet('近期沒有新彈的大獎資料');
    return head('本彈大獎','各遊戲最新主流彈的最高稀有度卡',info)+body+'<p class="rails-more"><a href="/?view=market" data-spa>看參考價漲跌</a></p>';
  }
  // 左右鍵在三個分頁間循環，Home／End 到頭尾；其他鍵回 -1。
  const nextTab=(key,index,count)=>key==='ArrowRight'?(index+1)%count:key==='ArrowLeft'?(index+count-1)%count:key==='Home'?0:key==='End'?count-1:-1;

  function init(doc){
    const section=doc.getElementById('homeRails');if(!section||!shared())return;
    // 只認自己的 tablist：#homeLatest 裡還有 series-band.js 的遊戲分頁，也是 role=tab。
    const bar=section.querySelector('.rails-switch'),tabs=[...bar.querySelectorAll('[role="tab"]')],panel=id=>doc.getElementById('railsPanel-'+id);
    let picked=false;const state={};
    // 使用者自己點了分頁就不用再等最熱：立刻解除隱藏（原本要等 /api/hot-cards 或 PICK_WAIT）。
    const select=(id,focus)=>{delete section.dataset.pending;
      tabs.forEach(tab=>{const on=tab.dataset.railsTab===id;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;tab.classList.toggle('on',on);if(on&&focus)tab.focus()});
      TABS.forEach(key=>{const node=panel(key);if(node)node.hidden=key!==id});
    };
    const paint=id=>{const node=panel(id);if(node)node.innerHTML=id==='hot'?hotPanel(state.hot):trendingPanel(state.prizes)};
    paint('hot');paint('trending');
    bar.addEventListener('click',event=>{const tab=event.target.closest('[role="tab"]');if(!tab)return;picked=true;select(tab.dataset.railsTab,false)});
    bar.addEventListener('keydown',event=>{
      const tab=event.target.closest('[role="tab"]'),next=tab?nextTab(event.key,tabs.indexOf(tab),tabs.length):-1;
      if(next<0)return;event.preventDefault();picked=true;select(tabs[next].dataset.railsTab,true);
    });
    const hotReq=(typeof fetch==='function'?fetch('/api/hot-cards').then(response=>response.ok?response.json():null).catch(()=>null):Promise.resolve(null))
      .then(body=>{state.hot={rows:cleanHot(body),meta:body?.meta||{}};paint('hot')});
    (typeof fetch==='function'?fetch('/api/pack-prizes').then(response=>response.ok?response.json():null).catch(()=>null):Promise.resolve(null))
      .then(body=>{state.prizes=cleanPrizes(body);paint('trending')});
    // 預設選「最熱」（有資料時），否則「最新」。等最熱回來再決定（最多 PICK_WAIT 毫秒），免得先亮最新再跳過去；使用者已經自己選了就不動。
    section.dataset.pending='';
    Promise.race([hotReq,new Promise(resolve=>setTimeout(resolve,PICK_WAIT))]).then(()=>{
      if(!picked&&state.hot?.rows.length)select('hot',false);
      delete section.dataset.pending;
    });
  }
  root.homeRails={hotPanel,trendingPanel,nextTab,init};
  if(root.document)init(root.document);
})(window);
