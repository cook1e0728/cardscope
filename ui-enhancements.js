const uiLocal={get(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,value);return true}catch{return false}}};
// ⓘ 說明按鈕的標記由 ui-actions.js 的 window.infoTip 產生；沒載入時（單元測試）就不顯示。
const tipMarkup=(label,body)=>typeof window!=='undefined'&&window.infoTip?window.infoTip(label,body):'';
let cardViewMode='grid',cardGroupMode='none',wallMixed=false;
let activeDetailCardId=null,detailReturnCardId=null;
let favoritesOnly=uiLocal.get('cardscope-favorites-only','0')==='1';
const legacyFavoriteIds=readUiArray('cardscope-favorites');
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
// 卡牆參考價（只有寶可夢）：browse 回應的 referencePrice＝該 printing 最新一筆 Cardmarket 每日快照（EUR，7 天內）；有 amountTwd 時以新台幣為主。格狀只留一行「NT$ 金額＋來源縮寫（CM／TCG）＋極短版本」，原幣、觀測日、完整來源名放 title／aria-label／滑過或長按（:active）提示，清單模式保留原幣；沒有資料就不顯示，不放 0。
// Cardmarket 沒有這張卡的價格時，改用 TCG API 轉來的 TCGplayer 美元市價（多為美國市場上的日版卡行情）。
const REFERENCE_SOURCE_NAMES={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'},REFERENCE_SOURCE_SHORT={cardmarket:'CM',tcgplayer:'TCG'};
function referenceAmountText(amount,currency){const value=Number(amount);return Number.isFinite(value)?`${currency==='EUR'?'€':currency==='USD'?'US$':currency+' '}${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:''}
// 近 7 天漲跌（server 的 referencePrice.changePct／changeFrom）：台灣慣例紅漲綠跌；沒有 changePct 就回 null，畫面不放 0。
function referenceChangeInfo(ref){
  const pct=ref?.changePct==null?NaN:Number(ref.changePct);if(!Number.isFinite(pct))return null;
  const from=String(ref.changeFrom||'').slice(5,10),since=/^\d{2}-\d{2}$/.test(from)?`（比 ${from}）`:'',dir=pct>0?'up':pct<0?'down':'flat',text=`${Math.abs(pct).toLocaleString('en-US',{maximumFractionDigits:1})}%`;
  return {dir,label:dir==='flat'?`近 7 天持平${since}`:`${dir==='up'?'▲':'▼'}${text} 近 7 天${since}`,mark:dir==='up'?`▲${text}`:dir==='down'?`▼${text}`:'持平',say:dir==='flat'?`近 7 天持平${since}`:`近 7 天${dir==='up'?'上漲':'下跌'} ${text}${since}`};
}
// 卡牆與詳細頁共用的有效參考價條件：只有寶可夢、金額為正、Cardmarket 歐元或 TCGplayer 美元。
function usableReference(card){const ref=card?.referencePrice,amount=Number(ref?.amount);return cardGameId(card)==='pokemon'&&ref&&Number.isFinite(amount)&&amount>0&&(ref.currency==='EUR'||ref.currency==='USD'&&ref.source==='tcgplayer')?ref:null}
function cardReferenceMarkup(card,openId){
  const ref=usableReference(card);if(!ref)return '';
  const amount=Number(ref.amount),chg=referenceChangeInfo(ref);
  const source=REFERENCE_SOURCE_NAMES[ref.source]||String(ref.source||'參考來源'),variantKey=String(ref.variant||''),variant=variantKey?(typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[variantKey])||variantKey:'',seen=typeof marketDate==='function'?marketDate(ref.observedAt):'',
    tip=`${source} 平台參考價${ref.source==='tcgplayer'?'（美國市場，經 TCG API）':''}${variant?`（${variant}）`:''}${seen?`，更新於 ${seen}`:''}；不是成交價或台灣行情`,label=`${source} 參考`,original=referenceAmountText(amount,ref.currency),twd=Number(ref.amountTwd),money=Number.isFinite(twd)&&twd>0?`NT$${twd.toLocaleString('en-US')}`:original,text=`${label} ${money===original?money:`約 ${money}（${original}）`}`;
  const short=REFERENCE_SOURCE_SHORT[ref.source]||String(source).slice(0,3).toUpperCase(),shortVariant=variant.split(' ')[0];
  return `<div class="card-price card-reference" data-card-open="${e(openId)}" tabindex="0" role="button" aria-label="${e(text+(chg?'，'+chg.say:'')+'，'+tip+'；開啟卡片詳細資料')}"><span class="cr-amount">${e(money)}</span>${chg&&chg.dir!=='flat'?`<small class="cr-chg cr-${chg.dir}" aria-hidden="true">${e(chg.mark)}</small>`:''}<small class="cr-src" title="${e(`${source}；${original}${seen?`；更新於 ${seen}`:''}；參考價，不是成交價`)}" aria-hidden="true">${e(short)}</small>${shortVariant?`<small class="cr-var" aria-hidden="true">${e(shortVariant)}</small>`:''}${money===original?'':`<small class="cr-original" aria-hidden="true">${e(original)}</small>`}<small class="card-reference-tip" aria-hidden="true">${e(tip)}</small></div>`;
}
// 詳細頁卡名下方的價格列：點它捲到下方的「價格」區塊（沒有分頁，走勢區塊進入視窗才載入）。沒有參考價就不畫，也不放 0。
// 價格區塊用的是比快照新的即時價；同來源、同版本的即時價較新時改用它，漲跌也用它對 7 天前重算，兩處數字才一致。
function liveReference(ref,records){
  const source=REFERENCE_SOURCE_NAMES[ref.source],live=(Array.isArray(records)?records:[]).find(r=>r.priceType==='market'&&r.market===source&&(r.variant||'')===(ref.variant||'')&&r.currency===ref.currency&&Number(r.amount)>0&&Number(r.priceTwd)>0&&Date.parse(r.observedAt)>Date.parse(ref.observedAt));
  if(!live)return ref;const base=Number(ref.changeBase),pct=base>0?(Number(live.amount)-base)/base*100:NaN,taipei=new Date(Date.parse(live.observedAt)+8*3600000).toISOString().slice(0,10);
  return {...ref,amount:Number(live.amount),amountTwd:Number(live.priceTwd),snapshotDate:taipei,...(Number.isFinite(pct)?{changePct:Math.abs(pct)<0.5?0:Math.round(pct*10)/10}:{changePct:null})};
}
// 伺服器剛醒時參考價可能逾時（referencePriceFailed）：留一顆重試鈕，不讓價格列無聲消失。
function detailPriceMarkup(card,records){
  let ref=usableReference(card);if(!ref)return card?.referencePriceFailed&&cardGameId(card)==='pokemon'?'<button type="button" class="detail-price detail-price-retry" data-detail-price-retry><b class="dp-retry">參考價暫時讀不到</b><small class="dp-note">按一下重新讀取</small></button>':'';ref=liveReference(ref,records);
  const source=REFERENCE_SOURCE_NAMES[ref.source]||String(ref.source||'參考來源'),twd=Number(ref.amountTwd),money=twd>0?`NT$ ${twd.toLocaleString('en-US')}`:referenceAmountText(ref.amount,ref.currency),chg=referenceChangeInfo(ref),date=String(ref.snapshotDate||'').slice(5,10),
    note=`${source} 參考${/^\d{2}-\d{2}$/.test(date)?` · ${date}`:''} · 非成交價`,disclaimer='平台參考價，不是成交價或台灣行情';
  return `<button type="button" class="detail-price" data-detail-price title="${e(disclaimer+'；點一下看價格走勢')}" aria-label="${e(`${money}，${chg?chg.say+'，':''}${source} 參考${date?' '+date:''}；${disclaimer}；跳到價格區塊`)}"><b class="dp-amount">${e(money)}</b>${chg?`<span class="dp-chg cr-${chg.dir}">${e(chg.label)}</span>`:''}<small class="dp-note">${e(note)}</small></button>`;
}
function cardGameLabel(card){const catalogName=G(card.game).nameZh;if(catalogName)return catalogName;return (window.CARD_GAMES||[]).find(item=>item.id===card.game)?.name||card.game||'IP 待補'}
// 數量就是收藏：數量 > 0 即「已收藏」，☆ 只是把數量設成 1（或詢問後移除）的快速鍵。
function watchQuantity(id){const value=Number(watchlist[String(id)]);return Number.isInteger(value)&&value>0?value:0}
function isFavorite(id){return watchQuantity(id)>0}
function allKnownCards(){const rows=[...(currentCardRows||[]),...(C?.cards||[])];return [...new Map(rows.map(card=>[String(card.id),card])).values()]}
function cardForWatch(id){const card=allKnownCards().find(item=>String(item.id)===String(id));if(card)return card;const snapshot=watchlistMeta[String(id)];return snapshot?{...snapshot,__watchlistSnapshot:true}:null}
// ADR 0045：收藏以實體卡 ID 為鍵（搜尋列的 id 是作品層 ID，所以用 cardOpenId 取畫面上那個版本的實體卡）；舊資料若以作品層 ID 存，仍對得上。
const CS=window.CollectionStore,COMMON_FINISHES=['normal','holo','reverse'],renderedCards=new Map();
function physicalIdOf(card){const id=String(cardOpenId(card));return id===String(card.id)&&card.physicalCardIds?.length===1?String(card.physicalCardIds[0]):id}
function entryKey(card){const key=physicalIdOf(card);return[key,String(card.id)].find(item=>watchQuantity(item)>0)||key}
function cardSnapshot(card,key){
  const printing=(card.printings||[]).find(p=>String(p.cardId)===String(key))||null;
  return{id:String(key),canonicalId:String(card.canonicalId||card.id||''),game:cardGameId(card)||'',...(printing?.seriesId||card.seriesId?{seriesId:printing?.seriesId||card.seriesId}:{}),nameZh:card.nameZh||'',nameEn:card.nameEn||'',nameJa:card.nameJa||'',nameKo:card.nameKo||'',officialCardNumber:card.officialCardNumber||printing?.localCardNumber||'',rarity:printing?.rarity||card.rarity||'',region:printing?.region||card.region||card.printings?.[0]?.region||'',version:printing?.metadata?.variantName||card.metadata?.variantName||'',image:(printing?.imageUrl&&!printing.imageRehostRequired?printing.imageUrl:image(card))||''};
}
function persistCollection(){return[uiLocal.set('cardscope-watchlist',JSON.stringify(watchlist)),uiLocal.set('cardscope-watchlist-meta',JSON.stringify(watchlistMeta))].every(Boolean)}
// 舊 ☆ 清單只在第一次載入時搬成數量 1（已有數量的不變）。舊鍵原封不動留作備份；數量寫入成功才記下已搬移，失敗下次載入再搬，不會遺失。
function migrateLegacyFavorites(){
  if(!CS||uiLocal.get('cardscope-collection-unified','')==='1')return;
  Object.assign(watchlist,CS.migrateFavorites(legacyFavoriteIds,watchlist).watchlist);
  if(uiLocal.set('cardscope-watchlist',JSON.stringify(watchlist)))uiLocal.set('cardscope-collection-unified','1');
}
migrateLegacyFavorites();
// 在收藏內時保留畫面快照與使用者填的品況／版本／備註；移出收藏就一併刪除。
function touchMeta(key){
  if(!watchQuantity(key)){delete watchlistMeta[key];return}
  const card=renderedCards.get(key)||allKnownCards().find(item=>String(item.id)===key);
  if(card)watchlistMeta[key]={...watchlistMeta[key],...cardSnapshot(card,key),v:1};
}

const cardscopeBaseFilteredCards=typeof filteredCards==='function'?filteredCards:null;
if(cardscopeBaseFilteredCards){
  filteredCards=function(rows){const result=cardscopeBaseFilteredCards(rows);const owned=favoritesOnly?result.filter(card=>isFavorite(entryKey(card))):result;return missingOnlyActive()?owned.filter(card=>!isFavorite(entryKey(card))):owned};
}

function missingImageMarkup(message='圖片來源尚未收錄'){
  return `<span class="image-fallback unified-image-fallback"><b>圖片待補</b><small>${e(message)}</small></span>`;
}

function cardGameId(card){return typeof card?.game==='object'?card.game.id:card?.game}
function cardHasEmbeddedSample(card,src){
  const gameId=cardGameId(card),values=[src,card?.imageUrl,card?.imageSource,...(card?.images||[]).flatMap(item=>[item.imageUrl,item.sourceUrl,item.source]),...(card?.printings||[]).flatMap(item=>[item.imageUrl,item.sourceUrl,item.source])].filter(Boolean);
  const joined=values.map(value=>{try{return decodeURIComponent(String(value))}catch{return String(value)}}).join(' ').toLowerCase();
  return gameId==='onepiece'&&(/(?:asia-tc|asia-en|en)\.onepiece-cardgame\.com/.test(joined)||joined.includes('/api/images/onepiece?'))||gameId==='weiss-schwarz'&&joined.includes('ws-tcg.com');
}
function cardIsSigned(card){
  const values=[card?.rarity,...(card?.printings||[]).flatMap(item=>[item.rarity,item.rarityCode,item.rarityLabel,item.metadata?.variantKey,item.metadata?.variantName])].filter(Boolean).join(' ').toUpperCase();
  return /(^|[^A-Z0-9])(SSP|SP|SEC\+?|OFR|AGR|SIGNED|SIGNATURE|AUTOGRAPH)([^A-Z0-9]|$)/.test(values);
}
// 日版／台版卡沒有自己的圖時，借用同一張英文版卡（同圖鑑編號、同稀有度、唯一候選）的圖；卡面文字不同，要標明。
function cardEnglishStandIn(card,src){const region=card?.region||card?.printings?.[0]?.region;return cardGameId(card)==='pokemon'&&(region==='JP'||region==='TW')&&/^https:\/\/images\.pokemontcg\.io\//.test(String(src||''))}
function cardWatermarkOptions(card,src){const embeddedSample=cardHasEmbeddedSample(card,src),signed=cardIsSigned(card);return{embeddedSample,signed,suppressOverlay:signed&&!embeddedSample,englishStandIn:cardEnglishStandIn(card,src)}}

// 卡圖載入事件（markup 的 data-img-error="card"）：error／load 不冒泡，用 document 的 capture 監聽；其他種類的圖在 ui-actions.js。
function cardImageFailed(img){
  if(!img.dataset.retried){img.dataset.retried='1';img.style.visibility='hidden';setTimeout(()=>{img.src=img.src+(img.src.includes('?')?'&':'?')+'retry=1'},1500);return}
  const next=JSON.parse(img.dataset.fallbacks||'[]');
  if(next.length){img.dataset.fallbacks=JSON.stringify(next.slice(1));img.src=next[0];return}
  img.hidden=true;img.nextElementSibling.hidden=false;const sample=img.parentElement.querySelector('.card-sample-watermark');if(sample)sample.hidden=true;
}
document.addEventListener('error',event=>{if(event.target?.dataset?.imgError==='card')cardImageFailed(event.target)},true);
document.addEventListener('load',event=>{if(event.target?.dataset?.imgError==='card')event.target.style.visibility=''},true);

function resilientImage(src,alt,message,options={}){
  src=typeof displayImageUrl==='function'?displayImageUrl(src):src;
  // 第一次載入失敗先隔 1.5 秒用同網址（加 retry=1）重試一次（官方站偶爾回 503）；還失敗才依序改用其他版本的圖（例如台灣官方站維護時改用日版圖），與放大檢視一致
  const fallbacks=[...new Set((options.fallbacks||[]).map(url=>typeof displayImageUrl==='function'?displayImageUrl(url):url).filter(url=>url&&url!==src))];
  // 這個版本本身沒有圖（例如日版 M6a 的 SAR）：直接用其他版本同一張卡的圖，並標示
  const otherVersion=!src&&fallbacks.length>0;
  if(otherVersion)src=fallbacks.shift();
  if(!src)return missingImageMarkup(message);
  const sample=options.embeddedSample||options.suppressOverlay?'':`<span class="card-sample-watermark" aria-hidden="true">SAMPLE</span>`;
  const note=/^https:\/\/product-images\.tcgplayer\.com\//.test(src)?'<span class="card-lang-note" title="官方與 TCGdex 都沒有這張卡的圖，暫用 TCGplayer 的商品圖">TCGplayer 卡圖</span>':options.englishStandIn?'<span class="card-lang-note" title="這個版本沒有可用的卡圖，暫用英文版同一張卡的圖；卡面文字不同">英文版卡圖</span>':otherVersion?'<span class="card-lang-note" title="這個版本沒有可用的卡圖，暫用其他版本同一張卡的圖；卡面文字可能不同">其他版本卡圖</span>':'';
  return `<img src="${e(src)}" alt="${e(alt)}" loading="lazy"${fallbacks.length?` data-fallbacks="${e(JSON.stringify(fallbacks))}"`:''} data-img-error="card"><span class="image-fallback unified-image-fallback" hidden><b>圖片待補</b><small>${e(message||'圖片來源尚未收錄')}</small></span>${sample}${note}`;
}

function installViewToggle(){
  const tools=$('cardTools');if(!tools||$('cardViewSwitch'))return;
  // 工具列一排（決定 11）：顯示方式｜分組｜稀有度｜排序｜收藏狀態都放進 #cardControls；桌機折行、手機橫向捲動，不另開一套。
  const controls=document.createElement('div');controls.id='cardControls';controls.className='card-controls';
  const segment=(id,label,key,items)=>{const host=document.createElement('div');host.id=id;host.className='view-switch';host.setAttribute('role','group');host.setAttribute('aria-label',label);host.innerHTML=items.map(([value,text])=>`<button type="button" data-${key}="${value}" aria-pressed="false">${text}</button>`).join('');return host};
  const display=segment('cardViewSwitch','顯示方式','view',[['grid','圖鑑'],['list','清單']]),group=segment('cardGroupSwitch','分組','group',[['none','不分組'],['rarity','依稀有度']]);
  controls.append(display,group,...tools.querySelectorAll(':scope > .filter-field'));tools.prepend(controls);
  display.onclick=event=>{const button=event.target.closest('[data-view]');if(!button||button.dataset.view===cardViewMode)return;cardViewMode=button.dataset.view;drawViewButtons();cards(currentCardRows,true)};
  group.onclick=event=>{const button=event.target.closest('[data-group]');if(!button||button.dataset.group===cardGroupMode)return;cardGroupMode=button.dataset.group;if(cardGroupMode==='rarity'&&!String(cardFilters.sort).startsWith('rarity-')){cardFilters.sort='rarity-desc';const sortControl=$('cardSort');if(sortControl)sortControl.value='rarity-desc'}drawViewButtons();if(game!=='all'&&!activeSearch&&cardGroupMode==='rarity')loadCardsPage(true);else cards(currentCardRows,true)};
  drawViewButtons();
}
function drawViewButtons(){
  const mark=(selector,attribute,current)=>document.querySelectorAll(selector).forEach(button=>{const on=button.dataset[attribute]===current;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on))});
  mark('#cardViewSwitch [data-view]','view',cardViewMode);mark('#cardGroupSwitch [data-group]','group',cardGroupMode);
}

// 混合牆（決定：卡片三行）：搜尋結果，或載入的卡跨了不同遊戲、系列、版本（日／台…）。同名同號的卡要靠遊戲、系列、版本標籤分辨；單一系列頁已經是同一批，不重複顯示。
function wallIsMixed(rows){
  if(typeof activeSearch!=='undefined'&&activeSearch)return true;
  if(typeof browse!=='undefined'&&browse?.seriesId)return false;
  const games=new Set(),series=new Set(),regions=new Set();
  for(const card of rows||[]){games.add(cardGameId(card));series.add(card.seriesId||card.printings?.find(p=>p.seriesId)?.seriesId||'');regions.add(card.region||card.printings?.[0]?.region||'')}
  return games.size>1||series.size>1||regions.size>1;
}
function cardActionsMarkup(card){
  const key=entryKey(card);renderedCards.set(key,card);if(renderedCards.size>800)renderedCards.delete(renderedCards.keys().next().value);
  const id=e(key),quantity=watchQuantity(key),title=e(name(card));
  // 收藏是一個動作（決定 3c、10）：沒收藏＝一顆 ☆（按一下加入 1 張）；收藏了＝「− 數量 ＋」，減到 0 就是取消。數量不是按鈕，三格合起來剛好 44＋24＋44px，放得進手機一排 3 張的卡寬。
  const body=quantity
    ?`<div class="watchlist-inline" data-action="watchlist" role="group" aria-label="${title}，已收藏 ${quantity} 張"><button type="button" data-watch-decrement="${id}" aria-label="${quantity===1?`取消收藏：${title}（目前 1 張）`:`減少一張：${title}（目前 ${quantity} 張）`}">−</button><span class="watch-quantity" data-watch-quantity="${id}">${quantity}</span><button type="button" data-watch-increment="${id}" aria-label="增加一張：${title}（目前 ${quantity} 張）">＋</button></div>`
    :`<button type="button" class="favorite-toggle" data-action="favorite" data-favorite-id="${id}" aria-pressed="false" aria-label="加入我的收藏：${title}（目前 0 張）" title="加入我的收藏">☆</button>`;
  return `<div class="card-actions" data-action="card-actions" data-card-key="${id}">${body}</div>`;
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
// 卡格的系列名與版本晶片（同名同號的卡靠這兩樣分辨）：系列名取自目錄，查不到時退回印刷版本的系列代碼；系列頁本身已是單一系列，不重複顯示。
let seriesIndex=null,seriesIndexSource=null;
const CARD_REGION_ORDER=['JP','TW','US','KR','CN','ASIA'];
function cardSeriesLabel(card){
  if(seriesIndexSource!==C.series){seriesIndexSource=C.series;seriesIndex=new Map((C.series||[]).map(row=>[row.id,row]))}
  if(browse?.seriesId&&!activeSearch)return '';
  const id=card.seriesId||card.printings?.find(p=>p.seriesId)?.seriesId,row=seriesIndex.get(id),label=String(row?.nameZh||row?.nameJa||row?.nameEn||row?.officialCode||setCodeText(card.printings?.[0]?.localSetCode)||'').replace(/^.*?系列｜/,'');
  return label?`<div class="card-series" title="${e([row?.officialCode,label].filter(Boolean).join('・'))}">${e(label)}</div>`:'';
}
// 有多個版本時並列「日 台」小晶片（整組用 aria-label 讀出完整版本名）；只有一個版本維持原本的「日版」標籤。
function cardVersionBadges(card){
  const regions=[...new Set([card.region,...(card.printings||[]).map(p=>p.region)].filter(Boolean))].sort((a,b)=>CARD_REGION_ORDER.indexOf(a)-CARD_REGION_ORDER.indexOf(b));
  if(regions.length<2)return `<span class="badge">${e(rn(card.region||card.printings?.[0]?.region,card.game))}</span>`;
  return `<span class="card-versions" role="group" aria-label="收錄版本：${e(regions.map(r=>rn(r,card.game)).join('、'))}">${regions.map(r=>`<span class="badge region-chip" aria-hidden="true">${e(rn(r,card.game).replace(/版$/,''))}</span>`).join('')}</span>`;
}
function cardMarkup(card){
  const source=image(card),price=priceFor(card),number=cardNumberLabel(card),rarity=cardRarityLabel(card),rarityHtml=cardRarityMarkup(card),mixed=wallMixed,versionMarkup=mixed?cardVersionBadges(card):'',seriesMarkup=mixed?cardSeriesLabel(card):'',gameLabel=cardGameLabel(card),picture=resilientImage(source,name(card),'這張卡尚未收錄可公開顯示的圖片',{...cardWatermarkOptions(card,source),fallbacks:[...cardImageSourceCandidates(card),...(card.fallbackImageUrls||[])]}),id=e(cardOpenId(card)),priceMarkup=cardPriceLabel(price),referenceMarkup=cardReferenceMarkup(card,cardOpenId(card));
  const variant=card.metadata?.variantName||card.printings?.find(p=>p.metadata?.variantName)?.metadata?.variantName,flags=`${variant?`<span class="badge variant-badge">${e(variant)}</span>`:''}${listingBadge(card)}`,owned=watchQuantity(entryKey(card))>0?' is-owned':'';
  const openLabel=`開啟${name(card)}的卡片詳細資料`;
  const openControl=`<button type="button" class="card-open-hit" data-card-open="${id}" aria-label="${e(openLabel)}"></button>`;
  if(cardViewMode==='list')return `<article class="card card-list${owned}">${openControl}<div class="art">${picture}</div><div class="card-list-main">${mixed?`<span class="badge ip-badge">${e(gameLabel)}</span>`:''}<h3>${e(name(card))}</h3>${seriesMarkup}<div class="meta">${e(original(card)&&original(card)!==name(card)?original(card):'原名待補')}</div></div><div class="card-list-facts"><b>${e(number)}</b><span>${rarityHtml}</span>${versionMarkup}${flags}${priceMarkup?`<strong>${priceMarkup}</strong>`:''}${referenceMarkup||(priceMarkup?'':'<span class="meta">參考價待補</span>')}</div>${cardActionsMarkup(card)}</article>`;
  // 卡片三行：卡名（旁邊是收藏）、卡號＋稀有度、價格（有才顯示）。遊戲、系列、版本只在混合牆出現。
  const pricing=priceMarkup||referenceMarkup?`<div class="card-pricing">${priceMarkup?`<div class="card-price">${priceMarkup}</div>`:''}${referenceMarkup}</div>`:'';
  return `<article class="card${mixed?' card-mixed':''}${owned}">${openControl}<div class="art">${picture}</div>${mixed?`<div class="card-ctx"><span class="badge ip-badge">${e(gameLabel)}</span>${seriesMarkup}${versionMarkup}</div>`:''}<h3>${e(name(card))}</h3><div class="meta"><span class="card-no">${e(number)}</span><span class="card-sep"> · </span><span class="card-rarity" data-tier="${rarityTier(rarity)}">${rarityHtml}</span></div>${pricing}${flags?`<div class="card-flags">${flags}</div>`:''}${cardActionsMarkup(card)}</article>`;
}

function activateCardActions(root=$('cards')){
  if(!root)return;
  root.querySelectorAll('[data-card-open]').forEach(card=>{card.onclick=event=>{if(event.target.closest('[data-action]'))return;openCard(card.dataset.cardOpen)};card.onkeydown=event=>{if(event.target.closest('[data-action]'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();openCard(card.dataset.cardOpen)}}});
  root.querySelectorAll('[data-favorite-id]').forEach(button=>{button.onclick=event=>{event.stopPropagation();toggleFavorite(button.dataset.favoriteId)}});
  root.querySelectorAll('[data-watch-increment]').forEach(button=>{button.onclick=event=>{event.stopPropagation();stepWatchQuantity(button.dataset.watchIncrement,1)}});
  root.querySelectorAll('[data-watch-decrement]').forEach(button=>{button.onclick=event=>{event.stopPropagation();stepWatchQuantity(button.dataset.watchDecrement,-1)}});
}

function renderCardEmpty(){return `<div class="cards-empty mascot-empty"><img src="/assets/brand/web/rabbit-offline.webp" alt="奔跑中的 CardScope 兔子" loading="lazy"><div><b>兔子還在尋找卡片</b><p>若是尚未發售商品，代表官方尚未公開卡表；圖片待補時也會保留卡片資料。</p></div></div>`}

function renderCardRows(rows){
  if(cardGroupMode!=='rarity')return rows.length?rows.map(cardMarkup).join(''):renderCardEmpty();
  const groups=new Map();rows.forEach(card=>{const rarity=cardRarityLabel(card),gameLabel=cardGameLabel(card),key=`${card.game||'unknown'}\u0000${rarity}`;if(!groups.has(key))groups.set(key,{gameId:cardGameId(card)||'unknown',gameLabel,rarity,cards:[]});groups.get(key).cards.push(card)});
  const direction=cardFilters.sort==='rarity-asc'?'asc':'desc',gameOrder=new Map((window.CARD_GAMES||[]).map((item,index)=>[item.id,index])),ordered=[...groups.values()].sort((a,b)=>(gameOrder.get(a.gameId)??999)-(gameOrder.get(b.gameId)??999)||compareRarityLabels(a.gameId,a.rarity,b.rarity,direction));
  return ordered.length?ordered.map(({gameId,gameLabel,rarity,cards:cardsForRarity},groupIndex)=>`<section class="rarity-group" aria-labelledby="rarity-${groupIndex}"><header><h3 id="rarity-${groupIndex}"><span>${e(gameLabel)}</span>｜<span>${rarityMarkup(rarity,gameId)||e(rarity)}</span></h3><span>${cardsForRarity.length.toLocaleString()} 張</span></header><div class="cards rarity-group-cards${cardViewMode==='list'?' list-view':''}">${cardsForRarity.map(cardMarkup).join('')}</div></section>`).join(''):renderCardEmpty();
}

// ── 分頁標題 ──
// 文案與 providers/seo.mjs 的伺服器端標題一致；畫面內容變動時由 syncPageTitle 依目前狀態重算，所以關掉詳細頁自然回到底下頁面的標題。
const TITLE_SITE='CardScope',TITLE_REGIONS={JP:'日版',TW:'台版',US:'美版',CN:'陸版',KR:'韓版',ASIA:'亞洲版'};
let detailTitleInfo=null;
function pageTitleFor(view){
  const v=view||{},text=value=>String(value??'').trim(),gameTitle=`${text(v.game)}卡牌圖鑑｜${TITLE_SITE}`;
  if(v.kind==='collection')return `我的收藏｜${TITLE_SITE}`;
  if(v.kind==='about')return `資料收錄狀態｜${TITLE_SITE}`;
  if(v.kind==='privacy')return `隱私說明｜${TITLE_SITE}`;
  if(v.kind==='search'&&text(v.query))return `「${text(v.query)}」搜尋結果｜${TITLE_SITE}`;
  if(v.kind==='card'&&text(v.name)){const head=text(v.name)+(text(v.original)?`（${text(v.original)}）`:''),tail=[text(v.number),text(v.rarity)].filter(Boolean).join(' '),first=[head,tail].filter(Boolean).join(' ');/* 與 providers/seo.mjs 的 cardSeo 相同：名稱段與卡號稀有度之間一個空格 */return [first,text(v.series),TITLE_SITE].filter(Boolean).join('｜')}
  if(v.kind==='series'&&text(v.name)){const count=Number(v.count),place=`${text(v.region)}${text(v.game)}${Number.isFinite(count)&&count>0?`・共 ${count} 張`:''}`;return `${text(v.name)} 卡表｜${place}｜${TITLE_SITE}`}
  if((v.kind==='game'||v.kind==='series')&&text(v.game))return gameTitle;
  return `${TITLE_SITE}｜TCG 卡牌圖鑑`;
}
function cardTitleParts(c,selected){
  const primary=zhParts(c.nameZh).name||original(c),series=printingSeries(c,selected),rarity=rarityInfo(selected?.rarity||cardRarityRaw(c),cardGameId(c)).code;
  return{name:primary,original:[c.nameJa,c.nameEn,c.nameKo].map(value=>String(value||'').trim()).find(value=>value&&value!==primary)||'',number:selected?.localCardNumber||c.officialCardNumber||'',rarity:rarity==='NONE'?'':rarity,series:series&&(series.nameZh||series.nameJa||series.nameEn||series.nameKo||series.officialCode)||''};
}
function currentTitleView(){
  const label=id=>G(id).nameZh||(window.CARD_GAMES||[]).find(item=>item.id===id)?.name||id;
  if(document.getElementById('collectionDialog')?.open)return{kind:'collection'};
  if(detailTitleInfo&&$('modal')?.classList.contains('open'))return{kind:'card',...detailTitleInfo};
  if(typeof activeSearch!=='undefined'&&activeSearch?.q)return{kind:'search',query:activeSearch.q};
  if(document.body?.dataset?.view==='about')return{kind:'about'};
  if(document.body?.dataset?.view==='privacy')return{kind:'privacy'};
  if(game==='all')return{kind:'home'};
  const row=browse.seriesId&&(C.series||[]).find(item=>item.id===browse.seriesId);
  if(!row)return{kind:'game',game:label(game)};
  const count=seriesTotals.get(row.id)||(cardFilters.rarity==='all'&&browse.total>0?browse.total:null);
  return{kind:'series',name:row.nameZh||row.nameJa||row.nameEn||row.nameKo||row.officialCode,region:TITLE_REGIONS[row.region]||'',game:label(game),count};
}
function syncPageTitle(){
  try{const title=pageTitleFor(currentTitleView());if(document.title!==title)document.title=title}catch{/* 標題只是輔助：算不出來就保留原標題 */}
  try{syncSeriesCrumbs()}catch{/* 麵包屑也是輔助 */}
}
window.syncPageTitle=syncPageTitle;
// 麵包屑：系列頁卡牆上方「遊戲 › 版本 › 系列」，詳細頁頂端再加卡名。前面幾格是站內連結（data-spa，由 navigation-state.js 以 pushState 導覽；詳細頁開著時先關掉）；最後一格是目前頁（aria-current，不是連結）。
function crumbTrail(gid,region,series){
  const to=params=>'/?'+new URLSearchParams(params),trail=[{label:G(gid).nameZh||gid,href:to({game:gid})}];
  if(region)trail.push({label:rn(region,gid),href:to({game:gid,region})});
  if(series?.id)trail.push({label:titleName(series),href:to({game:gid,series:series.id})});
  return trail;
}
function crumbsMarkup(trail){
  const last=trail.length-1;
  return `<nav class="crumbs" aria-label="麵包屑"><ol>${trail.map((item,i)=>i===last?`<li><span aria-current="page">${e(item.label)}</span></li>`:`<li><a href="${e(item.href)}" data-spa>${e(item.label)}</a></li>`).join('')}</ol></nav>`;
}
function syncSeriesCrumbs(){
  const section=$('cardsSection');if(!section)return;
  const row=document.body?.dataset?.view==='game'&&game!=='all'&&!(typeof activeSearch!=='undefined'&&activeSearch)&&!browse.all&&browse.seriesId&&(C.series||[]).find(item=>item.id===browse.seriesId),host=$('seriesCrumbs');
  if(!row){host?.remove();return}
  const html=crumbsMarkup(crumbTrail(game,row.region,row));
  if(host?.innerHTML===html)return;
  const box=host||Object.assign(document.createElement('div'),{id:'seriesCrumbs'});box.innerHTML=html;if(!host)section.prepend(box);
}
// ── 分頁標題 end ──

cards=function(rows,keepSource=false){
  // 請求還在跑（骨架畫面）時空列表只是「還沒有資料」，不能蓋成「沒有卡」的空白狀態；回應到了由呼叫端先設成 ready，0 張才顯示。
  const waiting=cardDisplayState==='loading';
  if(!keepSource){currentCardRows=rows;refreshRarityOptions(rows)}
  const shown=filteredCards(currentCardRows),host=$('cards');
  if(waiting&&!shown.length)return;
  
  cardDisplayState='ready';wallMixed=wallIsMixed(currentCardRows);host.classList.toggle('list-view',cardViewMode==='list');host.classList.toggle('rarity-view',cardGroupMode==='rarity');drawViewButtons();
  setFilterSummary(`目前載入 ${currentCardRows.length.toLocaleString()} 張，篩選後 ${shown.length.toLocaleString()} 張${favoritesOnly?'；目前只看我的收藏':''}${missingOnlyActive()?'；目前只看缺的卡':''}`);
  host.innerHTML=renderCardRows(shown);
  if(typeof primeCardImages==='function')primeCardImages(host.dataset.cardscopeGame||game,browse);
  activateCardActions(host);renderFavoritesControl();renderWatchlistSummary();renderSeriesProgress();syncPageTitle();
};

function renderFavoritesControl(){
  const current=missingOnlyActive()?'missing':favoritesOnly?'owned':'all';
  document.querySelectorAll('#collectionState [data-coll-state]').forEach(button=>{const on=button.dataset.collState===current;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on))});
}
// 收藏狀態一組三選一（全部／已收藏／還缺）。「已收藏」沿用既有的 cardscope-favorites-only；「還缺」只在系列頁、不記住（換系列就回到全部）。
function setCollectionState(state){
  favoritesOnly=state==='owned';missingOnly=state==='missing';if(missingOnly)missingOnlySeries=browse.seriesId;
  uiLocal.set('cardscope-favorites-only',favoritesOnly?'1':'0');cards(currentCardRows,true);
}

// ☆ 與詳細頁的按鈕共用：未收藏 → 數量 1；已收藏 → 取消。取消會一併刪掉品況、版本與備註，所以有這些資料、或一次要取消多張時先問；單張又沒填任何東西就直接取消（決定 10）。回傳是否有變動。
const hasCollectionNotes=key=>{const meta=watchlistMeta[String(key)];return Boolean(meta&&(meta.condition||meta.finish||meta.note))};
function toggleFavorite(id){
  const key=String(id),quantity=watchQuantity(key);
  if(!quantity){setWatchQuantity(key,1);return true}
  if(quantity>1||hasCollectionNotes(key)){
    const meta=watchlistMeta[key],title=meta?.v?name(meta):(renderedCards.get(key)?name(renderedCards.get(key)):key);
    if(!confirm(`從「我的收藏」移除 ${title}（${quantity} 張）？品況、版本與備註也會一併刪除。`))return false;
  }
  setWatchQuantity(key,0);return true;
}
// ± 按鈕：減到 0 等於取消，走同一個判斷。
function stepWatchQuantity(id,step){const key=String(id),next=watchQuantity(key)+step;if(next<1&&watchQuantity(key)>0)toggleFavorite(key);else if(next>=1)setWatchQuantity(key,next)}

function showCollectionToast(){
  let toast=$('brandCollectionToast');
  if(!toast){toast=document.createElement('div');toast.id='brandCollectionToast';toast.className='brand-collection-toast';toast.setAttribute('role','status');document.body.append(toast)}
  toast.innerHTML='<img src="/assets/brand/web/rabbit-success-160.webp" alt=""><div><b>已加入我的收藏</b><span>彩虹寶箱兔幫你收好了</span></div>';
  toast.classList.add('show');clearTimeout(showCollectionToast.timer);showCollectionToast.timer=setTimeout(()=>toast.classList.remove('show'),2600);
}

function setWatchQuantity(id,quantity){
  const key=String(id),previous=watchQuantity(key),next=Math.max(0,Math.min(999,Number(quantity)||0));
  if(next)watchlist[key]=next;else delete watchlist[key];
  touchMeta(key);persistCollection();repaintCollected(key,previous,next);if(previous===0&&next>0)showCollectionToast();
}

function watchlistEntries(){
  return Object.entries(watchlist).map(([id,quantity])=>({id,quantity:watchQuantity(id),card:cardForWatch(id)})).filter(entry=>entry.quantity>0);
}

function watchlistTotals(){
  const totals=new Map();watchlistEntries().forEach(({card,quantity})=>{if(!card||card.__watchlistSnapshot)return;const price=priceFor(card),amount=price&&Number(price.price),currency=price&&String(price.currency||'').trim();if(!Number.isFinite(amount)||!currency)return;totals.set(currency,(totals.get(currency)||0)+amount*quantity)});return totals;
}
// 收藏數量變動後只重畫動到的那張卡的收藏區（B7：整片重繪會讓圖片閃一下、鍵盤焦點掉光）。
// 只有開著「已收藏／還缺」篩選、而且這張卡進出了牆面時，才整片重繪。
function repaintCollected(key,previous,next){
  if((favoritesOnly||missingOnlyActive())&&(previous===0||next===0)){cards(currentCardRows,true);renderDetailCollect();return}
  refreshCardCollect(key,next);renderFavoritesControl();renderWatchlistSummary();renderSeriesProgress();renderDetailCollect();
}
// 同一張卡在牆上可能出現不只一處（清單、分組），逐一處理；焦點在被換掉的按鈕上時，換完放回同一個位置。
function refreshCardCollect(key,next){
  const boxes=[...(document.querySelectorAll?.('#cards .card-actions')||[])].filter(box=>box.dataset.cardKey===key);
  if(!boxes.length)return;
  const card=renderedCards.get(key);if(!card){cards(currentCardRows,true);return}
  for(const box of boxes){
    const active=box.contains(document.activeElement)?document.activeElement:null,role=active?(active.hasAttribute('data-watch-decrement')?'[data-watch-decrement]':'[data-watch-increment]'):'';
    box.insertAdjacentHTML('afterend',cardActionsMarkup(card));const fresh=box.nextElementSibling,article=box.closest('.card');box.remove();
    article?.classList.toggle('is-owned',next>0);activateCardActions(article||fresh.parentElement);
    if(active)(next>0?fresh.querySelector(role):fresh.querySelector('[data-favorite-id]'))?.focus({preventScroll:true});
  }
  announceCollect(`${name(card)}：${next>0?`已收藏 ${next} 張`:'已取消收藏'}`);
}
// 螢幕閱讀器：按鈕被換掉後 aria-live 不會報，所以用一個固定的隱藏播報區。
function announceCollect(text){
  let live=document.getElementById('collectLive');
  if(!live){live=document.createElement('div');live.id='collectLive';live.className='sr-only';live.setAttribute('role','status');live.setAttribute('aria-live','polite');document.body.append(live)}
  live.textContent=text;
}


// 「我的收藏」= 數量 > 0 的卡；款數與總張數在網格、摘要與收藏視窗用同一組函式。
function collectionIds(){return Object.keys(watchlist).filter(id=>watchQuantity(id)>0)}
function collectionTotal(){return collectionIds().reduce((sum,id)=>sum+watchQuantity(id),0)}
// 系列集卡進度（圖鑑系列頁）。已收藏 = 這台裝置收藏中屬於該系列的卡（同一張的多張複本只算一張）；共 = 伺服器回報的系列卡數（browse.total，沒有稀有度篩選時才記下）。
// 舊收藏沒存 seriesId 時改用目前卡牆上的卡 id 比對（只比得到已載入的頁），並順手補存 seriesId；開過該系列就不再有這個限制。
let missingOnly=false,missingOnlySeries='';
const seriesTotals=new Map(),seriesTotalFailed=new Set();
function seriesWall(){return typeof browse!=='undefined'&&typeof game!=='undefined'&&game!=='all'&&!!browse.seriesId&&!(typeof activeSearch!=='undefined'&&activeSearch)}
function missingOnlyActive(){return missingOnly&&seriesWall()&&browse.seriesId===missingOnlySeries}
function seriesProgressState(){
  if(!seriesWall())return null;
  const sid=browse.seriesId;
  if(cardFilters.rarity==='all'&&browse.rows.length&&browse.total>0)seriesTotals.set(sid,browse.total);
  const total=seriesTotals.get(sid);if(!total)return null;
  const keys=browse.rows.map(entryKey);let changed=false;
  keys.forEach(key=>{if(watchQuantity(key)>0&&!watchlistMeta[key]?.seriesId){watchlistMeta[key]={...watchlistMeta[key],id:key,seriesId:sid};changed=true}});
  if(changed)persistCollection();
  return{hasMore:browse.hasMore,...CS.seriesProgress(CS.ownedInSeries(collectionItems(),sid,keys),total)};
}
const progressBar=(p,label)=>`<div class="series-progress-bar" role="progressbar" aria-label="${e(label)}" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.owned}"><i style="width:${p.percent}%"></i></div>`;
function renderSeriesProgress(){
  const host=$('seriesProgress'),missingButton=$('missingOnly');
  const p=host||missingButton?seriesProgressState():null;
  // 「還缺」是收藏狀態那一組的第三顆：只有系列頁（算得出進度）才出現
  if(missingButton){missingButton.hidden=!p;if(p)missingButton.textContent=`還缺 ${p.missing}`}
  if(!host)return;
  if(!p){host.hidden=true;host.innerHTML='';return}
  host.hidden=false;
  host.innerHTML=`<span class="series-progress-text">已收藏 ${p.owned}／共 ${p.total} 張</span>${progressBar(p,'本系列集卡進度')}${missingOnlyActive()&&p.hasMore?'<small class="meta">只篩選已載入的卡；還有卡沒載入，按「載入更多卡片」才會看到其餘缺的卡。</small>':''}`;
}
function renderWatchlistSummary(){
  const host=$('watchlistSummary');if(!host)return;
  const entries=watchlistEntries(),totals=watchlistTotals(),verified=[...totals].map(([currency,amount])=>`${e(currency)} ${amount.toLocaleString()}`).join(' ／ ');
  const total=verified?`已驗證總價：${verified}`:game==='pokemon'?'收購價總計：寶可夢沒有店家收購資料，參考價見「我的收藏」':'已驗證總價：目前沒有可加總的價格';
  host.innerHTML=`<span class="wl-count"><b>我的收藏</b> 共 ${collectionTotal()} 張</span>${tipMarkup('我的收藏的儲存方式與總價',`<p>僅儲存在此裝置，不會送出採購或販售。</p><p>${total}</p>`)}<button type="button" id="downloadWatchlist" title="下載清單 CSV"${entries.length?'':' disabled'}>下載 CSV</button>`;
  const button=$('downloadWatchlist');if(button)button.onclick=downloadWatchlistCsv;
}

function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`}
function downloadWatchlistCsv(){
  const items=collectionItems();if(!items.length)return;
  const header=['卡片 ID','名稱','原名','官方卡號','稀有度','數量','已驗證價格幣別','已驗證單價','已驗證小計','品況','版本','備註','作品層 ID','系列 ID','遊戲','地區'];
  const rows=items.map(item=>{const id=item.id,quantity=item.quantity||1,card=cardForWatch(id),price=card&&!card.__watchlistSnapshot&&priceFor(card),amount=price&&Number(price.price),valid=Number.isFinite(amount)&&price.currency,known=card&&(!card.__watchlistSnapshot||card.v);return[id,known?name(card):'卡片資料待載入',known?original(card):'',known?(card.__watchlistSnapshot?card.officialCardNumber:cardNumberLabel(card)):'',known?(card.__watchlistSnapshot?card.rarity:cardRarityLabel(card)):'',quantity,valid?price.currency:'',valid?amount:'',valid?amount*quantity:'',CS.CONDITIONS.find(([key])=>key===item.condition)?.[1]||'',item.finish,item.note,item.canonicalId,item.seriesId||'',item.game||'',item.region||''].map(csvCell).join(',')});
  downloadFile('cardscope-watchlist.csv','text/csv;charset=utf-8',`\uFEFF${[header.map(csvCell).join(','),...rows].join('\r\n')}`);
}

function installCardUtilities(){
  const tools=$('cardTools');if(!tools||$('collectionState'))return;
  const state=document.createElement('div');state.id='collectionState';state.className='view-switch collection-state';state.setAttribute('role','group');state.setAttribute('aria-label','收藏狀態');
  state.innerHTML='<button type="button" data-coll-state="all" aria-pressed="true">全部</button><button type="button" id="favoritesOnly" data-coll-state="owned" aria-pressed="false">已收藏</button><button type="button" id="missingOnly" data-coll-state="missing" aria-pressed="false" hidden>還缺</button>';
  state.onclick=event=>{const button=event.target.closest('[data-coll-state]');if(button)setCollectionState(button.dataset.collState)};
  const summary=document.createElement('div');summary.id='watchlistSummary';summary.className='watchlist-summary';const progress=document.createElement('div');progress.id='seriesProgress';progress.className='series-progress';progress.hidden=true;
  ($('cardControls')||tools).append(state);tools.append(summary,progress);renderFavoritesControl();renderWatchlistSummary();renderSeriesProgress();
}

function cardTextBlock(card){
  const metadata=card.metadata||{},originalText=metadata.effectText||metadata.cardText||metadata.ability||metadata.text||metadata.effect||null,translatedText=metadata.effectTextZh||metadata.cardTextZh||metadata.abilityZh||metadata.textZh||null;
  if(!originalText)return '<p class="meta card-text-empty">這個資料來源沒有提供卡面技能文字。</p>';
  if(!translatedText)return `<h3>卡片文字</h3><div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>中文翻譯尚未收錄；不以未驗證翻譯冒充官方內容。</div>`;
  return `<h3>卡片文字</h3><div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>${e(translatedText)}<small>機器翻譯僅供參考，請以卡面原文與官方規則為準。</small></div>`;
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
  const state={scale:1,maxScale:4,mode:'fit',x:0,y:0,pointers:new Map(),gesture:null,sourceIndex:0,downs:new Map(),tap:null,multi:false};
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
  const endPointer=event=>{state.pointers.delete(event.pointerId);if(state.pointers.size)beginGesture();else{state.gesture=null;state.multi=false}};
  // 雙擊／雙觸：兩次 pointerup 間隔 <300ms、各自位移與兩點距離都小才算；在點擊處於 1x 與 2.5x 間切換，走同一個 setZoom（過場本來就沒有動畫，不受 reduced-motion 影響）。滑鼠與觸控共用，不另掛 dblclick 以免重複觸發。
  const tapToggle=event=>{
    const down=state.downs.get(event.pointerId);state.downs.delete(event.pointerId);
    if(!down||state.multi||Math.hypot(event.clientX-down.x,event.clientY-down.y)>10){state.tap=null;return}
    const last=state.tap;
    if(last&&event.timeStamp-last.t<300&&Math.hypot(event.clientX-last.x,event.clientY-last.y)<30){state.tap=null;setZoom(state.scale>1.01?'fit':2.5,event)}else state.tap={t:event.timeStamp,x:event.clientX,y:event.clientY};
  };

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
  viewport?.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;event.preventDefault();viewport.setPointerCapture?.(event.pointerId);state.pointers.set(event.pointerId,pointerPosition(event));state.downs.set(event.pointerId,pointerPosition(event));if(state.pointers.size>1)state.multi=true;beginGesture()});
  viewport?.addEventListener('pointermove',event=>{if(!state.pointers.has(event.pointerId))return;event.preventDefault();state.pointers.set(event.pointerId,pointerPosition(event));updateGesture()});
  viewport?.addEventListener('pointerup',event=>{tapToggle(event);endPointer(event)});viewport?.addEventListener('pointercancel',event=>{state.downs.delete(event.pointerId);state.tap=null;endPointer(event)});viewport?.addEventListener('lostpointercapture',event=>{if(state.pointers.has(event.pointerId))endPointer(event)});
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
  document.querySelectorAll('[data-text-mode]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-text-mode]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-text-panel]').forEach(panel=>panel.hidden=panel.dataset.textPanel!==button.dataset.textMode)});
  document.querySelectorAll('.tilt-card').forEach(tilt=>{
    const surface=tilt.querySelector('.tilt-card-surface');
    const reset=()=>{surface.style.setProperty('--tilt-x','0deg');surface.style.setProperty('--tilt-y','0deg');surface.style.setProperty('--shine-opacity','0')};
    tilt.onpointermove=event=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const rect=tilt.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));surface.style.setProperty('--tilt-x',`${((.5-y)*12).toFixed(2)}deg`);surface.style.setProperty('--tilt-y',`${((x-.5)*14).toFixed(2)}deg`);surface.style.setProperty('--shine-x',`${(x*100).toFixed(1)}%`);surface.style.setProperty('--shine-y',`${(y*100).toFixed(1)}%`);surface.style.setProperty('--shine-opacity','.38')};
    tilt.onpointerleave=reset;tilt.onblur=reset;
    if(tilt.dataset.cardZoomSrc||tilt.dataset.cardZoomSources){const sources=()=>cardZoomSourcesFromElement(tilt),options=()=>({embeddedSample:tilt.dataset.cardEmbeddedSample==='1',suppressOverlay:tilt.dataset.cardSuppressSample==='1'});tilt.classList.add('can-zoom');tilt.onclick=()=>openCardZoom(sources(),tilt.dataset.cardZoomAlt,options());tilt.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCardZoom(sources(),tilt.dataset.cardZoomAlt,options())}}}
  });
}

function detailRows(){const rows=filteredCards(currentCardRows||[]);return rows.length?rows:(currentCardRows||[])}
function openAdjacentCard(step){const rows=detailRows(),index=rows.findIndex(card=>String(cardOpenId(card))===String(activeDetailCardId));if(index<0||rows.length<2)return;const next=cardOpenId(rows[(index+step+rows.length)%rows.length]);detailTile(next)?.scrollIntoView({block:'nearest',inline:'nearest'});openCard(next)}

// ADR 0044 Q10：資料來源 id 轉成人看得懂的名稱（名稱對照 data/source-registry.json；未知 id 照原樣顯示）。
const DETAIL_SOURCE_NAMES={'pokemon-card-official-jp':'日本官方卡片搜尋','pokemon-jp':'日本官方卡片搜尋','pokemon-tw-official':'台灣官方卡片搜尋','pokemon-tw':'台灣官方卡片搜尋','asia-pokemon-card-official-tw':'台灣官方卡片搜尋',tcgdex:'TCGdex','tcgdex-ja':'TCGdex','tcgdex-zh-tw':'TCGdex','tcgdex-zh-hant-tw':'TCGdex',pokemontcg:'PokemonTCG',ygoprodeck:'YGOPRODeck','cardscope-yugioh-cache':'YGOPRODeck','yugioh-official-us':'遊戲王美國官方卡片資料庫','yugioh-neuron':'遊戲王官方 Neuron 資料庫','onepiece-official':'ONE PIECE 官方卡表','onepiece-official-p':'ONE PIECE 官方卡表','onepiece-official-runtime':'ONE PIECE 官方卡表','onepiece-official-tw':'ONE PIECE 台灣官方卡表','onepiece-official-tw-p':'ONE PIECE 台灣官方卡表','onepiece-tw':'ONE PIECE 台灣官方卡表','optcg-api':'OPTCG API','weiss-schwarz-official':'Weiß Schwarz 官方卡表','haikyu-official':'排球少年卡牌官方卡表'};
// 系列名要跟隨「目前顯示」那個版本：日版卡不顯示台版系列名（目錄查不到該版本的系列時寧可顯示「系列待補」）。
function printingSeries(c,selected){
  const base=c.series&&typeof c.series==='object'?c.series:null;
  if(selected?.seriesId&&selected.seriesId!==base?.id)return(typeof C!=='undefined'&&C.series||[]).find(row=>row.id===selected.seriesId)||null;
  return base&&(!selected?.region||!base.region||base.region===selected.region)?base:null;
}
const setCodeText=value=>/^unspecified$/i.test(String(value||'').trim())?'':String(value||'');
function detailInfoMeta(c,ps,selected){
  const series=printingSeries(c,selected),seriesName=series&&(series.nameZh||series.nameJa||series.nameEn),code=setCodeText(series?.officialCode||selected?.localSetCode),tags=[(series?.region||selected?.region)&&rn(series?.region||selected?.region,c.game),code].filter(Boolean).join('・'),
    sources=[...new Set([...ps.map(p=>p.source),c.source].filter(Boolean).map(id=>DETAIL_SOURCE_NAMES[id]||id))],link=/^https:\/\//.test(selected?.sourceUrl||'')?` <a href="${e(selected.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始頁面</a>`:'',updated=ps.map(p=>p.updatedAt).filter(Boolean).map(String).sort().at(-1);
  return `<section class="dpanel dpanel-source"><h3 class="dpanel-title">系列與來源</h3><dl class="card-identity detail-meta"><div><dt>系列</dt><dd>${seriesName?`${e(seriesName)}${tags?`（${e(tags)}）`:''}`:`系列待補${tags?`（${e(tags)}）`:''}`}</dd></div><div><dt>資料來源</dt><dd>${sources.length?e(sources.join('、')):'來源待補'}${link}</dd></div>${updated?`<div><dt>更新時間</dt><dd><time datetime="${e(updated)}">${e(updated.slice(0,10))}</time></dd></div>`:''}</dl></section>`;
}
// ADR 0042／0044：參考價走勢不拖慢詳細頁開啟。階段 4 起沒有分頁，價格區塊一直排在資訊下面：走勢區塊捲進視窗（或按頂端的「價格」）才請求（price-timeline.js）。
function bindPriceTrend(gameId,market,card){
  const slot=document.querySelector('#detail [data-price-trend]');if(!slot||!window.PriceTimeline)return;
  const load=()=>{
    if(slot.dataset.loaded)return;slot.dataset.loaded='1';
    if(gameId==='pokemon'||gameId?.id==='pokemon')window.PriceTimeline.loadGraded?.(document.querySelector('#detail [data-graded-prices]'),{market,card});
    const art=document.querySelector('#detail .detail-art img');window.PriceTimeline.load(slot,{market,cardNumber:card.officialCardNumber||card.printings?.find(printing=>printing.localCardNumber)?.localCardNumber||'',details:document.querySelector('#detail .ptl-details'),shared:market?.meta?.sharedPriceCardIds?.length>0,image:art?.currentSrc||art?.src||'',cards:art?[art]:[],regionLabel:region=>region?rn(region,gameId):'',variantLabel:variant=>typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[variant]||variant})
  };
  if(typeof IntersectionObserver!=='function')return load();
  const watch=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){watch.disconnect();load()}},{rootMargin:'300px 0px'});
  // 看外面的區塊而不是空的 slot：index.html 的 .price-trend:empty 是 display:none，沒有盒子的元素 IntersectionObserver 永遠不回報。
  watch.observe(slot.closest('.dpanel-trend')||slot);
}

