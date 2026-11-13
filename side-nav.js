// 重新設計 v2 階段 2：外框骨架（左側欄；手機是從底部拉起的選單）。ADR 0056、docs/REDESIGN_PLAN.md 第 2、6 節。
// 不重寫資料流程：把既有的遊戲列（#channels）、系列橫幅（#seriesBand 與它的錨點 #gameContext）、版本選單（.browse-regions）
// 整塊搬進同一個 <aside id="sideNav">；點選、重繪、網址（navigation-state.js）都還是原來那幾個函式，這支只管位置、收合、開關與焦點。
// 三種模式（界線與 look-v2.css 第 9 節的 media query 同一組）：inline（≥1000px 且高 ≥501px，固定在左、可收合）、
// drawer（761–999px 或矮視窗，從左側滑出，有遮罩）、sheet（≤760px，從底部拉起）。overlay 模式開著時加 .open，焦點鎖／回復交給 dialog-focus.js。
(function(scope){
  'use strict';
  const COLLAPSE_KEY='cardscope-side-collapsed';
  const sideMode=(width,height)=>width<=760?'sheet':width>=1000&&height>=501?'inline':'drawer';
  // 側欄在遊戲頁、全部遊戲的搜尋結果、我的收藏（收藏篩選）出現；首頁 landing、行情與 about／privacy 維持滿版
  const sideState=(view,hasResults)=>view==='game'?'game':view==='collection'?'collection':view==='landing'&&hasResults?'results':'';
  // localStorage 在無痕、封鎖網站資料時會丟例外：讀不到就當展開、寫不進去就只在這個分頁記
  const collapsedStore=storage=>({
    read(){try{return storage.getItem(COLLAPSE_KEY)==='1'}catch{return false}},
    write(on){try{if(on)storage.setItem(COLLAPSE_KEY,'1');else storage.removeItem(COLLAPSE_KEY)}catch{}}
  });
  // 系列橫幅整塊重繪時焦點會掉到 body：記下焦點在哪個項目，重繪後放回同一個
  const focusKey=el=>{
    const data=el?.dataset||{},has=name=>data[name]!==undefined,classes=el?.classList;
    if(classes?.contains('channel')&&data.ip)return`ip:${data.ip}`;
    if(has('bandTab'))return`tab:${data.bandTab}`;
    if(has('region'))return`region:${data.region}`;
    if(has('searchRegion'))return`search-region:${data.searchRegion}`;
    if(classes?.contains('band-tile')&&data.id)return`tile:${data.kind}:${data.id}`;
    if(classes?.contains('series-band-filter'))return'filter';
    if(has('bandExpand'))return'expand';
    if(has('bandMore'))return'more';
    return'';
  };
  const keySelector=key=>{
    const [type,...rest]=key.split(':'),value=rest.join(':'),q=s=>String(s).replace(/["\\]/g,'\\$&');
    if(type==='ip')return`.channel[data-ip="${q(value)}"]`;
    if(type==='tab')return`[data-band-tab="${q(value)}"]`;
    if(type==='region')return`[data-region="${q(value)}"]`;
    if(type==='search-region')return`[data-search-region="${q(value)}"]`;
    if(type==='tile'){const [kind,...id]=rest;return`.band-tile[data-kind="${q(kind)}"][data-id="${q(id.join(':'))}"]`}
    return{filter:'.series-band-filter',expand:'[data-band-expand]',more:'[data-band-more]'}[type]||'';
  };
  scope.CardScopeSide={sideMode,sideState,collapsedStore,focusKey,keySelector,COLLAPSE_KEY};

  const doc=scope.document;
  const side=doc?.getElementById('sideNav');
  if(!side||side.dataset.ready)return;
  side.dataset.ready='1';
  const $=id=>doc.getElementById(id),root=doc.documentElement,body=doc.body,main=$('main'),topBar=doc.querySelector('header.top');
  const scrim=$('sideScrim'),toggle=$('sideToggle'),closeBtn=$('sideClose'),menuBtn=$('sideMenuBtn'),sheetBtn=$('sideSheetBtn');
  let storage;try{storage=scope.localStorage}catch{}// 封鎖網站資料時，連讀取 localStorage 這個屬性都會丟例外
  const store=collapsedStore(storage||{getItem(){throw Error('no storage')}});
  const mql=q=>typeof scope.matchMedia==='function'?scope.matchMedia(q):{matches:false,addEventListener(){}};
  const mqPhone=mql('(max-width:760px)'),mqInline=mql('(min-width:1000px) and (min-height:501px)');
  const mode=()=>mqPhone.matches?'sheet':mqInline.matches?'inline':'drawer';
  const sideOn=()=>Boolean(body.dataset.side);
  // 手機的選單在任何頁都能開（首頁沒有側欄，選單裡只有遊戲）；其他寬度只在遊戲頁與搜尋結果
  const usable=()=>sideOn()||mode()==='sheet';
  const isOpen=()=>side.classList.contains('open');
  let opener=null;

  // ---- 搬位置：每個節點只留一處。首頁（桌機）的遊戲列與版本選單留在夜空展示區，進內頁才搬進側欄 ----
  const slots={games:$('sideGames'),region:$('sideRegion'),series:$('sideSeries')},homes=new Map();
  function place(el,slot,want){
    if(!el||!slot)return;
    if(want){
      if(el.parentNode===slot)return;
      if(!homes.has(el)){const mark=doc.createComment('side-home');el.before(mark);homes.set(el,mark)}
      slot.append(el);
    }else if(homes.has(el)&&el.parentNode===slot){homes.get(el).before(el)}
  }
  function dock(){
    place($('channels'),slots.games,usable()&&body.dataset.side!=='collection');
    place(doc.querySelector('.browse-regions'),slots.region,body.dataset.side==='results');
    // #gameContext 是 series-band.js 放系列橫幅的錨點（anchor.after(band)）：搬一次，橫幅之後重建也都落在側欄裡
    const anchor=$('gameContext');if(anchor&&anchor.parentNode!==slots.series)slots.series.prepend(anchor);
    // 系列資料比本腳本早到時，橫幅已經接在舊位置的錨點後面：跟著錨點搬過來，否則側欄沒有版本與系列
    const band=$('seriesBand');if(anchor&&band&&anchor.nextElementSibling!==band)anchor.after(band);
  }

  // ---- 狀態：body[data-side]、收合、開關 ----
  const setTop=()=>{if(topBar)root.style.setProperty('--side-top',Math.round(topBar.getBoundingClientRect().height)+'px')};
  function reflectCollapse(){
    const collapsed=root.dataset.sideCollapsed==='1';
    if(!toggle)return;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-label',collapsed?'展開目錄':'收合目錄');
    const text=toggle.querySelector('.side-toggle-text');if(text)text.textContent=collapsed?'展開目錄':'收合目錄';
  }
  function reflectOpen(){
    const open=isOpen(),m=mode(),overlay=m!=='inline';
    scrim?.setAttribute('aria-hidden','true');
    // overlay 模式才是對話框；inline 只是一塊導覽
    if(overlay){side.setAttribute('role','dialog');side.setAttribute('aria-modal','true')}else{side.removeAttribute('role');side.removeAttribute('aria-modal')}
    root.classList.toggle('side-open',open&&m==='sheet');
    const openers=[menuBtn,sheetBtn,...doc.querySelectorAll('nav.bottom [data-nav="browse"], header.top .nav [data-nav="browse"]')].filter(Boolean);
    for(const button of openers){
      // 頂欄與底部導覽的「圖鑑」只有在會開選單的模式才帶 aria-expanded（桌機內嵌側欄時它是跳到側欄）
      const popup=button===menuBtn||button===sheetBtn||(overlay&&usable());
      if(popup){button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','sideNav');button.setAttribute('aria-expanded',String(open&&(button===opener||(button.dataset.nav==='browse'&&opener?.dataset?.nav==='browse'))))}
      else if(button.dataset.nav){button.removeAttribute('aria-haspopup');button.removeAttribute('aria-controls');button.removeAttribute('aria-expanded')}
    }
  }
  function open(from){
    if(!usable()||mode()==='inline')return false;
    opener=from||doc.activeElement;
    side.classList.add('open');reflectOpen();return true;
  }
  function close(){
    if(!isOpen())return;
    side.classList.remove('open');reflectOpen();
  }
  function syncSide(){
    const results=Boolean($('cardsSection')?.classList.contains('has-results')),next=sideState(body.dataset.view,results);
    if(next)body.dataset.side=next;else delete body.dataset.side;
    dock();
    if(isOpen()&&(!usable()||mode()==='inline'))close();
    reflectOpen();refreshContext();
  }

  // 手機上「選系列」鈕顯示現在的位置，不用打開選單就知道在哪
  function refreshContext(){
    const label=$('sideSheetCtx');if(!label)return;
    if(body.dataset.view==='collection'){label.textContent=scope.collectionFilterLabel?.()||'全部收藏';const head=doc.querySelector('.side-sheet-label');if(head)head.textContent='篩選收藏';return}
    const head=doc.querySelector('.side-sheet-label');if(head)head.textContent='選系列';
    const game=(scope.CARD_GAMES||[]).find(item=>item.id===body.dataset.game),select=$('browseRegion'),region=select&&select.value!=='all'?select.selectedOptions?.[0]?.textContent:'',title=$('selectedProduct')?.querySelector('h2')?.textContent;
    label.textContent=[game?.name,region,title].filter(Boolean).join('・');
  }

  // ---- 系列橫幅：加上「版本」「系列」小標，目前的版本標 aria-current（版本按鈕原本只有 aria-pressed） ----
  const heading=text=>{const h=doc.createElement('h3');h.className='side-h side-h-sub';h.textContent=text;return h};
  function decorate(){
    const band=$('seriesBand');if(!band)return;
    const regions=band.querySelector('.series-band-head .series-band-regions');
    if(regions&&!band.querySelector('.side-h-sub')){
      regions.before(heading('版本'));
      (band.querySelector('.series-band-tools')||band.querySelector('.series-band-tabs'))?.before(heading('系列'));
    }
    // 商品分類在同一排分頁的後半（series-band.js 標在第一個商品分頁上）：前面插一個不可讀的小標，換到新的一行
    const firstProduct=band.querySelector('.series-band-tabs .starts-eras');
    if(firstProduct&&!band.querySelector('.side-tab-label')){const label=doc.createElement('span');label.className='side-tab-label';label.setAttribute('aria-hidden','true');label.textContent='商品';firstProduct.before(label)}
    band.querySelectorAll('.series-band-head .series-band-regions button').forEach(button=>{
      if(button.classList.contains('on'))button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    });
  }

  // ---- 焦點：重繪後放回原處 ----
  let lastKey='',lastAt=0;
  const remember=el=>{const key=focusKey(el);if(key){lastKey=key;lastAt=Date.now()}};
  side.addEventListener('focusin',event=>remember(event.target));
  side.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')remember(event.target.closest?.('button,input,a,select')||event.target)});
  doc.addEventListener('pointerdown',event=>{if(!side.contains(event.target))lastKey=''});
  doc.addEventListener('focusin',event=>{if(!side.contains(event.target))lastKey=''});
  function restoreFocus(){
    if(!lastKey||Date.now()-lastAt>15000||(doc.activeElement&&doc.activeElement!==body))return;
    const selector=keySelector(lastKey),el=selector&&side.querySelector(selector);
    if(el&&el.getClientRects().length)el.focus({preventScroll:true});
  }

  // ---- 事件 ----
  toggle?.addEventListener('click',()=>{
    const collapsed=root.dataset.sideCollapsed!=='1';
    if(collapsed)root.dataset.sideCollapsed='1';else delete root.dataset.sideCollapsed;
    store.write(collapsed);reflectCollapse();
  });
  closeBtn?.addEventListener('click',close);
  scrim?.addEventListener('click',close);
  for(const button of [menuBtn,sheetBtn])button?.addEventListener('click',()=>{if(isOpen())close();else open(button)});
  // overlay 模式選了系列／商品、或回到「全部遊戲」就收起來（選遊戲、版本、分類時留著，讓人接著挑系列）
  side.addEventListener('click',event=>{
    if(mode()==='inline')return;
    if(event.target.closest?.('.band-tile,.channel[data-ip="all"],.coll-side-btn'))close();
  });
  doc.addEventListener('keydown',event=>{
    // 篩選欄的 Esc 先清掉字（它自己 preventDefault），ⓘ 說明的 Esc 由 ui-actions.js 先處理
    if(event.key!=='Escape'||event.defaultPrevented||!isOpen())return;
    event.preventDefault();close();
  });
  // 「圖鑑」：手機開選單；桌機在遊戲頁跳到側欄（收合著就先展開）；首頁沒有側欄，交回 game-switcher.js 原本的捲動
  doc.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-nav="browse"]');if(!button)return;
    if(['collection','market'].includes(body.dataset.view))return;// 這兩頁的「圖鑑」回首頁（game-switcher.js）
    const m=mode();
    if(m==='sheet'||(m==='drawer'&&sideOn())){event.stopImmediatePropagation();if(isOpen())close();else open(button);return}
    if(m==='inline'&&sideOn()){
      event.stopImmediatePropagation();
      if(root.dataset.sideCollapsed==='1')toggle?.click();
      (side.querySelector('.channel.on')||side.querySelector('.channel'))?.focus();
    }
  },true);
  // 窗寬改變：進入 inline 就把開著的選單收起來；模式不同，角色與 aria 也要跟著換
  for(const query of [mqPhone,mqInline])query.addEventListener?.('change',()=>{syncSide();setTop()});

  // 版本選單、遊戲、系列變動時同步（網址還原、上一頁都會走到 choose／render，不必另外處理）
  const watch=(node,options)=>{if(node&&typeof scope.MutationObserver==='function')new scope.MutationObserver(()=>{syncSide()}).observe(node,options)};
  watch(body,{attributes:true,attributeFilter:['data-view','data-game']});
  watch($('cardsSection'),{attributes:true,attributeFilter:['class']});
  if(typeof scope.MutationObserver==='function'){
    const sideBody=$('sideBody');
    if(sideBody)new scope.MutationObserver(()=>{decorate();restoreFocus()}).observe(sideBody,{childList:true,subtree:true});
    const picked=$('selectedProduct');if(picked)new scope.MutationObserver(refreshContext).observe(picked,{childList:true,subtree:true});
  }
  doc.addEventListener('cardscope:browse',refreshContext);
  $('browseRegion')?.addEventListener('change',refreshContext);
  if(typeof scope.ResizeObserver==='function'&&topBar)new scope.ResizeObserver(setTop).observe(topBar);

  // overlay 模式的焦點鎖、Tab 循環與關閉後回到開啟它的按鈕，沿用卡片詳細視窗那一份（dialog-focus.js，看的是 .open）
  scope.installDialogFocus?.(side,{doc,initialFocus:()=>side.querySelector('.channel.on')||closeBtn,returnTarget:()=>opener});

  reflectCollapse();syncSide();setTop();decorate();
  scope.cardscopeSideNav={open,close,isOpen,mode,refresh:refreshContext};
})(window);
