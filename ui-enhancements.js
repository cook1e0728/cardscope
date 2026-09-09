const uiLocal={get(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
let cardViewMode='grid';
let activeDetailCardId=null;
let favoritesOnly=uiLocal.get('cardscope-favorites-only','0')==='1';
const favoriteIds=new Set(readUiArray('cardscope-favorites'));
const watchlist=readUiObject('cardscope-watchlist');
const watchlistMeta=readUiObject('cardscope-watchlist-meta');

const renderSeriesForSelectedGame=series;
series=function(){
  if(game!=='all')return renderSeriesForSelectedGame();
  const host=$('series'),controls=document.getElementById('seriesControls');
  if(controls)controls.remove();
  if(host){host.classList.add('series-nav-host');host.innerHTML='<div class="browse-gate"><b>商品與系列會依 IP 分開</b><span>先選擇單一遊戲，這裡才會顯示該 IP 的系列、版本與最近瀏覽。</span></div>'}
};

function readUiArray(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.map(String):[]}catch{return[]}}
function readUiObject(key){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}}
function saveUiArray(key,value){uiLocal.set(key,JSON.stringify([...value]))}
function saveUiObject(key,value){uiLocal.set(key,JSON.stringify(value))}
function cardRarityLabel(card){return String(card.rarity||card.printings?.find(printing=>printing.rarity)?.rarity||'稀有度待補')}
function cardNumberLabel(card){return card.officialCardNumber||card.printings?.find(printing=>printing.localCardNumber)?.localCardNumber||'卡號待補'}
function cardPriceLabel(price){return price&&Number.isFinite(Number(price.price))&&price.currency?`${e(price.currency)} ${Number(price.price).toLocaleString()} 買取`:''}
function cardGameLabel(card){const catalogName=G(card.game).nameZh;if(catalogName)return catalogName;return (window.CARD_GAMES||[]).find(item=>item.id===card.game)?.name||card.game||'IP 待補'}
function isFavorite(id){return favoriteIds.has(String(id))}
function watchQuantity(id){const value=Number(watchlist[String(id)]);return Number.isInteger(value)&&value>0?value:0}
function allKnownCards(){const rows=[...(currentCardRows||[]),...(C?.cards||[])];return [...new Map(rows.map(card=>[String(card.id),card])).values()]}
function cardForWatch(id){const card=allKnownCards().find(item=>String(item.id)===String(id));if(card)return card;const snapshot=watchlistMeta[String(id)];return snapshot?{...snapshot,__watchlistSnapshot:true}:null}

const cardscopeBaseFilteredCards=typeof filteredCards==='function'?filteredCards:null;
if(cardscopeBaseFilteredCards){
  filteredCards=function(rows){const result=cardscopeBaseFilteredCards(rows);return favoritesOnly?result.filter(card=>isFavorite(card.id)):result};
}

function missingImageMarkup(message='圖片來源尚未收錄'){
  return `<span class="image-fallback unified-image-fallback"><b>圖片待補</b><small>${e(message)}</small></span>`;
}

function cardGameId(card){return typeof card?.game==='object'?card.game.id:card?.game}
function cardHasEmbeddedSample(card,src){
  const gameId=cardGameId(card),values=[src,card?.imageUrl,card?.imageSource,...(card?.images||[]).flatMap(item=>[item.imageUrl,item.sourceUrl,item.source]),...(card?.printings||[]).flatMap(item=>[item.imageUrl,item.sourceUrl,item.source])].filter(Boolean);
  const joined=values.map(value=>{try{return decodeURIComponent(String(value))}catch{return String(value)}}).join(' ').toLowerCase();
  return gameId==='onepiece'&&(/(?:asia-tc|asia-en)\.onepiece-cardgame\.com/.test(joined)||joined.includes('/api/images/onepiece?'))||gameId==='weiss-schwarz'&&joined.includes('ws-tcg.com');
}
function cardIsSigned(card){
  const values=[card?.rarity,...(card?.printings||[]).flatMap(item=>[item.rarity,item.rarityCode,item.rarityLabel,item.metadata?.variantKey,item.metadata?.variantName])].filter(Boolean).join(' ').toUpperCase();
  return /(^|[^A-Z0-9])(SSP|SP|SEC\+?|OFR|AGR|SIGNED|SIGNATURE|AUTOGRAPH)([^A-Z0-9]|$)/.test(values);
}
function cardWatermarkOptions(card,src){const embeddedSample=cardHasEmbeddedSample(card,src),signed=cardIsSigned(card);return{embeddedSample,signed,suppressOverlay:signed&&!embeddedSample}}

function resilientImage(src,alt,message,options={}){
  src=typeof displayImageUrl==='function'?displayImageUrl(src):src;
  if(!src)return missingImageMarkup(message);
  const sample=options.embeddedSample||options.suppressOverlay?'':`<span class="card-sample-watermark" aria-hidden="true">SAMPLE</span>`;
  return `<img src="${e(src)}" alt="${e(alt)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false;const sample=this.parentElement.querySelector('.card-sample-watermark');if(sample)sample.hidden=true"><span class="image-fallback unified-image-fallback" hidden><b>圖片待補</b><small>${e(message||'圖片來源尚未收錄')}</small></span>${sample}`;
}

function installViewToggle(){
  const tools=$('cardTools');if(!tools||$('cardViewSwitch'))return;
  const host=document.createElement('div');host.id='cardViewSwitch';host.className='view-switch';host.setAttribute('aria-label','卡片瀏覽模式');
  host.innerHTML=`<button type="button" data-view="grid">圖鑑模式</button><button type="button" data-view="list">清單模式</button><button type="button" data-view="rarity">稀有度分組</button>`;
  tools.prepend(host);host.onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;cardViewMode=button.dataset.view;if(cardViewMode==='rarity'&&!String(cardFilters.sort).startsWith('rarity-')){cardFilters.sort='rarity-desc';const sortControl=$('cardSort');if(sortControl)sortControl.value='rarity-desc'}drawViewButtons();if(game!=='all'&&cardViewMode==='rarity')loadCardsPage(true);else cards(currentCardRows,true)};drawViewButtons();
}
function drawViewButtons(){document.querySelectorAll('#cardViewSwitch [data-view]').forEach(button=>button.classList.toggle('on',button.dataset.view===cardViewMode))}

function cardActionsMarkup(card){
  const id=e(card.id),favorite=isFavorite(card.id),quantity=watchQuantity(card.id);
  return `<div class="card-actions" data-action="card-actions"><button type="button" class="favorite-toggle" data-action="favorite" data-favorite-id="${id}" aria-pressed="${favorite}" aria-label="${favorite?'取消收藏':'加入收藏'}" title="${favorite?'取消收藏':'加入收藏'}">${favorite?'★':'☆'}</button><div class="watchlist-inline" data-action="watchlist" aria-label="追蹤清單數量"><button type="button" data-watch-decrement="${id}" aria-label="減少數量"${quantity?'':' disabled'}>−</button><span data-watch-quantity="${id}">${quantity}</span><button type="button" data-watch-increment="${id}" aria-label="增加數量">＋</button></div></div>`;
}

