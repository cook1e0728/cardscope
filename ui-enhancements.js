const uiLocal={get(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,value);return true}catch{return false}}};
let cardViewMode='grid';
let activeDetailCardId=null,detailReturnCardId=null;
let favoritesOnly=uiLocal.get('cardscope-favorites-only','0')==='1';
const favoriteIds=new Set(readUiArray('cardscope-favorites'));
const watchlist=readUiObject('cardscope-watchlist');
const watchlistMeta=readUiObject('cardscope-watchlist-meta');
const rarityOptionMemory=new Map();

function rarityOptionScopeKey(){
  const region=document.getElementById('browseRegion')?.value||'all';
  const seriesId=typeof browse!=='undefined'&&browse?.seriesId||'';
  return `${typeof game!=='undefined'?game:'all'}|${region}|${seriesId}`;
}

function rememberRarityOptions(){
  const select=document.getElementById('rarityFilter');
  if(!select||typeof game==='undefined'||game==='all')return;
  const key=rarityOptionScopeKey(),known=rarityOptionMemory.get(key)||new Map();
  [...select.options].forEach(option=>{
    if(option.value==='all')return;
    known.set(option.value,{value:option.value,label:option.textContent});
  });
  rarityOptionMemory.set(key,known);
}

function restoreRarityOptions(){
  const select=document.getElementById('rarityFilter');
  if(!select||typeof game==='undefined'||game==='all')return;
  rememberRarityOptions();
  const known=rarityOptionMemory.get(rarityOptionScopeKey());
  if(!known||known.size<=Math.max(0,select.options.length-1))return;
  const selected=select.value,fragment=document.createDocumentFragment(),makeOption=(label,value)=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option};
  fragment.append(makeOption('全部稀有度','all'));
  known.forEach(option=>fragment.append(makeOption(option.label,option.value)));
  select.replaceChildren(fragment);
  select.value=known.has(selected)?selected:'all';
}

function installRarityOptionMemory(){
  const select=document.getElementById('rarityFilter');
  if(!select||select.dataset.rarityMemoryReady)return;
  select.dataset.rarityMemoryReady='1';
  if(typeof MutationObserver==='undefined'){rememberRarityOptions();return}
  const observer=new MutationObserver(restoreRarityOptions);
  observer.observe(select,{childList:true});
  select.addEventListener('change',rememberRarityOptions);
  rememberRarityOptions();
}

function installDetailModalAccessibility(){
  const modal=document.getElementById('modal');
  if(!modal||modal.dataset.a11yReady)return;
  modal.dataset.a11yReady='1';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','卡片詳細資料');
  const sync=()=>modal.setAttribute('aria-hidden',String(!modal.classList.contains('open')));
  if(typeof MutationObserver==='undefined'){sync();return}
  new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});
  sync();
}

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
// ADR 0044 Q12：畫面一律顯示稀有度代碼（SAR），全名放 title；NONE 顯示「無標記」。沿用 index.html 的 rarityCanonicalCode／rarityRankings。
function rarityInfo(raw,gameId){
  const value=String(raw??'').trim();
  if(!value)return{code:'',text:'',full:''};
  const code=typeof rarityCanonicalCode==='function'?rarityCanonicalCode(gameId,value):value,definition=typeof rarityRankings!=='undefined'&&rarityRankings.systems?.[gameId]||{};
  if(code==='NONE'||value==='無標記')return{code:'NONE',text:'無標記',full:'沒有稀有度標記'};
  return{code,text:code,full:value!==code?value:(definition.canonicalLabels?.[code]||definition.aliases?.[code]?.[0]||'')};
}
function rarityMarkup(raw,gameId,showFull=false){
  const info=rarityInfo(raw,gameId),full=info.full&&info.full!==info.text?info.full:'';
  if(!info.text)return '';
  return `<abbr class="rarity-code"${full?` title="${e(full)}"`:''}>${e(info.text)}</abbr>${showFull&&full&&info.code!=='NONE'?`<small class="meta rarity-full">（${e(full)}）</small>`:''}`;
}
function cardRarityRaw(card){return String(card.rarity||card.printings?.find(printing=>printing.rarity)?.rarity||'')}
function cardRarityLabel(card){return rarityInfo(cardRarityRaw(card),cardGameId(card)).code||'稀有度待補'}
function cardRarityMarkup(card){return rarityMarkup(cardRarityRaw(card),cardGameId(card))||'稀有度待補'}
// DP-era Japanese cards print no number (metadata.numberStatus 'not-printed'); only a missing value is '卡號待補'.
function cardNumberLabel(card){return card.officialCardNumber||card.printings?.find(printing=>printing.localCardNumber)?.localCardNumber||(card.metadata?.numberStatus==='not-printed'?'未印卡號':'卡號待補')}
function cardPriceLabel(price){return price&&Number.isFinite(Number(price.price))&&price.currency?`${e(price.currency)} ${Number(price.price).toLocaleString()} 買取`:''}
function cardGameLabel(card){const catalogName=G(card.game).nameZh;if(catalogName)return catalogName;return (window.CARD_GAMES||[]).find(item=>item.id===card.game)?.name||card.game||'IP 待補'}
function isFavorite(id){return favoriteIds.has(String(id))}
function watchQuantity(id){const value=Number(watchlist[String(id)]);return Number.isInteger(value)&&value>0?value:0}
function allKnownCards(){const rows=[...(currentCardRows||[]),...(C?.cards||[])];return [...new Map(rows.map(card=>[String(card.id),card])).values()]}
function cardForWatch(id){const card=allKnownCards().find(item=>String(item.id)===String(id));if(card)return card;const snapshot=watchlistMeta[String(id)];return snapshot?{...snapshot,__watchlistSnapshot:true}:null}
// ADR 0045：收藏以實體卡 ID 為鍵（搜尋列的 id 是作品層 ID，所以用 cardOpenId 取畫面上那個版本的實體卡）；舊資料若以作品層 ID 存，仍對得上。
const CS=window.CollectionStore,COMMON_FINISHES=['normal','holo','reverse'],renderedCards=new Map();
function physicalIdOf(card){const id=String(cardOpenId(card));return id===String(card.id)&&card.physicalCardIds?.length===1?String(card.physicalCardIds[0]):id}
function entryKey(card){const key=physicalIdOf(card);return[key,String(card.id)].find(item=>favoriteIds.has(item)||watchlist[item])||key}
function cardSnapshot(card,key){
  const printing=(card.printings||[]).find(p=>String(p.cardId)===String(key))||null;
  return{id:String(key),canonicalId:String(card.canonicalId||card.id||''),game:cardGameId(card)||'',nameZh:card.nameZh||'',nameEn:card.nameEn||'',nameJa:card.nameJa||'',nameKo:card.nameKo||'',officialCardNumber:card.officialCardNumber||printing?.localCardNumber||'',rarity:printing?.rarity||card.rarity||'',region:printing?.region||card.region||card.printings?.[0]?.region||'',version:printing?.metadata?.variantName||card.metadata?.variantName||'',image:(printing?.imageUrl&&!printing.imageRehostRequired?printing.imageUrl:image(card))||''};
}
function persistCollection(){return[uiLocal.set('cardscope-favorites',JSON.stringify([...favoriteIds])),uiLocal.set('cardscope-watchlist',JSON.stringify(watchlist)),uiLocal.set('cardscope-watchlist-meta',JSON.stringify(watchlistMeta))].every(Boolean)}
// 在收藏內時保留畫面快照與使用者填的品況／版本／備註；移出收藏就一併刪除。
function touchMeta(key){
  if(!favoriteIds.has(key)&&!watchlist[key]){delete watchlistMeta[key];return}
  const card=renderedCards.get(key)||allKnownCards().find(item=>String(item.id)===key);
  if(card)watchlistMeta[key]={...watchlistMeta[key],...cardSnapshot(card,key),v:1};
}

const cardscopeBaseFilteredCards=typeof filteredCards==='function'?filteredCards:null;
if(cardscopeBaseFilteredCards){
  filteredCards=function(rows){const result=cardscopeBaseFilteredCards(rows);return favoritesOnly?result.filter(card=>isFavorite(entryKey(card))):result};
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
  const key=entryKey(card);renderedCards.set(key,card);if(renderedCards.size>800)renderedCards.delete(renderedCards.keys().next().value);
  const id=e(key),favorite=isFavorite(key),quantity=watchQuantity(key);
  return `<div class="card-actions" data-action="card-actions"><button type="button" class="favorite-toggle" data-action="favorite" data-favorite-id="${id}" aria-pressed="${favorite}" aria-label="${favorite?'從我的收藏移除':'加入我的收藏'}" title="${favorite?'從我的收藏移除':'加入我的收藏'}">${favorite?'★':'☆'}</button><div class="watchlist-inline" data-action="watchlist" aria-label="我的收藏張數"><button type="button" data-watch-decrement="${id}" aria-label="減少數量"${quantity?'':' disabled'}>−</button><span data-watch-quantity="${id}">${quantity}</span><button type="button" data-watch-increment="${id}" aria-label="增加數量">＋</button></div></div>`;
}

// Three sticker tiers for the binder theme: top (SAR/UR/SEC…), high (SR/AR/RRR…), and everything else.
function rarityTier(label){const code=String(label||'').trim().toUpperCase();if(/^(SAR|UR|SEC|HR|SSR|MA|CSR|SP|SSP|OFR|BSR|MUR|ACE)/.test(code))return 'top';if(/^(SR|AR|RRR|CHR|K|L|PR|S)/.test(code))return 'high';return 'base'}
// Cards kept although the Japanese official card search does not list them (M6a 104–135, B/G/R: listed by the Taiwanese official search or TCGdex only).
const hasListing=(card,value)=>card?.metadata?.officialListing===value||(card?.printings||[]).some(p=>p.metadata?.officialListing===value);
const notOfficiallyListed=card=>hasListing(card,'jp-not-listed');
const officialPageConfirmed=card=>hasListing(card,'jp-search-omitted');
const searchOmittedTitle='日本官方商品頁證實這張卡存在，但官方卡片搜尋沒有收錄';
function listingBadge(card){return notOfficiallyListed(card)?`<span class="badge listing-badge" title="日本官方卡片搜尋目前沒有列出這張卡；資料來自 TCGdex 或台灣官方">待日本官方確認</span>`:officialPageConfirmed(card)?`<span class="badge listing-badge listing-badge-confirmed" title="${searchOmittedTitle}">官方商品頁已證實</span>`:''}
function listingNote(card){return notOfficiallyListed(card)?` <small class="meta listing-note" title="日本官方卡片搜尋目前沒有列出這張卡；資料來自 TCGdex 或台灣官方">待日本官方確認</small>`:officialPageConfirmed(card)?` <small class="meta listing-note listing-note-confirmed" title="${searchOmittedTitle}">官方商品頁已證實</small>`:''}
// Search merges a canonical group into one row whose id is the canonical card while its label follows referencePrintingId; open the labelled version.
const cardOpenId=card=>{const ref=card?.referencePrintingId!=null&&(card.printings||[]).find(p=>String(p.id)===String(card.referencePrintingId));return ref?.cardId||card?.id};
// Same region and number: list 版本 1, 2, 3… in order (an original card can be 版本 2 when its TCGdex image is that version, ADR 0043).
const versionNumber=p=>Number(String(p?.metadata?.variantName||'').match(/\d+/)?.[0]||0);
function versionOrder(ps){const first=new Map();ps.forEach((p,i)=>{const key=`${p.region}|${p.localSetCode}|${p.localCardNumber}`;if(!first.has(key))first.set(key,i)});return ps.map((p,i)=>({p,i,g:first.get(`${p.region}|${p.localSetCode}|${p.localCardNumber}`)})).sort((a,b)=>a.g-b.g||versionNumber(a.p)-versionNumber(b.p)||a.i-b.i).map(x=>x.p)}
function cardMarkup(card){
  const source=image(card),price=priceFor(card),number=cardNumberLabel(card),rarity=cardRarityLabel(card),rarityHtml=cardRarityMarkup(card),region=rn(card.region||card.printings?.[0]?.region),gameLabel=cardGameLabel(card),picture=resilientImage(source,name(card),'這張卡尚未收錄可公開顯示的圖片',cardWatermarkOptions(card,source)),id=e(cardOpenId(card)),priceMarkup=cardPriceLabel(price);
  const openLabel=`開啟${name(card)}的卡片詳細資料`;
  const openControl=`<button type="button" class="card-open-hit" data-card-open="${id}" aria-label="${e(openLabel)}"></button>`;
  if(cardViewMode==='list')return `<article class="card card-list">${openControl}<div class="art">${picture}</div><div class="card-list-main"><span class="badge ip-badge">${e(gameLabel)}</span><h3>${e(name(card))}</h3><div class="meta">${e(original(card)&&original(card)!==name(card)?original(card):'原名待補')}</div></div><div class="card-list-facts"><b>${e(number)}</b><span>${rarityHtml}</span><span class="badge">${e(region)}</span>${(()=>{const variant=card.metadata?.variantName||card.printings?.find(p=>p.metadata?.variantName)?.metadata?.variantName;return variant?`<span class="badge variant-badge">${e(variant)}</span>`:''})()}${listingBadge(card)}${priceMarkup?`<strong>${priceMarkup}</strong>`:'<span class="meta">可靠價格待補</span>'}</div>${cardActionsMarkup(card)}</article>`;
  return `<article class="card">${openControl}<div class="art">${picture}</div><span class="badge ip-badge">${e(gameLabel)}</span><h3>${e(name(card))}</h3><div class="meta"><span class="card-no">${e(number)}</span><span class="card-sep"> · </span><span class="card-rarity" data-tier="${rarityTier(rarity)}">${rarityHtml}</span></div>${priceMarkup?`<div class="card-price">${priceMarkup}</div>`:''}<span class="badge">${e(region)}</span>${(()=>{const variant=card.metadata?.variantName||card.printings?.find(p=>p.metadata?.variantName)?.metadata?.variantName;return variant?`<span class="badge variant-badge">${e(variant)}</span>`:''})()}${listingBadge(card)}${cardActionsMarkup(card)}</article>`;
}

