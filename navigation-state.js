(()=>{
  const PAGE_SIZE=100;
  const allowedGames=new Set(['all','pokemon','onepiece','yugioh','haikyuu','weiss-schwarz']);
  const allowedRegions=new Set(['all','JP','TW','US','CN','KR','ASIA']);
  const allowedSorts=new Set(['number-asc','number-desc','rarity-desc','rarity-asc','price-asc','price-desc','release-desc']);
  const allowedPrices=new Set(['all','priced','unpriced']);
  let restoring=false;

  const node=id=>document.getElementById(id);
  const clean=value=>String(value||'').trim();
  const number=(value,fallback=0)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:fallback};
  const currentCardId=()=>clean(window.activeDetailCardId||document.querySelector('#modal.open [data-card-id]')?.dataset.cardId);
  const waitFor=(predicate,timeout=10000)=>new Promise((resolve,reject)=>{const started=Date.now(),tick=()=>{if(predicate())return resolve();if(Date.now()-started>=timeout)return reject(new Error('STATE_RESTORE_TIMEOUT'));setTimeout(tick,40)};tick()});

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
    const params=new URLSearchParams(),selectedGame=overrides.game??game,region=overrides.region??node('browseRegion')?.value??'all',series=overrides.series??browse?.seriesId??'',rarity=overrides.rarity??cardFilters?.rarity??'all',price=overrides.price??cardFilters?.price??'all',sort=overrides.sort??cardFilters?.sort??'number-asc',query=overrides.query??node('q')?.value?.trim()??'',card=overrides.card??currentCardId(),pages=overrides.pages??Math.max(1,Math.ceil(number(browse?.offset,0)/PAGE_SIZE));
    if(selectedGame&&selectedGame!=='all')params.set('game',selectedGame);
    if(region&&region!=='all')params.set('region',region);
    if(series)params.set('series',series);
    if(rarity&&rarity!=='all')params.set('rarity',rarity);
    if(price&&price!=='all')params.set('price',price);
    if(sort&&sort!=='number-asc')params.set('sort',sort);
    if(query)params.set('q',query);
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
    try{await navigator.clipboard.writeText(url);button.textContent='已複製分享網址'}
    catch{button.textContent='請複製瀏覽器網址'}
  }

  function installDetailShare(){
    const detail=node('detail');if(!detail||detail.querySelector('[data-share-card]'))return;
    const button=document.createElement('button');button.type='button';button.className='source-link';button.dataset.shareCard='';button.textContent='分享此卡';button.onclick=()=>copyCurrentUrl(button);detail.querySelector('.card-identity')?.after(button);
  }

  const originalChoose=window.choose;
  if(typeof originalChoose==='function')window.choose=async id=>{
    saveScroll();
    const result=await originalChoose(id);
    if(!restoring)writeUrl('push',{game:id,series:'',rarity:'all',query:'',card:'',pages:1});
    return result;
  };

  const originalOpenProduct=window.openProduct;
  if(typeof originalOpenProduct==='function')window.openProduct=async id=>{
    saveScroll();const result=await originalOpenProduct(id);if(!restoring)writeUrl('push',{series:browse?.seriesId||'',query:'',card:'',pages:1});return result;
  };

  const originalOpenCard=window.openCard;
  if(typeof originalOpenCard==='function')window.openCard=async id=>{
    saveScroll();if(!restoring)writeUrl('push',{card:id});const result=await originalOpenCard(id);installDetailShare();return result;
  };

  async function restore(state=readLocation()){
    restoring=true;
    try{
      await waitFor(()=>Array.isArray(C?.games)&&C.games.length>0).catch(()=>{});
      if(node('browseRegion'))node('browseRegion').value=state.region;
      cardFilters.rarity=state.rarity;cardFilters.price=state.price;cardFilters.sort=state.sort;
      if(node('priceFilter'))node('priceFilter').value=state.price;
      if(node('cardSort'))node('cardSort').value=state.sort;
      if(node('q'))node('q').value=state.query;
      await originalChoose?.(state.game);
      await waitFor(()=>!browse?.loading).catch(()=>{});
      if(state.series&&state.game!=='all'){
        browse.seriesId=state.series;
        await loadCardsPage(true);
      }
      while(state.game!=='all'&&state.pages>1&&browse?.hasMore&&Math.ceil(number(browse.offset,0)/PAGE_SIZE)<state.pages)await loadCardsPage(false);
      if(state.query&&typeof window.search==='function')await window.search();
      if(state.card&&typeof originalOpenCard==='function'){await originalOpenCard(state.card);installDetailShare()}
      requestAnimationFrame(()=>window.scrollTo({top:state.scrollY,behavior:'auto'}));
    }finally{
      restoring=false;writeUrl('replace');
    }
  }

  for(const id of ['browseRegion','rarityFilter','priceFilter','cardSort'])node(id)?.addEventListener('change',()=>setTimeout(()=>writeUrl('push',{pages:1,card:''}),0));
  node('go')?.addEventListener('click',()=>setTimeout(()=>writeUrl('push',{query:node('q')?.value?.trim()||'',card:'',pages:1}),0));
  node('q')?.addEventListener('keydown',event=>{if(event.key==='Enter')setTimeout(()=>writeUrl('push',{query:node('q')?.value?.trim()||'',card:'',pages:1}),0)});
  node('loadMore')?.addEventListener('click',()=>setTimeout(()=>writeUrl('replace'),0));
  node('close')?.addEventListener('click',()=>{if(!restoring)writeUrl('push',{card:''})});
  node('modal')?.addEventListener('click',event=>{if(event.target===node('modal')&&!restoring)writeUrl('push',{card:''})});
  window.addEventListener('beforeunload',saveScroll);
  window.addEventListener('popstate',()=>restore(readLocation()));
  if('scrollRestoration'in history)history.scrollRestoration='manual';
  moveSecondaryContent();
  restore(readLocation());
})();