function cardMarkup(card){
  const source=image(card),price=priceFor(card),number=cardNumberLabel(card),rarity=cardRarityLabel(card),region=rn(card.region||card.printings?.[0]?.region),gameLabel=cardGameLabel(card),picture=resilientImage(source,name(card),'這張卡尚未收錄可公開顯示的圖片',cardWatermarkOptions(card,source)),id=e(card.id),priceMarkup=cardPriceLabel(price);
  if(cardViewMode==='list')return `<article class="card card-list" data-card-open="${id}"><div class="art">${picture}</div><div class="card-list-main"><span class="badge ip-badge">${e(gameLabel)}</span><h3>${e(name(card))}</h3><div class="meta">${e(original(card)&&original(card)!==name(card)?original(card):'原名待補')}</div></div><div class="card-list-facts"><b>${e(number)}</b><span>${e(rarity)}</span><span class="badge">${e(region)}</span>${priceMarkup?`<strong>${priceMarkup}</strong>`:'<span class="meta">可靠價格待補</span>'}</div>${cardActionsMarkup(card)}</article>`;
  return `<article class="card" data-card-open="${id}"><div class="art">${picture}</div><span class="badge ip-badge">${e(gameLabel)}</span><h3>${e(name(card))}</h3><div class="meta">${e(number)} · ${e(rarity)}</div>${priceMarkup?`<div class="card-price">${priceMarkup}</div>`:''}<span class="badge">${e(region)}</span>${cardActionsMarkup(card)}</article>`;
}

