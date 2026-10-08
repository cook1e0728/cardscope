// Game-page series band (preview): a text tab row (最新 / 最近瀏覽 / eras) over a rail of square series tiles, in the
// shape of trade.kapaipai.tw/trade. Only the layout is borrowed. Tiles are the catalog's own series (each opens its
// card table) with CardScope's series images; a series without one shows its code on the IP colour instead of an
// empty placeholder. The 商品圖鑑 section below keeps the sealed products.
(function(){
  const bandTab={},recentKey='cardscope-band-recent';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const today=()=>new Date().toISOString().slice(0,10);
  const regionLabel={JP:'日版',TW:'台版',US:'美版',CN:'陸版',KR:'韓版',ASIA:'亞洲英文版'};
  function recent(){try{return JSON.parse(localStorage.getItem(recentKey)||'[]')}catch{return[]}}
  function remember(id){try{localStorage.setItem(recentKey,JSON.stringify([id,...recent().filter(x=>x!==id)].slice(0,12)))}catch{}}
  function rows(){
    const region=document.getElementById('browseRegion')?.value||'all';
    return (C.series||[]).filter(item=>item.game===game&&(region==='all'||item.region===region));
  }
  function tileName(item){
    return String(item.nameZh||item.nameJa||item.nameEn||item.officialCode||'名稱待補').replace(/^.*?系列｜/,'');
  }
  function byDate(list){return [...list].sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||''))||(seriesRegionRank[a.region]??9)-(seriesRegionRank[b.region]??9))}
  function tile(item,showRegion){
    const name=tileName(item),code=item.officialCode||'',upcoming=item.releaseDate&&item.releaseDate>today();
    const art=item.imageUrl?`<img src="${esc(item.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('is-type');this.remove()">`:'';
    const sub=[code||'代碼待補',showRegion&&regionLabel[item.region]].filter(Boolean).join(' · ');
    return`<button type="button" class="band-tile" data-series="${esc(item.id)}" title="${esc([name,code,regionLabel[item.region],item.releaseDate].filter(Boolean).join('・'))}">`
      +`<span class="band-tile-art${art?'':' is-type'}" data-code="${esc(code||name.slice(0,6))}">${art}${upcoming?'<span class="band-tile-flag">即將發售</span>':''}</span>`
      +`<b class="band-tile-name">${esc(name)}</b><span class="band-tile-code">${esc(sub)}</span></button>`;
  }
  function newTile(newest){
    if(!newest)return'';const label=newest.releaseDate>today()?'即將發售':'最新商品';
    return`<button type="button" class="band-tile band-tile-new" data-series="${esc(newest.id)}" aria-label="${esc(`${label}：${tileName(newest)}`)}">`
      +`<span class="band-tile-art"><span class="band-new-kicker">${label}</span><span class="band-new-name">${esc(tileName(newest))}</span></span>`
      +`<b class="band-tile-name">${label}</b><span class="band-tile-code">NEW</span></button>`;
  }
  async function openSeries(item){
    remember(item.id);resetRarityFilter();clearProduct();
    const s={...item,seriesId:item.id,versionLabel:regionLabel[item.region]};browse.product=s;browse.seriesId=item.id;
    const box=document.getElementById('selectedProduct');box.classList.add('open');
    box.innerHTML=`<div class="selected-product-art"><span class="band-tile-art${item.imageUrl?'':' is-type'}" data-code="${esc(item.officialCode||'')}">${item.imageUrl?`<img src="${esc(item.imageUrl)}" alt="">`:''}</span></div><div><span class="badge">系列卡表</span><span class="badge">${esc(regionLabel[item.region]||item.region||'版本待補')}</span><h2>${esc(tileName(item))}</h2><div class="meta">${esc(item.officialCode||'系列代碼待補')} · ${esc(item.releaseDate||'發售日待補')}</div>${item.nameJa&&item.nameZh?`<p class="meta">${esc(item.nameJa)}</p>`:''}</div>`;
    box.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start'});
    await loadCardsPage(true);render();
  }
  function render(){
    const anchor=document.getElementById('gameContext');let band=document.getElementById('seriesBand');
    if(game==='all'||!anchor){band?.remove();return}
    if(!band){band=document.createElement('section');band.id='seriesBand';band.className='series-band';band.setAttribute('aria-label','系列快速入口');anchor.after(band)}
    const all=rows(),buckets=seriesGroupBuckets(all),seen=recent().map(id=>all.find(item=>item.id===id)).filter(Boolean);
    const tabs=[['latest','最新'],...(seen.length?[['recent','最近瀏覽']]:[]),...buckets.map(bucket=>[`group:${bucket.label}`,bucket.label])];
    let active=bandTab[game]||'latest';if(!tabs.some(([id])=>id===active))active='latest';bandTab[game]=active;
    const dated=byDate(all),list=active==='latest'?dated.slice(0,30):active==='recent'?seen:byDate(buckets.find(bucket=>`group:${bucket.label}`===active)?.items||[]);
    const showRegion=new Set(all.map(item=>item.region)).size>1,key=`${game}|${active}|${all.length}`;
    const keep=band.dataset.key===key?band.querySelector('.series-band-rail')?.scrollLeft||0:0;
    band.dataset.key=key;
    band.innerHTML=`<div class="series-band-tabs" role="tablist" aria-label="系列分組">${tabs.map(([id,label])=>`<button type="button" role="tab" aria-selected="${id===active}" class="${id===active?'on':''}" data-band-tab="${esc(id)}">${esc(label)}</button>`).join('')}</div>`
      +`<div class="series-band-rail" role="tabpanel">${active==='latest'?newTile(dated[0]):''}${list.map(item=>tile(item,showRegion)).join('')||'<p class="series-band-empty">這個版本目前沒有收錄系列。</p>'}</div>`;
    band.querySelector('.series-band-rail').scrollLeft=keep;
    band.querySelector(`[data-series="${CSS.escape(String(browse.seriesId||''))}"]:not(.band-tile-new)`)?.setAttribute('aria-current','true');
    band.onclick=event=>{
      const tab=event.target.closest('[data-band-tab]');if(tab){bandTab[game]=tab.dataset.bandTab;render();return}
      const card=event.target.closest('.band-tile');if(!card)return;
      const item=all.find(row=>row.id===card.dataset.series);if(item)openSeries(item);
    };
  }
  const previous=series;
  series=function(){previous();render()};
  document.getElementById('browseRegion')?.addEventListener('change',()=>render());
  window.renderSeriesBand=render;
  if(typeof game!=='undefined'&&typeof C!=='undefined')render();
})();