// 價格區塊的跨版本對照表（server 的 market 回應 versions）：一個版本（printing）一組，只並列各版本自己的價格——不排名、不算最便宜、不加總，來源／價格種類／variant 不同的各佔一列。
// 沒有價格的版本照實寫「目前沒有可靠價格」；只有一個版本時不畫表（和收錄版本列重複）。表格在窄螢幕於自己的容器內橫向捲動，頁面不橫向溢出。
function versionPriceTable(market,gameId,selectedCardId){
  const versions=Array.isArray(market?.versions)?market.versions:[];if(versions.length<2)return '';
  const types=market?.meta?.priceTypes||{},variantName=key=>key?(typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[key])||key:'',
    amount=(value,currency)=>{const number=Number(value);return Number.isFinite(number)?`${e(currency)} ${number.toLocaleString('en-US',currency==='JPY'?{maximumFractionDigits:0}:{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—'},
    twd=value=>value!=null&&Number.isFinite(Number(value))?`NT$ ${Number(value).toLocaleString('en-US')}`:'—',
    seen=value=>{const text=typeof marketDate==='function'?marketDate(value):'';return text?`<time datetime="${e(value)}">${e(text)}</time>`:'—'};
  const rows=versions.map(version=>{
    const label=`<th scope="row"><b>${e(rn(version.region,gameId))}</b>${String(version.cardId)===String(selectedCardId)?' <span class="badge">目前顯示</span>':''}<small>${e([printingLanguage(version,gameId),setCodeText(version.localSetCode),version.localCardNumber,version.variantName].filter(Boolean).join(' · '))}</small></th>`;
    if(!version.prices?.length)return `<tr>${label}<td colspan="5" class="vp-none">${typeof noPriceSource==='function'&&noPriceSource(gameId)?'尚未接入價格來源':'目前沒有參考價'}</td></tr>`;
    return version.prices.map((price,index)=>`<tr>${index?`<th scope="row" class="vp-same"><span class="sr-only">${e(rn(version.region,gameId))}</span></th>`:label}<td>${e(price.source)}${price.origin==='snapshot'?' <small>每日快照</small>':''}</td><td>${e(types[price.priceType]||price.priceType)}${price.variant?` <small>${e(variantName(price.variant))}</small>`:''}</td><td>${amount(price.amount,price.currency)}</td><td>${twd(price.amountTwd)}</td><td>${seen(price.observedAt)}</td></tr>`).join('');
  }).join('');
  return `<section class="dpanel dpanel-prices"><h4 class="dpanel-title">各版本價格對照</h4>${tipMarkup('各版本價格對照的規則','<p>只並列各版本自己的價格，不判斷哪裡比較便宜；來源、價格種類與版本不同的價格不合併，新台幣為換算參考。</p>')}<div class="version-prices" role="region" aria-label="各版本價格對照，可左右捲動" tabindex="0"><table class="version-price-table"><thead><tr><th scope="col">版本</th><th scope="col">來源</th><th scope="col">價格種類</th><th scope="col">原幣</th><th scope="col">新台幣</th><th scope="col">更新日期</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// 收錄版本列：平行卡（圖片網址或卡 ID 帶 _p1／_r2）標「異圖 N」；航海王台灣版是日文印刷，語言顯示日文（只改顯示）；遊戲王卡號顯示印刷編號，密碼放次要資訊。
function parallelLabel(p,gameId){const m=String(p?.imageUrl||'').match(/_([pr])(\d+)\.\w+(?:\?|$)/i)||(gameId==='onepiece'?String(p?.cardId||'').match(/-([pr])(\d+)$/i):null);return m?`異圖 ${Number(m[2])}`:''}
function printingLanguage(p,gameId){return gameId==='onepiece'&&p?.region==='TW'?'日文':ln(p?.language)}
function detailNumber(c,selected){const passcode=String(c.officialCardNumber||''),printed=selected?.localCardNumber;return cardGameId(c)==='yugioh'&&printed&&/^\d+$/.test(passcode)&&printed!==passcode?`${e(printed)} <small class="meta" title="遊戲王卡片密碼（Passcode）">密碼 ${e(passcode)}</small>`:e(cardNumberLabel(c))}
// 詳細頁的收藏按鈕：數量 > 0 即已收藏；按鈕、± 與網格上的 ☆ 共用同一份數量。
function renderDetailCollect(){
  const slot=document.querySelector('#detail [data-detail-collect]');if(!slot)return;
  const key=slot.dataset.detailCollect,quantity=watchQuantity(key),focused=slot.contains(document.activeElement)?document.activeElement.dataset.collectAct:'';
  slot.innerHTML=quantity?`<button type="button" class="detail-collect-state" data-collect-act="toggle" aria-pressed="true" title="已收藏，按一下移除">★ 已收藏 ×${quantity}</button><span class="detail-collect-step" role="group" aria-label="收藏張數"><button type="button" data-collect-act="dec" aria-label="減少數量">−</button><button type="button" data-collect-act="inc" aria-label="增加數量">＋</button></span>`:'<button type="button" class="detail-collect-state" data-collect-act="toggle" aria-pressed="false">☆ 加入收藏</button>';
  slot.onclick=event=>{const act=event.target.closest('[data-collect-act]')?.dataset.collectAct;if(act==='toggle')toggleFavorite(key);else if(act==='dec')stepWatchQuantity(key,-1);else if(act==='inc')stepWatchQuantity(key,1)};
  if(focused)(slot.querySelector(`[data-collect-act="${focused}"]`)||slot.querySelector('[data-collect-act="toggle"]'))?.focus();
}

// ── 詳細資料（REDESIGN_PLAN 階段 4）：桌機 ≥1000px 是右側側板（卡牆仍可看、可捲、可點），其餘寬度是全螢幕一頁 ──
const panelQuery=typeof matchMedia==='function'?matchMedia('(min-width:1000px)'):null;
window.detailMode=()=>panelQuery?.matches?'panel':'page';
// 側板不鎖整頁（沒有 aria-modal）；全螢幕才是真的對話框
function syncDetailMode(){
  const modal=$('modal');if(!modal)return;
  const panel=window.detailMode()==='panel';modal.dataset.mode=panel?'panel':'page';
  for(const node of [modal,modal.querySelector('.dialog')])if(node){if(panel)node.removeAttribute('aria-modal');else node.setAttribute('aria-modal','true')}
}
panelQuery?.addEventListener?.('change',syncDetailMode);
const detailTile=id=>{const hit=[...document.querySelectorAll('#cards .card-open-hit')].find(item=>item.dataset.cardOpen===String(id));return hit?.closest('.card')||hit||null};
// 側板開關會讓卡牆變窄（6→4 欄）、卡換行：改變前後量同一張卡的位置，把差距捲回去，使用者正在看的那張不會跳走。
function holdPlace(id,change){
  const tile=id==null?null:detailTile(id),rect=tile?.getBoundingClientRect(),visible=Boolean(rect&&rect.bottom>0&&rect.top<window.innerHeight),before=visible?rect.top:0;
  change();
  if(visible&&tile.isConnected){const delta=tile.getBoundingClientRect().top-before;if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'})}
}
// 卡牆上標出現在開著的那張（aria-current）；上一張／下一張的位置與可用狀態跟著卡牆走
function syncWall(){
  const active=activeDetailCardId==null?'':String(activeDetailCardId);
  document.querySelectorAll('#cards .card-open-hit').forEach(hit=>{if(active&&hit.dataset.cardOpen===active)hit.setAttribute('aria-current','true');else hit.removeAttribute('aria-current')});
  const rows=detailRows(),index=active?rows.findIndex(card=>String(cardOpenId(card))===active):-1,position=$('detailPos'),jump=document.querySelector('#modal [data-detail-jump]');
  if(position)position.textContent=index>=0?`${index+1} / ${rows.length}`:'';
  document.querySelectorAll('#modal [data-card-step]').forEach(button=>{button.disabled=!(index>=0&&rows.length>1)});
  if(jump)jump.disabled=!$('detailPriceTitle');
}
// 唯一的關閉入口（Esc、關閉鈕、返回、站內連結都走這裡）：作廢還在路上的請求，關閉前後同樣守住卡牆的位置
window.closeCardDetail=function(){
  holdPlace(activeDetailCardId,()=>{$('modal').classList.remove('open')});
  detailRequestVersion++;activeDetailCardId=null;syncWall();
};
function jumpToPrice(){
  const title=$('detailPriceTitle');if(!title)return;
  title.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.hasAttribute('data-cs-paused')?'auto':'smooth'});
  title.focus({preventScroll:true});
}
// 方向鍵換卡：側板常駐，所以只有焦點在側板、卡牆或沒有焦點時才換；搜尋框、側欄、工具列、選單、滑桿的方向鍵是它們自己的。
function canStepWithKey(event){
  const target=event.target;
  if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return false;
  if(target?.closest?.('input,select,textarea,[contenteditable="true"],[contenteditable=""],[role="combobox"],[role="listbox"],[role="slider"],[role="tab"],[role="radio"],[role="menu"]'))return false;
  if(window.detailMode()!=='panel')return true;
  return !target||target===document.body||target===document.documentElement||Boolean(target.closest?.('#modal,#cards'));
}
// 先畫卡牆已有的資料（卡名、卡號、稀有度、卡圖）；沒有對應的卡牆資料（網址直開、搜尋建議）就畫骨架
function detailPreviewRow(id){return [...(currentCardRows||[]),...(typeof C!=='undefined'&&C?.cards||[])].find(card=>String(cardOpenId(card))===String(id)||String(card.id)===String(id))||null}
function detailPreviewMarkup(card){
  const sources=cardImageSourceCandidates(card),url=sources[0]||image(card),picture=resilientImage(url,name(card),'這張卡尚未收錄可公開顯示的圖片',{...cardWatermarkOptions(card,url),fallbacks:[...sources,...(card.fallbackImageUrls||[])]});
  return `<div class="detail detail-flow detail-preview" data-ip="${e(cardGameId(card))}"><div class="detail-visual"><div class="detail-visual-stage"><div class="detail-art">${picture}</div></div><h2>${e(name(card))}</h2><dl class="card-identity"><div><dt>卡號</dt><dd>${e(cardNumberLabel(card))}</dd></div><div><dt>稀有度</dt><dd>${cardRarityMarkup(card)}</dd></div></dl></div><div class="detail-flow-main"><div class="dsk dsk-flow" aria-busy="true"><span class="sr-only" role="status">正在載入卡片資料…</span><div class="dsk-text" aria-hidden="true"><span class="dsk-line s"></span><span class="dsk-line m"></span><span class="dsk-line m"></span><span class="dsk-line s"></span></div></div></div></div>`;
}
const detailPainted=phase=>{syncWall();if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('cardscope:detail',{detail:{phase}}))};

