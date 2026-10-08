// Game-page series band, in the shape of trade.kapaipai.tw/trade: a region switch, a text tab row
// (最新 / 最近瀏覽 / product categories / eras) and a rail of square tiles. Only the layout is borrowed. Series tiles
// are the catalog's own series (each opens its card table); product tiles are the 商品圖鑑 products, which this band
// replaces. Each IP is browsed one region at a time (JP first, per the data priority); a tile without an image shows
// its code or name on the IP colour instead of an empty placeholder.
(function(){
  const bandTab={},recentKey='cardscope-band-recent',regionOrder=['JP','TW','US','ASIA','KR','CN'];
  const regionLabel={JP:'日版',TW:'台版',US:'美版',CN:'陸版',KR:'韓版',ASIA:'亞洲英文版'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const today=()=>new Date().toISOString().slice(0,10);
  const regionSelect=()=>document.getElementById('browseRegion');
  function recent(){try{return JSON.parse(localStorage.getItem(recentKey)||'[]')}catch{return[]}}
  function remember(id){try{localStorage.setItem(recentKey,JSON.stringify([id,...recent().filter(x=>x!==id)].slice(0,12)))}catch{}}
  // A region is offered when it has a real catalog behind it (3+ series or products), or when it is the only one.
  function regionsFor(g){
    const counts={};for(const item of [...(C.series||[]),...(P||[])])if(item.game===g&&item.region)counts[item.region]=(counts[item.region]||0)+1;
    const present=regionOrder.filter(region=>counts[region]),offered=present.filter(region=>counts[region]>=3);
    return offered.length?offered:present;
  }
  // Keep the browse region on one of this IP's regions; set silently so the card load that follows uses it.
  function ensureRegion(){
    const select=regionSelect(),regions=regionsFor(game);if(!select||!regions.length)return regions;
    if(!regions.includes(select.value))select.value=regions[0];
    return regions;
  }
  const label=item=>String(item.label).replace(/／.*$/,'');
  const productName=item=>{
    const translated=item.nameZh&&!['unofficial','category-only'].includes(item.metadata?.translationStatus);
    return String(translated?item.nameZh:(item.nameJa||item.name||item.nameEn||item.nameZh||'名稱待補'))
      .replace(/^官方尚未有中文名稱｜/,'').replace(/^(補充包|擴充包|原盒)[｜ 　]*/,'').replace(/^「(.*)」$/,'$1');
  };
  const seriesName=item=>String(item.nameZh||item.nameJa||item.nameEn||item.officialCode||'名稱待補').replace(/^.*?系列｜/,'');
  // Newest first. Series without a release date (most 台版 rows) fall back to era, newest era first, then code descending.
  const eraOrder=['MEGA 系列','朱／紫系列','劍／盾系列','太陽／月亮系列','XY 系列','BW 系列','LEGEND 系列','DP 系列','ADV／PCG 系列','經典系列'];
  const eraRank=item=>{if(item.game!=='pokemon')return 0;const rank=eraOrder.indexOf(pokemonEra(item));return rank<0?eraOrder.length:rank};
  function byDate(list){return [...list].sort((a,b)=>compare(a,b))}
  const compare=(a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||''))||eraRank(a)-eraRank(b)||String(b.officialCode||'').localeCompare(String(a.officialCode||''),undefined,{numeric:true});
  // Pokémon eras already come newest first; other IPs' groups are often undated, so order them by their newest series.
  function orderBuckets(buckets){return game==='pokemon'?buckets:[...buckets].sort((a,b)=>compare(byDate(a.items)[0],byDate(b.items)[0]))}
  // A series has no picture of its own, so it borrows the box art of the sealed product linked to it (same region).
  function cover(item){
    if(item.imageUrl)return item.imageUrl;
    return (P||[]).find(row=>row.seriesId===item.id&&row.imageUrl&&row.imageKind==='sealed-product')?.imageUrl||null;
  }
  function tile(kind,item){
    const imageUrl=kind==='series'?cover(item):item.imageUrl,name=kind==='product'?productName(item):seriesName(item),code=item.officialCode||'',upcoming=item.releaseDate&&item.releaseDate>today();
    const art=imageUrl?`<img src="${esc(imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('is-type');this.remove()">`:'';
    const sub=code||(kind==='product'?item.productSubtype||item.productType||item.releaseDate||'':'代碼待補');
    return`<button type="button" class="band-tile" data-kind="${kind}" data-id="${esc(item.id)}" title="${esc([name,code,item.releaseDate].filter(Boolean).join('・'))}">`
      +`<span class="band-tile-art${art?'':code?' is-type':' is-type is-text'}" data-code="${esc(code||name)}">${art}${upcoming?'<span class="band-tile-flag">即將發售</span>':''}</span>`
      +`<b class="band-tile-name">${esc(name)}</b><span class="band-tile-code">${esc(sub)}</span></button>`;
  }
  function newTile(newest){
    if(!newest)return'';const kicker=newest.releaseDate>today()?'即將發售':'最新商品';
    return`<button type="button" class="band-tile band-tile-new" data-kind="series" data-id="${esc(newest.id)}" aria-label="${esc(`${kicker}：${seriesName(newest)}`)}">`
      +`<span class="band-tile-art"><span class="band-new-kicker">${kicker}</span><span class="band-new-name">${esc(seriesName(newest))}</span></span>`
      +`<b class="band-tile-name">${kicker}</b><span class="band-tile-code">NEW</span></button>`;
  }
  async function openSeries(item){
    remember(item.id);resetRarityFilter();clearProduct();
    browse.product={...item,seriesId:item.id,versionLabel:regionLabel[item.region]};browse.seriesId=item.id;
    const box=document.getElementById('selectedProduct');box.classList.add('open');
    const art=cover(item);box.innerHTML=`<div class="selected-product-art"><span class="band-tile-art${art?'':' is-type'}" data-code="${esc(item.officialCode||'')}">${art?`<img src="${esc(art)}" alt="">`:''}</span></div><div><span class="badge">系列卡表</span><span class="badge">${esc(regionLabel[item.region]||item.region||'版本待補')}</span><h2>${esc(seriesName(item))}</h2><div class="meta">${esc(item.officialCode||'系列代碼待補')} · ${esc(item.releaseDate||'發售日待補')}</div>${item.nameJa&&item.nameZh?`<p class="meta">${esc(item.nameJa)}</p>`:''}</div>`;
    box.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start'});
    await loadCardsPage(true);render();
  }
  function render(){
    const anchor=document.getElementById('gameContext');let band=document.getElementById('seriesBand');
    if(game==='all'||!anchor){band?.remove();return}
    if(!band){band=document.createElement('section');band.id='seriesBand';band.className='series-band';band.setAttribute('aria-label','系列與商品快速入口');anchor.after(band)}
    const regions=ensureRegion(),region=regionSelect()?.value||'all',inRegion=item=>item.game===game&&(region==='all'||item.region===region);
    const series=(C.series||[]).filter(inRegion),products=(P||[]).filter(inRegion),buckets=orderBuckets(seriesGroupBuckets(series));
    const seen=recent().map(id=>series.find(item=>item.id===id)).filter(Boolean);
    const categories=PRODUCT_CATEGORY_DEFINITIONS.filter(item=>item.id!=='singles').map(item=>({...item,rows:products.filter(row=>productMatchesCategory(row,item.id))})).filter(item=>item.rows.length);
    const tabs=[['latest','最新'],...(seen.length?[['recent','最近瀏覽']]:[]),...categories.map(item=>[`product:${item.id}`,label(item),item.description]),...buckets.map(bucket=>[`group:${bucket.label}`,bucket.label])];
    let active=bandTab[game]||'latest';if(!tabs.some(([id])=>id===active))active='latest';bandTab[game]=active;
    const dated=byDate(series),firstEraTab=categories.length?tabs.findIndex(([id])=>id.startsWith('group:')):-1;
    let kind='series',list;
    if(active==='latest')list=dated.slice(0,30);
    else if(active==='recent')list=seen;
    else if(active.startsWith('product:')){kind='product';list=byDate(categories.find(item=>`product:${item.id}`===active)?.rows||[]).slice(0,60)}
    else list=byDate(buckets.find(bucket=>`group:${bucket.label}`===active)?.items||[]);
    const key=`${game}|${region}|${active}|${list.length}`,keep=band.dataset.key===key?band.querySelector('.series-band-rail')?.scrollLeft||0:0;
    band.dataset.key=key;
    band.innerHTML=`<div class="series-band-head"><div class="series-band-regions" role="group" aria-label="地區版本">${regions.map(id=>`<button type="button" data-region="${id}" aria-pressed="${id===region}" class="${id===region?'on':''}">${esc(regionLabel[id]||id)}</button>`).join('')}</div></div>`
      +`<div class="series-band-tabs" role="tablist" aria-label="系列與商品分類">${tabs.map(([id,text,hint],index)=>`<button type="button" role="tab" aria-selected="${id===active}" class="${id===active?'on':''}${index===firstEraTab?' starts-eras':''}" data-band-tab="${esc(id)}"${hint?` title="${esc(hint)}"`:''}>${esc(text)}</button>`).join('')}</div>`
      +`<div class="series-band-rail" role="tabpanel">${active==='latest'?newTile(dated[0]):''}${list.map(item=>tile(kind,item)).join('')||`<p class="series-band-empty">${esc(regionLabel[region]||'')}目前沒有收錄這一類。</p>`}</div>`;
    band.querySelector('.series-band-rail').scrollLeft=keep;
    const current=browse.product?.id||browse.seriesId;if(current)band.querySelector(`.band-tile:not(.band-tile-new)[data-id="${CSS.escape(String(current))}"]`)?.setAttribute('aria-current','true');
    band.onclick=event=>{
      const regionButton=event.target.closest('[data-region]');
      if(regionButton){const select=regionSelect();if(select&&select.value!==regionButton.dataset.region){select.value=regionButton.dataset.region;select.dispatchEvent(new Event('change',{bubbles:true}))}return}
      const tab=event.target.closest('[data-band-tab]');if(tab){bandTab[game]=tab.dataset.bandTab;render();return}
      const card=event.target.closest('.band-tile');if(!card)return;
      if(card.dataset.kind==='product'){openProduct(card.dataset.id).then(render);document.getElementById('selectedProduct')?.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start'});return}
      const item=series.find(row=>row.id===card.dataset.id);if(item)openSeries(item);
    };
  }
  const previous=series;
  series=function(){if(game!=='all')ensureRegion();previous();render()};
  window.renderSeriesBand=render;
  if(typeof game!=='undefined'&&typeof C!=='undefined')render();
})();