function activateCardActions(root=$('cards')){
  if(!root)return;
  root.querySelectorAll('[data-card-open]').forEach(card=>{card.onclick=event=>{if(event.target.closest('[data-action]'))return;openCard(card.dataset.cardOpen)};card.onkeydown=event=>{if(event.target.closest('[data-action]'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();openCard(card.dataset.cardOpen)}}});
  root.querySelectorAll('[data-favorite-id]').forEach(button=>{button.onclick=event=>{event.stopPropagation();toggleFavorite(button.dataset.favoriteId)}});
  root.querySelectorAll('[data-watch-increment]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchIncrement,watchQuantity(button.dataset.watchIncrement)+1)}});
  root.querySelectorAll('[data-watch-decrement]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchDecrement,watchQuantity(button.dataset.watchDecrement)-1)}});
}

function renderCardEmpty(){return `<div class="cards-empty mascot-empty"><img src="/assets/brand/web/rabbit-offline.webp" alt="奔跑中的 CardScope 兔子" loading="lazy"><div><b>兔子還在尋找卡片</b><p>若是尚未發售商品，代表官方尚未公開卡表；圖片待補時也會保留卡片資料。</p></div></div>`}

function renderCardRows(rows){
  if(cardViewMode!=='rarity')return rows.length?rows.map(cardMarkup).join(''):renderCardEmpty();
  const groups=new Map();rows.forEach(card=>{const rarity=cardRarityLabel(card),gameLabel=cardGameLabel(card),key=`${card.game||'unknown'}\u0000${rarity}`;if(!groups.has(key))groups.set(key,{gameId:cardGameId(card)||'unknown',gameLabel,rarity,cards:[]});groups.get(key).cards.push(card)});
  const direction=cardFilters.sort==='rarity-asc'?'asc':'desc',gameOrder=new Map((window.CARD_GAMES||[]).map((item,index)=>[item.id,index])),ordered=[...groups.values()].sort((a,b)=>(gameOrder.get(a.gameId)??999)-(gameOrder.get(b.gameId)??999)||compareRarityLabels(a.gameId,a.rarity,b.rarity,direction));
  return ordered.length?ordered.map(({gameId,gameLabel,rarity,cards:cardsForRarity},groupIndex)=>`<section class="rarity-group" aria-labelledby="rarity-${groupIndex}"><header><h3 id="rarity-${groupIndex}"><span>${e(gameLabel)}</span>｜<span>${rarityMarkup(rarity,gameId)||e(rarity)}</span></h3><span>${cardsForRarity.length.toLocaleString()} 張</span></header><div class="cards rarity-group-cards">${cardsForRarity.map(cardMarkup).join('')}</div></section>`).join(''):renderCardEmpty();
}

cards=function(rows,keepSource=false){
  cardDisplayState='ready';
  if(!keepSource){currentCardRows=rows;refreshRarityOptions(rows)}
  const shown=filteredCards(currentCardRows),host=$('cards');host.classList.toggle('list-view',cardViewMode==='list');host.classList.toggle('rarity-view',cardViewMode==='rarity');drawViewButtons();
  $('filterSummary').textContent=`目前載入 ${currentCardRows.length.toLocaleString()} 張，篩選後 ${shown.length.toLocaleString()} 張${favoritesOnly?'；目前只看我的收藏':''}；價格僅採可驗證買取資料`;
  host.innerHTML=renderCardRows(shown);
  if(typeof primeCardImages==='function')primeCardImages(host.dataset.cardscopeGame||game,browse);
  activateCardActions(host);renderFavoritesControl();renderWatchlistSummary();
};

function renderFavoritesControl(){
  const control=$('favoritesOnly');if(!control)return;
  control.classList.toggle('on',favoritesOnly);control.setAttribute('aria-pressed',String(favoritesOnly));control.textContent=`只看我的收藏（${favoriteIds.size}）`;
}

function toggleFavorite(id){
  const key=String(id);if(favoriteIds.has(key))favoriteIds.delete(key);else favoriteIds.add(key);
  touchMeta(key);persistCollection();cards(currentCardRows,true);
}

function showCollectionToast(){
  let toast=$('brandCollectionToast');
  if(!toast){toast=document.createElement('div');toast.id='brandCollectionToast';toast.className='brand-collection-toast';toast.setAttribute('role','status');document.body.append(toast)}
  toast.innerHTML='<img src="/assets/brand/web/rabbit-success-160.webp" alt=""><div><b>已加入我的收藏</b><span>彩虹寶箱兔幫你收好了</span></div>';
  toast.classList.add('show');clearTimeout(showCollectionToast.timer);showCollectionToast.timer=setTimeout(()=>toast.classList.remove('show'),2600);
}

function setWatchQuantity(id,quantity){
  const key=String(id),previous=watchQuantity(key),next=Math.max(0,Math.min(999,Number(quantity)||0));
  if(next)watchlist[key]=next;else delete watchlist[key];
  touchMeta(key);persistCollection();cards(currentCardRows,true);if(previous===0&&next>0)showCollectionToast();
}

function watchlistEntries(){
  return Object.entries(watchlist).map(([id,quantity])=>({id,quantity:watchQuantity(id),card:cardForWatch(id)})).filter(entry=>entry.quantity>0);
}

function watchlistTotals(){
  const totals=new Map();watchlistEntries().forEach(({card,quantity})=>{if(!card||card.__watchlistSnapshot)return;const price=priceFor(card),amount=price&&Number(price.price),currency=price&&String(price.currency||'').trim();if(!Number.isFinite(amount)||!currency)return;totals.set(currency,(totals.get(currency)||0)+amount*quantity)});return totals;
}

// 星號收藏與張數清單合併成「我的收藏」：有張數就用張數，只有星號算 1 張。
function collectionIds(){return[...new Set([...favoriteIds,...Object.keys(watchlist)])]}
function collectionTotal(){return collectionIds().reduce((sum,id)=>sum+(watchQuantity(id)||1),0)}
function renderWatchlistSummary(){
  const host=$('watchlistSummary');if(!host)return;
  const entries=watchlistEntries(),totals=watchlistTotals(),verified=[...totals].map(([currency,amount])=>`${e(currency)} ${amount.toLocaleString()}`).join(' ／ ');
  host.innerHTML=`<div><b>我的收藏</b><span> 共 ${collectionTotal()} 張</span><small>僅儲存在此裝置，不會送出採購或販售。</small>${verified?`<em>已驗證總價：${verified}</em>`:'<em>已驗證總價：目前沒有可合併的可靠價格</em>'}</div><button type="button" id="downloadWatchlist"${entries.length?'':' disabled'}>下載清單 CSV</button>`;
  const button=$('downloadWatchlist');if(button)button.onclick=downloadWatchlistCsv;
}

function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`}
function downloadWatchlistCsv(){
  const items=collectionItems();if(!items.length)return;
  const header=['卡片 ID','名稱','原名','官方卡號','稀有度','數量','已驗證價格幣別','已驗證單價','已驗證小計','品況','版本','備註','作品層 ID'];
  const rows=items.map(item=>{const id=item.id,quantity=item.quantity||1,card=cardForWatch(id),price=card&&!card.__watchlistSnapshot&&priceFor(card),amount=price&&Number(price.price),valid=Number.isFinite(amount)&&price.currency,known=card&&(!card.__watchlistSnapshot||card.v);return[id,known?name(card):'卡片資料待載入',known?original(card):'',known?(card.__watchlistSnapshot?card.officialCardNumber:cardNumberLabel(card)):'',known?(card.__watchlistSnapshot?card.rarity:cardRarityLabel(card)):'',quantity,valid?price.currency:'',valid?amount:'',valid?amount*quantity:'',CS.CONDITIONS.find(([key])=>key===item.condition)?.[1]||'',item.finish,item.note,item.canonicalId].map(csvCell).join(',')});
  downloadFile('cardscope-watchlist.csv','text/csv;charset=utf-8',`\uFEFF${[header.map(csvCell).join(','),...rows].join('\r\n')}`);
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
    for(const key of ['highResImageUrl','highResolutionImageUrl','highResUrl','high','imageUrlHiRes','imageLarge','image_large','imageBase','image_base','originalImageUrl','originalUrl','original','largeImageUrl','largeUrl','large','imageUrl','image_url','url','src','href'])visit(record[key],depth+1);
    for(const key of ['sources','images','image','imageData','metadata'])visit(record[key],depth+1);
  };
  visit(value);
  return sources;
}

function providerHighResolutionSource(value){
  const source=typeof value==='string'?value.trim():'';
  if(!source)return null;
  if(/^https:\/\/assets\.tcgdex\.net\//i.test(source))return /\/low\.webp(?:\?|$)/i.test(source)?source.replace(/\/low\.webp(?=\?|$)/i,'/high.webp'):/\/(?:high)\.webp(?:\?|$)/i.test(source)?source:`${source.replace(/\/$/,'')}/high.webp`;
  if(/^https:\/\/images\.pokemontcg\.io\//i.test(source)&&!/_hires\.png(?:\?|$)/i.test(source)&&/\.png(?:\?|$)/i.test(source))return source.replace(/\.png(?=\?|$)/i,'_hires.png');
  if(/^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\//i.test(source))return source.replace('/images/cards_small/','/images/cards/');
  return null;
}

function cardImageSourceCandidates(card,selectedPrinting){
  const candidates=[];
  const add=value=>collectImageSources(value).forEach(source=>{for(const candidate of [providerHighResolutionSource(source),source]){if(!candidate)continue;const displaySource=typeof displayImageUrl==='function'?displayImageUrl(candidate):candidate;if(!candidates.includes(displaySource))candidates.push(displaySource)}});
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
  zoom.innerHTML=`<button type="button" class="card-zoom-close" aria-label="關閉放大卡圖" title="關閉">×</button><div class="card-zoom-viewport" tabindex="0" aria-label="卡片檢視區；可拖曳平移，觸控可雙指縮放"><div class="card-zoom-canvas"><div class="card-zoom-media"><img class="card-zoom-image" alt="${e(alt||'卡片')}放大卡圖" draggable="false"><span class="card-zoom-fallback" hidden role="status">圖片待補<br><small>目前來源無法顯示</small></span>${sampleMarkup}</div></div></div><div class="card-zoom-toolbar" role="toolbar" aria-label="卡片縮放工具"><button type="button" data-zoom-preset="fit" aria-label="適合視窗">適合視窗</button><button type="button" data-zoom-preset="1" aria-label="顯示 100%">100%</button><button type="button" data-zoom-preset="2" aria-label="顯示 200%">200%</button><button type="button" data-zoom-preset="4" aria-label="顯示 400%">400%</button><span class="card-zoom-divider" aria-hidden="true"></span><button type="button" data-zoom-action="out" aria-label="縮小卡圖" title="縮小">−</button><output data-zoom-label aria-live="polite">適合視窗</output><button type="button" data-zoom-action="in" aria-label="放大卡圖" title="放大">＋</button><button type="button" data-zoom-action="reset" aria-label="重設卡圖位置與縮放" title="重設">重設</button><span class="card-zoom-quality" data-image-quality aria-live="polite">解析度檢查中</span></div>`;
  zoom.classList.add('open');
  zoom.setAttribute('aria-hidden','false');
  document.body?.classList.add('card-zoom-open');

  const viewport=zoom.querySelector('.card-zoom-viewport'),canvas=zoom.querySelector('.card-zoom-canvas'),media=zoom.querySelector('.card-zoom-media'),img=zoom.querySelector('.card-zoom-image'),fallback=zoom.querySelector('.card-zoom-fallback'),sample=zoom.querySelector('.card-sample-watermark'),label=zoom.querySelector('[data-zoom-label]'),quality=zoom.querySelector('[data-image-quality]'),close=zoom.querySelector('.card-zoom-close');
  const state={scale:1,maxScale:4,mode:'fit',x:0,y:0,pointers:new Map(),gesture:null,sourceIndex:0};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const viewportGeometry=()=>{const rect=viewport?.getBoundingClientRect?.();return{left:rect?.left||0,top:rect?.top||0,width:rect?.width||viewport?.clientWidth||window.innerWidth||900,height:rect?.height||viewport?.clientHeight||window.innerHeight||700}};
  const viewportSize=()=>{const {width,height}=viewportGeometry();return{width,height}};
  const panLimits=()=>{const size=viewportSize(),baseWidth=media?.clientWidth||canvas?.clientWidth||size.width,baseHeight=media?.clientHeight||canvas?.clientHeight||size.height;return{x:Math.max(0,(baseWidth*state.scale-size.width)/2),y:Math.max(0,(baseHeight*state.scale-size.height)/2)}};
  const applyZoom=()=>{
    const limits=panLimits();state.x=clamp(state.x,-limits.x,limits.x);state.y=clamp(state.y,-limits.y,limits.y);
    if(media)media.style.transform=`translate3d(${state.x.toFixed(2)}px,${state.y.toFixed(2)}px,0) scale(${state.scale.toFixed(3)})`;
    const zoomText=state.scale===1&&state.mode==='fit'?'適合視窗':`${Math.round(state.scale*100)}%`;
    if(label)label.value=zoomText;
    if(label)label.textContent=zoomText;
    if(viewport)viewport.classList.toggle('is-zoomed',state.scale>1);
  };
  const setZoom=(requested,anchor)=>{
    const previous=state.scale,next=requested==='fit'?1:clamp(Number(requested)||1,1,state.maxScale);
    if(anchor&&previous!==next){const geometry=viewportGeometry(),point={x:anchor.clientX-geometry.left-geometry.width/2,y:anchor.clientY-geometry.top-geometry.height/2};state.x=point.x-(point.x-state.x)*(next/previous);state.y=point.y-(point.y-state.y)*(next/previous)}
    state.scale=next;state.mode=requested==='fit'?'fit':'percent';if(next===1&&requested==='fit'){state.x=0;state.y=0}applyZoom();
  };
  const stepZoom=direction=>{const levels=[...new Set([1,2,4,state.maxScale].filter(level=>level<=state.maxScale+.01))].sort((a,b)=>a-b),next=direction>0?levels.find(level=>level>state.scale+.01)||state.maxScale:[...levels].reverse().find(level=>level<state.scale-.01)||1;setZoom(next)};
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
      const first=entries[0][1],second=entries[1][1],mid=midpoint(first,second),g=state.gesture,geometry=viewportGeometry(),startPoint={x:g.startMid.x-geometry.left-geometry.width/2,y:g.startMid.y-geometry.top-geometry.height/2},next=clamp(g.startScale*(distance(first,second)/g.startDistance),1,state.maxScale);state.scale=next;state.x=startPoint.x-(startPoint.x-g.startX)*(next/g.startScale)+(mid.x-g.startMid.x);state.y=startPoint.y-(startPoint.y-g.startY)*(next/g.startScale)+(mid.y-g.startMid.y);applyZoom();return}
    if(state.gesture?.type==='pan'&&entries.length===1){const entry=entries[0][1],g=state.gesture;state.x=g.startX+entry.x-g.startPointer.x;state.y=g.startY+entry.y-g.startPointer.y;applyZoom()}
  };
  const endPointer=event=>{state.pointers.delete(event.pointerId);if(state.pointers.size)beginGesture();else state.gesture=null};

  const fitMediaToViewport=()=>{if(!media||!img?.naturalWidth||!img?.naturalHeight)return null;const size=viewportSize(),ratio=img.naturalWidth/img.naturalHeight,width=Math.min(size.width,size.height*ratio),height=width/ratio;media.style.width=`${Math.max(1,width).toFixed(2)}px`;media.style.height=`${Math.max(1,height).toFixed(2)}px`;return{width,height}};
  img.onload=()=>{img.hidden=false;if(fallback)fallback.hidden=true;if(sample)sample.hidden=false;const fitted=fitMediaToViewport();state.maxScale=fitted?clamp(Math.min(img.naturalWidth/fitted.width,img.naturalHeight/fitted.height),1,4):1;zoom.querySelectorAll('[data-zoom-preset]').forEach(button=>{const preset=button.dataset.zoomPreset,requested=preset==='fit'?1:Number(preset);button.disabled=requested>state.maxScale+.01;button.title=button.disabled?`來源原始像素最高支援 ${Math.floor(state.maxScale*100)}%`:''});if(quality){const limited=state.maxScale<3.99;quality.textContent=`來源 ${img.naturalWidth}×${img.naturalHeight}${limited?` · 最高無損 ${Math.floor(state.maxScale*100)}%`:''}`;quality.classList.toggle('is-low-resolution',state.maxScale<2)}if(state.scale>state.maxScale)state.scale=state.maxScale;applyZoom()};
  img.onerror=()=>{if(state.sourceIndex<sources.length-1){state.sourceIndex+=1;img.src=sources[state.sourceIndex];return}img.hidden=true;if(fallback)fallback.hidden=false;if(sample)sample.hidden=true};
  img.src=sources[0];
  if(img.complete&&img.naturalWidth)img.onload();
  close?.addEventListener('click',closeCardZoom);
  zoom.onclick=event=>{if(event.target===zoom)closeCardZoom()};
  zoom.querySelectorAll('[data-zoom-preset]').forEach(button=>button.addEventListener('click',()=>setZoom(button.dataset.zoomPreset)));
  zoom.querySelector('[data-zoom-action="out"]')?.addEventListener('click',()=>stepZoom(-1));
  zoom.querySelector('[data-zoom-action="in"]')?.addEventListener('click',()=>stepZoom(1));
  zoom.querySelector('[data-zoom-action="reset"]')?.addEventListener('click',()=>setZoom('fit'));
  viewport?.addEventListener('wheel',event=>{event.preventDefault();setZoom(clamp(state.scale*(event.deltaY<0?1.25:.8),1,state.maxScale),event)},{passive:false});
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
  document.querySelectorAll('[data-detail-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-detail-tab]').forEach(x=>{const on=x===button;x.classList.toggle('on',on);x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1});document.querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==button.dataset.detailTab)});
  document.querySelectorAll('.detail-tabs[role="tablist"]').forEach(list=>list.onkeydown=event=>{const tabs=[...list.querySelectorAll('[role="tab"]')].filter(tab=>!tab.hidden),index=tabs.indexOf(document.activeElement),last=tabs.length-1,next={ArrowRight:index>=last?0:index+1,ArrowLeft:index<=0?last:index-1,Home:0,End:last}[event.key];if(index<0||next===undefined)return;event.preventDefault();tabs[next].focus();tabs[next].click()});
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
function openAdjacentCard(step){const rows=detailRows(),index=rows.findIndex(card=>String(cardOpenId(card))===String(activeDetailCardId));if(index<0||rows.length<2)return;openCard(cardOpenId(rows[(index+step+rows.length)%rows.length]))}

// ADR 0044 Q10：資料來源 id 轉成人看得懂的名稱（名稱對照 data/source-registry.json；未知 id 照原樣顯示）。
const DETAIL_SOURCE_NAMES={'pokemon-card-official-jp':'日本官方卡片搜尋','pokemon-jp':'日本官方卡片搜尋','pokemon-tw-official':'台灣官方卡片搜尋','pokemon-tw':'台灣官方卡片搜尋','asia-pokemon-card-official-tw':'台灣官方卡片搜尋',tcgdex:'TCGdex','tcgdex-ja':'TCGdex','tcgdex-zh-tw':'TCGdex','tcgdex-zh-hant-tw':'TCGdex',pokemontcg:'PokemonTCG',ygoprodeck:'YGOPRODeck','cardscope-yugioh-cache':'YGOPRODeck','yugioh-official-us':'遊戲王美國官方卡片資料庫','yugioh-neuron':'遊戲王官方 Neuron 資料庫','onepiece-official':'ONE PIECE 官方卡表','onepiece-official-p':'ONE PIECE 官方卡表','onepiece-official-runtime':'ONE PIECE 官方卡表','onepiece-official-tw':'ONE PIECE 台灣官方卡表','onepiece-official-tw-p':'ONE PIECE 台灣官方卡表','onepiece-tw':'ONE PIECE 台灣官方卡表','optcg-api':'OPTCG API','weiss-schwarz-official':'Weiß Schwarz 官方卡表','haikyu-official':'排球少年卡牌官方卡表'};
function detailInfoMeta(c,ps,selected){
  const series=c.series&&typeof c.series==='object'?c.series:null,seriesName=series&&(series.nameZh||series.nameJa||series.nameEn),code=series?.officialCode||selected?.localSetCode,tags=[series?.region&&rn(series.region),code].filter(Boolean).join('・'),
    sources=[...new Set([...ps.map(p=>p.source),c.source].filter(Boolean).map(id=>DETAIL_SOURCE_NAMES[id]||id))],link=/^https:\/\//.test(selected?.sourceUrl||'')?` <a href="${e(selected.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始頁面</a>`:'',updated=ps.map(p=>p.updatedAt).filter(Boolean).map(String).sort().at(-1);
  return `<dl class="card-identity detail-meta"><div><dt>系列</dt><dd>${seriesName?`${e(seriesName)}${tags?`（${e(tags)}）`:''}`:'系列待補'}</dd></div><div><dt>資料來源</dt><dd>${sources.length?e(sources.join('、')):'來源待補'}${link}</dd></div>${updated?`<div><dt>更新時間</dt><dd><time datetime="${e(updated)}">${e(updated.slice(0,10))}</time></dd></div>`:''}</dl>`;
}
// 分頁：資訊／價格／走勢；「使用者回報」在有表單前隱藏（保留程式與面板）。原「成交趨勢」分頁已由走勢取代。
const DETAIL_TABS=[['info','資訊'],['market','價格'],['trend','走勢'],['reports','使用者回報']];
function detailTabsMarkup(){return `<div class="detail-tabs" role="tablist" aria-label="卡片資訊分頁">${DETAIL_TABS.map(([key,label],index)=>`<button type="button" role="tab" id="detail-tab-${key}" class="${index?'':'on'}" data-detail-tab="${key}" aria-selected="${index===0}" aria-controls="detail-panel-${key}" tabindex="${index?-1:0}"${key==='reports'?' hidden':''}>${label}</button>`).join('')}</div>`}
function detailPanel(key,hidden,body){return `<section role="tabpanel" id="detail-panel-${key}" aria-labelledby="detail-tab-${key}" tabindex="0" data-detail-panel="${key}"${hidden||key==='reports'?' hidden':''}>${body}</section>`}

// ADR 0042／0044：參考價走勢只在使用者打開「走勢」分頁時才請求（price-history-chart.js），不拖慢詳細頁開啟。
function bindPriceTrend(){const slot=document.querySelector('#detail [data-price-trend]'),tab=document.querySelector('#detail [data-detail-tab="trend"]');if(!slot||!tab||!window.PriceTrend)return;tab.addEventListener('click',()=>window.PriceTrend.load(slot,{regionLabel:region=>region?rn(region):'',variantLabel:variant=>typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[variant]||variant}))}

openCard=async function(id,options={}){
  if(!options.keepPosition){activeDetailCardId=id;detailReturnCardId=id}$('modal').classList.add('open');$('detail').textContent='正在載入…';
  try{
    const cr=await fetch('/api/cards/'+encodeURIComponent(id)),cb=await cr.json();
    if(!cr.ok)throw Error(cb.error);
    const [marketResult,reportResult]=await Promise.allSettled([fetch('/api/cards/'+encodeURIComponent(id)+'/market'),fetch('/api/reports?cardId='+encodeURIComponent(id))]),marketResponse=marketResult.status==='fulfilled'?marketResult.value:null,reportResponse=reportResult.status==='fulfilled'?reportResult.value:null,mb=marketResponse?.ok?await marketResponse.json().catch(()=>({data:{records:[],meta:{}}})):{data:{records:[],meta:{warning:'行情服務暫時無法回應；卡片資料仍可正常查看。'}}},rb=reportResponse?.ok?await reportResponse.json().catch(()=>({data:{reports:[]}})):{data:{reports:[]}},c=cb.data,m=mb.data||{records:[],meta:{}},reports=rb.data?.reports||[];
    const ps=c.printings||[],ref=ps.find(p=>p.region==='JP')||ps.find(p=>p.region==='TW')||ps.find(p=>p.region==='US')||ps.find(p=>p.region==='KR')||ps[0],selectedPrinting=ps.find(p=>p.cardId&&String(p.cardId)===String(id))||ps.find(p=>c.referencePrintingId&&String(p.id??p.cardId)===String(c.referencePrintingId))||ps.find(p=>p.region===c.region&&p.language===c.language)||ref,versions=versionOrder(ps).map(p=>{const diff=[];if(ref&&p!==ref&&p.localCardNumber&&p.localCardNumber!==ref.localCardNumber)diff.push('卡號不同');if(ref&&p!==ref&&p.rarity&&ref.rarity&&p.rarity!==ref.rarity)diff.push('稀有度不同');const switchable=p!==selectedPrinting&&p.cardId&&String(p.cardId)!==String(selectedPrinting?.cardId),body=`<b>${e(rn(p.region))}</b>${p===ref?' · <span class="badge">比對基準</span>':''}${p===selectedPrinting?' · <span class="badge">目前顯示</span>':''} · ${e(ln(p.language))} · ${e(p.localSetCode)} · ${e(p.localCardNumber)}${p.rarity?` · ${rarityMarkup(p.rarity,cardGameId(c))}`:''}${p.metadata?.variantName?` · ${e(p.metadata.variantName)}`:''}${diff.length?`<br><span class="meta">版本差異：${e(diff.join('、'))}</span>`:''}${switchable?'<br><span class="meta">點擊查看此版本的卡圖</span>':''}`;return switchable?`<button type="button" class="state version-switch" data-version-card="${e(p.cardId)}">${body}</button>`:`<div class="state">${body}</div>`}).join(''),markets=m.records?.length?m.records.map(r=>`<div class="market"><b>${e(r.provider)}</b> · ${e(r.priceType)} · ${e(r.currency)} ${Number(r.amount).toLocaleString()}</div>`).join(''):'<div class="state">目前沒有可靠對應價格，不以假價格補空白。</div>',reportList=reports.length?reports.map(r=>`<div class="state"><b>${e(r.platform)}</b> · ${e(r.currency)} ${Number(r.price).toLocaleString()}<br><span class="meta">使用者回報，尚未驗證</span></div>`).join(''):'<div class="state">目前沒有使用者回報。</div>';
    const detailImageSources=cardImageSourceCandidates(c,selectedPrinting),detailImageUrl=detailImageSources[0]||image(c),detailSet=detailRows(),detailIndex=detailSet.findIndex(card=>String(cardOpenId(card))===String(activeDetailCardId)),position=detailIndex>=0?`${detailIndex+1} / ${detailSet.length}`:'目前卡片',zhPart=zhParts(c.nameZh),zhName=zhPart.name||'中文名稱待補',originalName=original(c)||'原文名稱待補',gid=cardGameId(c),rarities=[...new Set([c.rarity,...ps.map(p=>p.rarity)].filter(Boolean).map(rarityText).map(value=>rarityMarkup(value,gid,true)))].join('、')||'稀有度待補';
    const watermarkOptions=cardWatermarkOptions(c,detailImageUrl),zoomSourceAttribute=detailImageSources.length?`data-card-zoom-src="${e(detailImageSources[0])}" data-card-zoom-sources="${e(JSON.stringify(detailImageSources))}" data-card-zoom-alt="${e(name(c))}" data-card-embedded-sample="${watermarkOptions.embeddedSample?'1':'0'}" data-card-suppress-sample="${watermarkOptions.suppressOverlay?'1':'0'}"`:'';
    $('detail').innerHTML=`<div class="detail detail-tabs-layout"><div class="detail-visual"><div class="detail-visual-stage"><button class="detail-nav detail-prev" data-card-step="-1" aria-label="上一張卡" title="上一張卡">&#8592;</button><div class="detail-art tilt-card" tabindex="0" ${zoomSourceAttribute} aria-label="${detailImageUrl?'點擊放大卡圖；移動游標可傾斜查看':'卡片圖片待補'}"><div class="tilt-card-surface">${resilientImage(detailImageUrl,name(c),'這張卡尚未收錄可公開顯示的圖片',watermarkOptions)}<span class="tilt-shine" aria-hidden="true"></span></div></div><button class="detail-nav detail-next" data-card-step="1" aria-label="下一張卡" title="下一張卡">&#8594;</button></div><div class="detail-position"><span>${e(position)}</span><small>${detailImageUrl?'點擊卡圖可放大；移動游標可傾斜查看':'圖片來源待補'}</small></div><h2>${e(name(c))}</h2><dl class="card-identity"><div><dt>中文名</dt><dd>${e(zhName)}${zhPart.note?` <small class="meta" title="台版來源在名稱後附加的標記">${e(zhPart.note)}</small>`:''}${c.nameZh&&['derived-same-name','derived-cross-series'].includes(c.metadata?.nameZhBasis)?` <small class="meta" title="${c.metadata.nameZhBasis==='derived-cross-series'?'台版未收錄這張卡；中文名沿用其他系列同日文名卡片的台版官方名稱':'台版未收錄這張卡；中文名沿用同系列同日文名卡片的台版官方名稱'}">同名推導</small>`:''}</dd></div><div><dt>原文名</dt><dd>${e(originalName)}</dd></div><div><dt>卡號</dt><dd>${e(cardNumberLabel(c))}${listingNote(c)}</dd></div><div><dt>稀有度</dt><dd>${rarities}${ps.filter(p=>p.metadata?.rarityBeforeOfficial?.rarity&&p.rarity).map(p=>` <small class="meta" title="依日本官方卡片資料修正；原資料來源標為 ${e(p.metadata.rarityBeforeOfficial.rarity)}">${e(rn(p.region))}依官方修正（原資料為 ${e(p.metadata.rarityBeforeOfficial.rarity)}）</small>`).join('')}</dd></div></dl><p>${e(c.game?.nameZh||G(c.game).nameZh||c.game)}</p></div><div>${detailTabsMarkup()}${detailPanel('info',false,`${detailInfoMeta(c,ps,selectedPrinting)}<h3>卡片文字</h3>${cardTextBlock(c)}<h3>收錄版本</h3><p class="meta">每個版本分別標示語言、卡號與稀有度；缺少日版時依序採台版、美版、韓版或其他版本作比對基準。</p>${versions||'<div class="state">版本待補</div>'}`)}${detailPanel('market',true,`<h3>跨市場比價</h3><p class="meta">平台參考價，不是成交價或台灣行情；新台幣為換算參考。</p>${typeof marketBlock==='function'?marketBlock(m):`<p class="meta">${e(m.meta?.warning||'不同價格性質不混算。')}</p>${markets}`}`)}${detailPanel('trend',true,`<div class="price-trend" data-price-trend="${e(id)}"></div>`)}${detailPanel('reports',true,reportList)}</div></div>`;activateDetailInteractions();bindPriceTrend();$('detail').querySelectorAll('[data-version-card]').forEach(button=>{button.onclick=()=>openCard(button.dataset.versionCard,{keepPosition:true})});
  }catch(error){$('detail').innerHTML=`<div class="state">卡片資料載入失敗：${e(error.message)}</div>`}
};
window.openCard=openCard;

// Phones: the filter selects move into a bottom sheet (BottleNeko pattern). Choices wait for 套用; ×, the
// backdrop and Escape put back what was there. On wider screens the wrapper is display:contents, so nothing moves.
function installFilterSheet(){
  const tools=$('cardTools');if(!tools||$('filterSheet'))return;
  const selects=['rarityFilter','priceFilter','cardSort'].map(id=>$(id)).filter(Boolean),fields=selects.map(select=>select.closest('.filter-field')).filter(Boolean);if(!fields.length)return;
  const sheet=document.createElement('div');sheet.id='filterSheet';sheet.className='filter-sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-labelledby','filterSheetTitle');
  sheet.innerHTML='<div class="filter-sheet-head"><b id="filterSheetTitle">篩選與排序</b><button type="button" class="filter-sheet-close" aria-label="取消篩選變更">×</button></div><div class="filter-sheet-body"></div><button type="button" class="filter-sheet-apply">套用</button>';
  const body=sheet.querySelector('.filter-sheet-body'),backdrop=document.createElement('div');backdrop.className='filter-sheet-backdrop';
  fields[0].before(sheet);fields.forEach(field=>body.append(field));const favorites=$('favoritesOnly');if(favorites)body.append(favorites);sheet.after(backdrop);
  const toggle=document.createElement('button');toggle.type='button';toggle.className='filter-sheet-toggle';toggle.setAttribute('aria-haspopup','dialog');sheet.before(toggle);
  const optionText=select=>select.selectedOptions?.[0]?.textContent?.trim()||'';
  const summarize=()=>{toggle.innerHTML=`<b>篩選與排序</b><span>${selects.map(optionText).filter(Boolean).map(e).join('・')}</span>`};
  let snapshot=null,applying=false;
  const isOpen=()=>sheet.classList.contains('open'),phone=()=>matchMedia('(max-width:760px)').matches;
  const open=()=>{snapshot=selects.map(select=>select.value);sheet.classList.add('open');backdrop.classList.add('open');document.body.classList.add('filter-sheet-open')};
  const close=revert=>{if(revert&&snapshot)selects.forEach((select,index)=>{select.value=snapshot[index]});snapshot=null;sheet.classList.remove('open');backdrop.classList.remove('open');document.body.classList.remove('filter-sheet-open');summarize()};
  // While the sheet is open, hold each change at the sheet so the grid does not reload per select.
  sheet.addEventListener('change',event=>{if(applying||!isOpen()||!selects.includes(event.target))return;event.stopPropagation();summarize()},true);
  const apply=()=>{const before=snapshot||[];close(false);applying=true;try{selects.forEach((select,index)=>{if(select.value!==before[index])select.dispatchEvent(new Event('change',{bubbles:true}))})}finally{applying=false}summarize()};
  toggle.onclick=()=>{if(phone())open()};
  sheet.querySelector('.filter-sheet-close').onclick=()=>close(true);
  sheet.querySelector('.filter-sheet-apply').onclick=apply;
  backdrop.onclick=()=>close(true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()){event.preventDefault();close(true)}});
  // Filters can also change from the URL, a game switch or a reset; keep the summary current.
  // (Observe only the selects' options; the toggle lives inside the tools, so observing them would loop.)
  const optionsChanged=new MutationObserver(summarize);selects.forEach(select=>{select.addEventListener('change',summarize);optionsChanged.observe(select,{childList:true,subtree:true})});
  window.refreshFilterSummary=summarize;
  window.installDialogFocus?.(sheet,{initialFocus:()=>selects[0],returnTarget:()=>toggle});
  summarize();
}

