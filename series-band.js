// Game-page series band, in the shape of trade.kapaipai.tw/trade: a region switch, a text tab row
// (全部系列 / 最近瀏覽 / product categories / eras) and a rail of square tiles. Only the layout is borrowed. Series tiles
// are the catalog's own series (each opens its card table); product tiles are the 商品圖鑑 products, which this band
// replaces. Each IP is browsed one region at a time (JP first, per the data priority); a tile without an image shows
// its code or name on the IP colour instead of an empty placeholder.
(function(){
  // A search adds a first tab with the series and products whose names match (the server's expanded terms, e.g. 30th / 30周年),
  // so box and series pages are found even when no card name matches.
  let bandSearch=null,searchSummary={here:0,others:[],label:''};
  const fold=value=>String(value||'').toLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-<>\[\]「」｜|]/g,'');
  const bandTab={},recentKey='cardscope-band-recent',regionOrder=['JP','TW','US','ASIA','KR','CN'];
  // 航海王的台灣官方站賣的是日文印刷的卡（亞洲發行），不是繁中版
  const regionLabel={JP:'日版',TW:'台版',US:'美版',CN:'陸版',KR:'韓版',ASIA:'亞洲英文版'},regionText=(r,g=game)=>r==='TW'&&g==='onepiece'?'亞洲日文版':regionLabel[r];
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // 發售日以台灣日期為準：UTC 在台灣 00:00–08:00 還是前一天，會把當天發售的系列標成即將發售。
  const taipeiDate=(daysAgo=0)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(Date.now()-daysAgo*864e5);window.taipeiDate=taipeiDate;
  const today=()=>taipeiDate();
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
    // Prefer the booster box over a deck, and either over sleeves or playmats that share the series link.
    const rank=row=>productMatchesCategory(row,'sealed')?0:productMatchesCategory(row,'decks')?1:2;
    return (P||[]).filter(row=>row.seriesId===item.id&&row.imageUrl&&row.imageKind==='sealed-product').sort((a,b)=>rank(a)-rank(b))[0]?.imageUrl||null;
  }
  function tile(kind,item,extra=''){
    const imageUrl=kind==='series'?cover(item):item.imageUrl,name=kind==='product'?productName(item):seriesName(item),code=item.officialCode||'',upcoming=item.releaseDate&&item.releaseDate>today(),fresh=!upcoming&&item.releaseDate&&item.releaseDate>=recentSince();
    // 官方站（pokemon-card.com、onepiece-cardgame.com）偶爾單次載入失敗：先隔 1.5 秒重試一次，仍失敗才改成代碼磚。
    const art=imageUrl?`<img src="${esc(imageUrl)}" alt="" loading="lazy" data-img-error="retry-type">`:'';
    const sub=(extra?extra+' · ':'')+(code||(kind==='product'?item.productSubtype||item.productType||item.releaseDate||'':'代碼待補'));
    return`<button type="button" class="band-tile" data-kind="${kind}" data-id="${esc(item.id)}" data-game="${esc(item.game)}" title="${esc([name,code,item.releaseDate].filter(Boolean).join('・'))}">`
      +`<span class="band-tile-art${art?'':code?' is-type':' is-type is-text'}" data-code="${esc(code||name)}">${art}${upcoming?'<span class="band-tile-flag">即將發售</span>':fresh?'<span class="band-tile-flag is-new">NEW</span>':''}</span>`
      +`<b class="band-tile-name">${esc(name)}</b><span class="band-tile-code">${esc(sub)}</span></button>`;
  }
  function mascotNewTile(target){
    const hint=target?`${seriesName(target)}・${target.officialCode||''}`:'最新收錄系列';
    return`<button type="button" class="band-tile is-mascot-new" data-kind="mascot-new"${target?` data-id="${esc(target.id)}" data-game="${esc(target.game)}"`:''} title="${esc(`最新系列 NEW｜${hint}`)}">`
      +`<span class="band-tile-art is-mascot-art"><img src="/assets/brand/web/rabbit-success-160.webp" alt="" loading="lazy"><span class="band-tile-flag is-new">NEW</span></span>`
      +`<b class="band-tile-name">最新系列</b><span class="band-tile-code">NEW</span></button>`;
  }
  // Released in the last 90 days: shown as a NEW badge on the series' own tile.
  const recentSince=()=>taipeiDate(90);
  // auto: the page opened this series as the game's default view, so it is not remembered as 最近瀏覽 and the page does not scroll.
  async function openSeries(item,{auto=false}={}){
    if(!auto)remember(item.id);resetRarityFilter();clearProduct();
    browse.product={...item,seriesId:item.id,versionLabel:regionText(item.region,item.game)};browse.seriesId=item.id;
    const box=document.getElementById('selectedProduct');box.classList.add('open');
    const art=cover(item);box.innerHTML=`<div class="selected-product-art"><span class="band-tile-art${art?'':' is-type'}" data-code="${esc(item.officialCode||'')}">${art?`<img src="${esc(art)}" alt="">`:''}</span></div><div><span class="badge">系列卡表</span><span class="badge">${esc(regionText(item.region,item.game)||item.region||'版本待補')}</span><h2>${esc(seriesName(item))}</h2><div class="meta">${esc(item.officialCode||'系列代碼待補')} · ${esc(item.releaseDate||'發售日待補')}</div>${item.nameJa&&item.nameZh?`<p class="meta">${esc(item.nameJa)}</p>`:''}</div>`;
    if(!auto)scrollBelowHeader(box);
    await loadCardsPage(true);render();if(!auto)window.announceBrowse?.(true);
  }
  // Default view of a game page: the newest released series of the browsing region; one with no cards yet falls through to the next (three at most).
  async function openLatestSeries(){
    ensureRegion();const startGame=game,region=regionSelect()?.value||'all',list=byDate((C.series||[]).filter(item=>item.game===game&&(region==='all'||item.region===region)&&!(item.releaseDate&&item.releaseDate>today()))).slice(0,3);
    for(const item of list){
      await openSeries(item,{auto:true});
      // A failed load keeps its retry button; only an empty series falls through to the next one.
      if(game!==startGame||browse.seriesId!==item.id||browse.rows.length||cardDisplayState==='error')return true;
    }
    return false;
  }
  // Landing: the newest dated series of each IP (its first region) as the same tiles the game page uses; a tile opens that game on that series.
  let homeTab='latest';
  function renderHome(){
    const host=document.getElementById('homeLatest'),rail=document.getElementById('homeLatestRail');if(!host||!rail)return;
    if(game!=='all'){host.hidden=true;return}
    const ids=(window.CARD_GAMES||C.games||[]).map(choice=>choice.id).filter(id=>id&&id!=='all'),picks=[];
    for(const id of ids){
      const rows=(C.series||[]).filter(item=>item.game===id&&item.releaseDate&&item.releaseDate<=today()).sort((a,b)=>compare(a,b)||regionOrder.indexOf(a.region)-regionOrder.indexOf(b.region));
      const grouped=[],used=new Set();
      for(const row of rows){
        if(used.has(row.id))continue;
        const siblings=rows.filter(s=>!used.has(s.id)&&(s.id===row.id||(s.officialCode&&row.officialCode&&String(s.officialCode).toUpperCase()===String(row.officialCode).toUpperCase())||(s.releaseDate===row.releaseDate&&fold(seriesName(s))===fold(seriesName(row))))).sort((a,b)=>regionOrder.indexOf(a.region)-regionOrder.indexOf(b.region));
        siblings.forEach(s=>used.add(s.id));
        grouped.push(...siblings);
        if(grouped.length>=4)break;
      }
      picks.push(...grouped.slice(0,4));
    }
    const allDated=[];
    {const byRelease=[...picks].sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate))||regionOrder.indexOf(a.region)-regionOrder.indexOf(b.region)),seen=new Set();
      for(const row of byRelease){
        if(seen.has(row.id))continue;
        const siblings=byRelease.filter(s=>!seen.has(s.id)&&s.game===row.game&&(s.id===row.id||(s.officialCode&&row.officialCode&&String(s.officialCode).toUpperCase()===String(row.officialCode).toUpperCase())||(s.releaseDate===row.releaseDate&&fold(seriesName(s))===fold(seriesName(row))))).sort((a,b)=>regionOrder.indexOf(a.region)-regionOrder.indexOf(b.region));
        siblings.forEach(s=>seen.add(s.id));
        allDated.push(...siblings);
      }
    }
    const gameTabs=ids.map(id=>{
      const name=(window.CARD_GAMES||[]).find(choice=>choice.id===id)?.name||id;
      const count=allDated.filter(item=>item.game===id).length;
      return count?[id,name,count]:null;
    }).filter(Boolean);
    const tabs=[['latest','最新系列',Math.min(8,allDated.length)],...gameTabs];
    if(!tabs.some(([id])=>id===homeTab))homeTab='latest';
    const list=(homeTab==='latest'?allDated:allDated.filter(item=>item.game===homeTab)).slice(0,8);
    host.hidden=!allDated.length;
    let tabBar=host.querySelector('.series-band-tabs');
    if(!tabBar){tabBar=document.createElement('div');tabBar.className='series-band-tabs home-latest-tabs';tabBar.setAttribute('role','tablist');tabBar.setAttribute('aria-label','最新系列快速分類');rail.before(tabBar)}
    tabBar.innerHTML=tabs.map(([id,text,count])=>`<button type="button" role="tab" aria-selected="${id===homeTab}" class="${id===homeTab?'on':''}" data-home-tab="${esc(id)}">${esc(text)} <span class="count" aria-hidden="true">${count}</span></button>`).join('');
    tabBar.onclick=event=>{const btn=event.target.closest('[data-home-tab]');if(!btn)return;homeTab=btn.dataset.homeTab;renderHome()};
    rail.innerHTML=(list.length?mascotNewTile(list[0]):'')+list.map(item=>tile('series',item,[(window.CARD_GAMES||[]).find(choice=>choice.id===item.game)?.name||'',regionText(item.region,item.game)||item.region||''].filter(Boolean).join(' '))).join('');
    rail.onclick=event=>{
      const button=event.target.closest('.band-tile'),item=button&&(C.series||[]).find(row=>row.id===button.dataset.id);if(!item)return;
      const select=regionSelect();if(select)select.value=item.region;window.cardscopeEntry={series:item.id};window.choose(item.game);
    };
    renderHomeCardsPreview(host,list.length?list:allDated);
  }
  const homeCardsCache=new Map();
  let homePreviewGame='';
  async function renderHomeCardsPreview(host,candidates){
    const rawList=Array.isArray(candidates)?candidates.filter(Boolean):[candidates].filter(Boolean);
    if(!host||!rawList.length||typeof fetch!=='function')return;
    let wrap=document.getElementById('homeCardsPreview');
    if(!wrap){
      wrap=document.createElement('div');wrap.id='homeCardsPreview';wrap.className='home-cards-preview';
      host.append(wrap);
    }
    const availableGames=[...new Set(rawList.map(s=>s.game))];
    const activePreviewGame=homePreviewGame&&availableGames.includes(homePreviewGame)?homePreviewGame:homeTab!=='latest'&&availableGames.includes(homeTab)?homeTab:'';
    const ordered=activePreviewGame?[...rawList.filter(s=>s.game===activePreviewGame),...rawList.filter(s=>s.game!==activePreviewGame)]:rawList;
    const sig=ordered.map(s=>`${s.game}|${s.id}`).join(',')+'|'+activePreviewGame;
    wrap.dataset.key=sig;
    const draw=(targetSeries,rows)=>{
      if(wrap.dataset.key!==sig||game!=='all')return;
      if(!rows.length||!targetSeries){wrap.hidden=true;return}
      wrap.hidden=false;
      const gameName=(window.CARD_GAMES||[]).find(c=>c.id===targetSeries.game)?.name||targetSeries.game;
      const switcher=availableGames.length>1?`<div class="home-preview-ips" role="group" aria-label="熱門與最新 IP 預覽切換">${availableGames.map(gid=>{const gLabel=(window.CARD_GAMES||[]).find(c=>c.id===gid)?.name||gid;const isOn=gid===targetSeries.game;return`<button type="button" class="home-preview-ip${isOn?' on':''}" data-preview-game="${esc(gid)}" aria-pressed="${isOn}">${esc(gLabel)}</button>`}).join('')}</div>`:'';
      wrap.innerHTML=`<div class="home-cards-head"><div><h3>熱門／最新單卡推送 · ${esc(seriesName(targetSeries))}</h3>${switcher}</div><button type="button" class="home-cards-more" data-open-series="${esc(targetSeries.id)}" data-open-game="${esc(targetSeries.game)}" data-open-region="${esc(targetSeries.region||'')}">查看完整卡表（${esc(gameName)}）›</button></div><div class="cards home-cards-grid">${rows.slice(0,8).map(c=>typeof cardMarkup==='function'?cardMarkup(c):'').join('')}</div>`;
      if(typeof activateCardActions==='function')activateCardActions(wrap.querySelector('.home-cards-grid'));
      wrap.querySelectorAll('[data-preview-game]').forEach(btn=>{btn.onclick=()=>{homePreviewGame=btn.dataset.previewGame;renderHomeCardsPreview(host,rawList)}});
      const moreBtn=wrap.querySelector('[data-open-series]');
      if(moreBtn)moreBtn.onclick=()=>{const select=regionSelect();if(select&&moreBtn.dataset.openRegion)select.value=moreBtn.dataset.openRegion;window.cardscopeEntry={series:moreBtn.dataset.openSeries};window.choose(moreBtn.dataset.openGame)};
    };
    const hasImg=card=>{const u=String((typeof image==='function'?image(card):card?.imageUrl)||card?.printings?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl||'');return Boolean(u)&&!u.includes('www.pokemon-card.com')};
    let fallbackSeries=null,fallbackRows=[];
    for(const targetSeries of ordered.slice(0,8)){
      const key=`${targetSeries.game}|${targetSeries.id}`;
      let rows=homeCardsCache.get(key);
      if(!rows){
        try{
          const params=new URLSearchParams({game:targetSeries.game,series:targetSeries.id,region:targetSeries.region||'JP',limit:'12',offset:'0',sort:'rarity-desc'});
          const res=await fetch('/api/cards?'+params);
          if(res.ok){
            const body=await res.json();
            rows=Array.isArray(body.data)?body.data:[];
            if(rows.length)homeCardsCache.set(key,rows);
          }else rows=[];
        }catch{rows=[]}
      }
      if(!rows.length)continue;
      if(!fallbackSeries){fallbackSeries=targetSeries;fallbackRows=rows}
      const withImg=rows.filter(hasImg);
      if(withImg.length>=4)return draw(targetSeries,[...withImg,...rows.filter(c=>!hasImg(c))].slice(0,8));
    }
    if(fallbackSeries)draw(fallbackSeries,fallbackRows);
  }
  function render(){
    const anchor=document.getElementById('gameContext');let band=document.getElementById('seriesBand');
    if(game==='all'||!anchor){band?.remove();return}
    if(!band){band=document.createElement('section');band.id='seriesBand';band.className='series-band';band.setAttribute('aria-label','系列與商品快速入口');anchor.after(band)}
    const regions=ensureRegion(),region=regionSelect()?.value||'all',inRegion=item=>item.game===game&&(region==='all'||item.region===region);
    const series=(C.series||[]).filter(inRegion),products=(P||[]).filter(inRegion),buckets=orderBuckets(seriesGroupBuckets(series));
    const seen=recent().map(id=>series.find(item=>item.id===id)).filter(Boolean);
    const categories=PRODUCT_CATEGORY_DEFINITIONS.filter(item=>item.id!=='singles').map(item=>({...item,rows:products.filter(row=>productMatchesCategory(row,item.id))})).filter(item=>item.rows.length);
    const needles=(bandSearch?.game===game?bandSearch.terms:[]).map(fold).filter(Boolean),matches=item=>needles.length&&[item.nameZh,item.nameJa,item.nameEn,item.officialCode,...(item.aliases||[])].some(value=>{const name=fold(value);return name&&needles.some(needle=>name.includes(needle))});
    const found=needles.length?[...byDate(series.filter(matches)).map(item=>['series',item]),...byDate(products.filter(matches)).map(item=>['product',item])].slice(0,60):[];
    // The same names in this IP's other regions: offered as one-click switches so a region-limited search is never a dead end.
    const perRegion={};if(needles.length)for(const item of [...(C.series||[]),...(P||[])])if(item.game===game&&item.region&&matches(item))perRegion[item.region]=(perRegion[item.region]||0)+1;
    const elsewhere=needles.length?regions.filter(id=>id!==region&&perRegion[id]).map(id=>[id,perRegion[id]]):[];
    searchSummary={here:found.length,others:elsewhere,label:regionText(region)||''};
    // [id, text, hint, count, unit]: the count comes from lists already in memory (no extra request); unit feeds the screen-reader label.
    const tabs=[...(found.length||elsewhere.length?[['search',`搜尋：${bandSearch.query}`,'',found.length,'項']]:[]),['latest','全部系列','',series.length,'個系列'],...(seen.length?[['recent','最近瀏覽','',seen.length,'個系列']]:[]),...categories.map(item=>[`product:${item.id}`,label(item),item.description,item.rows.length,'項商品']),...buckets.map(bucket=>[`group:${bucket.label}`,bucket.label,'',bucket.items.length,'個系列'])];
    let active=bandTab[game]||'latest';if(!tabs.some(([id])=>id===active))active='latest';bandTab[game]=active;
    // 兔子格開最新已發售系列；dated 的第一筆可能是即將發售
    const dated=byDate(series),newest=dated.find(item=>!(item.releaseDate&&item.releaseDate>today()))||dated[0],firstEraTab=categories.length?tabs.findIndex(([id])=>id.startsWith('group:')):-1;
    let kind='series',list;
    if(active==='search')list=found;
    else if(active==='latest')list=dated;
    else if(active==='recent')list=seen;
    else if(active.startsWith('product:')){kind='product';list=byDate(categories.find(item=>`product:${item.id}`===active)?.rows||[]).slice(0,60)}
    else list=byDate(buckets.find(bucket=>`group:${bucket.label}`===active)?.items||[]);
    const key=`${game}|${region}|${active}|${list.length}`,keep=band.dataset.key===key?band.querySelector('.series-band-rail')?.scrollLeft||0:0;
    band.dataset.key=key;
    band.innerHTML=`<div class="series-band-head"><div class="series-band-regions" role="group" aria-label="地區版本">${regions.map(id=>`<button type="button" data-region="${id}" aria-pressed="${id===region}" class="${id===region?'on':''}">${esc(regionText(id)||id)}</button>`).join('')}</div></div>`
      +`<div class="series-band-tabs" role="tablist" aria-label="系列與商品分類">${tabs.map(([id,text,hint,count,unit],index)=>`<button type="button" role="tab" aria-selected="${id===active}" class="${id===active?'on':''}${index===firstEraTab?' starts-eras':''}" data-band-tab="${esc(id)}"${hint?` title="${esc(hint)}"`:''} aria-label="${esc(`${text}，${count} ${unit}`)}">${esc(text)} <span class="count" aria-hidden="true">${count}</span></button>`).join('')}</div>`
      +(active==='search'&&elsewhere.length?`<div class="series-band-regions series-band-elsewhere" role="group" aria-label="其他版本的搜尋結果"><span class="series-band-note">其他版本也有符合：</span>${elsewhere.map(([id,count])=>`<button type="button" data-search-region="${id}">${esc(regionText(id)||id)} ${count} 項</button>`).join('')}</div>`:'')
      +`<div class="series-band-rail" role="tabpanel">${(list.length?(newest?mascotNewTile(newest):'')+list.map(item=>Array.isArray(item)?tile(item[0],item[1]):tile(kind,item)).join(''):'')||`<p class="series-band-empty">${window.catalogPartial?'系列資料載入中…':active==='search'?`${esc(regionText(region)||'')}沒有符合的系列或商品。`:`${esc(regionText(region)||'')}目前沒有收錄這一類。`}</p>`}</div>`;
    band.querySelector('.series-band-rail').scrollLeft=keep;
    const current=browse.product?.id||browse.seriesId;if(current)band.querySelector(`.band-tile:not(.is-mascot-new)[data-id="${CSS.escape(String(current))}"]`)?.setAttribute('aria-current','true');
    band.onclick=event=>{
      const regionButton=event.target.closest('[data-region],[data-search-region]'),target=regionButton?.dataset.region||regionButton?.dataset.searchRegion;
      if(regionButton){const select=regionSelect();if(select&&select.value!==target){select.value=target;select.dispatchEvent(new Event('change',{bubbles:true}))}return}
      const tab=event.target.closest('[data-band-tab]');if(tab){bandTab[game]=tab.dataset.bandTab;render();return}
      const card=event.target.closest('.band-tile');if(!card)return;
      if(card.dataset.kind==='mascot-new'){bandTab[game]='latest';if(newest)openSeries(newest);else render();return}
      if(card.dataset.kind==='product'){openProduct(card.dataset.id).then(render);scrollBelowHeader(document.getElementById('selectedProduct'));return}
      const item=series.find(row=>row.id===card.dataset.id);if(item)openSeries(item);
    };
  }
  const previous=series;
  series=function(){if(game!=='all')ensureRegion();previous();render()};
  window.renderSeriesBand=render;window.openBandSeries=openSeries;window.openLatestSeries=openLatestSeries;window.renderHomeLatest=renderHome;
  // Called by search(): opens the search tab when something matches and returns {here, others:[[region,count]], label}: matches in this region and in the IP's other regions.
  window.setBandSearch=(query,terms)=>{bandSearch=query?{query,game,terms:terms?.length?terms:[query]}:null;if(bandSearch)bandTab[game]='search';render();return bandSearch?searchSummary:{here:0,others:[],label:''}};
  if(typeof game!=='undefined'&&typeof C!=='undefined')render();
})();
