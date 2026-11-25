// 首頁「最新｜最夯｜最熱」（重新設計 v2，REDESIGN_PLAN 第 3 節）：夜空展示區下方三排直接疊著顯示（2026-11-24 拿掉分頁，不用點就看得到大獎與熱門）。
// 最新＝原本的 #homeLatest（series-band.js 照舊畫，標記直接放在 index.html 的面板裡）。
// 最夯＝本彈大獎（/api/pack-prizes）：寶可夢、航海王、黑白雙翼各一排，近 90 天最新主流彈的最高稀有度卡；手動置頂排最前。漲跌榜只在行情頁（?view=market），這裡留一個連結。
// 最熱＝/api/hot-cards 近 7 天被開最多次的卡前 12 張；沒有這支 API（404）或還沒有資料時顯示安靜的空白狀態。
// 榜上有 1–5 張卡（不到一排）時那一排整個不顯示；0 張沿用安靜的空白狀態。
// 大獎與最熱的每張卡右上角有 ☆（和搜尋結果同一套收藏），卡片本身與 ☆ 是兩顆並排的按鈕，不巢狀。
// 寬螢幕（≥1200px）多欄（NEXT_PHASE_PLAN L1）：搜尋區右邊放「漲最多」，榜單右邊放「跌最多」與「卡牌時事」，資料缺了那一塊就退場、另一塊佔滿；手機與窄螢幕不顯示也不請求。
(root=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const HOT_LIMIT=12,MIN_CARDS=6,WIDE='(min-width:1200px)',MOVERS_N=5,EVENTS_N=6;
  const shared=()=>root.priceMoversShared;
  const gameName=id=>(root.CARD_GAMES||[]).find(game=>game.id===id)?.name||'';
  const cleanHot=body=>(Array.isArray(body?.data)?body.data:[]).filter(row=>row&&typeof row==='object'&&row.cardId).slice(0,HOT_LIMIT);
  const cleanRows=list=>(Array.isArray(list)?list:[]).filter(row=>row&&typeof row==='object'&&row.cardId);
  const cleanPrizes=body=>({failed:body===FAILED,pinned:cleanRows(body?.pinned),games:(Array.isArray(body?.games)?body.games:[]).map(g=>({...g,data:cleanRows(g?.data)})).filter(g=>g.data.length),meta:body?.meta||{}});
  const head=(title,note,info,tag='h3')=>`<div class="rails-head"><${tag}>${title}</${tag}><div class="title-note"><span class="meta">${note}</span>${info}</div></div>`;
  const quiet=text=>`<p class="rails-note" role="status">${text}</p>`;
  // 讀取失敗（網路或 5xx）和「真的沒資料」分開：失敗時寫「暫時讀不到」並給重試鈕（體檢 HCI-05）。404＝沒有這支 API，仍當空的。
  const FAILED={failed:true};
  const load=url=>typeof fetch!=='function'?Promise.resolve(null):fetch(url).then(r=>r.ok?r.json():r.status===404?null:FAILED).catch(()=>FAILED);
  const failed=(text,id)=>`<div class="rails-note rails-failed" role="status"><p>${text}</p><button type="button" class="rails-retry" data-rails-retry="${id}">重試</button></div>`;

  // ☆ 的狀態向 ui-enhancements.js 問（還沒載入就當沒收藏）；點下去交給它的 toggleFavorite，收藏變動後它再呼叫 refreshCollect。
  const quantity=id=>Number(root.railCollectQuantity?.(id))||0;
  const collectState=(id,name)=>{const q=quantity(id);return {pressed:String(q>0),label:q?`已收藏：${name}（${q} 張），按一下移除`:`加入我的收藏：${name}`,text:q?'★':'☆',title:q?'已收藏':'加入我的收藏'}};
  const collectBtn=(row,name)=>{const s=collectState(row.cardId,name);return `<button type="button" class="favorite-toggle rail-collect" data-rail-collect="${esc(row.cardId)}" data-rail-name="${esc(name)}" aria-pressed="${s.pressed}" aria-label="${esc(s.label)}" title="${s.title}">${s.text}</button>`};
  const rowsById=new Map();
  const cell=(row,name,inner)=>{rowsById.set(String(row.cardId),row);return `<div class="trend-cell">${inner}${collectBtn(row,name)}</div>`};
  function hotCard(row){
    const name=row.name||row.nameJa||row.cardNumber||'未命名卡片';
    return cell(row,name,`<button type="button" class="trend-card" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${shared().image(row.imageUrl,name)}</div>`+
      `<div class="trend-card-head"><b>${esc(name)}</b></div>`+
      `<span class="trend-card-number">${esc([row.seriesCode,row.cardNumber].filter(Boolean).join(' · '))}</span>`+
      `<small>${esc([gameName(row.game),row.seriesName].filter(Boolean).join(' · '))}</small></button>`);
  }
  // hot：undefined＝還在讀；{rows,meta,failed}＝讀完（failed＝讀取失敗，rows 是空的）
  function hotPanel(hot){
    const meta=hot?.meta||{},days=Number(meta.windowDays)||7,min=Number(meta.minOpens)||0;
    const info=root.infoTip('熱門排行的算法',`<p><b>來源</b>依本站近 ${days} 天卡片被開啟的次數排序，不記錄是誰開的。</p>${min?`<p><b>門檻</b>被開啟至少 ${min} 次才會上榜。</p>`:''}`);
    const body=!hot?quiet('讀取中…'):hot.failed?failed('暫時讀不到熱門排行，請稍後再試。','hot'):hot.rows.length?`<div class="rails-rail">${hot.rows.map(hotCard).join('')}</div>`:
      `<div class="rails-empty"><img src="/assets/brand/web/rabbit-offline.webp" alt="" width="128" height="85" loading="lazy"><p>熱門排行統計中，累積幾天後就會出現</p></div>`;
    return head(`近 ${days} 天最多人開的卡`,'本站被開啟次數',info)+body;
  }
  // 卡號那行可換行（手機上 EB05-006、SFN/S136-002SSP 會被截掉）；遊戲與系列已寫在每排標題，只有「精選」那排才在卡上寫。
  function prizeCard(row,mixed){
    const name=row.name||row.cardNumber||'未命名卡片',twd=row.game==='pokemon'?Number(row.referencePrice?.amountTwd):0;
    return cell(row,name,`<button type="button" class="trend-card" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${shared().image(row.imageUrl,name)}</div>`+
      `<div class="trend-card-head"><b>${esc(name)}</b></div>`+
      // 稀有度與卡號各佔一行（不讓「·」掛在行尾、卡號被擠到下一行）；價格放大加粗，來源寫在下面的小字。
      `<span class="trend-card-number is-wrap"><span class="tc-line">${esc([row.rarity,row.altArt?'異圖':''].filter(Boolean).join(' · '))}</span><span class="tc-line">${esc(row.cardNumber||'')}</span></span>`+
      (twd>0?`<strong class="trend-price">NT$${Math.round(twd).toLocaleString('en-US')}</strong><small>${esc(`${({JP:'日版',TW:'台版',ASIA:'亞洲版'})[row.priceRegion]||''}參考價（約）`)}</small>`:mixed?`<small>${esc([gameName(row.game),row.seriesCode].filter(Boolean).join(' · '))}</small>`:'')+'</button>');
  }
  const prizeRail=(title,rows,mixed=false)=>`<h4 class="rails-sub">${esc(title)}</h4><div class="rails-rail">${rows.map(row=>prizeCard(row,mixed)).join('')}</div>`;
  // prizes：undefined＝還在讀；{pinned,games,failed}＝讀完（failed＝讀取失敗）
  function trendingPanel(prizes){
    const days=Number(prizes?.meta?.windowDays)||90;
    const info=root.infoTip('本彈大獎怎麼挑',`<p><b>系列</b>寶可夢、航海王、黑白雙翼各取近 ${days} 天最新的主流補充包（不含預組、禮盒、周邊、特典；航海王只看 OP／EB／PRB），優先台灣版；台版缺的卡用同一彈日版補上。</p><p><b>卡片</b>只列最高稀有度（寶可夢 SAR 以上、航海王 SEC／SP／TR、黑白雙翼 SP 以上），航海王異圖排在原版前；寶可夢有參考價時同稀有度價高的先；台版沒有參考價時借同卡號日版的價格並標「日版參考價」。參考價不是成交價。</p>`);
    const rows=prizes?[...(prizes.pinned.length?[prizeRail('精選',prizes.pinned,true)]:[]),...prizes.games.map(g=>prizeRail([gameName(g.game)||g.game,g.seriesName].filter(Boolean).join(' · '),g.data))]:[];
    const body=!prizes?quiet('讀取中…'):prizes.failed?failed('暫時讀不到本彈大獎，請稍後再試。','trending'):rows.length?rows.join(''):quiet('近期沒有新彈的大獎資料');
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
      load('/api/market-events').then(body=>{
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
  function init(doc){
    const section=doc.getElementById('homeRails');if(!section||!shared())return;
    const panel=id=>doc.getElementById('railsPanel-'+id);const state={};
    // 榜上只有 1–5 張卡（不到一排）就整排不顯示。0 張沿用安靜的空白狀態。
    const sparse=count=>count>0&&count<MIN_CARDS,prizeCount=prizes=>prizes?prizes.pinned.length+prizes.games.reduce((sum,game)=>sum+game.data.length,0):0;
    const paint=id=>{const node=panel(id);if(!node)return;node.innerHTML=id==='hot'?hotPanel(state.hot):trendingPanel(state.prizes);
      node.hidden=id==='hot'?!!state.hot&&sparse(state.hot.rows.length):!!state.prizes&&sparse(prizeCount(state.prizes))};
    paint('hot');paint('trending');
    section.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-rail-collect]'),row=button&&rowsById.get(button.dataset.railCollect);
      if(row&&typeof root.collectRailCard==='function')root.collectRailCard(row);
    });
    const fetchHot=()=>load('/api/hot-cards').then(body=>{state.hot={rows:cleanHot(body),meta:body?.meta||{},failed:body===FAILED};paint('hot')});
    const fetchPrizes=()=>load('/api/pack-prizes').then(body=>{state.prizes=cleanPrizes(body);paint('trending')});
    fetchHot();fetchPrizes();
    section.addEventListener('click',event=>{
      const id=event.target.closest?.('[data-rails-retry]')?.dataset.railsRetry;if(!id)return;
      const node=panel(id);if(id==='hot'){state.hot=undefined;paint('hot');fetchHot()}else{state.prizes=undefined;paint('trending');fetchPrizes()}
      node?.focus?.(); // 重試鈕被換掉，焦點移到該排，不掉到頁面最上方
    });
    initAside(doc,section);
  }
  // 收藏在別處變動（詳細頁、搜尋結果、雲端同步）後，把首頁每顆 ☆ 的狀態改到最新；就地改屬性，鍵盤焦點不會掉。
  function refreshCollect(doc=root.document){
    for(const button of doc?.querySelectorAll?.('#homeRails [data-rail-collect]')||[]){
      const s=collectState(button.dataset.railCollect,button.dataset.railName||'');
      button.setAttribute('aria-pressed',s.pressed);button.setAttribute('aria-label',s.label);button.title=s.title;button.textContent=s.text;
    }
  }
  root.homeRails={hotPanel,trendingPanel,init,refreshCollect};
  if(root.document)init(root.document);
})(window);