// ADR 0047：手機把稀有度篩選攤成可水平捲動的膠囊列；選項與選取邏輯沿用 #rarityFilter（只列目前範圍有的稀有度），排序仍在「篩選與排序」抽屜。桌面以 CSS 隱藏。
function installRarityPills(){
  const select=$('rarityFilter'),tools=$('cardTools');if(!select||!tools||typeof MutationObserver==='undefined'||$('rarityPills'))return;
  const strip=document.createElement('div');strip.id='rarityPills';strip.className='rarity-pills';strip.setAttribute('role','group');strip.setAttribute('aria-label','稀有度篩選');
  let signature='';
  const sync=()=>{
    const options=[...select.options].filter(option=>!option.hidden&&!option.disabled),next=options.map(option=>option.value+'|'+option.textContent).join('||');
    strip.hidden=options.length<2;
    if(next!==signature){
      const focused=strip.contains(document.activeElement)?document.activeElement.dataset.rarity:null;
      signature=next;strip.innerHTML=options.map(option=>`<button type="button" data-rarity="${e(option.value)}">${e(option.value==='all'?'全部':option.textContent)}</button>`).join('');
      if(focused!=null)[...strip.children].find(button=>button.dataset.rarity===focused)?.focus({preventScroll:true});
    }
    [...strip.children].forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.rarity===select.value)));
  };
  strip.addEventListener('click',event=>{const button=event.target.closest('[data-rarity]');if(!button||select.value===button.dataset.rarity)return;select.value=button.dataset.rarity;select.dispatchEvent(new Event('change',{bubbles:true}))});
  new MutationObserver(sync).observe(select,{childList:true,subtree:true});select.addEventListener('change',sync);
  tools.append(strip);sync();
}


