const uiLocal={get(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
let cardViewMode=uiLocal.get('cardscope-card-view','grid');
if(!['grid','list','rarity'].includes(cardViewMode))cardViewMode='grid';
let activeDetailCardId=null;
let favoritesOnly=uiLocal.get('cardscope-favorites-only','0')==='1';
const favoriteIds=new Set(readUiArray('cardscope-favorites'));
const watchlist=readUiObject('cardscope-watchlist');
const watchlistMeta=readUiObject('cardscope-watchlist-meta');

function readUiArray(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.map(String):[]}catch{return[]}}
function readUiObject(key){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}}
function saveUiArray(key,value){uiLocal.set(key,JSON.stringify([...value]))}
function saveUiObject(key,value){uiLocal.set(key,JSON.stringify(value))}
function cardRarityLabel(card){return String(card.rarity||card.printings?.find(printing=>printing.rarity)?.rarity||'稀有度待補')}
function cardNumberLabel(card){return card.officialCardNumber||card.printings?.find(printing=>printing.localCardNumber)?.localCardNumber||'卡號待補'}
function cardPriceLabel(price){return price&&Number.isFinite(Number(price.price))&&price.currency?`${e(price.currency)} ${Number(price.price).toLocaleString()} 買取`:''}
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

function resilientImage(src,alt,message){
  if(!src)return missingImageMarkup(message);
  return `<img src="${e(src)}" alt="${e(alt)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="image-fallback unified-image-fallback" hidden><b>圖片待補</b><small>${e(message||'圖片來源尚未收錄')}</small></span>`;
}

function installViewToggle(){
  const tools=$('cardTools');if(!tools||$('cardViewSwitch'))return;
  const host=document.createElement('div');host.id='cardViewSwitch';host.className='view-switch';host.setAttribute('aria-label','卡片瀏覽模式');
  host.innerHTML=`<button type="button" data-view="grid">圖鑑模式</button><button type="button" data-view="list">清單模式</button><button type="button" data-view="rarity">稀有度分組</button>`;
  tools.prepend(host);host.onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;cardViewMode=button.dataset.view;uiLocal.set('cardscope-card-view',cardViewMode);drawViewButtons();cards(currentCardRows,true)};drawViewButtons();
}
function drawViewButtons(){document.querySelectorAll('#cardViewSwitch [data-view]').forEach(button=>button.classList.toggle('on',button.dataset.view===cardViewMode))}

function cardActionsMarkup(card){
  const id=e(card.id),favorite=isFavorite(card.id),quantity=watchQuantity(card.id);
  return `<div class="card-actions" data-action="card-actions"><button type="button" class="favorite-toggle" data-action="favorite" data-favorite-id="${id}" aria-pressed="${favorite}" aria-label="${favorite?'取消收藏':'加入收藏'}" title="${favorite?'取消收藏':'加入收藏'}">${favorite?'★':'☆'}</button><div class="watchlist-inline" data-action="watchlist" aria-label="追蹤清單數量"><button type="button" data-watch-decrement="${id}" aria-label="減少數量"${quantity?'':' disabled'}>−</button><span data-watch-quantity="${id}">${quantity}</span><button type="button" data-watch-increment="${id}" aria-label="增加數量">＋</button></div></div>`;
}

function cardMarkup(card){
  const price=priceFor(card),number=cardNumberLabel(card),rarity=cardRarityLabel(card),region=rn(card.region||card.printings?.[0]?.region),picture=resilientImage(image(card),name(card),'這張卡尚未收錄可公開顯示的圖片'),id=e(card.id),priceMarkup=cardPriceLabel(price);
  if(cardViewMode==='list')return `<article class="card card-list" data-card-open="${id}"><div class="art">${picture}</div><div class="card-list-main"><h3>${e(name(card))}</h3><div class="meta">${e(original(card)&&original(card)!==name(card)?original(card):'原名待補')}</div></div><div class="card-list-facts"><b>${e(number)}</b><span>${e(rarity)}</span><span class="badge">${e(region)}</span>${priceMarkup?`<strong>${priceMarkup}</strong>`:'<span class="meta">可靠價格待補</span>'}</div>${cardActionsMarkup(card)}</article>`;
  return `<article class="card" data-card-open="${id}"><div class="art">${picture}</div><h3>${e(name(card))}</h3><div class="meta">${e(number)} · ${e(rarity)}</div>${priceMarkup?`<div class="card-price">${priceMarkup}</div>`:''}<span class="badge">${e(region)}</span>${cardActionsMarkup(card)}</article>`;
}

