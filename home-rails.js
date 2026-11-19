// 首頁「最新｜最夯｜最熱」（重新設計 v2，REDESIGN_PLAN 第 3 節）：夜空展示區下方的一組分段按鈕＋三個面板。
// 最新＝原本的 #homeLatest（series-band.js 照舊畫，標記直接放在 index.html 的面板裡）。
// 最夯＝本彈大獎（/api/pack-prizes）：寶可夢、航海王、黑白雙翼各一排，近 90 天最新主流彈的最高稀有度卡；手動置頂排最前。漲跌榜只在行情頁（?view=market），這裡留一個連結。
// 最熱＝/api/hot-cards 近 7 天被開最多次的卡前 12 張；沒有這支 API（404）或還沒有資料時顯示安靜的空白狀態。
// 榜上有 1–5 張卡（不到一排）時整個分頁不顯示；0 張沿用安靜的空白狀態。
// 寬螢幕（≥1200px）多欄（NEXT_PHASE_PLAN L1）：搜尋區右邊放「漲最多」，榜單右邊放「跌最多」與「卡牌時事」，資料缺了那一塊就退場、另一塊佔滿；手機與窄螢幕不顯示也不請求。
(root=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const TABS=['latest','trending','hot'],HOT_LIMIT=12,PICK_WAIT=1200,MIN_CARDS=6,WIDE='(min-width:1200px)',MOVERS_N=5,EVENTS_N=6;
  const shared=()=>root.priceMoversShared;
  const gameName=id=>(root.CARD_GAMES||[]).find(game=>game.id===id)?.name||'';
  const cleanHot=body=>(Array.isArray(body?.data)?body.data:[]).filter(row=>row&&typeof row==='object'&&row.cardId).slice(0,HOT_LIMIT);
  const cleanRows=list=>(Array.isArray(list)?list:[]).filter(row=>row&&typeof row==='object'&&row.cardId);
  const cleanPrizes=body=>({pinned:cleanRows(body?.pinned),games:(Array.isArray(body?.games)?body.games:[]).map(g=>({...g,data:cleanRows(g?.data)})).filter(g=>g.data.length),meta:body?.meta||{}});
  const head=(title,note,info,tag='h3')=>`<div class="rails-head"><${tag}>${title}</${tag}><div class="title-note"><span class="meta">${note}</span>${info}</div></div>`;
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
  // 卡號那行可換行（手機上 EB05-006、SFN/S136-002SSP 會被截掉）；遊戲與系列已寫在每排標題，只有「精選」那排才在卡上寫。
  function prizeCard(row,mixed){
    const name=row.name||row.cardNumber||'未命名卡片',twd=row.game==='pokemon'?Number(row.referencePrice?.amountTwd):0;
    return `<button type="button" class="trend-card" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${shared().image(row.imageUrl,name)}</div>`+
      `<div class="trend-card-head"><b>${esc(name)}</b></div>`+
      `<span class="trend-card-number is-wrap">${esc([row.rarity,row.altArt?'異圖':'',row.cardNumber].filter(Boolean).join(' · '))}</span>`+
      (twd>0?`<small>${esc(`${({JP:'日版',TW:'台版',ASIA:'亞洲版'})[row.priceRegion]||''}參考價約 NT$${Math.round(twd).toLocaleString('en-US')}`)}</small>`:mixed?`<small>${esc([gameName(row.game),row.seriesCode].filter(Boolean).join(' · '))}</small>`:'')+'</button>';
  }
  const prizeRail=(title,rows,mixed=false)=>`<h4 class="rails-sub">${esc(title)}</h4><div class="rails-rail">${rows.map(row=>prizeCard(row,mixed)).join('')}</div>`;
  // prizes：undefined＝還在讀；{pinned,games}＝讀完（API 失敗也當空的）
  function trendingPanel(prizes){
    const days=Number(prizes?.meta?.windowDays)||90;
    const info=root.infoTip('本彈大獎怎麼挑',`<p><b>系列</b>寶可夢、航海王、黑白雙翼各取近 ${days} 天最新的主流補充包（不含預組、禮盒、周邊、特典；航海王只看 OP／EB／PRB），優先台灣版；台版缺的卡用同一彈日版補上。</p><p><b>卡片</b>只列最高稀有度（寶可夢 SAR 以上、航海王 SEC／SP／TR、黑白雙翼 SP 以上），航海王異圖排在原版前；寶可夢有參考價時同稀有度價高的先；台版沒有參考價時借同卡號日版的價格並標「日版參考價」。參考價不是成交價。</p>`);
    const rows=prizes?[...(prizes.pinned.length?[prizeRail('精選',prizes.pinned,true)]:[]),...prizes.games.map(g=>prizeRail([gameName(g.game)||g.game,g.seriesName].filter(Boolean).join(' · '),g.data))]:[];
    const body=!prizes?quiet('讀取中…'):rows.length?rows.join(''):quiet('近期沒有新彈的大獎資料');
    return head('本彈大獎','各遊戲最新主流彈的最高稀有度卡',info)+body+'<p class="rails-more"><a href="/?view=market" data-spa>看參考價漲跌</a></p>';
  }
  // ---- 寬螢幕多欄的右側面板 ----
  const cleanMovers=list=>(Array.isArray(list)?list:[]).filter(row=>row&&typeof row==='object'&&row.cardId&&row.from&&row.to);
  const twd=value=>value==null||!Number.isFinite(Number(value))?'—':`NT$ ${Math.round(Number(value)).toLocaleString('en-US')}`;
  // 緊湊一列：小圖、卡名與編號、漲跌幅（文字有 ↑／↓ 與正負號，不只靠顏色）、前後參考價。
  function moverRow(row,up){
    const pct=Math.abs(Number(row.changePercent)).toLocaleString('en-US',{maximumFractionDigits:1}),name=row.name||row.cardNumber||'未命名卡片';
    return `<li><button type="button" class="mover-row" data-do="openCard" data-arg="${esc(row.cardId)}"><span class="mover-img">${shared().image(row.imageUrl,'')}</span>`+
      `<span class="mover-name"><b>${esc(name)}</b><small>${esc([row.seriesCode,row.cardNumber].filter(Boolean).join(' · '))}</small><small>${esc(twd(row.from.amountTwd))} → ${esc(twd(row.to.amountTwd))}</small></span>`+
      `<span class="mover-chg ${up?'is-up':'is-down'}">${up?'↑ +':'↓ -'}${pct}%</span></button></li>`;
  }
  function moversPanel(up,rows,meta,info){
    return head(`近 ${Number(meta.windowDays)||14} 天參考價${up?'漲':'跌'}最多`,'寶可夢，歐洲平台參考價，不是成交價',info,'h2')+`<ul class="mover-list">${rows.slice(0,MOVERS_N).map(row=>moverRow(row,up)).join('')}</ul>`+(up?'':'<p class="panel-more"><a href="/?view=market" data-spa>看完整漲跌榜與時事</a></p>');
  }
  const cleanTitle=value=>String(value??'').replace(/\s*\u2014\s*/g,'：');
  function eventsPanel(rows,today){
    return head('卡牌時事','發售日與官方消息，不代表價格會漲跌','','h2')+`<ul class="event-list">${rows.map(e=>`<li><time datetime="${esc(e.date)}">${esc(e.date.slice(5).replace('-','/'))}${e.date>today?'<span class="soon">即將</span>':''}</time><span>${esc(gameName(e.game)||e.game||'')}｜${esc(cleanTitle(e.title))}</span></li>`).join('')}</ul>`;
  }
  const fill=(node,html)=>{node.hidden=!html;node.innerHTML=html||''};
  function initAside(doc,rails){
    const hero=doc.getElementById('hero');if(!hero||!shared()||!doc.createElement)return;
    const make=(tag,id,label,html)=>{const node=doc.createElement(tag);node.id=id;node.className=tag==='aside'?'home-aside':'home-panel';node.setAttribute('aria-label',label);node.innerHTML=html;node.hidden=true;return node};
    const up=make('section','homeMoversUp','近期參考價漲最多',''),down=make('section','homeMoversDown','近期參考價跌最多',''),events=make('section','homeEvents','卡牌時事','');
    const aside=make('aside','homeAside','參考價跌幅與卡牌時事','');aside.append(up,down,events);rails.after(aside);
    const settle=()=>{aside.hidden=up.hidden&&down.hidden&&events.hidden};
    const start=()=>{
      shared().request().catch(()=>null).then(body=>{
        const list=key=>cleanMovers(body?.data?.[key]),rise=list('up'),fall=list('down'),meta=body?.meta||{},info=rise.length||fall.length?shared().info(rise,fall,meta):'';
        fill(up,rise.length&&moversPanel(true,rise,meta,info));fill(down,fall.length&&moversPanel(false,fall,meta,info));settle();
      });
      (typeof fetch==='function'?fetch('/api/market-events').then(response=>response.ok?response.json():null).catch(()=>null):Promise.resolve(null)).then(body=>{
        const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),all=(Array.isArray(body?.data)?body.data:[]).filter(e=>e&&typeof e.date==='string'&&e.title);
        const rows=root.MarketEvents?root.MarketEvents.arrange(all,today,EVENTS_N):all.slice(0,EVENTS_N);
        fill(events,rows.length&&eventsPanel(rows,today));settle();
      });
    };
    // 窄螢幕不顯示這幾塊，也就不去要資料；視窗之後變寬才開始。
    const wide=root.matchMedia?root.matchMedia(WIDE):null;
    let started=false;const go=()=>{if(!started){started=true;start()}};
    if(!wide||wide.matches)go();else wide.addEventListener('change',()=>{if(wide.matches)go()});
  }
  // 左右鍵在三個分頁間循環，Home／End 到頭尾；其他鍵回 -1。
  const nextTab=(key,index,count)=>key==='ArrowRight'?(index+1)%count:key==='ArrowLeft'?(index+count-1)%count:key==='Home'?0:key==='End'?count-1:-1;

  function init(doc){
    const section=doc.getElementById('homeRails');if(!section||!shared())return;
    // 只認自己的 tablist：#homeLatest 裡還有 series-band.js 的遊戲分頁，也是 role=tab。
    const bar=section.querySelector('.rails-switch'),tabs=[...bar.querySelectorAll('[role="tab"]')],panel=id=>doc.getElementById('railsPanel-'+id);
    let picked=false,current='latest';const state={};
    const shown=()=>tabs.filter(tab=>!tab.hidden);
    // 使用者自己點了分頁就不用再等最熱：立刻解除隱藏（原本要等 /api/hot-cards 或 PICK_WAIT）。
    const select=(id,focus)=>{delete section.dataset.pending;current=id;
      tabs.forEach(tab=>{const on=tab.dataset.railsTab===id;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;tab.classList.toggle('on',on);if(on&&focus)tab.focus()});
      TABS.forEach(key=>{const node=panel(key);if(node)node.hidden=key!==id});
    };
    // 榜上只有 1–5 張卡（不到一排）就整個分頁不顯示；正在看的分頁被藏起來時回到「最新」。0 張沿用安靜的空白狀態。
    const sparse=count=>count>0&&count<MIN_CARDS,prizeCount=prizes=>prizes?prizes.pinned.length+prizes.games.reduce((sum,game)=>sum+game.data.length,0):0;
    const sync=()=>{
      const hide={hot:!!state.hot&&sparse(state.hot.rows.length),trending:!!state.prizes&&sparse(prizeCount(state.prizes))};
      tabs.forEach(tab=>{tab.hidden=!!hide[tab.dataset.railsTab]});
      if(hide[current])select('latest',false);
    };
    const paint=id=>{const node=panel(id);if(node)node.innerHTML=id==='hot'?hotPanel(state.hot):trendingPanel(state.prizes)};
    paint('hot');paint('trending');
    bar.addEventListener('click',event=>{const tab=event.target.closest('[role="tab"]');if(!tab)return;picked=true;select(tab.dataset.railsTab,false)});
    bar.addEventListener('keydown',event=>{
      const tab=event.target.closest('[role="tab"]'),live=shown(),next=tab?nextTab(event.key,live.indexOf(tab),live.length):-1;
      if(next<0)return;event.preventDefault();picked=true;select(live[next].dataset.railsTab,true);
    });
    const hotReq=(typeof fetch==='function'?fetch('/api/hot-cards').then(response=>response.ok?response.json():null).catch(()=>null):Promise.resolve(null))
      .then(body=>{state.hot={rows:cleanHot(body),meta:body?.meta||{}};paint('hot');sync()});
    (typeof fetch==='function'?fetch('/api/pack-prizes').then(response=>response.ok?response.json():null).catch(()=>null):Promise.resolve(null))
      .then(body=>{state.prizes=cleanPrizes(body);paint('trending');sync()});
    // 預設選「最熱」（有資料時），否則「最新」。等最熱回來再決定（最多 PICK_WAIT 毫秒），免得先亮最新再跳過去；使用者已經自己選了就不動。
    section.dataset.pending='';
    initAside(doc,section);
    Promise.race([hotReq,new Promise(resolve=>setTimeout(resolve,PICK_WAIT))]).then(()=>{
      if(!picked&&state.hot?.rows.length>=MIN_CARDS)select('hot',false);
      delete section.dataset.pending;
    });
  }
  root.homeRails={hotPanel,trendingPanel,nextTab,init};
  if(root.document)init(root.document);
})(window);