function activateCardActions(root=$('cards')){
  if(!root)return;
  root.querySelectorAll('[data-card-open]').forEach(card=>{card.onclick=event=>{if(event.target.closest('[data-action]'))return;openCard(card.dataset.cardOpen)}});
  root.querySelectorAll('[data-favorite-id]').forEach(button=>{button.onclick=event=>{event.stopPropagation();toggleFavorite(button.dataset.favoriteId)}});
  root.querySelectorAll('[data-watch-increment]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchIncrement,watchQuantity(button.dataset.watchIncrement)+1)}});
  root.querySelectorAll('[data-watch-decrement]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchDecrement,watchQuantity(button.dataset.watchDecrement)-1)}});
}

function renderCardEmpty(){return `<div class="cards-empty mascot-empty"><img src="/assets/brand/rabbit-offline.png" alt="奔跑中的 CardScope 兔子" loading="lazy"><div><b>兔子還在尋找卡片</b><p>若是尚未發售商品，代表官方尚未公開卡表；圖片待補時也會保留卡片資料。</p></div></div>`}

function renderCardRows(rows){
  if(cardViewMode!=='rarity')return rows.length?rows.map(cardMarkup).join(''):renderCardEmpty();
  const groups=new Map();rows.forEach(card=>{const rarity=cardRarityLabel(card),gameLabel=cardGameLabel(card),key=`${card.game||'unknown'}\u0000${rarity}`;if(!groups.has(key))groups.set(key,{gameId:card.game||'unknown',gameLabel,rarity,cards:[]});groups.get(key).cards.push(card)});
  const direction=cardFilters.sort==='rarity-asc'?'asc':'desc',gameOrder=new Map((window.CARD_GAMES||[]).map((item,index)=>[item.id,index])),ordered=[...groups.values()].sort((a,b)=>(gameOrder.get(a.gameId)??999)-(gameOrder.get(b.gameId)??999)||compareRarityLabels(a.gameId,a.rarity,b.rarity,direction));
  return ordered.length?ordered.map(({gameLabel,rarity,cards:cardsForRarity},groupIndex)=>`<section class="rarity-group" aria-labelledby="rarity-${groupIndex}"><header><h3 id="rarity-${groupIndex}"><span>${e(gameLabel)}</span>｜<span>${e(rarity)}</span></h3><span>${cardsForRarity.length.toLocaleString()} 張</span></header><div class="cards rarity-group-cards">${cardsForRarity.map(cardMarkup).join('')}</div></section>`).join(''):renderCardEmpty();
}

cards=function(rows,keepSource=false){
  if(!keepSource){currentCardRows=rows;refreshRarityOptions(rows)}
  const shown=filteredCards(currentCardRows),host=$('cards');host.classList.toggle('list-view',cardViewMode==='list');host.classList.toggle('rarity-view',cardViewMode==='rarity');drawViewButtons();
  $('filterSummary').textContent=`目前載入 ${currentCardRows.length.toLocaleString()} 張，篩選後 ${shown.length.toLocaleString()} 張${favoritesOnly?'；目前只看收藏':''}；價格僅採可驗證買取資料`;
  host.innerHTML=renderCardRows(shown);activateCardActions(host);renderFavoritesControl();renderWatchlistSummary();
};

function renderFavoritesControl(){
  const control=$('favoritesOnly');if(!control)return;
  control.classList.toggle('on',favoritesOnly);control.setAttribute('aria-pressed',String(favoritesOnly));control.textContent=`只看收藏（${favoriteIds.size}）`;
}

function toggleFavorite(id){
  const key=String(id);if(favoriteIds.has(key))favoriteIds.delete(key);else favoriteIds.add(key);
  saveUiArray('cardscope-favorites',favoriteIds);cards(currentCardRows,true);
}

function showCollectionToast(){
  let toast=$('brandCollectionToast');
  if(!toast){toast=document.createElement('div');toast.id='brandCollectionToast';toast.className='brand-collection-toast';toast.setAttribute('role','status');document.body.append(toast)}
  toast.innerHTML='<img src="/assets/brand/rabbit-success.jpg" alt=""><div><b>已加入追蹤清單</b><span>彩虹寶箱兔幫你收好了</span></div>';
  toast.classList.add('show');clearTimeout(showCollectionToast.timer);showCollectionToast.timer=setTimeout(()=>toast.classList.remove('show'),2600);
}

function setWatchQuantity(id,quantity){
  const key=String(id),previous=watchQuantity(key),next=Math.max(0,Math.min(999,Number(quantity)||0));
  if(next){
    watchlist[key]=next;
    const card=allKnownCards().find(item=>String(item.id)===key);
    if(card)watchlistMeta[key]={id:key,game:card.game,nameZh:card.nameZh,nameEn:card.nameEn,nameJa:card.nameJa,nameKo:card.nameKo,officialCardNumber:card.officialCardNumber,rarity:card.rarity,region:card.region};
  }else{delete watchlist[key];delete watchlistMeta[key]}
  saveUiObject('cardscope-watchlist',watchlist);saveUiObject('cardscope-watchlist-meta',watchlistMeta);cards(currentCardRows,true);if(previous===0&&next>0)showCollectionToast();
}

function watchlistEntries(){
  return Object.entries(watchlist).map(([id,quantity])=>({id,quantity:watchQuantity(id),card:cardForWatch(id)})).filter(entry=>entry.quantity>0);
}

function watchlistTotals(){
  const totals=new Map();watchlistEntries().forEach(({card,quantity})=>{if(!card||card.__watchlistSnapshot)return;const price=priceFor(card),amount=price&&Number(price.price),currency=price&&String(price.currency||'').trim();if(!Number.isFinite(amount)||!currency)return;totals.set(currency,(totals.get(currency)||0)+amount*quantity)});return totals;
}

function renderWatchlistSummary(){
  const host=$('watchlistSummary');if(!host)return;
  const entries=watchlistEntries(),totalQuantity=entries.reduce((sum,entry)=>sum+entry.quantity,0),totals=watchlistTotals(),verified=[...totals].map(([currency,amount])=>`${e(currency)} ${amount.toLocaleString()}`).join(' ／ ');
  host.innerHTML=`<div><b>我的追蹤清單</b><span> ${entries.length} 張、${totalQuantity} 件</span><small>僅儲存在此裝置，不會送出採購或販售。</small>${verified?`<em>已驗證總價：${verified}</em>`:'<em>已驗證總價：目前沒有可合併的可靠價格</em>'}</div><button type="button" id="downloadWatchlist"${entries.length?'':' disabled'}>下載清單 CSV</button>`;
  const button=$('downloadWatchlist');if(button)button.onclick=downloadWatchlistCsv;
}

function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`}
function downloadWatchlistCsv(){
  const entries=watchlistEntries();if(!entries.length)return;
  const header=['卡片 ID','名稱','原名','官方卡號','稀有度','數量','已驗證價格幣別','已驗證單價','已驗證小計'];
  const rows=entries.map(({id,quantity,card})=>{const price=card&&!card.__watchlistSnapshot&&priceFor(card),amount=price&&Number(price.price),valid=Number.isFinite(amount)&&price.currency;return[id,card?name(card):'卡片資料待載入',card?original(card):'',card?cardNumberLabel(card):'',card?cardRarityLabel(card):'',quantity,valid?price.currency:'',valid?amount:'',valid?amount*quantity:''].map(csvCell).join(',')});
  const blob=new Blob([`\uFEFF${[header.map(csvCell).join(','),...rows].join('\r\n')}`],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='cardscope-watchlist.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}

function installCardUtilities(){
  const tools=$('cardTools');if(!tools||$('favoritesOnly'))return;
  const favoriteButton=document.createElement('button');favoriteButton.type='button';favoriteButton.id='favoritesOnly';favoriteButton.className='favorites-filter';favoriteButton.setAttribute('aria-pressed',String(favoritesOnly));favoriteButton.onclick=()=>{favoritesOnly=!favoritesOnly;uiLocal.set('cardscope-favorites-only',favoritesOnly?'1':'0');cards(currentCardRows,true)};
  const summary=document.createElement('div');summary.id='watchlistSummary';summary.className='watchlist-summary';tools.append(favoriteButton,summary);renderFavoritesControl();renderWatchlistSummary();
}

function cardTextBlock(card){
  const metadata=card.metadata||{},originalText=metadata.effectText||metadata.cardText||metadata.ability||metadata.text||metadata.effect||null,translatedText=metadata.effectTextZh||metadata.cardTextZh||metadata.abilityZh||metadata.textZh||null;
  if(!originalText)return '<div class="state">目前資料來源沒有提供可切換的技能／效果全文；不以自行生成內容補空白。</div>';
  if(!translatedText)return `<div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>中文翻譯尚未收錄；不以未驗證翻譯冒充官方內容。</div>`;
  return `<div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>${e(translatedText)}<small>機器翻譯僅供參考，請以卡面原文與官方規則為準。</small></div>`;
}

let cardZoomReturnFocus=null;

function collectImageSources(value){
  const sources=[],seen=new Set();
  const push=source=>{if(typeof source!=='string')return;const clean=source.trim();if(clean&&!seen.has(clean)){seen.add(clean);sources.push(clean)}};
  const visit=(record,depth=0)=>{
    if(record==null||depth>2)return;
    if(typeof record==='string'){push(record);return}
    if(Array.isArray(record)){record.forEach(item=>visit(item,depth+1));return}
    if(typeof record!=='object')return;
    for(const key of ['highResImageUrl','highResolutionImageUrl','highResUrl','high','imageUrlHiRes','originalImageUrl','originalUrl','original','largeImageUrl','largeUrl','large','imageUrl','image_url','url','src','href'])visit(record[key],depth+1);
    for(const key of ['sources','images','image','imageData','metadata'])visit(record[key],depth+1);
  };
  visit(value);
  return sources;
}

function cardImageSourceCandidates(card,selectedPrinting){
  const candidates=[];
  const add=value=>collectImageSources(value).forEach(source=>{const displaySource=typeof displayImageUrl==='function'?displayImageUrl(source):source;if(!candidates.includes(displaySource))candidates.push(displaySource)});
  // Keep the selected region/language first. The API may provide explicit high-resolution
  // fields on either the printing or its card_images record; use those when available.
  add(selectedPrinting?.metadata);
  add(selectedPrinting);
  if(selectedPrinting&&Array.isArray(card?.images)){
    const sameLanguage=card.images.filter(item=>!selectedPrinting.language||!item.language||item.language===selectedPrinting.language);
    add(sameLanguage);
  }
  add(card);
  if(typeof image==='function')add(image(card));
  return candidates;
}

function cardZoomSourcesFromElement(tilt){
  if(!tilt)return[];
  if(tilt.dataset.cardZoomSources){
    try{return collectImageSources(JSON.parse(tilt.dataset.cardZoomSources))}catch{}
  }
  return collectImageSources(tilt.dataset.cardZoomSrc);
}

function closeCardZoom(){
  const zoom=$('cardZoom');
  if(!zoom)return;
  zoom.classList.remove('open');
  zoom.setAttribute('aria-hidden','true');
  document.body?.classList.remove('card-zoom-open');
  const returnFocus=cardZoomReturnFocus;cardZoomReturnFocus=null;
  if(returnFocus&&returnFocus.isConnected!==false&&typeof returnFocus.focus==='function')returnFocus.focus();
}

function openCardZoom(source,alt,options={}){
  const sources=collectImageSources(source).concat(collectImageSources(options.sources||options.fallback)).filter((item,index,array)=>array.indexOf(item)===index);
  if(!sources.length)return;
  let zoom=$('cardZoom');
  if(!zoom){
    zoom=document.createElement('div');
    zoom.id='cardZoom';
    zoom.className='card-zoom';
    zoom.setAttribute('role','dialog');
    zoom.setAttribute('aria-modal','true');
    zoom.setAttribute('aria-label','卡片放大檢視');
    document.body.append(zoom);
  }
  const activeElement=document.activeElement;
  if(!zoom.classList.contains('open')&&activeElement&&activeElement!==zoom)cardZoomReturnFocus=activeElement;
  const sampleMarkup=options.embeddedSample||options.suppressOverlay?'':`<span class="card-sample-watermark card-sample-watermark-zoom" aria-hidden="true">SAMPLE</span>`;
  zoom.innerHTML=`<button type="button" class="card-zoom-close" aria-label="關閉放大卡圖" title="關閉">×</button><div class="card-zoom-viewport" tabindex="0" aria-label="卡片檢視區；可拖曳平移，觸控可雙指縮放"><div class="card-zoom-canvas"><img class="card-zoom-image" alt="${e(alt||'卡片')}放大卡圖" draggable="false"><span class="card-zoom-fallback" hidden role="status">圖片待補<br><small>目前來源無法顯示</small></span>${sampleMarkup}</div></div><div class="card-zoom-toolbar" role="toolbar" aria-label="卡片縮放工具"><button type="button" data-zoom-preset="fit" aria-label="適合視窗">適合視窗</button><button type="button" data-zoom-preset="1" aria-label="顯示 100%">100%</button><button type="button" data-zoom-preset="2" aria-label="顯示 200%">200%</button><button type="button" data-zoom-preset="4" aria-label="顯示 400%">400%</button><span class="card-zoom-divider" aria-hidden="true"></span><button type="button" data-zoom-action="out" aria-label="縮小卡圖" title="縮小">−</button><output data-zoom-label aria-live="polite">適合視窗</output><button type="button" data-zoom-action="in" aria-label="放大卡圖" title="放大">＋</button><button type="button" data-zoom-action="reset" aria-label="重設卡圖位置與縮放" title="重設">重設</button></div>`;
  zoom.classList.add('open');
  zoom.setAttribute('aria-hidden','false');
  document.body?.classList.add('card-zoom-open');

  const viewport=zoom.querySelector('.card-zoom-viewport'),canvas=zoom.querySelector('.card-zoom-canvas'),img=zoom.querySelector('.card-zoom-image'),fallback=zoom.querySelector('.card-zoom-fallback'),sample=zoom.querySelector('.card-sample-watermark'),label=zoom.querySelector('[data-zoom-label]'),close=zoom.querySelector('.card-zoom-close');
  const state={scale:1,mode:'fit',x:0,y:0,pointers:new Map(),gesture:null,sourceIndex:0};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const viewportGeometry=()=>{const rect=viewport?.getBoundingClientRect?.();return{left:rect?.left||0,top:rect?.top||0,width:rect?.width||viewport?.clientWidth||window.innerWidth||900,height:rect?.height||viewport?.clientHeight||window.innerHeight||700}};
  const viewportSize=()=>{const {width,height}=viewportGeometry();return{width,height}};
  const panLimits=()=>{const size=viewportSize(),baseWidth=canvas?.clientWidth||size.width,baseHeight=canvas?.clientHeight||size.height;return{x:Math.max(0,(baseWidth*state.scale-size.width)/2),y:Math.max(0,(baseHeight*state.scale-size.height)/2)}};
  const applyZoom=()=>{
    const limits=panLimits();state.x=clamp(state.x,-limits.x,limits.x);state.y=clamp(state.y,-limits.y,limits.y);
    if(img)img.style.transform=`translate3d(${state.x.toFixed(2)}px,${state.y.toFixed(2)}px,0) scale(${state.scale.toFixed(3)})`;
    const zoomText=state.scale===1&&state.mode==='fit'?'適合視窗':`${Math.round(state.scale*100)}%`;
    if(label)label.value=zoomText;
    if(label)label.textContent=zoomText;
    if(viewport)viewport.classList.toggle('is-zoomed',state.scale>1);
  };
  const setZoom=(requested,anchor)=>{
    const previous=state.scale,next=requested==='fit'?1:clamp(Number(requested)||1,1,4);
    if(anchor&&previous!==next){const geometry=viewportGeometry(),point={x:anchor.clientX-geometry.left-geometry.width/2,y:anchor.clientY-geometry.top-geometry.height/2};state.x=point.x-(point.x-state.x)*(next/previous);state.y=point.y-(point.y-state.y)*(next/previous)}
    state.scale=next;state.mode=requested==='fit'?'fit':'percent';if(next===1&&requested==='fit'){state.x=0;state.y=0}applyZoom();
  };
  const stepZoom=direction=>{const levels=[1,2,4],next=direction>0?levels.find(level=>level>state.scale+.01)||4:[...levels].reverse().find(level=>level<state.scale-.01)||1;setZoom(next)};
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const pointerPosition=event=>({x:event.clientX,y:event.clientY});
  const beginGesture=()=>{
    const entries=[...state.pointers.entries()];
    if(entries.length>=2){const first=entries[0][1],second=entries[1][1],mid=midpoint(first,second);state.gesture={type:'pinch',startDistance:Math.max(1,distance(first,second)),startScale:state.scale,startX:state.x,startY:state.y,startMid:mid};return}
    const entry=entries[0];if(entry)state.gesture={type:'pan',pointerId:entry[0],startPointer:entry[1],startX:state.x,startY:state.y};
  };
  const updateGesture=()=>{
    const entries=[...state.pointers.entries()];
    if(state.gesture?.type==='pinch'&&entries.length>=2){
      const first=entries[0][1],second=entries[1][1],mid=midpoint(first,second),g=state.gesture,geometry=viewportGeometry(),startPoint={x:g.startMid.x-geometry.left-geometry.width/2,y:g.startMid.y-geometry.top-geometry.height/2},next=clamp(g.startScale*(distance(first,second)/g.startDistance),1,4);state.scale=next;state.x=startPoint.x-(startPoint.x-g.startX)*(next/g.startScale)+(mid.x-g.startMid.x);state.y=startPoint.y-(startPoint.y-g.startY)*(next/g.startScale)+(mid.y-g.startMid.y);applyZoom();return}
    if(state.gesture?.type==='pan'&&entries.length===1){const entry=entries[0][1],g=state.gesture;state.x=g.startX+entry.x-g.startPointer.x;state.y=g.startY+entry.y-g.startPointer.y;applyZoom()}
  };
  const endPointer=event=>{state.pointers.delete(event.pointerId);if(state.pointers.size)beginGesture();else state.gesture=null};

  img.onload=()=>{img.hidden=false;if(fallback)fallback.hidden=true;if(sample)sample.hidden=false;applyZoom()};
  img.onerror=()=>{if(state.sourceIndex<sources.length-1){state.sourceIndex+=1;img.src=sources[state.sourceIndex];return}img.hidden=true;if(fallback)fallback.hidden=false;if(sample)sample.hidden=true};
  img.src=sources[0];
  if(img.complete&&img.naturalWidth)img.onload();
  close?.addEventListener('click',closeCardZoom);
  zoom.onclick=event=>{if(event.target===zoom)closeCardZoom()};
  zoom.querySelectorAll('[data-zoom-preset]').forEach(button=>button.addEventListener('click',()=>setZoom(button.dataset.zoomPreset)));
  zoom.querySelector('[data-zoom-action="out"]')?.addEventListener('click',()=>stepZoom(-1));
  zoom.querySelector('[data-zoom-action="in"]')?.addEventListener('click',()=>stepZoom(1));
  zoom.querySelector('[data-zoom-action="reset"]')?.addEventListener('click',()=>setZoom('fit'));
  viewport?.addEventListener('wheel',event=>{event.preventDefault();setZoom(clamp(state.scale*(event.deltaY<0?1.25:.8),1,4),event)},{passive:false});
  viewport?.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;event.preventDefault();viewport.setPointerCapture?.(event.pointerId);state.pointers.set(event.pointerId,pointerPosition(event));beginGesture()});
  viewport?.addEventListener('pointermove',event=>{if(!state.pointers.has(event.pointerId))return;event.preventDefault();state.pointers.set(event.pointerId,pointerPosition(event));updateGesture()});
  viewport?.addEventListener('pointerup',endPointer);viewport?.addEventListener('pointercancel',endPointer);viewport?.addEventListener('lostpointercapture',event=>{if(state.pointers.has(event.pointerId))endPointer(event)});
  zoom.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();closeCardZoom();return}
    if(event.key==='+'||event.key==='='){event.preventDefault();stepZoom(1);return}
    if(event.key==='-'||event.key==='_'){event.preventDefault();stepZoom(-1);return}
    if(event.key!=='Tab')return;
    const focusable=[...zoom.querySelectorAll('button,[tabindex="0"]')].filter(item=>!item.disabled&&!item.hidden),first=focusable[0],last=focusable.at(-1);if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  close?.focus();
  return zoom;
}

function activateDetailInteractions(){
  document.querySelectorAll('[data-detail-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-detail-tab]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==button.dataset.detailTab)});
  document.querySelectorAll('[data-text-mode]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-text-mode]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-text-panel]').forEach(panel=>panel.hidden=panel.dataset.textPanel!==button.dataset.textMode)});
  document.querySelectorAll('[data-card-step]').forEach(button=>button.onclick=()=>openAdjacentCard(Number(button.dataset.cardStep)));
  document.querySelectorAll('.tilt-card').forEach(tilt=>{
    const surface=tilt.querySelector('.tilt-card-surface');
    const reset=()=>{surface.style.setProperty('--tilt-x','0deg');surface.style.setProperty('--tilt-y','0deg');surface.style.setProperty('--shine-opacity','0')};
    tilt.onpointermove=event=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const rect=tilt.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));surface.style.setProperty('--tilt-x',`${((.5-y)*12).toFixed(2)}deg`);surface.style.setProperty('--tilt-y',`${((x-.5)*14).toFixed(2)}deg`);surface.style.setProperty('--shine-x',`${(x*100).toFixed(1)}%`);surface.style.setProperty('--shine-y',`${(y*100).toFixed(1)}%`);surface.style.setProperty('--shine-opacity','.38')};
    tilt.onpointerleave=reset;tilt.onblur=reset;
    if(tilt.dataset.cardZoomSrc||tilt.dataset.cardZoomSources){const sources=()=>cardZoomSourcesFromElement(tilt),options=()=>({embeddedSample:tilt.dataset.cardEmbeddedSample==='1',suppressOverlay:tilt.dataset.cardSuppressSample==='1'});tilt.classList.add('can-zoom');tilt.onclick=()=>openCardZoom(sources(),tilt.dataset.cardZoomAlt,options());tilt.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCardZoom(sources(),tilt.dataset.cardZoomAlt,options())}}}
  });
}

function detailRows(){const rows=filteredCards(currentCardRows||[]);return rows.length?rows:(currentCardRows||[])}
function openAdjacentCard(step){const rows=detailRows(),index=rows.findIndex(card=>String(card.id)===String(activeDetailCardId));if(index<0||rows.length<2)return;openCard(rows[(index+step+rows.length)%rows.length].id)}

openCard=async function(id){
  activeDetailCardId=id;$('modal').classList.add('open');$('detail').textContent='正在載入…';
  try{
    const [cr,mr,rr]=await Promise.all([fetch('/api/cards/'+encodeURIComponent(id)),fetch('/api/cards/'+encodeURIComponent(id)+'/market'),fetch('/api/reports?cardId='+encodeURIComponent(id)).catch(()=>null)]),cb=await cr.json(),mb=await mr.json(),rb=rr&&rr.ok?await rr.json():{data:{reports:[]}},c=cb.data,m=mb.data||{records:[],meta:{}},reports=rb.data?.reports||[];
    if(!cr.ok)throw Error(cb.error);
    const ps=c.printings||[],ref=ps.find(p=>p.region==='JP')||ps.find(p=>p.region==='TW')||ps.find(p=>p.region==='US')||ps.find(p=>p.region==='KR')||ps[0],versions=ps.map(p=>{const diff=[];if(ref&&p!==ref&&p.localCardNumber&&p.localCardNumber!==ref.localCardNumber)diff.push('卡號不同');if(ref&&p!==ref&&p.rarity&&ref.rarity&&p.rarity!==ref.rarity)diff.push('稀有度不同');return `<div class="state"><b>${e(rn(p.region))}</b>${p===ref?' · <span class="badge">比對基準</span>':''} · ${e(ln(p.language))} · ${e(p.localSetCode)} · ${e(p.localCardNumber)}${diff.length?`<br><span class="meta">版本差異：${e(diff.join('、'))}</span>`:''}</div>`}).join(''),markets=m.records?.length?m.records.map(r=>`<div class="market"><b>${e(r.provider)}</b> · ${e(r.priceType)} · ${e(r.currency)} ${Number(r.amount).toLocaleString()}</div>`).join(''):'<div class="state">目前沒有可靠對應價格，不以假價格補空白。</div>',reportList=reports.length?reports.map(r=>`<div class="state"><b>${e(r.platform)}</b> · ${e(r.currency)} ${Number(r.price).toLocaleString()}<br><span class="meta">使用者回報，尚未驗證</span></div>`).join(''):'<div class="state">目前沒有使用者回報。</div>';
    const selectedPrinting=ps.find(p=>c.referencePrintingId&&String(p.id??p.cardId)===String(c.referencePrintingId))||ps.find(p=>p.region===c.region&&p.language===c.language)||ps.find(p=>p.region==='JP')||ps.find(p=>p.region==='TW')||ps.find(p=>p.region==='US')||ps.find(p=>p.region==='KR')||ps[0],detailImageSources=cardImageSourceCandidates(c,selectedPrinting),detailImageUrl=detailImageSources[0]||image(c),detailSet=detailRows(),detailIndex=detailSet.findIndex(card=>String(card.id)===String(id)),position=detailIndex>=0?`${detailIndex+1} / ${detailSet.length}`:'目前卡片',zhName=c.nameZh||'中文名稱待補',originalName=original(c)||'原文名稱待補',rarities=[...new Set([c.rarity,...ps.map(p=>p.rarity)].filter(Boolean))].join('、')||'稀有度待補';
    const watermarkOptions=cardWatermarkOptions(c,detailImageUrl),zoomSourceAttribute=detailImageSources.length?`data-card-zoom-src="${e(detailImageSources[0])}" data-card-zoom-sources="${e(JSON.stringify(detailImageSources))}" data-card-zoom-alt="${e(name(c))}" data-card-embedded-sample="${watermarkOptions.embeddedSample?'1':'0'}" data-card-suppress-sample="${watermarkOptions.suppressOverlay?'1':'0'}"`:'';
    $('detail').innerHTML=`<div class="detail detail-tabs-layout"><div class="detail-visual"><div class="detail-visual-stage"><button class="detail-nav detail-prev" data-card-step="-1" aria-label="上一張卡" title="上一張卡">&#8592;</button><div class="detail-art tilt-card" tabindex="0" ${zoomSourceAttribute} aria-label="${detailImageUrl?'點擊放大卡圖；移動游標可傾斜查看':'卡片圖片待補'}"><div class="tilt-card-surface">${resilientImage(detailImageUrl,name(c),'這張卡尚未收錄可公開顯示的圖片',watermarkOptions)}<span class="tilt-shine" aria-hidden="true"></span></div></div><button class="detail-nav detail-next" data-card-step="1" aria-label="下一張卡" title="下一張卡">&#8594;</button></div><div class="detail-position"><span>${e(position)}</span><small>${detailImageUrl?'點擊卡圖可放大；移動游標可傾斜查看':'圖片來源待補'}</small></div><h2>${e(name(c))}</h2><dl class="card-identity"><div><dt>中文名</dt><dd>${e(zhName)}</dd></div><div><dt>原文名</dt><dd>${e(originalName)}</dd></div><div><dt>卡號</dt><dd>${e(c.officialCardNumber||'卡號待補')}</dd></div><div><dt>稀有度</dt><dd>${e(rarities)}</dd></div></dl><p>${e(c.game?.nameZh||G(c.game).nameZh||c.game)}</p></div><div><div class="detail-tabs" role="tablist"><button class="on" data-detail-tab="info">資訊</button><button data-detail-tab="market">跨市場比價</button><button data-detail-tab="trend">成交趨勢</button><button data-detail-tab="reports">使用者回報</button></div><section data-detail-panel="info"><h3>卡片文字</h3>${cardTextBlock(c)}<h3>收錄版本</h3><p class="meta">每個版本分別標示語言、卡號與稀有度；缺少日版時依序採台版、美版、韓版或其他版本作比對基準。</p>${versions||'<div class="state">版本待補</div>'}</section><section data-detail-panel="market" hidden><p class="meta">${e(m.meta?.warning||'不同價格性質不混算。')}</p>${markets}</section><section data-detail-panel="trend" hidden><div class="state">目前沒有足以建立可信成交趨勢的已驗證歷史資料，因此不顯示示範曲線或假交易量。</div></section><section data-detail-panel="reports" hidden>${reportList}</section></div></div>`;activateDetailInteractions();
  }catch(error){$('detail').innerHTML=`<div class="state">卡片資料載入失敗：${e(error.message)}</div>`}
};
window.openCard=openCard;

