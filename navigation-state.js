(()=>{
  // Same page size as index.html's CARDS_PAGE_SIZE (the first screen is 48 cards).
  const PAGE_SIZE=typeof CARDS_PAGE_SIZE==='number'?CARDS_PAGE_SIZE:48;
  const allowedGames=new Set(['all','pokemon','onepiece','yugioh','haikyuu','weiss-schwarz']);
  const allowedRegions=new Set(['all','JP','TW','US','CN','KR','ASIA']);
  const allowedSorts=new Set(['number-asc','number-desc','rarity-desc','rarity-asc','price-asc','price-desc','release-desc']);
  const allowedPrices=new Set(['all','priced','unpriced']);
  let restoring=false;

  const node=id=>document.getElementById(id);
  const clean=value=>String(value||'').trim();
  const number=(value,fallback=0)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:fallback};
  const activeCardId=()=>{
    try{return typeof activeDetailCardId!=='undefined'?activeDetailCardId:window.activeDetailCardId}
    catch{return window.activeDetailCardId}
  };
  const currentCardId=()=>clean(activeCardId()||document.querySelector('#modal.open [data-card-id]')?.dataset.cardId);
  const waitFor=(predicate,timeout=10000)=>new Promise((resolve,reject)=>{const started=Date.now(),tick=()=>{if(predicate())return resolve();if(Date.now()-started>=timeout)return reject(new Error('STATE_RESTORE_TIMEOUT'));setTimeout(tick,40)};tick()});

  function clearActiveDetailCard(){
    try{if(typeof activeDetailCardId!=='undefined')activeDetailCardId=null}catch{}
    if('activeDetailCardId'in window)window.activeDetailCardId=null;
  }

  function closeDetail(){
    node('modal')?.classList.remove('open');
    clearActiveDetailCard();
  }

  function moveSecondaryContent(){
    const main=document.querySelector('main.wrap'),brand=main?.querySelector('.brand-showcase'),guidance=node('betaGuidanceTitle')?.closest('.beta-guidance'),coverage=node('coverageStatus');
    if(!main||!brand)return;
    if(guidance)main.insertBefore(guidance,brand);
    if(coverage)main.insertBefore(coverage,brand);
  }

  function readLocation(){
    const params=new URLSearchParams(location.search),requestedGame=clean(params.get('game'))||'all',requestedRegion=clean(params.get('region'))||'all';
    return {
      game:allowedGames.has(requestedGame)?requestedGame:'all',
      region:allowedRegions.has(requestedRegion)?requestedRegion:'all',
      series:clean(params.get('series')),
      // view=all: a game's full card list; view=about: the data-status page.
      view:['all','about'].includes(clean(params.get('view')))?clean(params.get('view')):'',
      rarity:clean(params.get('rarity'))||'all',
      price:allowedPrices.has(clean(params.get('price')))?clean(params.get('price')):'all',
      sort:allowedSorts.has(clean(params.get('sort')))?clean(params.get('sort')):'number-asc',
      query:clean(params.get('q')),
      card:clean(params.get('card')),
      pages:Math.min(20,Math.max(1,Math.floor(number(params.get('pages'),1)))),
      scrollY:number(history.state?.scrollY,number(params.get('scroll'),0))
    };
  }

  function urlFor(overrides={}){
    const params=new URLSearchParams(),selectedGame=overrides.game??game,region=overrides.region??node('browseRegion')?.value??'all',series=overrides.series??browse?.seriesId??'',rarity=overrides.rarity??cardFilters?.rarity??'all',price=overrides.price??cardFilters?.price??'all',sort=overrides.sort??cardFilters?.sort??'number-asc',query=overrides.query??node('q')?.value?.trim()??'',card=overrides.card??currentCardId(),view=overrides.view??(selectedGame==='all'?(document.body?.dataset?.view==='about'?'about':''):!series&&browse?.all?'all':''),pages=overrides.pages??Math.max(1,Math.ceil(number(browse?.offset,0)/PAGE_SIZE));
    if(selectedGame&&selectedGame!=='all')params.set('game',selectedGame);
    if(region&&region!=='all')params.set('region',region);
    if(series)params.set('series',series);
    if(rarity&&rarity!=='all')params.set('rarity',rarity);
    if(price&&price!=='all')params.set('price',price);
    if(sort&&sort!=='number-asc')params.set('sort',sort);
    if(query)params.set('q',query);
    if(view)params.set('view',view);
    if(card)params.set('card',card);
    if(pages>1)params.set('pages',String(pages));
    const search=params.toString();return `${location.pathname}${search?`?${search}`:''}${location.hash||''}`;
  }

  function saveScroll(){
    if(!history.replaceState)return;
    history.replaceState({...history.state,scrollY:Math.max(0,Math.round(window.scrollY||0))},'',location.href);
  }

  function writeUrl(mode='replace',overrides={}){
    if(restoring)return;
    const method=mode==='push'?'pushState':'replaceState';
    history[method]({...history.state,scrollY:Math.max(0,Math.round(window.scrollY||0))},'',urlFor(overrides));
  }

  async function copyCurrentUrl(button){
    const url=new URL(urlFor(),location.origin).href;
    // 先用系統分享（使用者取消不算錯），再試剪貼簿，都不行就顯示唯讀、已全選的網址欄。
    if(navigator.share){try{await navigator.share({title:`${node('detail')?.querySelector('h2')?.textContent||'卡片'} - CardScope`,url});return}catch(error){if(error?.name==='AbortError')return}}
    try{await navigator.clipboard.writeText(url);button.textContent='已複製分享網址';return}catch{}
    let field=button.parentElement.querySelector('.share-url');
    if(!field){field=document.createElement('input');field.type='text';field.readOnly=true;field.className='share-url';field.setAttribute('aria-label','分享網址（請複製）');field.addEventListener('focus',()=>field.select());button.after(field)}
    field.value=url;button.textContent='請複製下方網址';field.focus();field.select();
  }

  function installDetailShare(){
    const detail=node('detail');if(!detail||detail.querySelector('[data-share-card]'))return;
    const button=document.createElement('button');button.type='button';button.className='source-link';button.dataset.shareCard='';button.textContent='分享此卡';button.onclick=()=>copyCurrentUrl(button);detail.querySelector('.card-identity')?.after(button);
  }

  const originalChoose=window.choose;
  if(typeof originalChoose==='function')window.choose=async id=>{
    saveScroll();
    const result=await originalChoose(id);
    if(!restoring)writeUrl('push',{game:id,rarity:'all',query:'',card:'',pages:1});
    return result;
  };

  const originalOpenProduct=window.openProduct;
  if(typeof originalOpenProduct==='function')window.openProduct=async id=>{
    saveScroll();const result=await originalOpenProduct(id);if(!restoring)writeUrl('push',{series:browse?.seriesId||'',query:'',card:'',pages:1});return result;
  };

  const originalOpenCard=window.openCard;
  // 只有「從列表第一次打開」才新增歷史；已開著時換上一張／下一張只改網址，關閉時才能一步退回列表。切換版本（keepPosition）不動網址，網址仍指向列表中的那張卡。
  if(typeof originalOpenCard==='function')window.openCard=async(id,options)=>{
    saveScroll();if(!restoring&&!options?.keepPosition){const open=node('modal')?.classList.contains('open');writeUrl(open?'replace':'push',{card:id});if(!open)openedFromList=true}const result=await originalOpenCard(id,options);installDetailShare();return result;
  };

  // 從列表點開的卡，關閉時退回上一筆歷史（按返回鍵就離開列表，不會重開這張卡）；從分享連結直接進來的，只把 card 參數拿掉。
  let openedFromList=false,skipRestore=false;
  function closeDetailWithHistory(){
    closeDetail();
    if(openedFromList){openedFromList=false;skipRestore=true;history.back()}else writeUrl('replace',{card:''});
  }
  async function restore(state=readLocation()){
    restoring=true;openedFromList=false;
    // 貼網址／重新整理帶搜尋、又沒有存過捲動位置：讓 search() 把畫面捲到結果；有存過位置（返回、重新整理）就以它為準，search() 不要再捲。
    const landOnResults=Boolean(state.query)&&!state.scrollY&&history.state?.scrollY==null;window.cardscopeKeepScroll=!landOnResults;
    // 系列／稀有度網址同理：沒有存過位置時，載入完成後捲到卡牆（固定頂欄下方），不要停在首屏頂端。
    const landOnSeries=!state.query&&!state.card&&state.game!=='all'&&Boolean(state.series||state.rarity!=='all')&&!state.scrollY&&history.state?.scrollY==null;
    // 分享連結直接開卡：先開詳細頁（只等卡片 API），列表在背後照常還原
    const earlyCard=state.card&&typeof originalOpenCard==='function'&&!node('modal')?.classList.contains('open')?originalOpenCard(state.card).then(installDetailShare).catch(()=>{}):null;
    try{
      await waitFor(()=>Array.isArray(C?.games)&&C.games.length>0).catch(()=>{});
      // 系列深連結（sitemap、分享）常沒帶 region：用該系列自己的地區，否則會套預設地區而顯示 0 張。
      if(node('browseRegion'))node('browseRegion').value=state.region!=='all'?state.region:(state.series&&(C.series||[]).find(row=>row.id===state.series)?.region)||'all';
      cardFilters.rarity=state.rarity;cardFilters.price=state.price;cardFilters.sort=state.sort;
      if(node('priceFilter'))node('priceFilter').value=state.price;
      if(node('cardSort'))node('cardSort').value=state.sort;
      if(node('q'))node('q').value=state.query;
      if(node('heroQ'))node('heroQ').value=state.query;
      if(typeof siteView!=='undefined')siteView=state.view==='about'?'about':'';
      // The game page opens on the series (or full list) named in the URL, without first loading the default newest series.
      window.cardscopeEntry=state.game!=='all'&&(state.series||state.view==='all')?{series:state.series,all:!state.series&&state.view==='all'}:null;
      await originalChoose?.(state.game);
      await waitFor(()=>!browse?.loading).catch(()=>{});
      // 換遊戲時 choose 會把稀有度重設成全部；網址指定了稀有度就再套用一次
      if(state.game!=='all'&&state.rarity&&state.rarity!=='all'&&cardFilters.rarity!==state.rarity){cardFilters.rarity=state.rarity;if(node('rarityFilter'))node('rarityFilter').value=state.rarity;if(typeof loadCardsPage==='function')await loadCardsPage(true);await waitFor(()=>!browse?.loading).catch(()=>{})}
      while(state.game!=='all'&&state.pages>1&&browse?.hasMore&&Math.ceil(number(browse.offset,0)/PAGE_SIZE)<state.pages)await loadCardsPage(false);
      if(state.query&&typeof window.search==='function')await window.search();
      if(state.card&&typeof originalOpenCard==='function'){if(earlyCard)await earlyCard;else{await originalOpenCard(state.card);installDetailShare()}}
      else closeDetail();
      if(landOnSeries)requestAnimationFrame(()=>window.scrollBelowHeader?.(node('cardsTitle')));
      else if(!landOnResults)requestAnimationFrame(()=>window.scrollTo({top:state.scrollY,behavior:'auto'}));
    }finally{
      window.cardscopeKeepScroll=false;restoring=false;writeUrl('replace',{card:state.card||''});
    }
  }

  for(const id of ['browseRegion','rarityFilter','priceFilter','cardSort'])node(id)?.addEventListener('change',()=>setTimeout(()=>writeUrl('push',{pages:1,card:''}),0));
  node('go')?.addEventListener('click',()=>setTimeout(()=>writeUrl('push',{query:node('q')?.value?.trim()||'',card:'',pages:1}),0));
  node('q')?.addEventListener('keydown',event=>{if(event.key==='Enter')setTimeout(()=>writeUrl('push',{query:node('q')?.value?.trim()||'',card:'',pages:1}),0)});
  node('loadMore')?.addEventListener('click',()=>setTimeout(()=>writeUrl('replace'),0));
  node('close')?.addEventListener('click',()=>{if(!restoring)closeDetailWithHistory()});
  node('modal')?.addEventListener('click',event=>{if(event.target===node('modal')&&!restoring)closeDetailWithHistory()});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||restoring||node('cardZoom')?.classList.contains('open')||!node('modal')?.classList.contains('open'))return;
    event.preventDefault();
    closeDetailWithHistory();
  },true);
  // index.html announces a browse view the page picked (newest series) or the user chose (series tile, 全部卡片), and searches it started itself (example chips, cancelled conditions).
  document.addEventListener('cardscope:browse',event=>{if(!restoring)writeUrl(event.detail?.push?'push':'replace',{pages:1,card:'',query:''})});
  document.addEventListener('cardscope:search',event=>{if(!restoring)writeUrl('push',{query:event.detail?.q||'',card:'',pages:1})});
  window.addEventListener('beforeunload',saveScroll);
  window.addEventListener('popstate',()=>{if(skipRestore){skipRestore=false;return}return restore(readLocation())});
  if('scrollRestoration'in history)history.scrollRestoration='manual';
  moveSecondaryContent();
  restore(readLocation());
})();