function installFeatureTour(){
  if($('cardscopeFeatureTour'))return;
  const section=document.createElement('details');section.id='cardscopeFeatureTour';section.className='feature-tour section';section.setAttribute('aria-label','CardScope 使用說明');
  section.innerHTML='<summary><span class="help-summary-copy"><b>快速使用說明</b><small>稀有度分組與我的收藏</small></span><img src="/assets/brand/web/cardscope-rabbit-mark-96.webp" alt="" loading="lazy"><span class="help-summary-chevron" aria-hidden="true">⌄</span></summary><div class="help-grid"><article class="help-item"><b>先選瀏覽方式</b><p>圖鑑模式看卡面，清單模式看欄位；需要依真實稀有度整理時，切換稀有度分組。</p></article><article class="help-item"><b>我的收藏</b><p>卡片上的星號與張數只儲存在此裝置（不用登入）；在「我的收藏」可編輯品況、版本、備註，看平台參考價總值，並匯出備份。</p></article><article class="help-item"><b>資料不足會明確標示</b><p>沒有可靠卡圖、名稱或價格時保留待補提示，不以生成內容補成官方資料。</p></article></div>';
  const footer=document.querySelector?.('.brand-footer'),notice=$('notice');
  if(footer)footer.insertAdjacentElement('beforebegin',section);else if(notice)notice.insertAdjacentElement('afterend',section);
}