// 三段畫：①點下去立刻畫卡牆已有的資料；②卡片 API 回來後補上版本、系列、卡面文字（價格區塊標 aria-busy）；③市場資料回來後只填價格區塊。每一段回來都先確認還是現在要看的那張卡（stale），不是就丟掉。
openCard=async function(id,options={}){
  // A slower earlier answer must not paint over the card clicked last (and leave the URL, position and shown card disagreeing).
  const version=++detailRequestVersion,stale=()=>version!==detailRequestVersion,box=$('detail'),refocus=Boolean(options.keepPosition&&document.activeElement?.closest?.('#detail [data-version-card]'));
  if(!options.keepPosition){activeDetailCardId=id;detailReturnCardId=id}if(!options.keepPosition)detailTitleInfo=null;
  if(!$('modal').classList.contains('open'))holdPlace(id,()=>$('modal').classList.add('open'));
  // 換版本時保留目前內容、只標記忙碌（變淡），不閃回骨架；新內容換上或失敗時拿掉
  if(options.keepPosition&&box.querySelector('.detail'))box.setAttribute('aria-busy','true');
  else{box.removeAttribute('aria-busy');const row=detailPreviewRow(id);box.innerHTML=row?detailPreviewMarkup(row):typeof detailSkeleton==='function'?detailSkeleton():'正在載入…';detailPainted('preview')}
  try{
    const cr=await fetch('/api/cards/'+encodeURIComponent(id)+'?open=1'),cb=await cr.json();
    if(stale())return;
    if(!cr.ok)throw Error(cb.error);
    const c=cb.data;
    const ps=c.printings||[],ref=ps.find(p=>p.region==='JP')||ps.find(p=>p.region==='TW')||ps.find(p=>p.region==='US')||ps.find(p=>p.region==='KR')||ps[0],selectedPrinting=ps.find(p=>p.cardId&&String(p.cardId)===String(id))||ps.find(p=>c.referencePrintingId&&String(p.id??p.cardId)===String(c.referencePrintingId))||ps.find(p=>p.region===c.region&&p.language===c.language)||ref,versions=versionOrder(ps).map(p=>{const diff=[];if(ref&&p!==ref&&p.localCardNumber&&p.localCardNumber!==ref.localCardNumber)diff.push('卡號不同');if(ref&&p!==ref&&p.rarity&&ref.rarity&&p.rarity!==ref.rarity)diff.push('稀有度不同');const switchable=p!==selectedPrinting&&p.cardId&&String(p.cardId)!==String(selectedPrinting?.cardId),body=`<b>${e(rn(p.region,c.game))}</b>${p===selectedPrinting?' · <span class="badge">目前顯示</span>':''} · ${e(printingLanguage(p,cardGameId(c)))} · ${e(setCodeText(p.localSetCode)||'系列未標示')} · ${e(p.localCardNumber)}${parallelLabel(p,cardGameId(c))?` · <span class="badge">${e(parallelLabel(p,cardGameId(c)))}</span>`:''}${p.rarity?` · ${rarityMarkup(p.rarity,cardGameId(c))}`:''}${p.metadata?.variantName?` · ${e(p.metadata.variantName)}`:''}${diff.length?`<br><span class="meta">版本差異：${e(diff.join('、'))}</span>`:''}${switchable?'<br><span class="meta">點擊查看此版本的卡圖</span>':''}`;return switchable?`<button type="button" class="state version-switch" data-version-card="${e(p.cardId)}">${body}</button>`:`<div class="state${p===selectedPrinting?' is-current':''}"${p===selectedPrinting?' aria-current="true"':''}>${body}</div>`}).join('');
    const detailImageSources=cardImageSourceCandidates(c,selectedPrinting),detailImageUrl=detailImageSources[0]||image(c),zhPart=zhParts(c.nameZh),zhName=zhPart.name||'中文名稱待補',gid=cardGameId(c),rarities=[...new Set([c.rarity,...ps.map(p=>p.rarity)].filter(Boolean).map(rarityText).map(value=>rarityMarkup(value,gid,true)))].join('、')||'稀有度待補';
    const collectKey=[selectedPrinting?.cardId,id,c.id].filter(Boolean).map(String).find(key=>watchQuantity(key)>0)||String(selectedPrinting?.cardId||id),watermarkOptions=cardWatermarkOptions(c,detailImageUrl),zoomSourceAttribute=detailImageSources.length?`data-card-zoom-src="${e(detailImageSources[0])}" data-card-zoom-sources="${e(JSON.stringify(detailImageSources))}" data-card-zoom-alt="${e(name(c))}" data-card-embedded-sample="${watermarkOptions.embeddedSample?'1':'0'}" data-card-suppress-sample="${watermarkOptions.suppressOverlay?'1':'0'}"`:'';
    detailTitleInfo=cardTitleParts(c,selectedPrinting);syncPageTitle();const crumbSeries=printingSeries(c,selectedPrinting),detailCrumbs=crumbsMarkup([...crumbTrail(gid,crumbSeries?.region||selectedPrinting?.region,crumbSeries),{label:name(c)}]);
    const priceSlot=detailPriceMarkup(c,[])?'<div class="detail-price-slot" data-price-slot aria-busy="true"><p class="state" role="status">正在讀取價格…</p></div>':'';
    box.removeAttribute('aria-busy');box.innerHTML=`${detailCrumbs}<div class="detail detail-flow" data-ip="${e(gid)}"><div class="detail-visual"><div class="detail-visual-stage"><div class="detail-art tilt-card" tabindex="0" ${zoomSourceAttribute} aria-label="${detailImageUrl?'點擊放大卡圖；移動游標可傾斜查看':'卡片圖片待補'}"><div class="tilt-card-surface">${resilientImage(detailImageUrl,name(c),'這張卡尚未收錄可公開顯示的圖片',{...watermarkOptions,fallbacks:[...detailImageSources,...(c.fallbackImageUrls||[])]})}<span class="tilt-shine" aria-hidden="true"></span></div></div></div><div class="detail-position">${detailImageUrl?tipMarkup('卡圖操作','點擊卡圖可放大；移動游標可傾斜查看。'):'<small>圖片來源待補</small>'}</div><h2>${e(name(c))}</h2>${zhPart.name&&original(c)?`<div class="detail-subname">${e(original(c))}</div>`:""}${priceSlot}<div class="detail-actions"><div class="detail-collect" data-detail-collect="${e(collectKey)}" role="group" aria-label="我的收藏"></div></div><section class="dpanel dpanel-facts"><h3 class="dpanel-title">卡片資料</h3><dl class="card-identity">${zhPart.name&&!zhPart.note&&!["derived-same-name","derived-cross-series"].includes(c.metadata?.nameZhBasis)?"":`<div><dt>中文名</dt><dd>${e(zhName)}${zhPart.note?` <small class="meta" title="台版來源在名稱後附加的標記">${e(zhPart.note)}</small>`:''}${c.nameZh&&['derived-same-name','derived-cross-series'].includes(c.metadata?.nameZhBasis)?` <small class="meta" title="${c.metadata.nameZhBasis==='derived-cross-series'?'台版未收錄這張卡；中文名沿用其他系列同日文名卡片的台版官方名稱':'台版未收錄這張卡；中文名沿用同系列同日文名卡片的台版官方名稱'}">參考同名譯名</small>`:''}</dd></div>`}<div><dt>卡號</dt><dd>${detailNumber(c,selectedPrinting)}${listingNote(c)}</dd></div><div><dt>稀有度</dt><dd>${rarities}${ps.filter(p=>p.metadata?.rarityBeforeOfficial?.rarity&&p.rarity).map(p=>` <small class="meta" title="依日本官方卡片資料修正；原資料來源標為 ${e(p.metadata.rarityBeforeOfficial.rarity)}">${e(rn(p.region,c.game))}依官方修正（原資料為 ${e(p.metadata.rarityBeforeOfficial.rarity)}）</small>`).join('')}</dd></div></dl></section><section class="dpanel dpanel-versions"><h3 class="dpanel-title">收錄版本</h3>${tipMarkup('收錄版本的顯示規則','每個版本分別標示語言、卡號與稀有度；沒有日版時依序顯示台版、美版、韓版或其他版本。')}<div class="version-list">${versions||'<div class="state">版本待補</div>'}</div></section><p class="detail-ip">${e(c.game?.nameZh||G(c.game).nameZh||c.game)}</p></div><div class="detail-flow-main">${detailInfoMeta(c,ps,selectedPrinting)}${cardTextBlock(c)}<section class="detail-price-section" id="detailPrice" aria-labelledby="detailPriceTitle"><h3 class="detail-section-title" id="detailPriceTitle" tabindex="-1">價格</h3><div data-price-body aria-busy="true"><p class="state" role="status">正在讀取價格…</p></div></section></div></div>`;
    renderedCards.set(collectKey,c);activateDetailInteractions();renderDetailCollect();box.querySelectorAll('[data-version-card]').forEach(button=>{button.onclick=()=>openCard(button.dataset.versionCard,{keepPosition:true})});if(refocus){const current=box.querySelector('.version-list [aria-current="true"]');if(current){current.tabIndex=-1;current.focus()}}
    detailPainted('detail');
    // ③ 市場資料（參考價、走勢、各版本價格）
    const [marketResult]=await Promise.allSettled([fetch('/api/cards/'+encodeURIComponent(id)+'/market')]),marketResponse=marketResult.status==='fulfilled'?marketResult.value:null,mb=marketResponse?.ok?await marketResponse.json().catch(()=>({data:{records:[],meta:{}}})):{data:{records:[],meta:{warning:'行情服務暫時無法回應；卡片資料仍可正常查看。'}}},m=mb.data||{records:[],meta:{}};
    if(stale())return;
    const markets=m.records?.length?m.records.map(r=>`<div class="market"><b>${e(r.provider)}</b> · ${e(r.priceType)} · ${e(r.currency)} ${Number(r.amount).toLocaleString()}</div>`).join(''):'<div class="state">目前沒有可靠對應價格，不以假價格補空白。</div>';
    const body=box.querySelector('[data-price-body]');body.innerHTML=`<section class="dpanel dpanel-trend"><h4 class="dpanel-title">價格走勢</h4><div class="price-trend" data-price-trend="${e(id)}"></div></section><div class="graded-prices" data-graded-prices></div><details class="ptl-details"><summary>這個價格怎麼來的？各版本明細</summary><p class="meta">平台參考價，不是成交價或台灣行情。${tipMarkup('價格紀錄怎麼算','<p>新台幣用今日匯率換算，過去的點也一樣。</p><p>價格變動約 2% 以上或滿 7 天才新增一筆紀錄，沒紀錄的日子沿用前一筆。</p>')}</p>${versionPriceTable(m,c.game&&typeof c.game==='object'?c.game.id:c.game,selectedPrinting?.cardId)}${typeof marketBlock==='function'?marketBlock(m,c.game):`<p class="meta">${e(m.meta?.warning||'不同價格性質不混算。')}</p>${markets}`}</details>`;body.removeAttribute('aria-busy');
    const slot=box.querySelector('[data-price-slot]');if(slot)slot.outerHTML=detailPriceMarkup(c,m.records);
    bindPriceTrend(c.game,m,c);
    const bindDetailPrice=()=>{const box=$('detail');box.querySelector('[data-detail-price]')?.addEventListener('click',jumpToPrice);const retry=box.querySelector('[data-detail-price-retry]');if(retry)retry.onclick=async()=>{retry.disabled=true;retry.querySelector('.dp-note').textContent='正在重新讀取…';let fresh=null;try{const r=await fetch('/api/cards/'+encodeURIComponent(id),{cache:'no-store'});fresh=r.ok?(await r.json()).data:null}catch{}if(stale())return;retry.outerHTML=detailPriceMarkup(fresh||c,m.records);bindDetailPrice()}};bindDetailPrice();detailPainted('price')
  }catch(error){if(stale())return;box.removeAttribute('aria-busy');box.innerHTML=`<div class="state">${e(failText('卡片資料載入失敗：',error))} <button type="button" class="notice-retry" data-detail-retry>重試</button></div>`;const retry=box.querySelector('[data-detail-retry]');if(retry){retry.onclick=()=>openCard(id,options);if(refocus)retry.focus()}detailPainted('error')}
};
window.openCard=openCard;
// 換版本載入中（#detail[aria-busy]）舊內容只是變淡：pointer-events 擋得了滑鼠，鍵盤的 Enter／Space／方向鍵還要在捕獲階段另外擋；Escape、Tab 照常。
(()=>{const busy=event=>$('detail')?.getAttribute('aria-busy')==='true'&&event.target?.closest?.('#detail'),stop=event=>{event.preventDefault();event.stopPropagation()};document.addEventListener('click',event=>{if(busy(event))stop(event)},true);document.addEventListener('keydown',event=>{if(busy(event)&&['Enter',' ','ArrowLeft','ArrowRight','Home','End'].includes(event.key))stop(event)},true)})();

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
    const labels={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年','weiss-schwarz':'葬送的芙莉蓮','dragonball-fw':'七龍珠超 Fusion World'},games=body.data?.games||{};
    const status=$('status'),enforceHealthTotal=()=>{const totalLabel=enhancementCoverageLabel(body.data,Array.isArray(C?.cards)?C.cards.length:null),expected=`${totalLabel}；${P.length.toLocaleString()} 筆實體商品（持續補齊中）。`;if(status&&status.textContent!==expected)status.textContent=expected};
    enforceHealthTotal();if(status){const observer=new MutationObserver(enforceHealthTotal);observer.observe(status,{childList:true,characterData:true,subtree:true});setTimeout(()=>observer.disconnect(),120000)}
    const riskDisplay=body.data?.policy?.unverifiedImageDisplayEnabled===true;
    section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><div class="health-grid">${Object.entries(labels).map(([id,label])=>{const row=games[id]||{};return`<div class="health-item"><b>${e(label)}｜${Number(row.cards||0).toLocaleString()} 張</b><span>中文名 ${Number(row.chineseNames||0).toLocaleString()} · 稀有度 ${Number(row.rarities||0).toLocaleString()}</span><span>圖片網址 ${Number(row.cardsWithImageUrls??row.displayableImages??0).toLocaleString()} · 明確授權 ${Number(row.displayableImages||0).toLocaleString()}</span></div>`}).join('')}</div><p class="health-note">${riskDisplay?'站方已明確接受風險，目前會顯示來源提供但尚未記錄展示授權的卡圖；這不代表卡圖已獲授權，收到權利通知時應下架。':'只有具明確權利狀態且未過期的圖片才會顯示。'} 官方總卡數尚未核定，因此不顯示假完成率。來源政策版本 ${e(body.data?.policy?.version||'—')}，檢查日 ${e(body.data?.policy?.reviewedAt||'—')}。</p>`;
  }catch(error){section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><p class="health-note">健康報告暫時無法讀取：${e(error.message)}</p>`}
}

