// 首頁預覽第 4 版「霓虹展示櫃」：最新動態資訊牌（桌面）／跑馬燈（手機）、標題光澤、首次歡迎卡片、導覽按鈕選中狀態。
// 資料只取自頁面既有 DOM（.band-tile）與 /api/catalog/coverage 的真實回應；拿不到就不顯示。選定後與 previews/ 一起處理。
(()=>{
  if(window.csPreview4)return;window.csPreview4={};
  const root=document.documentElement,KEY='cs-tour-v4-done',$=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||root.hasAttribute('data-cs-paused');
  const done=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
  const markDone=()=>{try{localStorage.setItem(KEY,'1')}catch{}};
  const visible=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const isLanding=()=>document.body?.dataset.view==='landing';
  const safe=fn=>(...a)=>{try{return fn(...a)}catch(e){console.warn('[preview-v4]',e)}};
  let items=[],replayTour=()=>{};

  /* ---------- 1. 導覽按鈕的選中狀態 ---------- */
  const syncNav=safe(()=>{
    const cur={landing:'search',game:'browse'}[document.body.dataset.view];
    $$('[data-nav]').forEach(b=>b.dataset.nav===cur?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  });

  /* ---------- 2. 標題金色光澤（視覺層 aria-hidden，原文字不動） ---------- */
  const initSheen=safe(()=>{
    const h1=$('.hero-intro h1');if(!h1||$('.v4-sheen',h1))return;
    const s=document.createElement('span');s.className='v4-sheen';s.setAttribute('aria-hidden','true');s.innerHTML='<span></span>';
    s.firstChild.textContent=h1.textContent;h1.append(s);
    const fit=()=>h1.style.setProperty('--w',h1.clientWidth+'px');fit();
    if(typeof ResizeObserver==='function')new ResizeObserver(fit).observe(h1);
  });

  /* ---------- 3. 最新系列清單（讀頁面既有 .band-tile） ---------- */
  const readTiles=()=>{
    const seen=new Set();
    return $$('#homeLatestRail .band-tile:not(.is-mascot-new)').map(t=>({
      id:t.dataset.id||'',name:$('.band-tile-name',t)?.textContent.trim()||'',sub:$('.band-tile-code',t)?.textContent.trim()||'',
      flag:$('.band-tile-flag',t)?.textContent.trim()||'',soon:!!$('.band-tile-flag:not(.is-new)',t)
    })).filter(i=>i.name&&!seen.has(i.id+i.name)&&seen.add(i.id+i.name));
  };
  const openSeries=it=>{
    const t=$$('#homeLatestRail .band-tile:not(.is-mascot-new)').find(x=>(it.id&&x.dataset.id===it.id)||$('.band-tile-name',x)?.textContent.trim()===it.name);
    t?.click();
  };
  const flagHtml=it=>it.flag?`<span class="v4-flag${it.soon?' is-soon':''}">${esc(it.flag)}</span>`:'';

  /* ---------- 4. 桌面資訊牌 ---------- */
  let board,stats={},idx=0,hold=false,timer=0,swapTick=0;
  const mkReplay=()=>{const b=document.createElement('button');b.type='button';b.className='v4-replay';b.textContent='重看導覽';b.addEventListener('click',()=>replayTour());return b};
  const initBoard=safe(()=>{
    const ex=$('.home-examples');if(!ex||$('.v4-board'))return;
    board=document.createElement('section');board.className='v4-board';board.hidden=true;board.setAttribute('aria-labelledby','v4BoardT');
    board.innerHTML='<div class="v4-board-head"><span class="v4-led" aria-hidden="true"></span><h2 id="v4BoardT">最新動態</h2></div>'
      +'<dl class="v4-stats" hidden></dl>'
      +'<div class="v4-news" role="group" aria-roledescription="carousel" aria-label="最新系列" hidden>'
      +'<button type="button" class="v4-news-item"></button>'
      +'<div class="v4-news-ctl"><button type="button" class="v4-prev" aria-label="上一個系列">‹</button><span class="v4-news-count" aria-live="off"></span><button type="button" class="v4-nextn" aria-label="下一個系列">›</button></div></div>';
    $('.v4-board-head',board).append(mkReplay());
    ex.after(board);
    const item=$('.v4-news-item',board),news=$('.v4-news',board);
    item.addEventListener('click',()=>items[idx]&&openSeries(items[idx]));
    $('.v4-prev',board).addEventListener('click',()=>step(-1));$('.v4-nextn',board).addEventListener('click',()=>step(1));
    const pause=v=>()=>{hold=v;news.setAttribute('aria-live',v?'polite':'off')};
    news.addEventListener('pointerenter',pause(true));news.addEventListener('pointerleave',()=>{if(!news.contains(document.activeElement))pause(false)()});
    news.addEventListener('focusin',pause(true));news.addEventListener('focusout',e=>{if(!news.contains(e.relatedTarget))pause(false)()});
  });
  const fill=()=>{
    const it=items[idx];if(!it||!board)return;
    $('.v4-news-item',board).innerHTML=`${flagHtml(it)}<span class="v4-news-name">${esc(it.name)}</span>${it.sub?`<span class="v4-news-sub">${esc(it.sub)}</span>`:''}`;
    $('.v4-news-item',board).setAttribute('aria-label',`開啟系列：${it.name}`);
    $('.v4-news-count',board).textContent=`${idx+1} / ${items.length}`;
  };
  const show=n=>{
    if(!items.length||!board)return;
    idx=(n+items.length)%items.length;
    const el=$('.v4-news-item',board),tick=++swapTick;
    if(still()||!visible(el)){fill();return}
    el.classList.add('is-out');
    setTimeout(()=>{if(tick!==swapTick)return;fill();el.classList.remove('is-out');el.classList.add('is-in');requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.remove('is-in')))},160);
  };
  const step=d=>show(idx+d);
  const syncBoard=()=>{
    if(!board)return;
    const hasStats=!$('.v4-stats',board).hidden,hasNews=items.length>0;
    $('.v4-news',board).hidden=!hasNews;
    board.hidden=!(hasStats||hasNews);
    root.classList.toggle('v4-board-on',!board.hidden);
    if(hasNews){idx=Math.min(idx,items.length-1);fill()}
  };

  const countUp=(el,to)=>{
    const out=el.firstChild,fmt=n=>Math.round(n).toLocaleString('en-US');
    if(still()){out.textContent=fmt(to);return}
    const t0=performance.now(),D=700;
    const f=t=>{const p=Math.min(1,(t-t0)/D);out.textContent=fmt(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)};
    out.textContent='0';requestAnimationFrame(f);
  };
  const initStats=safe(async()=>{
    const res=await fetch('/api/catalog/coverage');if(!res.ok)return;
    const d=(await res.json())?.data;if(!d)return;
    const games=d.games&&typeof d.games==='object'?d.games:{};
    const sumSeries=Object.values(games).reduce((a,g)=>a+(Number(g?.totalSeries)||0),0);
    const rows=[['收錄卡數',Number(d.totalCards)],['系列數',Number(d.totalSets)||sumSeries],['遊戲數',Array.isArray(d.coveredGames)?d.coveredGames.length:Object.values(games).filter(g=>g?.cards>0).length]]
      .filter(([,n])=>Number.isFinite(n)&&n>0);
    const dl=board&&$('.v4-stats',board);if(!dl||!rows.length)return;
    dl.innerHTML=rows.map(([l,n])=>`<div><dt>${l}</dt><dd><span aria-hidden="true">0</span><span class="v4-sr">${n.toLocaleString('en-US')}</span></dd></div>`).join('');
    dl.hidden=false;syncBoard();
    $$('dd',dl).forEach((dd,i)=>countUp(dd,rows[i][1]));
  });

  /* ---------- 5. 手機跑馬燈 ---------- */
  let marq;
  const buildMarq=()=>{
    if(!marq)return;
    const set=(hidden)=>`<span class="v4-marq-set"${hidden?' aria-hidden="true" inert':''}>`+items.map(it=>`<button type="button" class="v4-marq-item" data-i="${items.indexOf(it)}"${hidden?' tabindex="-1"':''}>${flagHtml(it)}<span>${esc(it.name)}</span>${it.sub?`<small>${esc(it.sub)}</small>`:''}</button>`).join('')+'</span>';
    $('.v4-marq-track',marq).innerHTML=set(false)+set(true);
    marq.hidden=!items.length;
    marq.style.setProperty('--v4-dur',Math.max(14,items.length*6)+'s');
  };
  const initMarq=safe(()=>{
    if($('.v4-marq'))return;
    const host=$('#mobileQuickGrid')||$('#channels');if(!host)return false;
    marq=document.createElement('section');marq.className='v4-marq';marq.hidden=true;marq.setAttribute('aria-label','最新動態');
    marq.innerHTML='<span class="v4-marq-label"><span class="v4-led" aria-hidden="true"></span>最新</span><div class="v4-marq-view"><div class="v4-marq-track"></div></div>';
    marq.append(mkReplay());
    marq.addEventListener('click',e=>{const b=e.target.closest('.v4-marq-item');if(b)items[+b.dataset.i]&&openSeries(items[+b.dataset.i])});
    host.before(marq);buildMarq();return true;
  });

  const refresh=safe(()=>{items=readTiles();syncBoard();buildMarq()});
  let refreshQ=0;const queueRefresh=()=>{cancelAnimationFrame(refreshQ);refreshQ=requestAnimationFrame(refresh)};

  /* ---------- 6. 首次歡迎卡片 ---------- */
  const SLIDES=[
    {sign:'⌕',t:'先搜尋卡名或卡號',d:'在搜尋框輸入卡名、卡號或系列，同一張卡的日、台、美版會並列對照。',target:()=>[$('#homeSearch'),$('header .search')]},
    {sign:'▣',t:'選一個遊戲開始翻閱',d:'點選遊戲入口，進入該作品的圖鑑，再依系列與稀有度慢慢翻閱。',target:()=>[$('#channels'),$('#mobileQuickGrid')]},
    {sign:'✦',t:'看看最新發售的系列',d:'最新系列會列出剛發售與即將發售的卡表，點一下就能翻閱整個系列。',target:()=>[$('#homeLatest')]},
    {sign:'★',t:'把喜歡的卡收進我的收藏',d:'在卡片上加入收藏，之後從「我的收藏」一次查看。',target:()=>[$('nav.bottom [data-nav="collection"]'),$('header.top [data-nav="collection"]')]}
  ];
  let tour,slide=0,prevFocus=null,awayTimer=0,flashEl=null,flashTimer=0;
  const targetOf=i=>SLIDES[i].target().find(visible);
  const flash=el=>{
    clearTimeout(flashTimer);flashEl?.classList.remove('v4-flash');flashEl=el;
    el.scrollIntoView({block:'center',behavior:still()?'auto':'smooth'});el.classList.add('v4-flash');
    flashTimer=setTimeout(()=>{el.classList.remove('v4-flash');if(flashEl===el)flashEl=null},2400);
  };
  const render=dir=>{
    const s=SLIDES[slide],last=slide===SLIDES.length-1,body=$('.v4-slide',tour);
    body.className='v4-slide'+(dir&&!still()?(dir>0?' is-fwd':' is-back'):'');
    body.innerHTML=`<div class="v4-sign" aria-hidden="true">${s.sign}</div><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p>${targetOf(slide)?'<button type="button" class="v4-show">帶我看</button>':''}`;
    $('.v4-card-kicker',tour).textContent=`${slide+1} / ${SLIDES.length}`;
    $$('.v4-dot',tour).forEach((d,i)=>i===slide?d.setAttribute('aria-current','step'):d.removeAttribute('aria-current'));
    $('.v4-back',tour).disabled=slide===0;$('.v4-fwd',tour).disabled=last;
    $('.v4-next',tour).textContent=last?'開始使用':'下一步';
  };
  const go=n=>{if(n<0||n>=SLIDES.length||n===slide)return;const d=n-slide;slide=n;render(d)};
  const away=()=>{
    const el=targetOf(slide);if(!el)return;
    tour.classList.add('is-away');flash(el);
    const back=()=>{clearTimeout(awayTimer);removeEventListener('pointerdown',back,true);removeEventListener('keydown',back,true);tour.classList.remove('is-away');$('.v4-show',tour)?.focus({preventScroll:true})};
    awayTimer=setTimeout(back,2400);setTimeout(()=>{addEventListener('pointerdown',back,true);addEventListener('keydown',back,true)},60);
  };
  const close=(mark=true)=>{
    if(!tour)return;
    if(mark)markDone();
    clearTimeout(awayTimer);tour.remove();tour=null;removeEventListener('keydown',onKey,true);
    const back=prevFocus&&document.contains(prevFocus)&&prevFocus!==document.body?prevFocus:$('#main');
    back?.focus({preventScroll:true});prevFocus=null;
  };
  const onKey=e=>{
    if(!tour)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}
    if(tour.classList.contains('is-away'))return;
    if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();go(slide+1);return}
    if(e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();go(slide-1);return}
    if(e.key==='Tab'){
      const f=$$('button:not(:disabled)',tour).filter(visible);if(!f.length)return;
      const a=document.activeElement,i=f.indexOf(a);
      if(e.shiftKey&&(i<=0)){e.preventDefault();f[f.length-1].focus()}
      else if(!e.shiftKey&&(i===f.length-1||i<0)){e.preventDefault();f[0].focus()}
    }
  };
  const openTour=safe(()=>{
    if(tour||!isLanding())return;
    prevFocus=document.activeElement;slide=0;
    tour=document.createElement('div');tour.className='v4-tour';
    tour.innerHTML='<div class="v4-card" role="dialog" aria-modal="true" aria-labelledby="v4TourT">'
      +'<p class="v4-card-kicker"></p><h2 id="v4TourT">歡迎來到 CardScope</h2>'
      +'<div class="v4-slide" aria-live="polite"></div>'
      +'<div class="v4-pager"><button type="button" class="v4-arrow v4-back" aria-label="上一張">‹</button>'
      +SLIDES.map((_,i)=>`<button type="button" class="v4-dot" aria-label="第 ${i+1} 張，共 ${SLIDES.length} 張" data-i="${i}"></button>`).join('')
      +'<button type="button" class="v4-arrow v4-fwd" aria-label="下一張">›</button></div>'
      +'<div class="v4-foot"><button type="button" class="v4-skip">略過導覽</button><button type="button" class="v4-next">下一步</button></div></div>';
    document.body.append(tour);
    tour.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.classList.contains('v4-back'))go(slide-1);
      else if(b.classList.contains('v4-fwd'))go(slide+1);
      else if(b.classList.contains('v4-dot'))go(+b.dataset.i);
      else if(b.classList.contains('v4-show'))away();
      else if(b.classList.contains('v4-skip'))close();
      else if(b.classList.contains('v4-next'))slide===SLIDES.length-1?close():go(slide+1);
    });
    addEventListener('keydown',onKey,true);
    render(0);
    $('.v4-next',tour).focus({preventScroll:true});
  });
  replayTour=()=>{if(tour)return;try{openTour()}catch{}};

  /* ---------- 啟動 ---------- */
  const start=()=>{
    syncNav();initSheen();initBoard();initStats();
    // 手機快速入口由 ui-enhancements 建立，可能晚於本檔
    if(initMarq()===false||!$('.v4-marq')){const ob=new MutationObserver(()=>{if(initMarq()!==false&&$('.v4-marq'))ob.disconnect()});ob.observe($('#hero')||document.body,{childList:true,subtree:true});setTimeout(()=>ob.disconnect(),10000)}
    refresh();
    const rail=$('#homeLatestRail');if(rail&&typeof MutationObserver==='function')new MutationObserver(queueRefresh).observe(rail,{childList:true,subtree:true});
    if(typeof MutationObserver==='function')new MutationObserver(()=>{syncNav();if(!isLanding())close()}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
    clearInterval(timer);
    timer=setInterval(()=>{if(!hold&&!document.hidden&&!still()&&board&&!board.hidden&&visible(board)&&items.length>1)step(1)},3000);
    if(!done())setTimeout(()=>{if(!done())openTour()},1200);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