function installFeatureTour(){
  if($('cardscopeFeatureTour'))return;
  const section=document.createElement('details');section.id='cardscopeFeatureTour';section.className='feature-tour section';section.setAttribute('aria-label','CardScope 使用說明');
  section.innerHTML='<summary><span class="help-summary-copy"><b>快速使用說明</b><small>稀有度分組、收藏與追蹤清單</small></span><img src="/assets/brand/cardscope-rabbit-mark.png" alt="" loading="lazy"><span class="help-summary-chevron" aria-hidden="true">⌄</span></summary><div class="help-grid"><article class="help-item"><b>先選瀏覽方式</b><p>圖鑑模式看卡面，清單模式看欄位；需要依真實稀有度整理時，切換稀有度分組。</p></article><article class="help-item"><b>收藏與追蹤</b><p>卡片上的星號只儲存在此裝置；數量清單可用加減調整，價格只計入已驗證買取資料。</p></article><article class="help-item"><b>資料不足會明確標示</b><p>沒有可靠卡圖、名稱或價格時保留待補提示，不以生成內容補成官方資料。</p></article></div>';
  const footer=document.querySelector?.('.brand-footer'),notice=$('notice');
  if(footer)footer.insertAdjacentElement('beforebegin',section);else if(notice)notice.insertAdjacentElement('afterend',section);
}