const enhancementStyle=document.createElement('style');enhancementStyle.textContent=`.unified-image-fallback{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f4f4f4,#f4f4f4 10px,#ededed 10px,#ededed 20px);gap:5px;align-content:center}.unified-image-fallback b{color:#555}.unified-image-fallback small{max-width:150px}.view-switch{display:flex;align-self:end;margin-right:auto}.view-switch button,.text-switch button{border:1px solid #d5d5d5;background:#fff;padding:8px 12px;cursor:pointer}.view-switch button:first-child,.text-switch button:first-child{border-radius:9px 0 0 9px}.view-switch button:last-child,.text-switch button:last-child{border-radius:0 9px 9px 0}.view-switch button.on,.text-switch button.on{background:#111;color:#fff;border-color:#111}.cards.list-view{grid-template-columns:1fr;gap:8px}.card-list{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(180px,auto);gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.card-list .art{width:76px;aspect-ratio:5/7}.card-list h3{white-space:normal;margin:0}.card-list-facts{display:grid;grid-template-columns:repeat(2,minmax(80px,auto));gap:3px 12px;align-items:center}.detail-flow{grid-template-columns:270px 1fr}.detail-visual-stage{position:relative}.tilt-card{perspective:1000px;overflow:visible;background:transparent;outline:none}.tilt-card:focus-visible{box-shadow:0 0 0 4px var(--y)}.tilt-card-surface{position:relative;width:100%;height:100%;overflow:hidden;border-radius:13px;transform:rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));transform-style:preserve-3d;transition:transform .18s ease;box-shadow:0 16px 35px #0002}.tilt-card-surface>img,.tilt-card-surface>.image-fallback{width:100%;height:100%;object-fit:contain}.tilt-shine{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--shine-x,50%) var(--shine-y,50%),#fff9 0,transparent 38%);mix-blend-mode:screen;opacity:var(--shine-opacity,0);transition:opacity .18s}.detail-position{display:flex;justify-content:space-between;gap:10px;margin:10px 3px 0;color:var(--muted);font-size:12px}.card-rules-text{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:14px;margin-top:8px}.card-rules-text small{display:block;color:#8a6500;margin-top:10px}.text-switch{display:flex}.feature-tour{overflow:hidden}.feature-tour-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.feature-eyebrow,.feature-kicker{display:block;font-size:11px;font-weight:900;letter-spacing:.14em}.feature-eyebrow{color:#888}.tour-pause{border:1px solid #ddd;border-radius:999px;background:#fff;padding:7px 13px;cursor:pointer}.feature-stage{position:relative;min-height:265px}.feature-slide{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(310px,.95fr);align-items:center;gap:35px;padding:34px 42px;border-radius:24px;opacity:0;visibility:hidden;transform:translateX(28px);transition:opacity .45s ease,transform .45s ease,visibility .45s}.feature-slide.on{opacity:1;visibility:visible;transform:none}.feature-slide.yellow{background:linear-gradient(120deg,#ffe669,#fff3b8)}.feature-slide.aqua{background:linear-gradient(120deg,#6ee2d6,#c8f9f4)}.feature-slide.violet{background:linear-gradient(120deg,#c69bff,#e5d4ff)}.feature-slide h3{font-size:clamp(24px,3vw,40px);line-height:1.08;margin:8px 0 14px}.feature-slide p{font-size:16px;max-width:630px}.tour-dots{display:flex;justify-content:center;gap:7px;margin-top:12px}.tour-dots button{width:9px;height:9px;padding:0;border:0;border-radius:99px;background:#ccc;cursor:pointer;transition:width .25s}.tour-dots button.on{width:28px;background:#111}.tour-products{height:185px;display:flex;justify-content:center;align-items:end;gap:12px}.tour-products i{display:block;width:92px;height:142px;border:5px solid #fff;border-radius:11px;background:linear-gradient(150deg,#e73154 0 48%,#291c64 49%);box-shadow:0 18px 25px #0002;transform:rotate(-7deg)}.tour-products i:nth-child(2){height:170px;background:linear-gradient(145deg,#00a99a 0 52%,#102a47 53%);transform:none}.tour-products i:nth-child(3){background:linear-gradient(145deg,#ff8b32 0 52%,#7d2047 53%);transform:rotate(7deg)}.tour-search{display:flex;flex-wrap:wrap;align-content:center;gap:10px;padding:26px;border:2px solid #111;border-radius:22px;background:#fffd;box-shadow:0 18px 30px #0001}.tour-search b{flex-basis:100%;font-size:30px}.tour-search span{background:#111;color:#fff;border-radius:999px;padding:7px 12px}.tour-search em{flex-basis:100%;font-style:normal;color:#555}.tour-card-demo{height:190px;display:flex;align-items:center;justify-content:center;gap:25px;perspective:1000px}.tour-card-demo div{width:118px;height:168px;border:6px solid #fff;border-radius:12px;background:linear-gradient(145deg,#f6d948 0 35%,#0a9a93 36% 68%,#1c173e 69%);box-shadow:18px 18px 28px #0003;transform:rotateY(-16deg) rotateX(7deg)}.tour-card-demo span{padding:13px;border-radius:12px;background:#111;color:#fff}@media(prefers-reduced-motion:reduce){.feature-slide,.tilt-card-surface,.tour-dots button{transition:none!important}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.detail-flow{grid-template-columns:1fr}.detail-visual{max-width:280px;margin:auto}.detail-position small{display:none}.feature-stage{min-height:390px}.feature-slide{grid-template-columns:1fr;padding:25px;gap:8px}.feature-slide h3{font-size:27px}.tour-products,.tour-card-demo{height:145px}.tour-products i{width:65px;height:105px}.tour-products i:nth-child(2){height:125px}.tour-card-demo div{width:85px;height:125px}.tour-search{padding:18px}.tour-search b{font-size:24px}}`;document.head.append(enhancementStyle);
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
  .detail-collect{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}
  .detail-collect button{min-width:44px;min-height:44px;padding:0 14px;border:1px solid #d4d4d4;border-radius:10px;background:#fff;color:#222;font:inherit;font-weight:800;cursor:pointer}
  .detail-collect button[aria-pressed=true]{background:#fff8bf;border-color:#c9a800;color:#5c4900}
  .detail-collect button:focus-visible{outline:3px solid var(--y);outline-offset:2px}
  .detail-collect-step{display:inline-flex;gap:6px}
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
  // 遊々亭買取漲幅停用後，這個位置改放 Cardmarket 參考價漲跌榜（price-movers.js）。
  if(typeof trendMeta!=='undefined'&&trendMeta?.disabled){if(typeof window.renderPriceMovers==='function')window.renderPriceMovers(section);else{section.hidden=true;section.innerHTML=''}return}
  const rows=typeof trendRows!=='undefined'&&Array.isArray(trendRows)?trendRows:[],meta=typeof trendMeta!=='undefined'&&trendMeta&&typeof trendMeta==='object'?trendMeta:{},first=rows[0]||{},source=betaValue(meta,['label','source'],betaTrendSource(first)),type=betaValue(meta,['priceType','scope.priceType'],betaTrendType(first)),coveredGames=betaValue(meta,['scope.coveredGames','coveredGames'],[]),coveredSets=betaValue(meta,['scope.coveredSets','coveredSets'],[]),scope=Array.isArray(coveredGames)&&coveredGames.length?`${coveredGames.length} 個 IP · ${Array.isArray(coveredSets)?coveredSets.length:0} 個系列`:betaTrendScope(first),updated=betaDate(betaValue(meta,['observationWindow.latest','scope.observationWindow.latest'],betaValue(first,['updatedAt','updated_at','fetchedAt','fetched_at','observedAt','observed_at'],''))),state=rows.length?(meta.complete===false?'資料不完整／待核實':betaTrendState(first)):'等待可驗證資料';
  const cards=rows.map((row,index)=>{const cardName=betaValue(row,['cardName','card_name','name','title'],betaValue(row,['cardNumber','card_number'],'卡片名稱待補')),cardNumber=betaValue(row,['cardNumber','card_number','officialCardNumber','official_card_number'],'卡號待補'),gameId=betaValue(row,['game','gameId','game_id'],''),gameLabel=G(gameId).nameZh||({pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年','weiss-schwarz':'芙莉蓮'}[gameId]||''),currency=betaValue(row,['currency','priceCurrency','price_currency'],''),current=betaValue(row,['price','currentPrice','current_price'],''),previous=betaValue(row,['previousPrice','previous_price','priorPrice','prior_price'],''),change=betaNumber(betaValue(row,['changePercent','change_percent','change'],'')),image=betaTrendImage(row),cardUrl=(url=>/^https:\/\//i.test(String(url))?url:'#')(betaValue(row,['cardUrl','card_url','url','sourceUrl','source_url'],'#')),status=betaTrendState(row),observed=betaDate(betaValue(row,['updatedAt','updated_at','observedAt','observed_at','fetchedAt','fetched_at'],'')),priceLabel=previous!==''&&current!==''?`${betaTrendAmount(previous,currency)} → ${betaTrendAmount(current,currency)}`:'前次／目前價格待補',changeLabel=change===null?'變動待補':`${change>=0?'+':''}${change}%`,safeHref=e(cardUrl),cardClass=cardUrl==='#'?'trend-card is-static':'trend-card';return`<a class="${cardClass}" href="${safeHref}"${cardUrl==='#'?' aria-disabled="true"':''} target="_blank" rel="noopener"><div class="trend-image">${image?`<img src="${e(image)}" alt="${e(cardName)}" loading="lazy" data-img-error="swap-hidden"><span class="image-fallback unified-image-fallback" hidden><b>圖片待補</b><small>圖片來源尚未收錄</small></span>`:'<span class="image-fallback unified-image-fallback"><b>圖片待補</b><small>圖片來源尚未收錄</small></span>'}</div><div class="trend-card-head"><b>${e(cardName)}</b><span class="trend-rise">${e(changeLabel)}</span></div><span class="trend-card-number">${e(gameLabel?`${gameLabel} · `:'')}${e(cardNumber)}</span><strong>${e(priceLabel)}</strong><div class="trend-card-facts"><span>${e(betaTrendSource(row))}</span><span>${e(betaTrendType(row))}</span><span>${e(status)}</span></div><small>觀測：${e(observed)}</small></a>`}).join('');
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
function enhancementCoverageLabel(data,loadedCount){const verifiedTotal=verifiedEnhancementCardTotal(data);if(verifiedTotal!==null)return`目前已收錄 ${verifiedTotal.toLocaleString()} 張卡片（持續補齊中）`;const isFallback=data?.sample===true||String(data?.source||'').startsWith('catalog.json'),fallbackCount=healthNumber(data,['totalCards'])??loadedCount;if(isFallback)return`本機備援樣本 ${fallbackCount===null?'待載入':fallbackCount.toLocaleString()} 張；資料庫總數未核定`;return loadedCount===null?'資料庫總數查核中；尚無載入樣本':`目前載入樣本 ${loadedCount.toLocaleString()} 張；資料庫總數待核`}
function healthPercent(value,expected){return value!==null&&expected!==null&&expected>0?Math.max(0,Math.min(100,value/expected*100)):null}
function healthMetric(label,value,denominator,{showGap=false}={}){const percent=healthPercent(value,denominator),display=value===null?'待核':value.toLocaleString(),width=percent===null?0:Math.round(percent),missing=showGap&&value!==null&&denominator!==null?Math.max(0,denominator-value):null;return`<div class="health-metric"><div><span>${e(label)}</span><b>${e(display)}</b></div>${percent===null?`<small>${value===null?'關聯資料待核':'尚無目前收錄基準'}</small>`:`<div class="health-meter" role="progressbar" aria-label="${e(label)}欄位覆蓋率" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100"><span class="health-meter-fill" style="width:${width}%"></span></div><small>${width}%（以目前收錄卡片為分母）${missing===null?'':` · 缺口 ${missing.toLocaleString()}`}</small>`}</div>`}
function installCatalogHealth(){
  if(document.getElementById('catalogHealth'))return;
  const section=document.createElement('details');section.id='catalogHealth';section.className='catalog-health';section.innerHTML='<summary>資料完整度與圖片權利狀態</summary><p class="health-note">正在讀取資料健康報告…</p>';
  const footer=document.querySelector('.brand-footer');if(footer)footer.insertAdjacentElement('beforebegin',section);else document.querySelector('main')?.append(section);
  const loadCoverage=()=>window.coverageOnce?.()||fetch('/api/catalog/coverage',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'讀取失敗');return body}),coverageRequest=window.onAboutView?new Promise(resolve=>window.onAboutView(()=>resolve(loadCoverage()))):loadCoverage();
  coverageRequest.then(body=>{const data=body.data||{},games=data.games||{},labels={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王','weiss-schwarz':'葬送的芙莉蓮',haikyuu:'排球少年','dragonball-fw':'七龍珠超 Fusion World'},totalLabel=enhancementCoverageLabel(data,Array.isArray(C?.cards)?C.cards.length:null),updated=betaDate(data.updatedAt||data.updated_at),items=Object.entries(labels).map(([id,label])=>{const row=games[id]||{},cards=healthNumber(row,['cards','cardCount','card_count']),expected=healthNumber(row,['expectedCards','expected_cards','officialTotal','official_total']),names=healthNumber(row,['chineseNames','chinese_names','translatedNames','translated_names']),rarities=healthNumber(row,['rarities','rarityCount','rarity_count']),images=healthNumber(row,['displayableImages','displayable_images']),imageUrls=healthNumber(row,['cardsWithImageUrls','cards_with_image_urls']),metricStatus=betaValue(row,['completeness','status','dataStatus','data_status'],'未核定'),scope=typeof row.scope==='object'?betaValue(row,['scope.kind'],'目前收錄資料'):betaValue(row,['scope','coverage','region'],'目前收錄資料');return`<article class="health-item" data-game="${e(id)}"><div class="health-item-heading"><b>${e(label)}</b><span>${cards===null?'卡片數待補':`${cards.toLocaleString()} 張`}</span></div><span class="health-scope">${e(scope)} · ${e(metricStatus)}</span>${healthMetric('中文名',names,cards)}${healthMetric('稀有度',rarities,cards)}${healthMetric('可顯示圖片',images,cards,{showGap:true})}${healthMetric('已有圖片網址',imageUrls,cards)}${expected===null?'<small class="health-status">完整分母未核定，不顯示假完成率。</small>':''}</article>`}).join('');section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><div class="health-head"><div><b>各遊戲分開檢視</b><span>${e(totalLabel)}；報告更新：${e(updated)}</span></div><span class="health-head-status">${e(data.metricStatus?.cards||'以目前資料列計算')}</span></div><div class="health-grid">${items}</div><p class="health-note">圖片是否可顯示依來源與目前權利狀態判斷；顯示圖片不等於已取得著作權授權。完整分母尚未核定的 IP 只顯示收錄量與欄位覆蓋，不把收錄量冒充完整度。<a href="#betaGuidanceTitle">查看勘誤與權利通知方式</a></p>`;const betaUpdated=document.getElementById('betaUpdatedAt');if(betaUpdated&&data.updatedAt)betaUpdated.textContent=`${String(data.updatedAt).slice(0,10)} · 覆蓋報告`}).catch(error=>{const totalLabel=enhancementCoverageLabel(null,Array.isArray(C?.cards)?C.cards.length:null);section.innerHTML=`<summary>資料完整度與圖片權利狀態</summary><p class="health-note">完整度報告暫時無法讀取：${e(error.message)}；${e(totalLabel)}；資料庫總數待核。</p>`})
}
function installReportTemplate(){const button=document.getElementById('copyReportTemplate');if(!button||button.dataset.ready)return;button.dataset.ready='1';button.onclick=async()=>{const template='CardScope 勘誤／權利通知\n卡片 ID：\n官方卡號：\nIP／版本：\n來源網址：\n問題描述：\n可供核對的官方連結：';const status=document.getElementById('betaCopyStatus');try{await navigator.clipboard.writeText(template);if(status)status.textContent='已複製模板'}catch{if(status)status.textContent='目前無法自動複製，請依上方欄位手動整理'}}}
// ADR 0049：手機版單行緊湊頂欄（左側：遊戲 Logo 下拉＋版本下拉；右側：膠囊搜尋框＋圓形放大鏡鈕）。桌面版以 CSS 隱藏。
function installMobileCompactHeader(){
  const bar=document.querySelector('.top .bar'),searchBox=bar?.querySelector('.search'),regionSelect=$('browseRegion');
  if(!bar||!searchBox||$('mobileHeaderScope'))return;
  const host=document.createElement('div');host.id='mobileHeaderScope';host.className='mobile-header-scope';
  host.innerHTML=`<label class="mobile-scope-pill"><span class="sr-only">切換遊戲</span><img id="mobileScopeLogo" src="/assets/brand/web/cardscope-rabbit-mark-96.webp" alt="" width="24" height="24"><select id="mobileGameSelect" aria-label="切換卡牌遊戲"></select></label><span class="mobile-scope-sep" aria-hidden="true">|</span><label class="mobile-region-pill"><span class="sr-only">切換地區版本</span><select id="mobileRegionSelect" aria-label="切換地區版本"></select></label>`;
  searchBox.before(host);
  const gameSel=$('mobileGameSelect'),regSel=$('mobileRegionSelect'),logo=$('mobileScopeLogo');
  const sync=()=>{
    const choices=window.CARD_GAMES||[{id:'all',name:'探索'},{id:'pokemon',name:'寶可夢'},{id:'onepiece',name:'航海王'},{id:'yugioh',name:'遊戲王'},{id:'weiss-schwarz',name:'芙莉蓮'},{id:'haikyuu',name:'排球少年'},{id:'dragonball-fw',name:'七龍珠超'}];
    const currentGame=typeof game!=='undefined'?game:'all';
    const gameSig=choices.map(c=>c.id).join('|');
    if(gameSel.dataset.sig!==gameSig){
      gameSel.dataset.sig=gameSig;
      gameSel.innerHTML=choices.map(c=>`<option value="${e(c.id)}">${e(c.id==='all'?'探索':c.id==='weiss-schwarz'?'芙莉蓮':c.name)}</option>`).join('');
    }
    gameSel.value=currentGame;
    const visual=typeof window.gameNavImage==='function'?window.gameNavImage(currentGame):'/assets/brand/web/cardscope-rabbit-mark-96.webp';
    if(logo&&visual)logo.src=visual;
    if(regionSelect){
      const opts=[...regionSelect.options].map(o=>`<option value="${e(o.value)}">${e(o.value==='all'?'全部':o.textContent)}</option>`).join('');
      if(regSel.innerHTML!==opts)regSel.innerHTML=opts;
      regSel.value=regionSelect.value||'all';
    }
  };
  gameSel.onchange=()=>{if(typeof window.choose==='function')window.choose(gameSel.value);setTimeout(sync,30)};
  regSel.onchange=()=>{if(!regionSelect)return;regionSelect.value=regSel.value;regionSelect.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(sync,30)};
  if(regionSelect)regionSelect.addEventListener('change',sync);
  document.addEventListener('cardscope:browse',sync);
  if(typeof MutationObserver!=='undefined'&&document.body)new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-game','data-view']});
  sync();
  window.syncMobileHeaderScope=sync;
}

installTrendTransparency();
installReportTemplate();
installFeatureTour();
installCatalogHealth();
installRarityOptionMemory();
installDetailModalAccessibility();
syncDetailMode();
// 頂端列（上一張／下一張／跳到價格）在 #detail 之外，換卡重畫時焦點不會掉
document.addEventListener('click',event=>{
  if(!event.target.closest?.('#modal'))return;
  const step=event.target.closest?.('[data-card-step]');if(step&&!step.disabled)return openAdjacentCard(Number(step.dataset.cardStep));
  if(event.target.closest?.('[data-detail-jump]'))jumpToPrice();
});
// 卡牆重畫（換系列、篩選、載入更多、收藏單張重畫）後，標記與「3 / 48」跟著更新
if($('cards')&&typeof MutationObserver==='function'){let frame=0;new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;syncWall()})}).observe($('cards'),{childList:true,subtree:true})}
// 手機／平板的全螢幕詳細頁：左右滑換卡（走勢圖、表格、輸入元件上的橫向手勢、螢幕邊緣的返回手勢不算）
(()=>{let start=null;
  document.addEventListener('touchstart',event=>{const t=event.touches[0];start=!event.target.closest?.('#modal')||window.detailMode()==='panel'||event.touches.length!==1||$('cardZoom')?.classList.contains('open')||t.clientX<24||t.clientX>innerWidth-24||event.target.closest?.('.ptl-chart,.version-prices,.ptl-table,input,select,textarea,[role="slider"],[role="region"]')?null:{x:t.clientX,y:t.clientY}},{passive:true});
  document.addEventListener('touchend',event=>{if(!start)return;const t=event.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;start=null;if(Math.abs(dx)>=64&&Math.abs(dx)>Math.abs(dy)*1.6)openAdjacentCard(dx<0?1:-1)},{passive:true});
})();
installViewToggle();
installCardUtilities();
installMobileCompactHeader();
// 分頁標題跟著內容走：換頁面種類（body data-*）、開關詳細頁（#modal class）、瀏覽／搜尋事件時重算。
if(typeof MutationObserver!=='undefined'&&document.body){const watch=(node,filter)=>node&&new MutationObserver(syncPageTitle).observe(node,{attributes:true,attributeFilter:filter});watch($('modal'),['class']);watch(document.body,['data-view','data-game'])}
document.addEventListener('cardscope:browse',syncPageTitle);document.addEventListener('cardscope:search',syncPageTitle);
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
window.installDialogFocus?.($('modal'),{initialFocus:()=>$('close'),trap:()=>window.detailMode()!=='panel',returnTarget:()=>detailReturnCardId&&[...document.querySelectorAll('[data-card-open]')].find(item=>item.dataset.cardOpen===String(detailReturnCardId))});

// An Escape already handled (the zoom view closes itself first) must not also close the detail. Closing the detail on Escape lives in navigation-state.js (it knows the history entry); here only the zoom view and the arrow keys.
document.addEventListener('keydown',event=>{if(event.defaultPrevented)return;if(event.key==='Escape'&&$('cardZoom')?.classList.contains('open')){closeCardZoom();return}if(!$('modal')?.classList.contains('open')||$('cardZoom')?.classList.contains('open'))return;const step={ArrowLeft:-1,ArrowRight:1}[event.key];if(step&&canStepWithKey(event))openAdjacentCard(step)});

const referencePriceStyle=document.createElement('style');
referencePriceStyle.textContent=`
  .card-reference{position:relative;z-index:2;cursor:pointer;width:fit-content;max-width:100%}
  .card-reference{display:flex;align-items:baseline;gap:4px;white-space:nowrap;font-variant-numeric:tabular-nums}.card-reference .cr-amount{white-space:nowrap}.card-reference .cr-src,.card-reference .cr-var,.card-reference .cr-original{font-size:.7em;font-weight:500;opacity:.75}.card-reference .cr-var{min-width:0;overflow:hidden;text-overflow:ellipsis}.card:not(.card-list) .card-reference .cr-original{display:none}
  .card-reference:focus-visible{outline:3px solid var(--y,#ffe500);outline-offset:2px}
  .card-reference .cr-chg{font-size:.78em;font-weight:700;min-width:0;overflow:hidden}.cr-up{color:#C4000F}.cr-down{color:#1F6F43}.cr-flat{color:#5A5348}
  .detail-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;width:100%;margin:0 0 10px;padding:8px 10px;border:1px solid var(--lc-hair,#d9d1c0);border-radius:8px;background:#fff;color:inherit;text-align:left;cursor:pointer}.detail-price:hover{border-color:var(--ink,#171717)}.detail-price:focus-visible{outline:3px solid var(--y,#ffe500);outline-offset:2px}
  .detail-price .dp-amount{font-size:24px;line-height:1.2;font-variant-numeric:tabular-nums}.detail-price .dp-chg{font-size:14px;font-weight:700}.detail-price .dp-note{flex-basis:100%;font-size:12px;color:var(--lc-ink-2,#5A5348)}
  .card-reference-tip{display:none;position:absolute;left:0;bottom:calc(100% + 4px);width:max-content;max-width:min(240px,80vw);padding:6px 9px;border-radius:8px;background:#171717;color:#fff;font:500 12px/1.4 system-ui,"Noto Sans TC",sans-serif;white-space:normal;box-shadow:0 2px 8px #0006;pointer-events:none}
  .card-reference:hover .card-reference-tip,.card-reference:focus-visible .card-reference-tip,.card-reference:active .card-reference-tip{display:block}
  .version-prices{max-width:100%;overflow-x:auto;margin:8px 0 14px;border:1px solid var(--line,#e5e5e5);border-radius:10px;-webkit-overflow-scrolling:touch}
  .version-prices:focus-visible{outline:3px solid var(--y,#ffe500);outline-offset:2px}
  .version-price-table{width:100%;min-width:560px;border-collapse:collapse;font-size:13px}
  .version-price-table th,.version-price-table td{padding:8px 10px;border-bottom:1px solid var(--line,#e5e5e5);text-align:left;vertical-align:top}
  .version-price-table thead th{background:var(--soft,#f3f4f5);font-size:12px;white-space:nowrap}
  .version-price-table tbody tr:last-child>*{border-bottom:0}
  .version-price-table th[scope=row]{font-weight:400;white-space:nowrap}
  .version-price-table small{display:block;color:var(--muted,#666);font-size:11px}
  .version-price-table td>small{display:inline}
  .version-price-table td:nth-child(n+2){white-space:nowrap}
  .version-price-table .vp-same{border-top-color:transparent}
  .version-price-table .vp-none{color:var(--muted,#666)}
`;
document.head.append(referencePriceStyle);
const detailTabsStyle=document.createElement('style');
detailTabsStyle.textContent=`.rarity-code{text-decoration:none;cursor:help}.rarity-full{font-size:12px}.detail-meta{margin:0 0 14px}
.collection-dialog{width:min(760px,calc(100vw - 16px));max-height:calc(100dvh - 16px);padding:0;border:1px solid var(--rule,#d9d1c0);border-radius:14px;background:#fff;color:inherit}.collection-dialog::backdrop{background:#0008}.coll{display:grid;gap:12px;padding:16px}.coll header{display:flex;align-items:center;justify-content:space-between;gap:12px}.coll h2{margin:0;font-size:20px}.coll header button{min-width:44px}.coll h3{margin:0 0 6px;font-size:16px}.coll-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:10px 8px;border:1px solid var(--rule,#d9d1c0);border-radius:10px;background:#FBF9F4;text-align:center}.coll-stat{display:grid;gap:2px;min-width:0}.coll-stat b{font-size:18px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}.coll-stat span{font-size:11px;color:var(--ink-2,#5a5348);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.coll-binder-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:56px;padding:10px 14px;border:1.5px solid #D49B1B;border-radius:12px;background:linear-gradient(135deg,#1F1B16 0%,#2B2A26 100%);color:#FFF8E7;text-align:left;cursor:pointer;box-sizing:border-box}.coll-binder-left{display:flex;align-items:center;gap:10px;min-width:0}.coll-binder-left img{width:38px;height:38px;border-radius:8px;object-fit:cover;border:1px solid #D49B1B;flex:none}.coll-binder-copy{display:grid;gap:2px;min-width:0}.coll-binder-copy b{font-size:15px;color:#FFF8E7}.coll-binder-copy small{font-size:11px;color:#E7BA4C}.coll-binder-right{font-size:13px;font-weight:700;color:#E7BA4C;white-space:nowrap;font-variant-numeric:tabular-nums}.coll-local{margin:0;padding:10px 12px;border-radius:8px;background:var(--paper-2,#f8f5ee);border:1px solid var(--rule,#d9d1c0);font-size:14px}.coll-value{padding:10px 12px;border:1px solid var(--rule,#d9d1c0);border-radius:8px}.coll-value p{margin:6px 0 0}.coll-sums{display:grid;gap:6px;margin:0;padding:0;list-style:none}.coll-sums li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.coll-sums b{font-size:18px}.coll-sums small{color:var(--ink-2,#5a5348)}.coll-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.coll-item{content-visibility:auto;contain-intrinsic-size:auto 220px;display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px 12px;padding:10px;border:1px solid var(--rule,#d9d1c0);border-radius:8px}.coll-art{position:relative;width:64px;aspect-ratio:5/7;overflow:hidden;border-radius:6px;background:var(--paper-2,#f8f5ee)}.coll-art .card-sample-watermark{font-size:9px;letter-spacing:.04em}.coll-art img{width:100%;height:100%;object-fit:contain}.coll-art .image-fallback{font-size:11px}.coll-main{min-width:0;overflow-wrap:anywhere}.coll-name{display:block}.coll-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.coll-price{display:grid;gap:2px;margin-top:6px;font-size:13px}.coll-skip{color:var(--ink-2,#5a5348)}.coll-fields,.coll-pick,.coll-actions{grid-column:1/-1}.coll-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.coll-fields label,.coll-pick{display:grid;gap:2px;font-size:13px;font-weight:700}.coll-fields input,.coll-fields select,.coll-pick select{width:100%;font:inherit;font-weight:400}.coll-note-field{grid-column:1/-1}.coll-actions,.coll-tools{display:flex;flex-wrap:wrap;gap:8px}.coll-actions{justify-content:flex-end}@media(min-width:720px){.coll-fields{grid-template-columns:90px repeat(2,minmax(0,1fr))}}@media(max-width:520px){.coll{padding:12px}.coll-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.coll-tools button{width:100%;min-height:44px}}`;
document.head.append(detailTabsStyle);
const seriesProgressStyle=document.createElement('style');
seriesProgressStyle.textContent=`.series-progress{display:grid;gap:8px;flex:1 1 100%;width:100%;margin-top:8px;padding:10px 12px;border:1px solid #D9D1C0;border-radius:10px;background:#FBF9F4;color:#1F1B16;box-sizing:border-box}.series-progress[hidden]{display:none}.series-progress-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}.series-progress-row span{font-variant-numeric:tabular-nums}.series-progress #missingOnly{min-height:44px;margin-left:auto}.series-progress-bar{height:10px;border-radius:999px;background:#E6DFCE;overflow:hidden}.series-progress-bar i{display:block;height:100%;border-radius:999px;background:#1F1B16}.coll-series-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.coll-series-list li{display:grid;gap:4px}.coll-series-name{font-weight:700;overflow-wrap:anywhere}.coll-series-count{font-size:13px;color:#5A5348;font-variant-numeric:tabular-nums}.coll-import{display:grid;gap:8px;padding:12px;border:2px solid #D49B1B;border-radius:10px;background:#FFF8E7;color:#1F1B16}.coll-import h3,.coll-import p{margin:0}.coll-import ul{margin:6px 0 0;padding-left:20px}.coll-import summary{min-height:44px;display:flex;align-items:center;cursor:pointer}.coll-replace{display:flex;align-items:center;gap:8px;min-height:44px}.coll-replace input{width:20px;height:20px;flex:none}.coll-import-actions{display:flex;flex-wrap:wrap;gap:8px}.coll-import-actions button{min-height:44px}`;
document.head.append(seriesProgressStyle);

// 頂欄／底部導覽的「我的收藏」呼叫 window.openCollection()（ADR 0045，v0 免登入）：清單可編輯張數／品況／版本／備註、看參考總值、匯出入 JSON 備份、下載 CSV。資料只在這台裝置。
const collectionUi={prices:{},priceMeta:null,pricesState:'idle',failed:new Set(),progress:'',pending:null};
const COLLECTION_REASONS={slab:'鑑定卡不計入',none:'尚無參考價快照',choose:'請選擇版本',['no-match']:'所選版本沒有對應的參考價'};
function collectionItems(){return CS.itemsFromLegacy([],watchlist,watchlistMeta).filter(item=>item.quantity>0)}
const collectionDialog=()=>$('collectionDialog'),collectionRowEl=id=>[...document.querySelectorAll('#collectionDialog [data-coll-id]')].find(item=>item.dataset.collId===id);
const collectionStatus=text=>{collectionUi.progress=text||'';const node=$('collStatus');if(node)node.textContent=collectionUi.progress};
const typingInCollection=()=>/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName||'')&&collectionDialog()?.contains(document.activeElement);
function finishLabel(key){return key===''?'未指定':(typeof MARKET_VARIANTS!=='undefined'&&MARKET_VARIANTS[key])||key}
// 這張卡只有一種價格版本時，版本欄預設選它（只是顯示，不寫入；估值本來就會用唯一的版本）。
function shownFinish(item){return item.finish||CS.soleFinish((collectionUi.prices[item.id]||[]).filter(price=>!price.stale))}
function finishChoices(item){const seen=new Set(),keys=['',...(collectionUi.prices[item.id]||[]).map(price=>price.variant).filter(Boolean),...COMMON_FINISHES];if(item.finish&&!keys.some(key=>CS.finishKey(key)===CS.finishKey(item.finish)))keys.push(item.finish);return keys.filter(key=>!seen.has(CS.finishKey(key))&&seen.add(CS.finishKey(key)))}
// 伺服器把超過 7 天的快照標 stale:true（與詳細頁同規則）：估值只用新鮮的；過期的仍在 collectionUi.prices 裡，只在各卡列標「已過期」。
function collectionValuation(){const fresh={};for(const [id,list] of Object.entries(collectionUi.prices))fresh[id]=list.filter(price=>!price.stale);return CS.valuate(collectionItems().map(item=>({...item,quantity:item.quantity||1})),fresh)}
function reasonText(id,reason){return watchlistMeta[id]?.ambiguous?'請先選擇卡片版本':COLLECTION_REASONS[reason]||''}
function rowPriceHtml(item,valuation){
  const state=collectionUi.pricesState,entry=valuation.perEntry[item.id];
  if(watchlistMeta[item.id]?.ambiguous)return '<span class="coll-skip">未計入：請先選擇卡片版本</span>';
  if(state==='loading'||state==='idle')return '<span class="meta">查詢參考價中…</span>';
  if(state==='error'||!entry)return '';
  const priceLine=(provider,price,qty,stale)=>`<span class="${stale?'coll-skip':'coll-price-line'}">${e(CS.PROVIDER_LABELS[provider])} 參考價 ${e(price.currency)} ${Number(price.amount).toLocaleString()}${Number.isFinite(price.amountTwd)?`（約 NT$ ${price.amountTwd.toLocaleString()}${qty>1&&!stale?` × ${qty}`:''}）`:''} · ${e(price.snapshotDate)}${stale?' · <b>已過期</b>，不計入':''}</span>`,counted=new Set(entry.counted.map(x=>x.provider)),seen=new Set(),
    stale=(collectionUi.prices[item.id]||[]).filter(price=>price.stale&&!counted.has(price.provider)&&(!item.finish||CS.finishKey(price.variant)===CS.finishKey(item.finish))&&!seen.has(price.provider)&&seen.add(price.provider)).map(price=>priceLine(price.provider,price,1,true)).join('');
  if(!entry.counted.length)return `<span class="coll-skip">未計入：${e(stale?'參考價已過期（超過 7 天）':reasonText(item.id,entry.reason))}</span>${stale}`;
  return entry.counted.map(({provider,price,qty})=>priceLine(provider,price,qty,false)).join('')+stale+(entry.needsFinish?'<span class="coll-skip">另一來源有多個版本：選擇版本後才計入</span>':'');
}
function valueHtml(valuation){
  const state=collectionUi.pricesState;
  if(!collectionItems().length)return '';
  if(state==='loading'||state==='idle')return '<h3>參考總值</h3><p class="meta">正在查詢參考價…</p>';
  if(state==='error')return '<h3>參考總值</h3><p class="meta">參考價暫時無法取得，不影響收藏本身。</p>';
  const fx=collectionUi.priceMeta?.exchangeRates,sums=Object.entries(CS.PROVIDER_LABELS).filter(([key])=>valuation.byProvider[key]).map(([key,label])=>{const row=valuation.byProvider[key];return `<li><span>${e(label)} 參考價小計</span><b>約 NT$ ${Math.round(row.twd).toLocaleString()}</b><small>${row.entries} 款${row.missingFx?`；${row.missingFx} 款缺匯率未換算`:''}</small></li>`}).join('');
  return `<h3>參考總值</h3>${sums?`<ul class="coll-sums">${sums}</ul>`:'<p>目前沒有可計入的參考價。</p>'}<p class="meta">${valuation.counted}／${valuation.total} 款有參考價${valuation.uncounted.length?`；其餘 ${valuation.uncounted.length} 款未計入（原因標在各卡）`:''}。${valuation.dateFrom?`快照日期 ${e(valuation.dateFrom)}${valuation.dateTo!==valuation.dateFrom?` 至 ${e(valuation.dateTo)}`:''}。`:''}不同來源不相加；品況不調整價格。${fx?.source==='fallback'?'匯率為備用值，僅供概略。':fx?.updatedAt?`匯率日期 ${e(fx.updatedAt)}。`:''}</p><p class="meta">${e(collectionUi.priceMeta?.note||'參考價不是成交價或台灣行情。')}</p>`;
}
// 「涵蓋遊戲」：收藏裡不同遊戲的數量（卡片資料還沒補齊的不算）。
function collectionGameCount(){return new Set(collectionIds().map(id=>watchlistMeta[id]?.game).filter(Boolean)).size}
function refreshCollectionValue(){
  const valuation=collectionValuation(),host=$('collValue');if(host)host.innerHTML=valueHtml(valuation);
  collectionItems().forEach(item=>{const cell=collectionRowEl(item.id)?.querySelector('.coll-price');if(cell)cell.innerHTML=rowPriceHtml(item,valuation)});
  const idsCount=collectionIds().length,cardsCount=collectionTotal();
  const total=$('collTotal');if(total)total.textContent=`共 ${idsCount} 款、${cardsCount} 張`;
  const statIds=$('collStatIds');if(statIds)statIds.textContent=String(idsCount);
  const statCards=$('collStatCards');if(statCards)statCards.textContent=String(cardsCount);
  const statGames=$('collStatGames');if(statGames)statGames.textContent=String(collectionGameCount());
  const statPriced=$('collStatPriced');if(statPriced)statPriced.textContent=String(valuation.counted||0);
  const binderTotal=$('collBinderTotal');if(binderTotal)binderTotal.textContent=`已擁有 ${cardsCount} 張卡 ›`;
}
// Alt-art versions can share region, set and number; add the id only when the label alone would not tell them apart.
function choiceLabels(choices,gameId){const labels=choices.map(choice=>[choice.cardId,[rn(choice.region,gameId),choice.set,choice.number,choice.rarity,choice.variant].filter(Boolean).join(' · ')]);return labels.map(([cardId,label])=>[cardId,labels.filter(row=>row[1]===label).length>1?`${label} · ${cardId}`:label])}
function collectionRowHtml(item,valuation){
  const meta=watchlistMeta[item.id]||{},known=!!meta.v,title=known?name(meta):collectionUi.failed.has(item.id)?`查無這張卡的資料（${item.id}）`:`卡片資料載入中（${item.id}）`,qty=item.quantity||1,id=e(item.id);
  const facts=known?[e(meta.officialCardNumber||'卡號待補'),meta.rarity?rarityMarkup(meta.rarity,meta.game):'稀有度待補'].join(' · '):'',badges=known?`${meta.region?`<span class="badge">${e(rn(meta.region,meta.game))}</span>`:''}${meta.version?`<span class="badge variant-badge">${e(meta.version)}</span>`:''}${meta.ambiguous?'<span class="badge">版本待確認</span>':''}`:'';
  const pick=meta.ambiguous?`<label class="coll-pick">選擇你持有的版本<select data-coll-pick="${id}"><option value="">請選擇…</option>${choiceLabels(meta.choices||[],meta.game).map(([cardId,label])=>`<option value="${e(cardId)}">${e(label)}</option>`).join('')}</select></label>`:'';
  return `<li class="coll-item" data-coll-id="${id}"><div class="coll-art">${known&&meta.image?resilientImage(meta.image,title,'圖片來源尚未收錄'):missingImageMarkup('')}</div><div class="coll-main"><b class="coll-name">${e(title)}</b><div class="meta">${facts}</div><div class="coll-badges">${badges}</div><div class="coll-price">${rowPriceHtml(item,valuation)}</div></div>${pick}<div class="coll-actions"><label class="coll-qty">張數<input type="number" inputmode="numeric" min="1" max="999" step="1" value="${qty}" data-coll-field="quantity"></label><button type="button" data-collection-open="${id}">查看</button><button type="button" data-coll-remove="${id}" aria-label="從我的收藏移除${e(title)}">移除</button></div><details class="coll-edit"${collectionUi.editOpen?.has(item.id)?' open':''}><summary>編輯品況・版本・備註</summary><div class="coll-fields"><label>品況<select data-coll-field="condition">${CS.CONDITIONS.map(([key,label])=>`<option value="${e(key)}"${key===item.condition?' selected':''}>${e(label)}</option>`).join('')}</select></label><label>版本<select data-coll-field="finish">${finishChoices(item).map(key=>`<option value="${e(key)}"${CS.finishKey(key)===CS.finishKey(shownFinish(item))?' selected':''}>${e(finishLabel(key))}</option>`).join('')}</select></label><label class="coll-note-field">備註<input type="text" maxlength="${CS.LIMITS.noteMax}" value="${e(item.note)}" data-coll-field="note" autocomplete="off"></label></div></details></li>`;
}
function seriesLabel(seriesId){const row=(typeof C!=='undefined'&&C.series||[]).find(item=>item.id===seriesId);return row?`${titleName(row)||seriesId}${row.region?`（${rn(row.region,row.game)}）`:''}`:seriesId}
function collectionSeriesHtml(){
  const {rows,seriesCount,unknown}=CS.seriesBreakdown(collectionItems(),10),note=unknown?`<p class="meta">另有 ${unknown} 款還沒有系列資料；打開該系列的卡牆（圖鑑 → 系列）就會自動補上。</p>`:'';
  if(!rows.length)return note;
  return `<h3>各系列進度${seriesCount>rows.length?`（前 ${rows.length} 名，共 ${seriesCount} 個系列）`:''}</h3><ul class="coll-series-list">${rows.map(row=>{const total=seriesTotals.get(row.seriesId),p=total&&CS.seriesProgress(row.owned,total),label=seriesLabel(row.seriesId);return `<li><span class="coll-series-name">${e(label)}</span><span class="coll-series-count">${p?`已收藏 ${p.owned} / 共 ${p.total} 張（${p.percent}%）`:`已收藏 ${row.owned} 張（${seriesTotalFailed.has(row.seriesId)?'總數暫時查不到':'總數查詢中…'}）`}</span>${p?progressBar(p,`${label} 集卡進度`):''}</li>`}).join('')}</ul>${note}`;
}
// 前 10 名系列的卡數各查一次（limit=1 只取 meta.total）；查不到的不擋畫面。
async function loadSeriesTotals(){
  const todo=CS.seriesBreakdown(collectionItems(),10).rows.filter(row=>!seriesTotals.has(row.seriesId)&&!seriesTotalFailed.has(row.seriesId));if(!todo.length)return;
  await Promise.all(todo.map(async row=>{
    try{
      const gameId=row.game||(C.series||[]).find(item=>item.id===row.seriesId)?.game,response=await fetch('/api/cards?'+new URLSearchParams({game:gameId,series:row.seriesId,limit:'1',offset:'0',region:'all',rarity:'all',sort:'number-asc'})),total=Number((await response.json()).meta?.total);
      if(!response.ok||!(total>0))throw Error('no total');seriesTotals.set(row.seriesId,total);
    }catch{seriesTotalFailed.add(row.seriesId)}
  }));
  const host=$('collSeries');if(host)host.innerHTML=collectionSeriesHtml();
}
// 匯入預覽：確認前不動既有收藏。
function importPreviewHtml(){
  const pending=collectionUi.pending;if(!pending)return '';
  const {parsed,replace}=pending,plan=CS.planImport(collectionItems(),parsed.items,replace),bad=parsed.problems,empty=!parsed.items.length,nothing=!plan.added&&!plan.updated&&!plan.removed;
  return `<section class="coll-import" id="collImport" aria-label="匯入預覽"><h3>匯入預覽</h3><p class="meta">${e(pending.fileName)}（${parsed.format==='csv'?'CSV':'JSON 備份'}，共 ${parsed.rows} 筆資料）。按下確認前不會改動你的收藏；同一張卡取較大的數量，不會相加，重複匯入不會翻倍。</p><p class="coll-import-counts" role="status"><b>將新增 ${plan.added} 筆、更新 ${plan.updated} 筆、略過 ${bad.length} 筆格式錯誤</b>${replace?`；移除目前有、檔案裡沒有的 ${plan.removed} 筆`:''}${plan.unchanged?`（另有 ${plan.unchanged} 筆內容相同，不變）`:''}</p>${bad.length?`<details><summary>看略過的原因（${bad.length>20?'前 20 筆':`${bad.length} 筆`}）</summary><ul>${bad.slice(0,20).map(({index,reason})=>`<li>第 ${index} 筆：${e(reason)}</li>`).join('')}</ul></details>`:''}${empty?'<p class="coll-skip">檔案裡沒有可匯入的資料。</p>':''}<label class="coll-replace"><input type="checkbox" data-coll-replace${replace?' checked':''}${empty?' disabled':''}> 以匯入檔取代全部（目前的收藏會被刪除，會再問一次）</label><div class="coll-import-actions"><button type="button" data-coll-import-confirm${empty||nothing?' disabled':''}>${replace?'取代全部收藏':'確認匯入'}</button><button type="button" data-coll-import-cancel>取消</button></div></section>`;
}
function renderCollection(){
  const dialog=collectionDialog();if(!dialog)return;
  collectionUi.editOpen=new Set([...dialog.querySelectorAll('.coll-edit[open]')].map(box=>box.closest('[data-coll-id]')?.dataset.collId).filter(Boolean));const items=collectionItems(),valuation=collectionValuation(),idsCount=collectionIds().length,cardsCount=collectionTotal(),gameCount=collectionGameCount();
  const overviewHtml=`<div class="coll-stats-grid" aria-label="收藏統計摘要"><div class="coll-stat"><b id="collStatIds">${idsCount}</b><span>收藏款數</span></div><div class="coll-stat"><b id="collStatCards">${cardsCount}</b><span>收藏總張數</span></div><div class="coll-stat"><b id="collStatGames">${gameCount}</b><span>涵蓋遊戲</span></div><div class="coll-stat"><b id="collStatPriced">${valuation.counted||0}</b><span>已估值款數</span></div></div><button type="button" class="coll-binder-banner" data-coll-binder><span class="coll-binder-left"><img src="/assets/brand/web/rabbit-success-160.webp" alt=""><span class="coll-binder-copy"><b>TCG 收藏冊</b><small>本機免登入 · 即時估值與清單管理</small></span></span><span class="coll-binder-right" id="collBinderTotal">已擁有 ${cardsCount} 張卡 ›</span></button>`;
  dialog.innerHTML=`<div class="coll"><header><h2 id="collectionTitle" tabindex="-1">我的收藏</h2><button type="button" data-collection-close aria-label="關閉我的收藏">×</button></header><div class="coll-top"><div class="coll-tools"><button type="button" data-coll-export${items.length?'':' disabled'} title="把收藏存成 JSON 備份檔">匯出備份</button><button type="button" data-coll-import title="匯入 JSON 備份或 CSV 清單">匯入</button><input type="file" id="collFile" accept="application/json,.json,text/csv,.csv" hidden><button type="button" id="collectionCsv"${items.length?'':' disabled'} title="下載清單 CSV">下載 CSV</button><button type="button" data-coll-explore>探索加卡</button></div><p class="coll-status" id="collStatus" role="status" aria-live="polite">${e(collectionUi.progress)}</p></div>${overviewHtml}<p class="coll-local" role="note"><b>只存在這台裝置</b>：不用登入、不會上傳。清除瀏覽器資料或換裝置就會消失，建議定期「匯出備份」。</p>${importPreviewHtml()}${items.length?`<section class="coll-series" id="collSeries" aria-label="各系列集卡進度">${collectionSeriesHtml()}</section><p class="meta" id="collTotal">共 ${idsCount} 款、${cardsCount} 張</p><section class="coll-value" id="collValue" aria-label="參考總值">${valueHtml(valuation)}</section><ul class="coll-list" id="collList">${items.map(item=>collectionRowHtml(item,valuation)).join('')}</ul>`:'<div class="state">還沒有收藏。在卡片上按星號或「＋」就會出現在這裡；也可以匯入之前的備份。</div>'}</div>`;
  const csv=$('collectionCsv');if(csv)csv.onclick=()=>{downloadWatchlistCsv();collectionStatus(`已下載清單 CSV（${items.length} 款）。`)};
}
const rerenderCollection=()=>{if(collectionDialog()?.open&&!typingInCollection())renderCollection()};
function refreshGrid(){renderWatchlistSummary();if($('cards')&&typeof currentCardRows!=='undefined')cards(currentCardRows,true);renderDetailCollect()}

// 把 items 寫回三個既有 localStorage 鍵；畫面快照（名稱、圖、地區）依 id 沿用。
function applyItems(items){
  const old={...watchlistMeta};Object.keys(watchlist).forEach(key=>delete watchlist[key]);Object.keys(watchlistMeta).forEach(key=>delete watchlistMeta[key]);
  items.forEach(item=>{const quantity=CS.collectedQuantity(item);if(quantity>0)watchlist[item.id]=quantity;watchlistMeta[item.id]={...old[item.id],id:item.id,canonicalId:item.canonicalId||old[item.id]?.canonicalId||'',condition:item.condition,finish:item.finish,note:item.note,...Object.fromEntries(['seriesId','game','region'].filter(key=>item[key]).map(key=>[key,item[key]]))}});
  const saved=persistCollection();
  if(!saved)collectionStatus('無法寫入瀏覽器儲存空間（可能是無痕模式或空間已滿），這次的變更關掉頁面後會消失；請先匯出備份。');
  return saved;
}
// 匯入一次寫入：儲存失敗就把原本的收藏放回去，不會留下一半的收藏。
function commitItems(items){
  const before=[JSON.stringify(watchlist),JSON.stringify(watchlistMeta)];
  if(applyItems(items))return true;
  [watchlist,watchlistMeta].forEach((target,at)=>{Object.keys(target).forEach(key=>delete target[key]);Object.assign(target,JSON.parse(before[at]))});persistCollection();return false;
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
  // 每批 200 筆、補到完；tried 擋住暫時失敗（非 404）的卡，避免同一批無限重試。
  const tried=new Set(),next=()=>collectionItems().map(item=>item.id).filter(id=>!watchlistMeta[id]?.v&&!collectionUi.failed.has(id)&&!tried.has(id)).slice(0,200);
  let pending=next();if(!pending.length)return false;
  const kept=collectionUi.progress,total=collectionItems().filter(item=>!watchlistMeta[item.id]?.v&&!collectionUi.failed.has(item.id)).length;let done=0;
  while(pending.length){
    const queue=[...pending],worker=async()=>{while(queue.length){const key=queue.shift();tried.add(key);try{await resolveCollectionEntry(key)}catch{}done++;collectionUi.progress=`正在補齊卡片資料（${done}／${total}）…`;collectionStatus(collectionUi.progress)}};
    await Promise.all([worker(),worker(),worker(),worker()]);persistCollection();pending=next();
  }
  collectionStatus(kept);return true;
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
  if(file.size>CS.LIMITS.fileMaxChars){collectionStatus('沒有匯入：檔案過大（上限 2 MB）。既有收藏沒有變動。');return}
  let text='';try{text=await file.text()}catch{collectionStatus('讀不到這個檔案。既有收藏沒有變動。');return}
  const parsed=CS.parseImport(text);
  if(parsed.error){collectionUi.pending=null;renderCollection();collectionStatus(`沒有匯入：${parsed.error}。既有收藏沒有變動。`);return}
  collectionUi.pending={parsed,fileName:file.name,replace:false};collectionStatus('');renderCollection();$('collImport')?.scrollIntoView({block:'nearest'});
}
async function confirmCollectionImport(){
  const pending=collectionUi.pending;if(!pending)return;
  const existing=collectionItems(),plan=CS.planImport(existing,pending.parsed.items,pending.replace),skipped=pending.parsed.problems.length;
  if(!pending.parsed.items.length)return collectionStatus('檔案裡沒有可匯入的資料，沒有變動。');
  if(plan.items.length>CS.LIMITS.itemsMax)return collectionStatus(`匯入後會超過 ${CS.LIMITS.itemsMax.toLocaleString('en-US')} 款上限，沒有匯入。`);
  if(pending.replace&&!confirm(`這會刪除目前的 ${existing.length} 款收藏，只留下匯入檔的 ${plan.items.length} 款，無法復原。真的要取代全部嗎？`))return;
  if(!commitItems(plan.items))return collectionStatus('無法寫入瀏覽器儲存空間（可能是無痕模式或空間已滿），匯入已取消，既有收藏沒有變動。');
  collectionUi.pending=null;refreshGrid();renderCollection();
  collectionStatus(`已匯入：新增 ${plan.added} 筆、更新 ${plan.updated} 筆${plan.removed?`、移除 ${plan.removed} 筆`:''}${skipped?`、略過 ${skipped} 筆格式錯誤`:''}。`);
  collectionUi.pricesState='idle';await resolveCollection();await loadCollectionPrices();rerenderCollection();loadSeriesTotals();
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
  delete watchlist[id];delete watchlistMeta[id];persistCollection();refreshGrid();renderCollection();$('collectionTitle')?.focus();collectionStatus(`已移除 ${title}。`);
}
function installCollectionDialog(){
  let dialog=collectionDialog();if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='collectionDialog';dialog.className='collection-dialog';dialog.setAttribute('aria-labelledby','collectionTitle');document.body.append(dialog);
  dialog.addEventListener('close',syncPageTitle);
  dialog.addEventListener('click',event=>{
    const target=event.target;if(target===dialog||target.closest('[data-collection-close]'))return dialog.close();
    const open=target.closest('[data-collection-open]');if(open){dialog.close();return openCard(open.dataset.collectionOpen)}
    const remove=target.closest('[data-coll-remove]');if(remove)return removeCollectionItem(remove.dataset.collRemove);
    if(target.closest('[data-coll-binder]')){const list=$('collList')||$('collValue');if(list)return list.scrollIntoView({behavior:'smooth',block:'start'});dialog.close();return typeof browse==='function'&&browse()}
    if(target.closest('[data-coll-explore]')){dialog.close();return typeof browse==='function'&&browse()}
    if(target.closest('[data-coll-export]')){const items=collectionItems(),filename=`cardscope-collection-${window.taipeiDate()}.json`;downloadFile(filename,'application/json;charset=utf-8',JSON.stringify(CS.exportBackup(items)));return collectionStatus(`已匯出 ${items.length} 款、${collectionTotal()} 張，備份檔 ${filename}（在瀏覽器的下載資料夾）。`)}
    if(target.closest('[data-coll-import]'))return $('collFile')?.click();
    if(target.closest('[data-coll-import-confirm]'))return confirmCollectionImport();
    if(target.closest('[data-coll-import-cancel]')){collectionUi.pending=null;renderCollection();return collectionStatus('已取消匯入，收藏沒有變動。')}
  });
  dialog.addEventListener('input',event=>{if(event.target.dataset?.collField)onCollectionField(event.target)});
  dialog.addEventListener('change',event=>{
    const target=event.target;
    if(target.dataset?.collReplace!==undefined&&collectionUi.pending){collectionUi.pending.replace=target.checked;renderCollection();$('collImport')?.querySelector('[data-coll-replace]')?.focus();return}
    if(target.id==='collFile'){const file=target.files?.[0];target.value='';importCollectionFile(file);return}
    if(target.dataset?.collField==='quantity')target.value=String(watchQuantity(target.closest('[data-coll-id]')?.dataset.collId)||1);
    if(target.dataset?.collPick&&target.value){const from=target.dataset.collPick,items=collectionItems(),item=items.find(row=>row.id===from);if(!item)return;applyItems(CS.mergeItems(items.filter(row=>row.id!==from),[{...item,id:target.value}]).items);refreshGrid();renderCollection();resolveCollection().then(()=>loadCollectionPrices()).then(rerenderCollection)}
  });
  return dialog;
}
function openCollection(){
  const dialog=installCollectionDialog();collectionUi.prices={};collectionUi.pricesState='idle';collectionUi.progress='';collectionUi.pending=null;
  renderCollection();if(!dialog.open)dialog.showModal();syncPageTitle();loadSeriesTotals();
  if(collectionItems().length)resolveCollection().then(changed=>{if(changed){refreshGrid();rerenderCollection()}return loadCollectionPrices()});
}
window.openCollection=openCollection;

// 搜尋框即時建議：輸入停 0.25 秒後查 /api/search（6 筆），在框下列出卡片；↑↓ 選、Enter 開卡、Esc 關。
// 查詢若帶稀有度（阿爾宙斯UR），第一列說明已拆成「卡名＋稀有度」；Enter 沒選列時照原本的搜尋流程。
(function installSearchSuggest(){
  if(typeof document.head?.appendChild!=='function')return; // 測試用的假 DOM 沒有 head，不裝
  const style=document.createElement('style');style.textContent=`.search-suggest{position:fixed;z-index:1000;max-height:min(70vh,460px);overflow:auto;margin:0;padding:6px;list-style:none;border:1px solid #D8D0C2;border-radius:12px;background:#fff;box-shadow:0 12px 28px rgba(33,28,23,.16);text-align:left}
.search-suggest[hidden]{display:none}
.search-suggest li{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 8px;border-radius:8px;cursor:pointer;color:#211C17}
.search-suggest li[aria-selected=true],.search-suggest li:hover{background:#F3EEE3}
.search-suggest li[aria-selected=true]{box-shadow:inset 3px 0 0 #211C17}
.search-suggest.ss-stale{opacity:.55;pointer-events:none}
.ss-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.search-suggest img,.search-suggest .ss-noimg{flex:none;width:32px;height:44px;border-radius:3px;object-fit:cover;background:#EFE9DB}
.search-suggest .ss-text{min-width:0;display:grid;gap:1px}
.search-suggest .ss-name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-suggest .ss-sub{font-size:12px;color:#5A5348;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-suggest .ss-action{justify-content:space-between;font-size:14px}
.search-suggest .ss-action b{font-weight:700}
.search-suggest .ss-chip{padding:1px 8px;border-radius:999px;background:#211C17;color:#fff;font-size:12px;font-weight:700}
.search-suggest .ss-state{cursor:default;color:#5A5348;font-size:13px}
.search-suggest .ss-state:hover{background:none}`;document.head.appendChild(style);
  const attach=input=>{
    if(!input||input.dataset.suggest)return;input.dataset.suggest='1';
    // 搜尋框外層 overflow:hidden（按鈕方角），清單改用 fixed 對齊外層，開啟、捲動、縮放時重算位置
    const host=input.parentElement;
    const list=document.createElement('ul'),listId=`${input.id}-suggest`;list.id=listId;list.className='search-suggest';list.setAttribute('role','listbox');list.setAttribute('aria-label','搜尋建議');list.hidden=true;document.body.appendChild(list);
    // 即時播報（螢幕閱讀器）：建議筆數、搜尋中、找不到
    const live=document.createElement('div');live.className='ss-live';live.setAttribute('role','status');live.setAttribute('aria-live','polite');document.body.appendChild(live);
    const place=()=>{if(list.hidden)return;const box=host.getBoundingClientRect();const width=Math.min(innerWidth-16,Math.max(box.width,340));list.style.width=`${width}px`;list.style.left=`${Math.max(8,Math.min(box.left,innerWidth-8-width))}px`;list.style.top=`${box.bottom+6}px`};
    addEventListener('resize',place);addEventListener('scroll',place,true);
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',listId);input.setAttribute('aria-expanded','false');
    let timer=0,controller=null,items=[],active=-1,lastQ='';
    const close=()=>{list.hidden=true;list.classList.remove('ss-stale');input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');live.textContent='';items=[];active=-1};
    const runSearch=q=>{close();if(typeof window.searchFor==='function')window.searchFor(q)};
    // 只執行目前清單裡真的存在的可選列；「搜尋中／找不到」列沒有 data-index
    const choose=index=>{const item=list.querySelector(`li[data-index="${index}"]`)&&items[index];if(!item)return;close();item.run()};
    const mark=index=>{active=index;[...list.children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===index)));const li=list.children[index];if(li?.id){input.setAttribute('aria-activedescendant',li.id);li.scrollIntoView({block:'nearest'})}else input.removeAttribute('aria-activedescendant')};
    const render=(q,body)=>{
      const cards=Array.isArray(body?.data)?body.data:[],meta=body?.meta||{},parsed=meta.parsed||{},total=Number(meta.total)||cards.length;
      items=[];const rows=[];
      const add=(html,run,cls='')=>{const index=items.length;items.push({run});rows.push(`<li role="option" id="${listId}-${index}" class="${cls}" data-index="${index}" aria-selected="false">${html}</li>`)};
      if(parsed.name&&parsed.rarities?.length)add(`<span>搜尋「<b>${e(parsed.name)}</b>」</span><span>${parsed.rarities.map(code=>`<span class="ss-chip">${e(code)}</span>`).join(' ')}</span>`,()=>runSearch(q),'ss-action');
      for(const c of cards){const img=image(c),number=c.officialCardNumber||c.printings?.find(p=>p.localCardNumber)?.localCardNumber||'',game=G(c.game)?.nameZh||'',sub=[game,number,c.rarity?rarityText(c.rarity):''].filter(Boolean).join(' · ');
        add(`${img?`<img src="${e(img)}" alt="" loading="lazy" data-img-error="remove">`:'<span class="ss-noimg" aria-hidden="true"></span>'}<span class="ss-text"><span class="ss-name">${e(name(c))}</span><span class="ss-sub">${e(sub)}</span></span>`,()=>{input.value='';openCard(cardOpenId(c))})}
      if(!cards.length&&meta.suggestion?.q)add(`<span>試試「<b>${e(meta.suggestion.q)}</b>」</span><span class="ss-sub">${e(meta.suggestion.reason||'')}</span>`,()=>runSearch(meta.suggestion.q),'ss-action');
      if(cards.length&&total>cards.length)add(`<span>查看全部 <b>${total.toLocaleString('en-US')}</b> 筆結果</span><span aria-hidden="true">›</span>`,()=>runSearch(q),'ss-action');
      if(!rows.length)rows.push(`<li class="ss-state" role="option" aria-disabled="true">${e(meta.hint?.message||`找不到「${q}」，按 Enter 用完整搜尋`)}</li>`);
      list.innerHTML=rows.join('');list.classList.remove('ss-stale');list.hidden=false;place();input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');active=-1;
      live.textContent=items.length?`${items.length} 筆建議`:'找不到符合的卡';
    };
    // 伺服器在美國、資料庫在東京，一次查詢約 0.7–1.5 秒；同一個詞（刪字再打回、重新聚焦）直接用記住的結果
    const memo=new Map(),regionNow=()=>document.getElementById('browseRegion')?.value||'all',memoKey=q=>`${regionNow()}|${q}`;
    const fetchSuggest=async q=>{
      controller?.abort();controller=new AbortController();const key=memoKey(q);
      try{const response=await fetch(`/api/search?limit=6&fields=suggest&q=${encodeURIComponent(q)}&region=${encodeURIComponent(regionNow())}`,{signal:controller.signal});if(!response.ok)return close();const body=await response.json();memo.delete(key);memo.set(key,body);if(memo.size>60)memo.delete(memo.keys().next().value);if(q!==input.value.trim()||document.activeElement!==input)return;render(q,body)}catch(error){if(error?.name!=='AbortError')close()}
    };
    const schedule=()=>{
      clearTimeout(timer);const q=input.value.trim();
      // 中日文 1 個字、英數 2 個字以上才查，避免一個字母就灑出整個卡庫
      if(!q||(!/[^\x00-\x7F]/.test(q)&&q.length<2)){controller?.abort();lastQ='';return close()}
      if(q===lastQ&&!list.hidden)return;
      const known=memo.get(memoKey(q));if(known){controller?.abort();lastQ=q;render(q,known);return}
      // 查詢變了：舊結果不可再被選（↓ Enter 會開出上一輪的卡），清單若還開著就淡化到新結果回來
      items=[];active=-1;input.removeAttribute('aria-activedescendant');if(!list.hidden)list.classList.add('ss-stale');
      timer=setTimeout(()=>{lastQ=q;if(list.hidden){list.innerHTML='<li class="ss-state" role="option" aria-disabled="true">搜尋中…</li>';list.hidden=false;place();input.setAttribute('aria-expanded','true');live.textContent='搜尋中'}fetchSuggest(q)},150);
    };
    // 輸入法組字中不查；組字結束（compositionend）再查一次
    input.addEventListener('input',event=>{if(event.isComposing)clearTimeout(timer);else schedule()});
    input.addEventListener('compositionend',schedule);
    input.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();return}
      if(list.hidden||!items.length){if(event.key==='Enter'){clearTimeout(timer);controller?.abort();close()}return}
      if(event.key==='ArrowDown'){event.preventDefault();mark((active+1)%items.length)}
      else if(event.key==='ArrowUp'){event.preventDefault();mark(active<=0?items.length-1:active-1)}
      else if(event.key==='Enter'){clearTimeout(timer);controller?.abort();if(active>=0){event.preventDefault();event.stopImmediatePropagation();choose(active)}else close()}
    },true);
    list.addEventListener('mousedown',event=>event.preventDefault());
    list.addEventListener('click',event=>{const li=event.target.closest('li[data-index]');if(li)choose(Number(li.dataset.index))});
    input.addEventListener('blur',()=>setTimeout(close,120));
    document.addEventListener('cardscope:search',()=>{clearTimeout(timer);controller?.abort();close()});
  };
  attach(document.getElementById('q'));attach(document.getElementById('heroQ'));
})();