async function installCatalogHealthLegacy(){
  if(document.getElementById('catalogHealth'))return;
  const section=document.createElement('details');section.id='catalogHealth';section.className='catalog-health';
  section.innerHTML='<summary>資料完整度與圖片權利狀態</summary><p class="health-note">正在讀取資料健康報告…</p>';
  const footer=document.querySelector('.brand-footer');if(footer)footer.insertAdjacentElement('beforebegin',section);
  try{
    const response=await fetch('/api/catalog/health',{cache:'no-store'}),body=await response.json();if(!response.ok)throw Error(body.error||'讀取失敗');
    const labels={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年','weiss-schwarz':'葬送的芙莉蓮'},games=body.data?.games||{};
    const status=$('status'),enforceHealthTotal=()=>{const totalLabel=enhancementCoverageLabel(body.data,Array.isArray(C?.cards)?C.cards.length:null),expected=`${totalLabel}；${P.length.toLocaleString()} 筆實體商品。各系列完整分母未核定時不顯示完成率。`;if(status&&status.textContent!==expected)status.textContent=expected};
    enforceHealthTotal();if(status){const observer=new MutationObserver(enforceHealthTotal);observer.observe(status,{childList:true,characterData:true,subtree:true});setTimeout(()=>observer.disconnect(),120000)}
    const riskDisplay=body.data?.policy?.unverifiedImageDisplayEnabled===true;
    section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><div class="health-grid">${Object.entries(labels).map(([id,label])=>{const row=games[id]||{};return`<div class="health-item"><b>${e(label)}｜${Number(row.cards||0).toLocaleString()} 張</b><span>中文名 ${Number(row.chineseNames||0).toLocaleString()} · 稀有度 ${Number(row.rarities||0).toLocaleString()}</span><span>圖片網址 ${Number(row.cardsWithImageUrls??row.displayableImages??0).toLocaleString()} · 明確授權 ${Number(row.displayableImages||0).toLocaleString()}</span></div>`}).join('')}</div><p class="health-note">${riskDisplay?'站方已明確接受風險，目前會顯示來源提供但尚未記錄展示授權的卡圖；這不代表卡圖已獲授權，收到權利通知時應下架。':'只有具明確權利狀態且未過期的圖片才會顯示。'} 官方總卡數尚未核定，因此不顯示假完成率。來源政策版本 ${e(body.data?.policy?.version||'—')}，檢查日 ${e(body.data?.policy?.reviewedAt||'—')}。</p>`;
  }catch(error){section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><p class="health-note">健康報告暫時無法讀取：${e(error.message)}</p>`}
}

const enhancementStyle=document.createElement('style');enhancementStyle.textContent=`.unified-image-fallback{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f4f4f4,#f4f4f4 10px,#ededed 10px,#ededed 20px);gap:5px;align-content:center}.unified-image-fallback b{color:#555}.unified-image-fallback small{max-width:150px}.view-switch{display:flex;align-self:end;margin-right:auto}.view-switch button,.detail-tabs button,.text-switch button{border:1px solid #d5d5d5;background:#fff;padding:8px 12px;cursor:pointer}.view-switch button:first-child,.detail-tabs button:first-child,.text-switch button:first-child{border-radius:9px 0 0 9px}.view-switch button:last-child,.detail-tabs button:last-child,.text-switch button:last-child{border-radius:0 9px 9px 0}.view-switch button.on,.detail-tabs button.on,.text-switch button.on{background:#111;color:#fff;border-color:#111}.cards.list-view{grid-template-columns:1fr;gap:8px}.card-list{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(180px,auto);gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.card-list .art{width:76px;aspect-ratio:5/7}.card-list h3{white-space:normal;margin:0}.card-list-facts{display:grid;grid-template-columns:repeat(2,minmax(80px,auto));gap:3px 12px;align-items:center}.detail-tabs-layout{grid-template-columns:270px 1fr}.detail-visual-stage{position:relative;padding:0 23px}.tilt-card{perspective:1000px;overflow:visible;background:transparent;outline:none}.tilt-card:focus-visible{box-shadow:0 0 0 4px var(--y)}.tilt-card-surface{position:relative;width:100%;height:100%;overflow:hidden;border-radius:13px;transform:rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));transform-style:preserve-3d;transition:transform .18s ease;box-shadow:0 16px 35px #0002}.tilt-card-surface>img,.tilt-card-surface>.image-fallback{width:100%;height:100%;object-fit:contain}.tilt-shine{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--shine-x,50%) var(--shine-y,50%),#fff9 0,transparent 38%);mix-blend-mode:screen;opacity:var(--shine-opacity,0);transition:opacity .18s}.detail-nav{position:absolute;top:45%;z-index:2;width:38px;height:38px;border:1px solid #ddd;border-radius:50%;background:#fffc;box-shadow:0 4px 14px #0002;cursor:pointer;font-size:20px}.detail-prev{left:-19px}.detail-next{right:-19px}.detail-position{display:flex;justify-content:space-between;gap:10px;margin:10px 3px 0;color:var(--muted);font-size:12px}.detail-tabs{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--line);margin-bottom:16px}.detail-tabs button{white-space:nowrap;border-radius:0!important;border-width:0 0 3px}.card-rules-text{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:14px;margin-top:8px}.card-rules-text small{display:block;color:#8a6500;margin-top:10px}.text-switch{display:flex}.feature-tour{overflow:hidden}.feature-tour-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.feature-eyebrow,.feature-kicker{display:block;font-size:11px;font-weight:900;letter-spacing:.14em}.feature-eyebrow{color:#888}.tour-pause{border:1px solid #ddd;border-radius:999px;background:#fff;padding:7px 13px;cursor:pointer}.feature-stage{position:relative;min-height:265px}.feature-slide{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(310px,.95fr);align-items:center;gap:35px;padding:34px 42px;border-radius:24px;opacity:0;visibility:hidden;transform:translateX(28px);transition:opacity .45s ease,transform .45s ease,visibility .45s}.feature-slide.on{opacity:1;visibility:visible;transform:none}.feature-slide.yellow{background:linear-gradient(120deg,#ffe669,#fff3b8)}.feature-slide.aqua{background:linear-gradient(120deg,#6ee2d6,#c8f9f4)}.feature-slide.violet{background:linear-gradient(120deg,#c69bff,#e5d4ff)}.feature-slide h3{font-size:clamp(24px,3vw,40px);line-height:1.08;margin:8px 0 14px}.feature-slide p{font-size:16px;max-width:630px}.tour-dots{display:flex;justify-content:center;gap:7px;margin-top:12px}.tour-dots button{width:9px;height:9px;padding:0;border:0;border-radius:99px;background:#ccc;cursor:pointer;transition:width .25s}.tour-dots button.on{width:28px;background:#111}.tour-products{height:185px;display:flex;justify-content:center;align-items:end;gap:12px}.tour-products i{display:block;width:92px;height:142px;border:5px solid #fff;border-radius:11px;background:linear-gradient(150deg,#e73154 0 48%,#291c64 49%);box-shadow:0 18px 25px #0002;transform:rotate(-7deg)}.tour-products i:nth-child(2){height:170px;background:linear-gradient(145deg,#00a99a 0 52%,#102a47 53%);transform:none}.tour-products i:nth-child(3){background:linear-gradient(145deg,#ff8b32 0 52%,#7d2047 53%);transform:rotate(7deg)}.tour-search{display:flex;flex-wrap:wrap;align-content:center;gap:10px;padding:26px;border:2px solid #111;border-radius:22px;background:#fffd;box-shadow:0 18px 30px #0001}.tour-search b{flex-basis:100%;font-size:30px}.tour-search span{background:#111;color:#fff;border-radius:999px;padding:7px 12px}.tour-search em{flex-basis:100%;font-style:normal;color:#555}.tour-card-demo{height:190px;display:flex;align-items:center;justify-content:center;gap:25px;perspective:1000px}.tour-card-demo div{width:118px;height:168px;border:6px solid #fff;border-radius:12px;background:linear-gradient(145deg,#f6d948 0 35%,#0a9a93 36% 68%,#1c173e 69%);box-shadow:18px 18px 28px #0003;transform:rotateY(-16deg) rotateX(7deg)}.tour-card-demo span{padding:13px;border-radius:12px;background:#111;color:#fff}@media(prefers-reduced-motion:reduce){.feature-slide,.tilt-card-surface,.tour-dots button{transition:none!important}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.detail-tabs-layout{grid-template-columns:1fr}.detail-tabs{position:sticky;top:0;background:#fff;z-index:1}.detail-visual{max-width:280px;margin:auto}.detail-position small{display:none}.feature-stage{min-height:390px}.feature-slide{grid-template-columns:1fr;padding:25px;gap:8px}.feature-slide h3{font-size:27px}.tour-products,.tour-card-demo{height:145px}.tour-products i{width:65px;height:105px}.tour-products i:nth-child(2){height:125px}.tour-card-demo div{width:85px;height:125px}.tour-search{padding:18px}.tour-search b{font-size:24px}}`;document.head.append(enhancementStyle);
const utilityStyle=document.createElement('style');utilityStyle.textContent=`.view-switch{flex-wrap:wrap;gap:0}.view-switch button{font-weight:800}.cards.rarity-view{display:block}.rarity-group{margin:0 0 24px}.rarity-group>header{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;padding:10px 13px;border-left:4px solid var(--y);background:var(--soft);border-radius:8px}.rarity-group>header h3{margin:0;font-size:17px}.rarity-group>header span{color:var(--muted);font-size:13px}.rarity-group-cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:22px 14px}.card-actions{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:8px}.favorite-toggle{width:32px;height:30px;padding:0;border:1px solid #d4d4d4;border-radius:8px;background:#fff;color:#666;font-size:20px;line-height:1;cursor:pointer}.favorite-toggle[aria-pressed=true]{color:#b18b00;border-color:#e0c534;background:#fff8bf}.watchlist-inline{display:inline-flex;align-items:center;gap:3px;border:1px solid #d4d4d4;border-radius:8px;overflow:hidden;background:#fff}.watchlist-inline button{width:24px;height:28px;padding:0;border:0;background:#f5f5f5;font-size:18px;line-height:1;cursor:pointer}.watchlist-inline button:disabled{color:#aaa;cursor:not-allowed}.watchlist-inline span{min-width:22px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}.card-list{grid-template-columns:76px minmax(0,1fr) minmax(180px,auto) auto}.card-list .card-actions{margin:0;display:grid;gap:5px}.card-list .favorite-toggle{justify-self:center}.card-list .watchlist-inline{justify-self:end}.favorites-filter{align-self:end;border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.favorites-filter.on{background:#111;color:#fff;border-color:#111}.watchlist-summary{display:flex;align-items:center;justify-content:space-between;gap:13px;flex:1 1 360px;min-width:260px;color:#444}.watchlist-summary>div{display:grid;gap:2px}.watchlist-summary span{color:var(--muted);font-size:13px}.watchlist-summary small{color:var(--muted);font-size:12px}.watchlist-summary em{font-style:normal;color:#7b6100;font-size:12px}.watchlist-summary button{border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 11px;font-weight:800;cursor:pointer;white-space:nowrap}.watchlist-summary button:disabled{color:#aaa;cursor:not-allowed}.cards-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:16px;min-height:155px;padding:24px;border:1px dashed #d4d4d4;border-radius:14px;color:var(--muted)}.cards-empty img{width:68px;height:68px;object-fit:contain;opacity:.72}.cards-empty b{display:block;color:#444}.cards-empty p{margin:5px 0 0}.feature-tour{margin:8px 0 18px;padding:0;border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden}.feature-tour summary{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;list-style:none}.feature-tour summary::-webkit-details-marker{display:none}.help-summary-copy{display:grid;gap:2px;flex:1}.help-summary-copy small{color:var(--muted);font-size:13px}.feature-tour summary img{width:34px;height:34px;object-fit:contain;opacity:.78}.help-summary-chevron{font-size:20px;transition:transform .2s}.feature-tour[open] .help-summary-chevron{transform:rotate(180deg)}.help-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 14px 14px}.help-item{padding:13px;border-radius:10px;background:var(--soft)}.help-item b{font-size:14px}.help-item p{margin:6px 0 0;color:#555;font-size:13px;line-height:1.55}@media(max-width:1100px){.rarity-group-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.card-list .card-actions{grid-column:2;display:flex;justify-self:start}.watchlist-summary{flex-basis:100%;min-width:0}.watchlist-summary button{margin-left:auto}.help-grid{grid-template-columns:1fr}.cards-empty{align-items:flex-start}.cards-empty img{width:54px;height:54px}}`;document.head.append(utilityStyle);
const zoomStyle=document.createElement('style');zoomStyle.textContent=`.tilt-card.can-zoom{cursor:zoom-in}.card-identity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}.card-identity>div{padding:8px 10px;border-radius:9px;background:var(--soft)}.card-identity dt{font-size:11px;color:var(--muted);font-weight:800}.card-identity dd{margin:2px 0 0;font-weight:800}.card-zoom{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:22px;background:#090909e8;cursor:zoom-out}.card-zoom.open{display:grid}.card-zoom img{display:block;max-width:min(94vw,900px);max-height:94vh;object-fit:contain;filter:drop-shadow(0 24px 45px #000)}.card-zoom-close{position:fixed;right:18px;top:16px;z-index:1;width:44px;height:44px;border:1px solid #fff5;border-radius:50%;background:#111;color:#fff;font-size:27px;cursor:pointer}@media(max-width:520px){.card-identity{grid-template-columns:1fr}.card-zoom{padding:10px}}`;document.head.append(zoomStyle);
const interactiveZoomStyle=document.createElement('style');interactiveZoomStyle.textContent=`body.card-zoom-open{overflow:hidden}.card-zoom{display:none;grid-template-rows:minmax(0,1fr) auto;gap:12px;padding:58px 16px 16px;background:#090909ed;color:#fff;cursor:default;overscroll-behavior:contain}.card-zoom.open{display:grid}.card-zoom-viewport{position:relative;min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;touch-action:none;cursor:grab;outline:none}.card-zoom-viewport:active{cursor:grabbing}.card-zoom-viewport:focus-visible{box-shadow:inset 0 0 0 3px var(--y)}.card-zoom-canvas{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:visible}.card-zoom-media{position:relative;display:grid;place-items:center;max-width:100%;max-height:100%;container-type:inline-size;transform-origin:center center;will-change:transform}.card-zoom-image{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;user-select:none;-webkit-user-drag:none;filter:drop-shadow(0 18px 34px #000)}.card-zoom-media .card-sample-watermark-zoom{left:7%;right:7%;top:58%;font-size:clamp(22px,15cqi,78px);letter-spacing:.08em;white-space:nowrap}.card-zoom-fallback{display:grid;place-items:center;text-align:center;color:#ddd;font-size:18px;line-height:1.6}.card-zoom-fallback small{font-size:12px;color:#aaa}.card-zoom-toolbar{position:relative;z-index:2;display:flex;align-items:center;justify-self:center;gap:4px;max-width:100%;padding:7px;border:1px solid #fff3;border-radius:13px;background:#151515ee;box-shadow:0 10px 30px #0008;color:#fff;overflow-x:auto}.card-zoom-toolbar button{border:1px solid #fff3;border-radius:8px;background:#292929;color:#fff;padding:7px 10px;cursor:pointer;white-space:nowrap}.card-zoom-toolbar button:hover,.card-zoom-toolbar button:focus-visible{background:#444;border-color:#fff8}.card-zoom-toolbar button:disabled{opacity:.38;cursor:not-allowed}.card-zoom-toolbar output{min-width:72px;padding:0 4px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}.card-zoom-quality{margin-left:5px;color:#bbb;font-size:11px;white-space:nowrap}.card-zoom-quality.is-low-resolution{color:#ffd66b}.card-zoom-divider{flex:0 0 1px;width:1px;height:25px;margin:0 3px;background:#fff4}.card-zoom-close{position:fixed;right:18px;top:14px;z-index:3;width:44px;height:44px;border:1px solid #fff5;border-radius:50%;background:#111;color:#fff;font-size:27px;line-height:1;cursor:pointer}.card-zoom-close:hover,.card-zoom-close:focus-visible{background:#333;outline:2px solid var(--y);outline-offset:2px}@media(max-width:520px){.card-identity{grid-template-columns:1fr}.card-zoom{gap:8px;padding:54px 8px 8px}.card-zoom-canvas{width:100%;height:100%}.card-zoom-toolbar{justify-self:stretch;justify-content:flex-start;gap:2px;padding:5px}.card-zoom-toolbar button{padding:7px 6px;font-size:12px}.card-zoom-toolbar output{min-width:57px;font-size:12px}.card-zoom-quality{margin-left:3px}.card-zoom-divider{height:21px;margin:0 1px}}@media(prefers-reduced-motion:reduce){.card-zoom-media{transition:none}}`;document.head.append(interactiveZoomStyle);
const nextStageStyle=document.createElement('style');
nextStageStyle.textContent=`
  .card{position:relative}
  .card-open-hit{position:absolute;inset:0;z-index:1;width:100%;height:100%;border:0;border-radius:inherit;background:transparent;cursor:pointer}
  .card-open-hit:focus-visible{outline:3px solid var(--y);outline-offset:3px}
  .card-actions{position:relative;z-index:2}
  .favorite-toggle{min-width:44px;min-height:44px}
  .watchlist-inline button{width:44px;height:44px;min-width:44px}
  .watchlist-inline span{min-width:34px}
  .modal.open{place-items:start center}
  .modal .dialog{max-height:calc(100dvh - 32px);overflow:auto}
  .card-zoom-viewport{min-height:clamp(260px,calc(100dvh - 142px),900px)}
  .card-zoom-canvas{width:100%;height:100%;max-height:100%}
  .card-zoom-media{max-width:100%;max-height:100%}
  @media(max-width:760px){
    .modal.open{place-items:stretch}
    .modal .dialog{max-height:none;overflow:auto}
    .card-zoom-viewport{min-height:clamp(220px,calc(100dvh - 132px),760px)}
  }
`;
document.head.append(nextStageStyle);

function betaValue(row,keys,fallback=''){
  for(const key of keys){const parts=String(key).split('.');let value=row;for(const part of parts)value=value&&typeof value==='object'?value[part]:undefined;if(value!==undefined&&value!==null&&String(value).trim()!=='')return value}
  return fallback;
}
function betaNumber(value){const number=Number(value);return Number.isFinite(number)?number:null}
function betaDate(value){if(!value)return'更新時間待補';const text=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;const date=new Date(text);return Number.isNaN(date.getTime())?text.slice(0,24):date.toLocaleString('zh-TW',{dateStyle:'short',timeStyle:'short'})}
function betaTrendState(row){const raw=String(betaValue(row,['status','verificationStatus','verification_status','dataStatus','data_status'],'功能驗證資料')).toLowerCase();if(/verified|complete|confirmed|已驗證/.test(raw))return'已驗證來源';if(/partial|incomplete|pending|unverified|待補|待核/.test(raw))return'資料不完整／待核實';return'功能驗證資料'}
function betaTrendSource(row){return betaValue(row,['sourceLabel','providerName','provider','source','market'],'來源待補')}
function betaTrendType(row){return betaValue(row,['dataType','priceType','price_type','type'],'價格變動')}
function betaTrendScope(row){return betaValue(row,['scope','coverage','range','region','market'],'目前可取得樣本')}
function betaTrendImage(row){const value=betaValue(row,['imageUrl','image_url','image','cardImageUrl','card_image_url'],'');return typeof displayImageUrl==='function'?displayImageUrl(value):value}
function betaTrendAmount(value,currency=''){const amount=betaNumber(value);return amount===null?'價格待補':`${currency?e(currency)+' ':''}${amount.toLocaleString()}`}
function renderPublicTrends(){
  const section=document.getElementById('trendsSection');if(!section)return;
  if(typeof trendMeta!=='undefined'&&trendMeta?.disabled){section.hidden=true;section.innerHTML='';return}
  const rows=typeof trendRows!=='undefined'&&Array.isArray(trendRows)?trendRows:[],meta=typeof trendMeta!=='undefined'&&trendMeta&&typeof trendMeta==='object'?trendMeta:{},first=rows[0]||{},source=betaValue(meta,['label','source'],betaTrendSource(first)),type=betaValue(meta,['priceType','scope.priceType'],betaTrendType(first)),coveredGames=betaValue(meta,['scope.coveredGames','coveredGames'],[]),coveredSets=betaValue(meta,['scope.coveredSets','coveredSets'],[]),scope=Array.isArray(coveredGames)&&coveredGames.length?`${coveredGames.length} 個 IP · ${Array.isArray(coveredSets)?coveredSets.length:0} 個系列`:betaTrendScope(first),updated=betaDate(betaValue(meta,['observationWindow.latest','scope.observationWindow.latest'],betaValue(first,['updatedAt','updated_at','fetchedAt','fetched_at','observedAt','observed_at'],''))),state=rows.length?(meta.complete===false?'資料不完整／待核實':betaTrendState(first)):'等待可驗證資料';
  const cards=rows.map((row,index)=>{const cardName=betaValue(row,['cardName','card_name','name','title'],betaValue(row,['cardNumber','card_number'],'卡片名稱待補')),cardNumber=betaValue(row,['cardNumber','card_number','officialCardNumber','official_card_number'],'卡號待補'),gameId=betaValue(row,['game','gameId','game_id'],''),gameLabel=G(gameId).nameZh||({pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年','weiss-schwarz':'芙莉蓮'}[gameId]||''),currency=betaValue(row,['currency','priceCurrency','price_currency'],''),current=betaValue(row,['price','currentPrice','current_price'],''),previous=betaValue(row,['previousPrice','previous_price','priorPrice','prior_price'],''),change=betaNumber(betaValue(row,['changePercent','change_percent','change'],'')),image=betaTrendImage(row),cardUrl=betaValue(row,['cardUrl','card_url','url','sourceUrl','source_url'],'#'),status=betaTrendState(row),observed=betaDate(betaValue(row,['updatedAt','updated_at','observedAt','observed_at','fetchedAt','fetched_at'],'')),priceLabel=previous!==''&&current!==''?`${betaTrendAmount(previous,currency)} → ${betaTrendAmount(current,currency)}`:'前次／目前價格待補',changeLabel=change===null?'變動待補':`${change>=0?'+':''}${change}%`,safeHref=e(cardUrl),cardClass=cardUrl==='#'?'trend-card is-static':'trend-card';return`<a class="${cardClass}" href="${safeHref}"${cardUrl==='#'?' aria-disabled="true"':''} target="_blank" rel="noopener"><div class="trend-image">${image?`<img src="${e(image)}" alt="${e(cardName)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="image-fallback unified-image-fallback" hidden><b>圖片待補</b><small>圖片來源尚未收錄</small></span>`:'<span class="image-fallback unified-image-fallback"><b>圖片待補</b><small>圖片來源尚未收錄</small></span>'}</div><div class="trend-card-head"><b>${e(cardName)}</b><span class="trend-rise">${e(changeLabel)}</span></div><span class="trend-card-number">${e(gameLabel?`${gameLabel} · `:'')}${e(cardNumber)}</span><strong>${e(priceLabel)}</strong><div class="trend-card-facts"><span>${e(betaTrendSource(row))}</span><span>${e(betaTrendType(row))}</span><span>${e(status)}</span></div><small>觀測：${e(observed)}</small></a>`}).join('');
  section.hidden=false;section.innerHTML=`<div class="title"><div><h2>單一來源買取漲幅</h2><span class="meta">試驗性市場資料；只呈現有前次價格可對照的項目，不代表全市場人氣或成交量</span></div><span class="meta">${rows.length?`目前 ${rows.length} 筆`:'資料待補'}</span></div><div class="trend-scope" aria-label="漲勢資料範圍"><div class="trend-scope-item"><b>來源</b><span>${e(source)}</span></div><div class="trend-scope-item"><b>資料型態</b><span>${e(type)}</span></div><div class="trend-scope-item"><b>範圍</b><span>${e(scope)}</span></div><div class="trend-scope-item"><b>狀態／更新</b><span>${e(state)} · ${e(updated)}</span></div><p class="trend-scope-note">資料只供查卡時參考；未提供成交量、全市場代表性或投資建議。沒有真實前次價格時不建立示範排名。</p></div><div class="trend-rail">${cards||'<div class="trend-empty"><b>目前沒有可驗證的漲勢資料</b><span>需要同一來源的前次與目前價格；資料補齊後會在此呈現，暫不以示範數字填空。</span></div>'}</div>`;
}
function installTrendTransparency(){
  if(typeof renderTrends!=='function')return;
  const base=renderTrends;if(base.__cardscopeWrapped)return;
  const wrapped=function(){base();renderPublicTrends()};wrapped.__cardscopeWrapped=true;renderTrends=wrapped;
  // Render now only if the trends request already finished; otherwise the wrapped renderTrends does it when data arrives
  // (an early 'no data' render was shorter than the real rail and made the page jump).
  setTimeout(()=>{if(window.trendsLoaded)renderPublicTrends()},0);
}
function healthNumber(row,keys){if((keys.includes('displayableImages')&&row?.metricStatus?.images==='unknown')||(keys.includes('rarities')&&row?.metricStatus?.rarities==='unknown'))return null;for(const key of keys){const value=betaNumber(row?.[key]);if(value!==null)return value}return null}
function verifiedEnhancementCardTotal(data){const total=healthNumber(data,['totalCards']);return Number.isSafeInteger(total)&&total>=0&&((data?.source==='supabase-current-rows'&&data.sample===false&&data.metricStatus?.cards==='complete')||(data?.metricStatus?.cards==='observed-physical-cards'&&data.sample!==true&&!String(data?.source||'').startsWith('catalog.json')))?total:null}
function enhancementCoverageLabel(data,loadedCount){const verifiedTotal=verifiedEnhancementCardTotal(data);if(verifiedTotal!==null)return`資料庫目前觀測 ${verifiedTotal.toLocaleString()} 張`;const isFallback=data?.sample===true||String(data?.source||'').startsWith('catalog.json'),fallbackCount=healthNumber(data,['totalCards'])??loadedCount;if(isFallback)return`本機備援樣本 ${fallbackCount===null?'待載入':fallbackCount.toLocaleString()} 張；資料庫總數未核定`;return loadedCount===null?'資料庫總數查核中；尚無載入樣本':`目前載入樣本 ${loadedCount.toLocaleString()} 張；資料庫總數待核`}
function healthPercent(value,expected){return value!==null&&expected!==null&&expected>0?Math.max(0,Math.min(100,value/expected*100)):null}
function healthMetric(label,value,denominator,{showGap=false}={}){const percent=healthPercent(value,denominator),display=value===null?'待核':value.toLocaleString(),width=percent===null?0:Math.round(percent),missing=showGap&&value!==null&&denominator!==null?Math.max(0,denominator-value):null;return`<div class="health-metric"><div><span>${e(label)}</span><b>${e(display)}</b></div>${percent===null?`<small>${value===null?'關聯資料待核':'尚無目前收錄基準'}</small>`:`<div class="health-meter" role="progressbar" aria-label="${e(label)}欄位覆蓋率" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100"><span class="health-meter-fill" style="width:${width}%"></span></div><small>${width}%（以目前收錄卡片為分母）${missing===null?'':` · 缺口 ${missing.toLocaleString()}`}</small>`}</div>`}
function installCatalogHealth(){
  if(document.getElementById('catalogHealth'))return;
  const section=document.createElement('details');section.id='catalogHealth';section.className='catalog-health';section.innerHTML='<summary>資料完整度與圖片權利狀態</summary><p class="health-note">正在讀取資料健康報告…</p>';
  const footer=document.querySelector('.brand-footer');if(footer)footer.insertAdjacentElement('beforebegin',section);else document.querySelector('main')?.append(section);
  const coverageRequest=window.CARD_SCOPE_COVERAGE_PROMISE||fetch('/api/catalog/coverage',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'讀取失敗');return body});
  coverageRequest.then(body=>{const data=body.data||{},games=data.games||{},labels={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王','weiss-schwarz':'葬送的芙莉蓮',haikyuu:'排球少年'},totalLabel=enhancementCoverageLabel(data,Array.isArray(C?.cards)?C.cards.length:null),updated=betaDate(data.updatedAt||data.updated_at),items=Object.entries(labels).map(([id,label])=>{const row=games[id]||{},cards=healthNumber(row,['cards','cardCount','card_count']),expected=healthNumber(row,['expectedCards','expected_cards','officialTotal','official_total']),names=healthNumber(row,['chineseNames','chinese_names','translatedNames','translated_names']),rarities=healthNumber(row,['rarities','rarityCount','rarity_count']),images=healthNumber(row,['displayableImages','displayable_images']),imageUrls=healthNumber(row,['cardsWithImageUrls','cards_with_image_urls']),metricStatus=betaValue(row,['completeness','status','dataStatus','data_status'],'未核定'),scope=typeof row.scope==='object'?betaValue(row,['scope.kind'],'目前收錄資料'):betaValue(row,['scope','coverage','region'],'目前收錄資料');return`<article class="health-item" data-game="${e(id)}"><div class="health-item-heading"><b>${e(label)}</b><span>${cards===null?'卡片數待補':`${cards.toLocaleString()} 張`}</span></div><span class="health-scope">${e(scope)} · ${e(metricStatus)}</span>${healthMetric('中文名',names,cards)}${healthMetric('稀有度',rarities,cards)}${healthMetric('可顯示圖片',images,cards,{showGap:true})}${healthMetric('已有圖片網址',imageUrls,cards)}${expected===null?'<small class="health-status">完整分母未核定，不顯示假完成率。</small>':''}</article>`}).join('');section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><div class="health-head"><div><b>五個 IP 分開檢視</b><span>${e(totalLabel)}；報告更新：${e(updated)}</span></div><span class="health-head-status">${e(data.metricStatus?.cards||'以目前資料列計算')}</span></div><div class="health-grid">${items}</div><p class="health-note">圖片是否可顯示依來源與目前權利狀態判斷；顯示圖片不等於已取得著作權授權。完整分母尚未核定的 IP 只顯示收錄量與欄位覆蓋，不把收錄量冒充完整度。<a href="#betaGuidanceTitle">查看勘誤與權利通知方式</a></p>`;const betaUpdated=document.getElementById('betaUpdatedAt');if(betaUpdated&&data.updatedAt)betaUpdated.textContent=`${String(data.updatedAt).slice(0,10)} · 覆蓋報告`}).catch(error=>{const totalLabel=enhancementCoverageLabel(null,Array.isArray(C?.cards)?C.cards.length:null);section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><p class="health-note">完整度報告暫時無法讀取：${e(error.message)}；${e(totalLabel)}；資料庫總數待核。</p>`})
}
function installReportTemplate(){const button=document.getElementById('copyReportTemplate');if(!button||button.dataset.ready)return;button.dataset.ready='1';button.onclick=async()=>{const template='CardScope 勘誤／權利通知\n卡片 ID：\n官方卡號：\nIP／版本：\n來源網址：\n問題描述：\n可供核對的官方連結：';const status=document.getElementById('betaCopyStatus');try{await navigator.clipboard.writeText(template);if(status)status.textContent='已複製模板'}catch{if(status)status.textContent='目前無法自動複製，請依上方欄位手動整理'}}}
installTrendTransparency();
installReportTemplate();
installFeatureTour();
installCatalogHealth();
installRarityOptionMemory();
installDetailModalAccessibility();
installViewToggle();
installCardUtilities();
installFilterSheet();
installRarityPills();
if(currentCardRows.length)cards(currentCardRows,true);
// Phone bottom bar: jump to sections that already exist on the page (探索 also focuses the search box).
document.querySelectorAll('nav.bottom [data-jump]').forEach(button=>{button.onclick=()=>{
  const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  if(button.dataset.jump==='q'){scrollTo({top:0,behavior});$('q')?.focus({preventScroll:true});return}
  const target=$(button.dataset.jump)?.getClientRects().length?$(button.dataset.jump):button.dataset.jump==='cardTools'?$('cards'):null;
  target?.scrollIntoView({block:'start',behavior});
}});
// The watchlist only exists inside a game's card view; hide 我的 while there is nothing to jump to.
const bottomWatchlist=document.querySelector('nav.bottom [data-jump="watchlistSummary"]');
if(bottomWatchlist&&$('cardTools')&&typeof ResizeObserver==='function')new ResizeObserver(()=>{bottomWatchlist.hidden=!$('watchlistSummary')?.getClientRects().length}).observe($('cardTools'));
// Return focus to the tile of the card last shown (arrow keys can move past the one that was opened).
window.installDialogFocus?.($('modal'),{initialFocus:()=>$('close'),returnTarget:()=>detailReturnCardId&&[...document.querySelectorAll('[data-card-open]')].find(item=>item.dataset.cardOpen===String(detailReturnCardId))});

// An Escape already handled (the zoom view closes itself first) must not also close the detail dialog.
document.addEventListener('keydown',event=>{if(event.defaultPrevented)return;if(event.key==='Escape'&&$('cardZoom')?.classList.contains('open')){closeCardZoom();return}if(!$('modal')?.classList.contains('open'))return;if(event.key==='ArrowLeft')openAdjacentCard(-1);if(event.key==='ArrowRight')openAdjacentCard(1);if(event.key==='Escape')$('modal').classList.remove('open')});

const detailTabsStyle=document.createElement('style');
detailTabsStyle.textContent=`.detail-tabs [hidden]{display:none!important}.rarity-code{text-decoration:none;cursor:help}.rarity-full{font-size:12px}.detail-meta{margin:0 0 14px}
.collection-dialog{width:min(760px,calc(100vw - 16px));max-height:calc(100dvh - 16px);padding:0;border:1px solid var(--rule,#d9d1c0);border-radius:12px;background:#fff;color:inherit}.collection-dialog::backdrop{background:#0008}.coll{display:grid;gap:12px;padding:16px}.coll header{display:flex;align-items:center;justify-content:space-between;gap:12px}.coll h2{margin:0;font-size:20px}.coll header button{min-width:44px}.coll h3{margin:0 0 6px;font-size:16px}.coll-local{margin:0;padding:10px 12px;border-radius:8px;background:var(--paper-2,#f8f5ee);border:1px solid var(--rule,#d9d1c0);font-size:14px}.coll-value{padding:10px 12px;border:1px solid var(--rule,#d9d1c0);border-radius:8px}.coll-value p{margin:6px 0 0}.coll-sums{display:grid;gap:6px;margin:0;padding:0;list-style:none}.coll-sums li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.coll-sums b{font-size:18px}.coll-sums small{color:var(--ink-2,#5a5348)}.coll-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.coll-item{content-visibility:auto;contain-intrinsic-size:auto 220px;display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px 12px;padding:10px;border:1px solid var(--rule,#d9d1c0);border-radius:8px}.coll-art{position:relative;width:64px;aspect-ratio:5/7;overflow:hidden;border-radius:6px;background:var(--paper-2,#f8f5ee)}.coll-art .card-sample-watermark{font-size:9px;letter-spacing:.04em}.coll-art img{width:100%;height:100%;object-fit:contain}.coll-art .image-fallback{font-size:11px}.coll-main{min-width:0;overflow-wrap:anywhere}.coll-name{display:block}.coll-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.coll-price{display:grid;gap:2px;margin-top:6px;font-size:13px}.coll-skip{color:var(--ink-2,#5a5348)}.coll-fields,.coll-pick,.coll-actions{grid-column:1/-1}.coll-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.coll-fields label,.coll-pick{display:grid;gap:2px;font-size:13px;font-weight:700}.coll-fields input,.coll-fields select,.coll-pick select{width:100%;font:inherit;font-weight:400}.coll-note-field{grid-column:1/-1}.coll-actions,.coll-tools{display:flex;flex-wrap:wrap;gap:8px}.coll-actions{justify-content:flex-end}@media(min-width:720px){.coll-fields{grid-template-columns:90px repeat(2,minmax(0,1fr))}}@media(max-width:520px){.coll{padding:12px}.coll-tools button{flex:1 1 140px}}`;
document.head.append(detailTabsStyle);

// 頂欄／底部導覽的「我的收藏」呼叫 window.openCollection()（ADR 0045，v0 免登入）：清單可編輯張數／品況／版本／備註、看參考總值、匯出入 JSON 備份、下載 CSV。資料只在這台裝置。
const collectionUi={prices:{},priceMeta:null,pricesState:'idle',failed:new Set(),progress:''};
const COLLECTION_REASONS={slab:'鑑定卡不計入',none:'尚無參考價快照',choose:'請選擇版本',['no-match']:'所選版本沒有對應的參考價'};
const collectionItems=()=>CS.itemsFromLegacy(favoriteIds,watchlist,watchlistMeta);
const collectionDialog=()=>$('collectionDialog'),collectionRowEl=id=>[...document.querySelectorAll('#collectionDialog [data-coll-id]')].find(item=>item.dataset.collId===id);
const collectionStatus=text=>{collectionUi.progress=text||'';const node=$('collStatus');if(node)node.textContent=collectionUi.progress};
const typingInCollection=()=>/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName||'')&&collectionDialog()?.contains(document.activeElement);
function finishLabel(key){return key===''?'未指定':(typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[key])||key}
function finishChoices(item){const seen=new Set(),keys=['',...(collectionUi.prices[item.id]||[]).map(price=>price.variant).filter(Boolean),...COMMON_FINISHES];if(item.finish&&!keys.some(key=>CS.finishKey(key)===CS.finishKey(item.finish)))keys.push(item.finish);return keys.filter(key=>!seen.has(CS.finishKey(key))&&seen.add(CS.finishKey(key)))}
function collectionValuation(){return CS.valuate(collectionItems().map(item=>({...item,quantity:item.quantity||1})),collectionUi.prices)}
function reasonText(id,reason){return watchlistMeta[id]?.ambiguous?'請先選擇卡片版本':COLLECTION_REASONS[reason]||''}
function rowPriceHtml(item,valuation){
  const state=collectionUi.pricesState,entry=valuation.perEntry[item.id];
  if(watchlistMeta[item.id]?.ambiguous)return '<span class="coll-skip">未計入：請先選擇卡片版本</span>';
  if(state==='loading'||state==='idle')return '<span class="meta">查詢參考價中…</span>';
  if(state==='error'||!entry)return '';
  if(!entry.counted.length)return `<span class="coll-skip">未計入：${e(reasonText(item.id,entry.reason))}</span>`;
  return entry.counted.map(({provider,price,qty})=>`<span class="coll-price-line">${e(CS.PROVIDER_LABELS[provider])} 參考價 ${e(price.currency)} ${Number(price.amount).toLocaleString()}${Number.isFinite(price.amountTwd)?`（約 NT$ ${price.amountTwd.toLocaleString()}${qty>1?` × ${qty}`:''}）`:''} · ${e(price.snapshotDate)}</span>`).join('')+(entry.needsFinish?'<span class="coll-skip">另一來源有多個版本：選擇版本後才計入</span>':'');
}
function valueHtml(valuation){
  const state=collectionUi.pricesState;
  if(!collectionItems().length)return '';
  if(state==='loading'||state==='idle')return '<h3>參考總值</h3><p class="meta">正在查詢參考價…</p>';
  if(state==='error')return '<h3>參考總值</h3><p class="meta">參考價暫時無法取得，不影響收藏本身。</p>';
  const fx=collectionUi.priceMeta?.exchangeRates,sums=Object.entries(CS.PROVIDER_LABELS).filter(([key])=>valuation.byProvider[key]).map(([key,label])=>{const row=valuation.byProvider[key];return `<li><span>${e(label)} 參考價小計</span><b>約 NT$ ${Math.round(row.twd).toLocaleString()}</b><small>${row.entries} 款${row.missingFx?`；${row.missingFx} 款缺匯率未換算`:''}</small></li>`}).join('');
  return `<h3>參考總值</h3>${sums?`<ul class="coll-sums">${sums}</ul>`:'<p>目前沒有可計入的參考價。</p>'}<p class="meta">${valuation.counted}／${valuation.total} 款有參考價${valuation.uncounted.length?`；其餘 ${valuation.uncounted.length} 款未計入（原因標在各卡）`:''}。${valuation.dateFrom?`快照日期 ${e(valuation.dateFrom)}${valuation.dateTo!==valuation.dateFrom?` 至 ${e(valuation.dateTo)}`:''}。`:''}不同來源不相加；品況不調整價格。${fx?.source==='fallback'?'匯率為備用值，僅供概略。':fx?.updatedAt?`匯率日期 ${e(fx.updatedAt)}。`:''}</p><p class="meta">${e(collectionUi.priceMeta?.note||'參考價不是成交價或台灣行情。')}</p>`;
}
function refreshCollectionValue(){
  const valuation=collectionValuation(),host=$('collValue');if(host)host.innerHTML=valueHtml(valuation);
  collectionItems().forEach(item=>{const cell=collectionRowEl(item.id)?.querySelector('.coll-price');if(cell)cell.innerHTML=rowPriceHtml(item,valuation)});
  const total=$('collTotal');if(total)total.textContent=`共 ${collectionIds().length} 款、${collectionTotal()} 張`;
}
// Alt-art versions can share region, set and number; add the id only when the label alone would not tell them apart.
function choiceLabels(choices){const labels=choices.map(choice=>[choice.cardId,[rn(choice.region),choice.set,choice.number,choice.rarity,choice.variant].filter(Boolean).join(' · ')]);return labels.map(([cardId,label])=>[cardId,labels.filter(row=>row[1]===label).length>1?`${label} · ${cardId}`:label])}
function collectionRowHtml(item,valuation){
  const meta=watchlistMeta[item.id]||{},known=!!meta.v,title=known?name(meta):collectionUi.failed.has(item.id)?`查無這張卡的資料（${item.id}）`:`卡片資料載入中（${item.id}）`,qty=item.quantity||1,id=e(item.id);
  const facts=known?[meta.officialCardNumber||'卡號待補',meta.rarity?rarityMarkup(meta.rarity,meta.game):'稀有度待補'].join(' · '):'',badges=known?`${meta.region?`<span class="badge">${e(rn(meta.region))}</span>`:''}${meta.version?`<span class="badge variant-badge">${e(meta.version)}</span>`:''}${meta.ambiguous?'<span class="badge">版本待確認</span>':''}`:'';
  const pick=meta.ambiguous?`<label class="coll-pick">選擇你持有的版本<select data-coll-pick="${id}"><option value="">請選擇…</option>${choiceLabels(meta.choices||[]).map(([cardId,label])=>`<option value="${e(cardId)}">${e(label)}</option>`).join('')}</select></label>`:'';
  return `<li class="coll-item" data-coll-id="${id}"><div class="coll-art">${known&&meta.image?resilientImage(meta.image,title,'圖片來源尚未收錄'):missingImageMarkup('')}</div><div class="coll-main"><b class="coll-name">${e(title)}</b><div class="meta">${facts}</div><div class="coll-badges">${badges}</div><div class="coll-price">${rowPriceHtml(item,valuation)}</div></div>${pick}<div class="coll-fields"><label>張數<input type="number" inputmode="numeric" min="1" max="999" step="1" value="${qty}" data-coll-field="quantity"></label><label>品況<select data-coll-field="condition">${CS.CONDITIONS.map(([key,label])=>`<option value="${e(key)}"${key===item.condition?' selected':''}>${e(label)}</option>`).join('')}</select></label><label>版本<select data-coll-field="finish">${finishChoices(item).map(key=>`<option value="${e(key)}"${CS.finishKey(key)===CS.finishKey(item.finish)?' selected':''}>${e(finishLabel(key))}</option>`).join('')}</select></label><label class="coll-note-field">備註<input type="text" maxlength="${CS.LIMITS.noteMax}" value="${e(item.note)}" data-coll-field="note" autocomplete="off"></label></div><div class="coll-actions"><button type="button" data-collection-open="${id}">查看</button><button type="button" data-coll-remove="${id}" aria-label="從我的收藏移除${e(title)}">移除</button></div></li>`;
}
function renderCollection(){
  const dialog=collectionDialog();if(!dialog)return;const items=collectionItems(),valuation=collectionValuation();
  dialog.innerHTML=`<div class="coll"><header><h2 id="collectionTitle" tabindex="-1">我的收藏</h2><button type="button" data-collection-close aria-label="關閉我的收藏">×</button></header><p class="coll-local" role="note"><b>只存在這台裝置</b>：不用登入、不會上傳。清除瀏覽器資料或換裝置就會消失，建議定期「匯出備份」。</p>${items.length?`<p class="meta" id="collTotal">共 ${collectionIds().length} 款、${collectionTotal()} 張</p><section class="coll-value" id="collValue" aria-label="參考總值">${valueHtml(valuation)}</section><ul class="coll-list">${items.map(item=>collectionRowHtml(item,valuation)).join('')}</ul>`:'<div class="state">還沒有收藏。在卡片上按星號或「＋」就會出現在這裡；也可以匯入之前的備份。</div>'}<div class="coll-tools"><button type="button" data-coll-export${items.length?'':' disabled'}>匯出備份（JSON）</button><button type="button" data-coll-import>匯入備份</button><input type="file" id="collFile" accept="application/json,.json" hidden><button type="button" id="collectionCsv"${items.length?'':' disabled'}>下載清單 CSV</button></div><p class="meta" id="collStatus" role="status" aria-live="polite">${e(collectionUi.progress)}</p></div>`;
  const csv=$('collectionCsv');if(csv)csv.onclick=downloadWatchlistCsv;
}
const rerenderCollection=()=>{if(collectionDialog()?.open&&!typingInCollection())renderCollection()};
function refreshGrid(){renderWatchlistSummary();if($('cards')&&typeof currentCardRows!=='undefined')cards(currentCardRows,true)}

// 把 items 寫回三個既有 localStorage 鍵；畫面快照（名稱、圖、地區）依 id 沿用。
function applyItems(items){
  const old={...watchlistMeta};favoriteIds.clear();Object.keys(watchlist).forEach(key=>delete watchlist[key]);Object.keys(watchlistMeta).forEach(key=>delete watchlistMeta[key]);
  items.forEach(item=>{if(item.favorite)favoriteIds.add(item.id);if(item.quantity>0)watchlist[item.id]=item.quantity;watchlistMeta[item.id]={...old[item.id],id:item.id,canonicalId:item.canonicalId||old[item.id]?.canonicalId||'',condition:item.condition,finish:item.finish,note:item.note}});
  if(!persistCollection())collectionStatus('無法寫入瀏覽器儲存空間（可能是無痕模式或空間已滿），這次的變更關掉頁面後會消失；請先匯出備份。');
}

// 舊資料搬移：收藏鍵可能是作品層 ID（搜尋、詳細頁）或實體卡 ID（圖鑑）。逐筆向 /api/cards/:id 查，換成實體卡 ID 並補快照；
// 只有一張實體卡才自動換，多版本不猜（留給使用者選）；查不到或失敗就原封不動保留。
async function resolveCollectionEntry(key){
  const response=await fetch('/api/cards/'+encodeURIComponent(key));
  if(response.status===404){collectionUi.failed.add(key);return}
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const card=(await response.json()).data,where=CS.locateCard(key,card),snapshot={...cardSnapshot(card,where.id),id:where.id,canonicalId:where.canonicalId||String(card.canonicalId||card.id),ambiguous:!!where.ambiguous,choices:where.choices||[],v:1};
  if(where.id!==key){const items=collectionItems(),from=items.find(item=>item.id===key);if(from)applyItems(CS.mergeItems(items.filter(item=>item.id!==key),[{...from,id:where.id,canonicalId:snapshot.canonicalId}]).items)}
  watchlistMeta[where.id]={...watchlistMeta[where.id],...snapshot};
}
async function resolveCollection(){
  const pending=collectionItems().map(item=>item.id).filter(id=>!watchlistMeta[id]?.v&&!collectionUi.failed.has(id)).slice(0,200);
  const kept=collectionUi.progress;let done=0;const queue=[...pending],worker=async()=>{while(queue.length){const key=queue.shift();try{await resolveCollectionEntry(key)}catch{}done++;collectionUi.progress=`正在補齊卡片資料（${done}／${pending.length}）…`;collectionStatus(collectionUi.progress)}};
  if(!pending.length)return false;
  await Promise.all([worker(),worker(),worker(),worker()]);persistCollection();collectionStatus(kept);return true;
}
async function loadCollectionPrices(){
  const ids=collectionItems().map(item=>item.id).filter(id=>!watchlistMeta[id]?.ambiguous&&!(id in collectionUi.prices));
  if(!ids.length){collectionUi.pricesState='ready';refreshCollectionValue();return}
  collectionUi.pricesState='loading';
  try{for(let index=0;index<ids.length;index+=100){const response=await fetch('/api/prices/reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardIds:ids.slice(index,index+100)})});if(!response.ok)throw Error(`HTTP ${response.status}`);const body=(await response.json()).data;body.cards.forEach(row=>{collectionUi.prices[row.cardId]=row.prices});collectionUi.priceMeta=body.meta}collectionUi.pricesState='ready'}catch{collectionUi.pricesState='error'}
  rerenderCollection();if(typingInCollection())refreshCollectionValue();
}

function downloadFile(filename,type,text){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
async function importCollectionFile(file){
  if(!file)return;
  if(file.size>CS.LIMITS.fileMaxChars*3){collectionStatus('檔案過大（上限 1 MB），沒有匯入。');return}
  let text='';try{text=await file.text()}catch{collectionStatus('讀不到這個檔案。');return}
  const parsed=CS.parseBackup(text);if(parsed.error){collectionStatus(`沒有匯入：${parsed.error}。`);return}
  const merged=CS.mergeItems(collectionItems(),parsed.items);
  if(merged.items.length>CS.LIMITS.itemsMax){collectionStatus(`合併後會超過 ${CS.LIMITS.itemsMax} 款上限，沒有匯入。`);return}
  applyItems(merged.items);refreshGrid();renderCollection();
  collectionStatus(`已匯入：新增 ${merged.added} 款、合併 ${merged.merged} 款${parsed.skipped?`、略過 ${parsed.skipped} 筆格式不符`:''}。`);
  collectionUi.pricesState='idle';await resolveCollection();await loadCollectionPrices();rerenderCollection();
}
function onCollectionField(input){
  const row=input.closest('[data-coll-id]'),id=row?.dataset.collId,field=input.dataset.collField;if(!id||!field)return;
  if(field==='quantity'){const value=Number(input.value);if(!Number.isInteger(value)||value<1||value>CS.LIMITS.quantityMax)return;watchlist[id]=value}
  else watchlistMeta[id]={...watchlistMeta[id],id,[field]:field==='note'?input.value.slice(0,CS.LIMITS.noteMax):input.value};
  if(!persistCollection())collectionStatus('無法寫入瀏覽器儲存空間，這次的變更關掉頁面後會消失；請先匯出備份。');
  refreshCollectionValue();if(field==='quantity')refreshGrid();
}
function removeCollectionItem(id){
  const meta=watchlistMeta[id],title=meta?.v?name(meta):id;
  if(!confirm(`從「我的收藏」移除 ${title}？品況、版本與備註也會一併刪除。`))return;
  favoriteIds.delete(id);delete watchlist[id];delete watchlistMeta[id];persistCollection();refreshGrid();renderCollection();$('collectionTitle')?.focus();collectionStatus(`已移除 ${title}。`);
}
function installCollectionDialog(){
  let dialog=collectionDialog();if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='collectionDialog';dialog.className='collection-dialog';dialog.setAttribute('aria-labelledby','collectionTitle');document.body.append(dialog);
  dialog.addEventListener('click',event=>{
    const target=event.target;if(target===dialog||target.closest('[data-collection-close]'))return dialog.close();
    const open=target.closest('[data-collection-open]');if(open){dialog.close();return openCard(open.dataset.collectionOpen)}
    const remove=target.closest('[data-coll-remove]');if(remove)return removeCollectionItem(remove.dataset.collRemove);
    if(target.closest('[data-coll-export]'))return downloadFile(`cardscope-collection-${new Date().toISOString().slice(0,10)}.json`,'application/json;charset=utf-8',JSON.stringify(CS.exportBackup(collectionItems()),null,2));
    if(target.closest('[data-coll-import]'))return $('collFile')?.click();
  });
  dialog.addEventListener('input',event=>{if(event.target.dataset?.collField)onCollectionField(event.target)});
  dialog.addEventListener('change',event=>{
    const target=event.target;
    if(target.id==='collFile'){const file=target.files?.[0];target.value='';importCollectionFile(file);return}
    if(target.dataset?.collField==='quantity')target.value=String(watchQuantity(target.closest('[data-coll-id]')?.dataset.collId)||1);
    if(target.dataset?.collPick&&target.value){const from=target.dataset.collPick,items=collectionItems(),item=items.find(row=>row.id===from);if(!item)return;applyItems(CS.mergeItems(items.filter(row=>row.id!==from),[{...item,id:target.value}]).items);refreshGrid();renderCollection();resolveCollection().then(()=>loadCollectionPrices()).then(rerenderCollection)}
  });
  return dialog;
}
function openCollection(){
  const dialog=installCollectionDialog();collectionUi.prices={};collectionUi.pricesState='idle';collectionUi.progress='';
  renderCollection();if(!dialog.open)dialog.showModal();
  if(collectionItems().length)resolveCollection().then(changed=>{if(changed){refreshGrid();rerenderCollection()}return loadCollectionPrices()});
}
window.openCollection=openCollection;