async function installCatalogHealth(){
  if(document.getElementById('catalogHealth'))return;
  const section=document.createElement('details');section.id='catalogHealth';section.className='catalog-health';
  section.innerHTML='<summary>資料完整度與圖片權利狀態</summary><p class="health-note">正在讀取資料健康報告…</p>';
  const footer=document.querySelector('.brand-footer');if(footer)footer.insertAdjacentElement('beforebegin',section);
  try{
    const response=await fetch('/api/catalog/health',{cache:'no-store'}),body=await response.json();if(!response.ok)throw Error(body.error||'讀取失敗');
    const labels={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年','weiss-schwarz':'葬送的芙莉蓮'},games=body.data?.games||{};
    const healthTotal=Number(body.data?.totalCards||C.cards.length),status=$('status'),enforceHealthTotal=()=>{const expected=`資料庫收錄：${healthTotal.toLocaleString()} 張卡片；${P.length.toLocaleString()} 筆實體商品。各系列官方總數尚未核定時不顯示完成率。`;if(status&&status.textContent!==expected)status.textContent=expected};
    enforceHealthTotal();if(status){const observer=new MutationObserver(enforceHealthTotal);observer.observe(status,{childList:true,characterData:true,subtree:true});setTimeout(()=>observer.disconnect(),120000)}
    const riskDisplay=body.data?.policy?.unverifiedImageDisplayEnabled===true;
    section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><div class="health-grid">${Object.entries(labels).map(([id,label])=>{const row=games[id]||{};return`<div class="health-item"><b>${e(label)}｜${Number(row.cards||0).toLocaleString()} 張</b><span>中文名 ${Number(row.chineseNames||0).toLocaleString()} · 稀有度 ${Number(row.rarities||0).toLocaleString()}</span><span>圖片網址 ${Number(row.cardsWithImageUrls??row.displayableImages??0).toLocaleString()} · 明確授權 ${Number(row.displayableImages||0).toLocaleString()}</span></div>`}).join('')}</div><p class="health-note">${riskDisplay?'站方已明確接受風險，目前會顯示來源提供但尚未記錄展示授權的卡圖；這不代表卡圖已獲授權，收到權利通知時應下架。':'只有具明確權利狀態且未過期的圖片才會顯示。'} 官方總卡數尚未核定，因此不顯示假完成率。來源政策版本 ${e(body.data?.policy?.version||'—')}，檢查日 ${e(body.data?.policy?.reviewedAt||'—')}。</p>`;
  }catch(error){section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><p class="health-note">健康報告暫時無法讀取：${e(error.message)}</p>`}
}

const enhancementStyle=document.createElement('style');enhancementStyle.textContent=`.unified-image-fallback{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f4f4f4,#f4f4f4 10px,#ededed 10px,#ededed 20px);gap:5px;align-content:center}.unified-image-fallback b{color:#555}.unified-image-fallback small{max-width:150px}.view-switch{display:flex;align-self:end;margin-right:auto}.view-switch button,.detail-tabs button,.text-switch button{border:1px solid #d5d5d5;background:#fff;padding:8px 12px;cursor:pointer}.view-switch button:first-child,.detail-tabs button:first-child,.text-switch button:first-child{border-radius:9px 0 0 9px}.view-switch button:last-child,.detail-tabs button:last-child,.text-switch button:last-child{border-radius:0 9px 9px 0}.view-switch button.on,.detail-tabs button.on,.text-switch button.on{background:#111;color:#fff;border-color:#111}.cards.list-view{grid-template-columns:1fr;gap:8px}.card-list{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(180px,auto);gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.card-list .art{width:76px;aspect-ratio:5/7}.card-list h3{white-space:normal;margin:0}.card-list-facts{display:grid;grid-template-columns:repeat(2,minmax(80px,auto));gap:3px 12px;align-items:center}.detail-tabs-layout{grid-template-columns:270px 1fr}.detail-visual-stage{position:relative;padding:0 23px}.tilt-card{perspective:1000px;overflow:visible;background:transparent;outline:none}.tilt-card:focus-visible{box-shadow:0 0 0 4px var(--y)}.tilt-card-surface{position:relative;width:100%;height:100%;overflow:hidden;border-radius:13px;transform:rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));transform-style:preserve-3d;transition:transform .18s ease;box-shadow:0 16px 35px #0002}.tilt-card-surface>img,.tilt-card-surface>.image-fallback{width:100%;height:100%;object-fit:contain}.tilt-shine{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--shine-x,50%) var(--shine-y,50%),#fff9 0,transparent 38%);mix-blend-mode:screen;opacity:var(--shine-opacity,0);transition:opacity .18s}.detail-nav{position:absolute;top:45%;z-index:2;width:38px;height:38px;border:1px solid #ddd;border-radius:50%;background:#fffc;box-shadow:0 4px 14px #0002;cursor:pointer;font-size:20px}.detail-prev{left:-19px}.detail-next{right:-19px}.detail-position{display:flex;justify-content:space-between;gap:10px;margin:10px 3px 0;color:var(--muted);font-size:12px}.detail-tabs{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--line);margin-bottom:16px}.detail-tabs button{white-space:nowrap;border-radius:0!important;border-width:0 0 3px}.card-rules-text{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:14px;margin-top:8px}.card-rules-text small{display:block;color:#8a6500;margin-top:10px}.text-switch{display:flex}.feature-tour{overflow:hidden}.feature-tour-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.feature-eyebrow,.feature-kicker{display:block;font-size:11px;font-weight:900;letter-spacing:.14em}.feature-eyebrow{color:#888}.tour-pause{border:1px solid #ddd;border-radius:999px;background:#fff;padding:7px 13px;cursor:pointer}.feature-stage{position:relative;min-height:265px}.feature-slide{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(310px,.95fr);align-items:center;gap:35px;padding:34px 42px;border-radius:24px;opacity:0;visibility:hidden;transform:translateX(28px);transition:opacity .45s ease,transform .45s ease,visibility .45s}.feature-slide.on{opacity:1;visibility:visible;transform:none}.feature-slide.yellow{background:linear-gradient(120deg,#ffe669,#fff3b8)}.feature-slide.aqua{background:linear-gradient(120deg,#6ee2d6,#c8f9f4)}.feature-slide.violet{background:linear-gradient(120deg,#c69bff,#e5d4ff)}.feature-slide h3{font-size:clamp(24px,3vw,40px);line-height:1.08;margin:8px 0 14px}.feature-slide p{font-size:16px;max-width:630px}.tour-dots{display:flex;justify-content:center;gap:7px;margin-top:12px}.tour-dots button{width:9px;height:9px;padding:0;border:0;border-radius:99px;background:#ccc;cursor:pointer;transition:width .25s}.tour-dots button.on{width:28px;background:#111}.tour-products{height:185px;display:flex;justify-content:center;align-items:end;gap:12px}.tour-products i{display:block;width:92px;height:142px;border:5px solid #fff;border-radius:11px;background:linear-gradient(150deg,#e73154 0 48%,#291c64 49%);box-shadow:0 18px 25px #0002;transform:rotate(-7deg)}.tour-products i:nth-child(2){height:170px;background:linear-gradient(145deg,#00a99a 0 52%,#102a47 53%);transform:none}.tour-products i:nth-child(3){background:linear-gradient(145deg,#ff8b32 0 52%,#7d2047 53%);transform:rotate(7deg)}.tour-search{display:flex;flex-wrap:wrap;align-content:center;gap:10px;padding:26px;border:2px solid #111;border-radius:22px;background:#fffd;box-shadow:0 18px 30px #0001}.tour-search b{flex-basis:100%;font-size:30px}.tour-search span{background:#111;color:#fff;border-radius:999px;padding:7px 12px}.tour-search em{flex-basis:100%;font-style:normal;color:#555}.tour-card-demo{height:190px;display:flex;align-items:center;justify-content:center;gap:25px;perspective:1000px}.tour-card-demo div{width:118px;height:168px;border:6px solid #fff;border-radius:12px;background:linear-gradient(145deg,#f6d948 0 35%,#0a9a93 36% 68%,#1c173e 69%);box-shadow:18px 18px 28px #0003;transform:rotateY(-16deg) rotateX(7deg)}.tour-card-demo span{padding:13px;border-radius:12px;background:#111;color:#fff}@media(prefers-reduced-motion:reduce){.feature-slide,.tilt-card-surface,.tour-dots button{transition:none!important}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.detail-tabs-layout{grid-template-columns:1fr}.detail-tabs{position:sticky;top:0;background:#fff;z-index:1}.detail-visual{max-width:280px;margin:auto}.detail-position small{display:none}.feature-stage{min-height:390px}.feature-slide{grid-template-columns:1fr;padding:25px;gap:8px}.feature-slide h3{font-size:27px}.tour-products,.tour-card-demo{height:145px}.tour-products i{width:65px;height:105px}.tour-products i:nth-child(2){height:125px}.tour-card-demo div{width:85px;height:125px}.tour-search{padding:18px}.tour-search b{font-size:24px}}`;document.head.append(enhancementStyle);
const utilityStyle=document.createElement('style');utilityStyle.textContent=`.view-switch{flex-wrap:wrap;gap:0}.view-switch button{font-weight:800}.cards.rarity-view{display:block}.rarity-group{margin:0 0 24px}.rarity-group>header{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;padding:10px 13px;border-left:4px solid var(--y);background:var(--soft);border-radius:8px}.rarity-group>header h3{margin:0;font-size:17px}.rarity-group>header span{color:var(--muted);font-size:13px}.rarity-group-cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:22px 14px}.card-actions{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:8px}.favorite-toggle{width:32px;height:30px;padding:0;border:1px solid #d4d4d4;border-radius:8px;background:#fff;color:#777;font-size:20px;line-height:1;cursor:pointer}.favorite-toggle[aria-pressed=true]{color:#b18b00;border-color:#e0c534;background:#fff8bf}.watchlist-inline{display:inline-flex;align-items:center;gap:3px;border:1px solid #d4d4d4;border-radius:8px;overflow:hidden;background:#fff}.watchlist-inline button{width:24px;height:28px;padding:0;border:0;background:#f5f5f5;font-size:18px;line-height:1;cursor:pointer}.watchlist-inline button:disabled{color:#aaa;cursor:not-allowed}.watchlist-inline span{min-width:22px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}.card-list{grid-template-columns:76px minmax(0,1fr) minmax(180px,auto) auto}.card-list .card-actions{margin:0;display:grid;gap:5px}.card-list .favorite-toggle{justify-self:center}.card-list .watchlist-inline{justify-self:end}.favorites-filter{align-self:end;border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.favorites-filter.on{background:#111;color:#fff;border-color:#111}.watchlist-summary{display:flex;align-items:center;justify-content:space-between;gap:13px;flex:1 1 360px;min-width:260px;color:#444}.watchlist-summary>div{display:grid;gap:2px}.watchlist-summary span{color:var(--muted);font-size:13px}.watchlist-summary small{color:var(--muted);font-size:12px}.watchlist-summary em{font-style:normal;color:#7b6100;font-size:12px}.watchlist-summary button{border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 11px;font-weight:800;cursor:pointer;white-space:nowrap}.watchlist-summary button:disabled{color:#aaa;cursor:not-allowed}.cards-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:16px;min-height:155px;padding:24px;border:1px dashed #d4d4d4;border-radius:14px;color:var(--muted)}.cards-empty img{width:68px;height:68px;object-fit:contain;opacity:.72}.cards-empty b{display:block;color:#444}.cards-empty p{margin:5px 0 0}.feature-tour{margin:8px 0 18px;padding:0;border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden}.feature-tour summary{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;list-style:none}.feature-tour summary::-webkit-details-marker{display:none}.help-summary-copy{display:grid;gap:2px;flex:1}.help-summary-copy small{color:var(--muted);font-size:13px}.feature-tour summary img{width:34px;height:34px;object-fit:contain;opacity:.78}.help-summary-chevron{font-size:20px;transition:transform .2s}.feature-tour[open] .help-summary-chevron{transform:rotate(180deg)}.help-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 14px 14px}.help-item{padding:13px;border-radius:10px;background:var(--soft)}.help-item b{font-size:14px}.help-item p{margin:6px 0 0;color:#555;font-size:13px;line-height:1.55}@media(max-width:1100px){.rarity-group-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.card-list .card-actions{grid-column:2;display:flex;justify-self:start}.watchlist-summary{flex-basis:100%;min-width:0}.watchlist-summary button{margin-left:auto}.help-grid{grid-template-columns:1fr}.cards-empty{align-items:flex-start}.cards-empty img{width:54px;height:54px}}`;document.head.append(utilityStyle);
const zoomStyle=document.createElement('style');zoomStyle.textContent=`.tilt-card.can-zoom{cursor:zoom-in}.card-identity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}.card-identity>div{padding:8px 10px;border-radius:9px;background:var(--soft)}.card-identity dt{font-size:11px;color:var(--muted);font-weight:800}.card-identity dd{margin:2px 0 0;font-weight:800}.card-zoom{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:22px;background:#090909e8;cursor:zoom-out}.card-zoom.open{display:grid}.card-zoom img{display:block;max-width:min(94vw,900px);max-height:94vh;object-fit:contain;filter:drop-shadow(0 24px 45px #000)}.card-zoom-close{position:fixed;right:18px;top:16px;z-index:1;width:44px;height:44px;border:1px solid #fff5;border-radius:50%;background:#111;color:#fff;font-size:27px;cursor:pointer}@media(max-width:520px){.card-identity{grid-template-columns:1fr}.card-zoom{padding:10px}}`;document.head.append(zoomStyle);
const interactiveZoomStyle=document.createElement('style');interactiveZoomStyle.textContent=`body.card-zoom-open{overflow:hidden}.card-zoom{display:none;grid-template-rows:minmax(0,1fr) auto;gap:12px;padding:58px 16px 16px;background:#090909ed;color:#fff;cursor:default;overscroll-behavior:contain}.card-zoom.open{display:grid}.card-zoom-viewport{position:relative;min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;touch-action:none;cursor:grab;outline:none}.card-zoom-viewport:active{cursor:grabbing}.card-zoom-viewport:focus-visible{box-shadow:inset 0 0 0 3px var(--y)}.card-zoom-canvas{position:relative;width:min(900px,100%);height:100%;display:grid;place-items:center;overflow:visible}.card-zoom-image{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;transform-origin:center center;user-select:none;-webkit-user-drag:none;will-change:transform;filter:drop-shadow(0 18px 34px #000)}.card-zoom-fallback{display:grid;place-items:center;text-align:center;color:#ddd;font-size:18px;line-height:1.6}.card-zoom-fallback small{font-size:12px;color:#aaa}.card-zoom-toolbar{position:relative;z-index:2;display:flex;align-items:center;justify-self:center;gap:4px;max-width:100%;padding:7px;border:1px solid #fff3;border-radius:13px;background:#151515ee;box-shadow:0 10px 30px #0008;color:#fff;overflow-x:auto}.card-zoom-toolbar button{border:1px solid #fff3;border-radius:8px;background:#292929;color:#fff;padding:7px 10px;cursor:pointer;white-space:nowrap}.card-zoom-toolbar button:hover,.card-zoom-toolbar button:focus-visible{background:#444;border-color:#fff8}.card-zoom-toolbar output{min-width:72px;padding:0 4px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}.card-zoom-divider{flex:0 0 1px;width:1px;height:25px;margin:0 3px;background:#fff4}.card-zoom-close{position:fixed;right:18px;top:14px;z-index:3;width:44px;height:44px;border:1px solid #fff5;border-radius:50%;background:#111;color:#fff;font-size:27px;line-height:1;cursor:pointer}.card-zoom-close:hover,.card-zoom-close:focus-visible{background:#333;outline:2px solid var(--y);outline-offset:2px}@media(max-width:520px){.card-identity{grid-template-columns:1fr}.card-zoom{gap:8px;padding:54px 8px 8px}.card-zoom-canvas{width:100%;height:100%}.card-zoom-toolbar{justify-self:stretch;justify-content:flex-start;gap:2px;padding:5px}.card-zoom-toolbar button{padding:7px 6px;font-size:12px}.card-zoom-toolbar output{min-width:57px;font-size:12px}.card-zoom-divider{height:21px;margin:0 1px}}@media(prefers-reduced-motion:reduce){.card-zoom-image{transition:none}}`;document.head.append(interactiveZoomStyle);
installFeatureTour();
installCatalogHealth();
installViewToggle();
installCardUtilities();
if(currentCardRows.length)cards(currentCardRows,true);

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('cardZoom')?.classList.contains('open')){closeCardZoom();return}if(!$('modal')?.classList.contains('open'))return;if(event.key==='ArrowLeft')openAdjacentCard(-1);if(event.key==='ArrowRight')openAdjacentCard(1);if(event.key==='Escape')$('modal').classList.remove('open')});