function activateCardActions(root=$('cards')){
  if(!root)return;
  root.querySelectorAll('[data-card-open]').forEach(card=>{card.onclick=event=>{if(event.target.closest('[data-action]'))return;openCard(card.dataset.cardOpen)}});
  root.querySelectorAll('[data-favorite-id]').forEach(button=>{button.onclick=event=>{event.stopPropagation();toggleFavorite(button.dataset.favoriteId)}});
  root.querySelectorAll('[data-watch-increment]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchIncrement,watchQuantity(button.dataset.watchIncrement)+1)}});
  root.querySelectorAll('[data-watch-decrement]').forEach(button=>{button.onclick=event=>{event.stopPropagation();setWatchQuantity(button.dataset.watchDecrement,watchQuantity(button.dataset.watchDecrement)-1)}});
}

function renderCardEmpty(){return `<div class="cards-empty"><img src="/assets/brand/cardscope-rabbit-mark.png" alt="" loading="lazy"><div><b>目前沒有符合條件的卡片</b><p>若是尚未發售商品，代表官方尚未公開卡表；圖片待補時也會保留卡片資料。</p></div></div>`}

function renderCardRows(rows){
  if(cardViewMode!=='rarity')return rows.length?rows.map(cardMarkup).join(''):renderCardEmpty();
  const groups=new Map();rows.forEach(card=>{const rarity=cardRarityLabel(card);if(!groups.has(rarity))groups.set(rarity,[]);groups.get(rarity).push(card)});
  return groups.size?[...groups].map(([rarity,cardsForRarity],groupIndex)=>`<section class="rarity-group" aria-labelledby="rarity-${groupIndex}"><header><h3 id="rarity-${groupIndex}">${e(rarity)}</h3><span>${cardsForRarity.length.toLocaleString()} 張</span></header><div class="cards rarity-group-cards">${cardsForRarity.map(cardMarkup).join('')}</div></section>`).join(''):renderCardEmpty();
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

function setWatchQuantity(id,quantity){
  const key=String(id),next=Math.max(0,Math.min(999,Number(quantity)||0));
  if(next){
    watchlist[key]=next;
    const card=allKnownCards().find(item=>String(item.id)===key);
    if(card)watchlistMeta[key]={id:key,game:card.game,nameZh:card.nameZh,nameEn:card.nameEn,nameJa:card.nameJa,nameKo:card.nameKo,officialCardNumber:card.officialCardNumber,rarity:card.rarity,region:card.region};
  }else{delete watchlist[key];delete watchlistMeta[key]}
  saveUiObject('cardscope-watchlist',watchlist);saveUiObject('cardscope-watchlist-meta',watchlistMeta);cards(currentCardRows,true);
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

function activateDetailInteractions(){
  document.querySelectorAll('[data-detail-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-detail-tab]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==button.dataset.detailTab)});
  document.querySelectorAll('[data-text-mode]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-text-mode]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-text-panel]').forEach(panel=>panel.hidden=panel.dataset.textPanel!==button.dataset.textMode)});
  document.querySelectorAll('[data-card-step]').forEach(button=>button.onclick=()=>openAdjacentCard(Number(button.dataset.cardStep)));
  document.querySelectorAll('.tilt-card').forEach(tilt=>{
    const surface=tilt.querySelector('.tilt-card-surface');
    const reset=()=>{surface.style.setProperty('--tilt-x','0deg');surface.style.setProperty('--tilt-y','0deg');surface.style.setProperty('--shine-opacity','0')};
    tilt.onpointermove=event=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const rect=tilt.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));surface.style.setProperty('--tilt-x',`${((.5-y)*12).toFixed(2)}deg`);surface.style.setProperty('--tilt-y',`${((x-.5)*14).toFixed(2)}deg`);surface.style.setProperty('--shine-x',`${(x*100).toFixed(1)}%`);surface.style.setProperty('--shine-y',`${(y*100).toFixed(1)}%`);surface.style.setProperty('--shine-opacity','.38')};
    tilt.onpointerleave=reset;tilt.onblur=reset;
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
    const detailSet=detailRows(),detailIndex=detailSet.findIndex(card=>String(card.id)===String(id)),position=detailIndex>=0?`${detailIndex+1} / ${detailSet.length}`:'目前卡片';
    $('detail').innerHTML=`<div class="detail detail-tabs-layout"><div class="detail-visual"><div class="detail-visual-stage"><button class="detail-nav detail-prev" data-card-step="-1" aria-label="上一張卡" title="上一張卡">&#8592;</button><div class="detail-art tilt-card" tabindex="0" aria-label="移動游標可傾斜查看卡圖"><div class="tilt-card-surface">${resilientImage(image(c),name(c),'這張卡尚未收錄可公開顯示的圖片')}<span class="tilt-shine" aria-hidden="true"></span></div></div><button class="detail-nav detail-next" data-card-step="1" aria-label="下一張卡" title="下一張卡">&#8594;</button></div><div class="detail-position"><span>${e(position)}</span><small>移動游標可傾斜查看卡面</small></div><h2>${e(name(c))}</h2><p class="meta">${original(c)?'原名：'+e(original(c)):'原名待補'}</p><p>${e(c.game?.nameZh||G(c.game).nameZh||c.game)}｜${e(c.officialCardNumber)}｜${e(c.rarity||'稀有度待補')}</p></div><div><div class="detail-tabs" role="tablist"><button class="on" data-detail-tab="info">資訊</button><button data-detail-tab="market">跨市場比價</button><button data-detail-tab="trend">成交趨勢</button><button data-detail-tab="reports">使用者回報</button></div><section data-detail-panel="info"><h3>卡片文字</h3>${cardTextBlock(c)}<h3>收錄版本</h3><p class="meta">優先以日版作跨地區比對基準；缺少日版時依序採台版、美版、韓版或其他版本。</p>${versions||'<div class="state">版本待補</div>'}</section><section data-detail-panel="market" hidden><p class="meta">${e(m.meta?.warning||'不同價格性質不混算。')}</p>${markets}</section><section data-detail-panel="trend" hidden><div class="state">目前沒有足以建立可信成交趨勢的已驗證歷史資料，因此不顯示示範曲線或假交易量。</div></section><section data-detail-panel="reports" hidden>${reportList}</section></div></div>`;activateDetailInteractions();
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

const enhancementStyle=document.createElement('style');enhancementStyle.textContent=`.unified-image-fallback{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f4f4f4,#f4f4f4 10px,#ededed 10px,#ededed 20px);gap:5px;align-content:center}.unified-image-fallback b{color:#555}.unified-image-fallback small{max-width:150px}.view-switch{display:flex;align-self:end;margin-right:auto}.view-switch button,.detail-tabs button,.text-switch button{border:1px solid #d5d5d5;background:#fff;padding:8px 12px;cursor:pointer}.view-switch button:first-child,.detail-tabs button:first-child,.text-switch button:first-child{border-radius:9px 0 0 9px}.view-switch button:last-child,.detail-tabs button:last-child,.text-switch button:last-child{border-radius:0 9px 9px 0}.view-switch button.on,.detail-tabs button.on,.text-switch button.on{background:#111;color:#fff;border-color:#111}.cards.list-view{grid-template-columns:1fr;gap:8px}.card-list{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(180px,auto);gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.card-list .art{width:76px;aspect-ratio:5/7}.card-list h3{white-space:normal;margin:0}.card-list-facts{display:grid;grid-template-columns:repeat(2,minmax(80px,auto));gap:3px 12px;align-items:center}.detail-tabs-layout{grid-template-columns:270px 1fr}.detail-visual-stage{position:relative;padding:0 23px}.tilt-card{perspective:1000px;overflow:visible;background:transparent;outline:none}.tilt-card:focus-visible{box-shadow:0 0 0 4px var(--y)}.tilt-card-surface{position:relative;width:100%;height:100%;overflow:hidden;border-radius:13px;transform:rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));transform-style:preserve-3d;transition:transform .18s ease;box-shadow:0 16px 35px #0002}.tilt-card-surface>img,.tilt-card-surface>.image-fallback{width:100%;height:100%;object-fit:contain}.tilt-shine{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--shine-x,50%) var(--shine-y,50%),#fff9 0,transparent 38%);mix-blend-mode:screen;opacity:var(--shine-opacity,0);transition:opacity .18s}.detail-nav{position:absolute;top:45%;z-index:2;width:38px;height:38px;border:1px solid #ddd;border-radius:50%;background:#fffc;box-shadow:0 4px 14px #0002;cursor:pointer;font-size:20px}.detail-prev{left:-19px}.detail-next{right:-19px}.detail-position{display:flex;justify-content:space-between;gap:10px;margin:10px 3px 0;color:var(--muted);font-size:12px}.detail-tabs{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--line);margin-bottom:16px}.detail-tabs button{white-space:nowrap;border-radius:0!important;border-width:0 0 3px}.card-rules-text{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:14px;margin-top:8px}.card-rules-text small{display:block;color:#8a6500;margin-top:10px}.text-switch{display:flex}.feature-tour{overflow:hidden}.feature-tour-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.feature-eyebrow,.feature-kicker{display:block;font-size:11px;font-weight:900;letter-spacing:.14em}.feature-eyebrow{color:#888}.tour-pause{border:1px solid #ddd;border-radius:999px;background:#fff;padding:7px 13px;cursor:pointer}.feature-stage{position:relative;min-height:265px}.feature-slide{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(310px,.95fr);align-items:center;gap:35px;padding:34px 42px;border-radius:24px;opacity:0;visibility:hidden;transform:translateX(28px);transition:opacity .45s ease,transform .45s ease,visibility .45s}.feature-slide.on{opacity:1;visibility:visible;transform:none}.feature-slide.yellow{background:linear-gradient(120deg,#ffe669,#fff3b8)}.feature-slide.aqua{background:linear-gradient(120deg,#6ee2d6,#c8f9f4)}.feature-slide.violet{background:linear-gradient(120deg,#c69bff,#e5d4ff)}.feature-slide h3{font-size:clamp(24px,3vw,40px);line-height:1.08;margin:8px 0 14px}.feature-slide p{font-size:16px;max-width:630px}.tour-dots{display:flex;justify-content:center;gap:7px;margin-top:12px}.tour-dots button{width:9px;height:9px;padding:0;border:0;border-radius:99px;background:#ccc;cursor:pointer;transition:width .25s}.tour-dots button.on{width:28px;background:#111}.tour-products{height:185px;display:flex;justify-content:center;align-items:end;gap:12px}.tour-products i{display:block;width:92px;height:142px;border:5px solid #fff;border-radius:11px;background:linear-gradient(150deg,#e73154 0 48%,#291c64 49%);box-shadow:0 18px 25px #0002;transform:rotate(-7deg)}.tour-products i:nth-child(2){height:170px;background:linear-gradient(145deg,#00a99a 0 52%,#102a47 53%);transform:none}.tour-products i:nth-child(3){background:linear-gradient(145deg,#ff8b32 0 52%,#7d2047 53%);transform:rotate(7deg)}.tour-search{display:flex;flex-wrap:wrap;align-content:center;gap:10px;padding:26px;border:2px solid #111;border-radius:22px;background:#fffd;box-shadow:0 18px 30px #0001}.tour-search b{flex-basis:100%;font-size:30px}.tour-search span{background:#111;color:#fff;border-radius:999px;padding:7px 12px}.tour-search em{flex-basis:100%;font-style:normal;color:#555}.tour-card-demo{height:190px;display:flex;align-items:center;justify-content:center;gap:25px;perspective:1000px}.tour-card-demo div{width:118px;height:168px;border:6px solid #fff;border-radius:12px;background:linear-gradient(145deg,#f6d948 0 35%,#0a9a93 36% 68%,#1c173e 69%);box-shadow:18px 18px 28px #0003;transform:rotateY(-16deg) rotateX(7deg)}.tour-card-demo span{padding:13px;border-radius:12px;background:#111;color:#fff}@media(prefers-reduced-motion:reduce){.feature-slide,.tilt-card-surface,.tour-dots button{transition:none!important}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.detail-tabs-layout{grid-template-columns:1fr}.detail-tabs{position:sticky;top:0;background:#fff;z-index:1}.detail-visual{max-width:280px;margin:auto}.detail-position small{display:none}.feature-stage{min-height:390px}.feature-slide{grid-template-columns:1fr;padding:25px;gap:8px}.feature-slide h3{font-size:27px}.tour-products,.tour-card-demo{height:145px}.tour-products i{width:65px;height:105px}.tour-products i:nth-child(2){height:125px}.tour-card-demo div{width:85px;height:125px}.tour-search{padding:18px}.tour-search b{font-size:24px}}`;document.head.append(enhancementStyle);
const utilityStyle=document.createElement('style');utilityStyle.textContent=`.view-switch{flex-wrap:wrap;gap:0}.view-switch button{font-weight:800}.cards.rarity-view{display:block}.rarity-group{margin:0 0 24px}.rarity-group>header{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;padding:10px 13px;border-left:4px solid var(--y);background:var(--soft);border-radius:8px}.rarity-group>header h3{margin:0;font-size:17px}.rarity-group>header span{color:var(--muted);font-size:13px}.rarity-group-cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:22px 14px}.card-actions{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:8px}.favorite-toggle{width:32px;height:30px;padding:0;border:1px solid #d4d4d4;border-radius:8px;background:#fff;color:#777;font-size:20px;line-height:1;cursor:pointer}.favorite-toggle[aria-pressed=true]{color:#b18b00;border-color:#e0c534;background:#fff8bf}.watchlist-inline{display:inline-flex;align-items:center;gap:3px;border:1px solid #d4d4d4;border-radius:8px;overflow:hidden;background:#fff}.watchlist-inline button{width:24px;height:28px;padding:0;border:0;background:#f5f5f5;font-size:18px;line-height:1;cursor:pointer}.watchlist-inline button:disabled{color:#aaa;cursor:not-allowed}.watchlist-inline span{min-width:22px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}.card-list{grid-template-columns:76px minmax(0,1fr) minmax(180px,auto) auto}.card-list .card-actions{margin:0;display:grid;gap:5px}.card-list .favorite-toggle{justify-self:center}.card-list .watchlist-inline{justify-self:end}.favorites-filter{align-self:end;border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.favorites-filter.on{background:#111;color:#fff;border-color:#111}.watchlist-summary{display:flex;align-items:center;justify-content:space-between;gap:13px;flex:1 1 360px;min-width:260px;color:#444}.watchlist-summary>div{display:grid;gap:2px}.watchlist-summary span{color:var(--muted);font-size:13px}.watchlist-summary small{color:var(--muted);font-size:12px}.watchlist-summary em{font-style:normal;color:#7b6100;font-size:12px}.watchlist-summary button{border:1px solid #d4d4d4;border-radius:9px;background:#fff;padding:8px 11px;font-weight:800;cursor:pointer;white-space:nowrap}.watchlist-summary button:disabled{color:#aaa;cursor:not-allowed}.cards-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:16px;min-height:155px;padding:24px;border:1px dashed #d4d4d4;border-radius:14px;color:var(--muted)}.cards-empty img{width:68px;height:68px;object-fit:contain;opacity:.72}.cards-empty b{display:block;color:#444}.cards-empty p{margin:5px 0 0}.feature-tour{margin:8px 0 18px;padding:0;border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden}.feature-tour summary{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;list-style:none}.feature-tour summary::-webkit-details-marker{display:none}.help-summary-copy{display:grid;gap:2px;flex:1}.help-summary-copy small{color:var(--muted);font-size:13px}.feature-tour summary img{width:34px;height:34px;object-fit:contain;opacity:.78}.help-summary-chevron{font-size:20px;transition:transform .2s}.feature-tour[open] .help-summary-chevron{transform:rotate(180deg)}.help-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 14px 14px}.help-item{padding:13px;border-radius:10px;background:var(--soft)}.help-item b{font-size:14px}.help-item p{margin:6px 0 0;color:#555;font-size:13px;line-height:1.55}@media(max-width:1100px){.rarity-group-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.card-list .card-actions{grid-column:2;display:flex;justify-self:start}.watchlist-summary{flex-basis:100%;min-width:0}.watchlist-summary button{margin-left:auto}.help-grid{grid-template-columns:1fr}.cards-empty{align-items:flex-start}.cards-empty img{width:54px;height:54px}}`;document.head.append(utilityStyle);
installFeatureTour();
installViewToggle();
installCardUtilities();
if(currentCardRows.length)cards(currentCardRows,true);

document.addEventListener('keydown',event=>{if(!$('modal')?.classList.contains('open'))return;if(event.key==='ArrowLeft')openAdjacentCard(-1);if(event.key==='ArrowRight')openAdjacentCard(1);if(event.key==='Escape')$('modal').classList.remove('open')});
