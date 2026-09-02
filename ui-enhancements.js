const uiLocal={get(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
let cardViewMode=uiLocal.get('cardscope-card-view','grid');

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
  host.innerHTML=`<button data-view="grid">圖鑑模式</button><button data-view="list">清單模式</button>`;
  tools.prepend(host);host.onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;cardViewMode=button.dataset.view;uiLocal.set('cardscope-card-view',cardViewMode);drawViewButtons();cards(currentCardRows,true)};drawViewButtons();
}
function drawViewButtons(){document.querySelectorAll('#cardViewSwitch [data-view]').forEach(button=>button.classList.toggle('on',button.dataset.view===cardViewMode))}

cards=function(rows,keepSource=false){
  if(!keepSource){currentCardRows=rows;refreshRarityOptions(rows)}
  const shown=filteredCards(currentCardRows),host=$('cards');host.classList.toggle('list-view',cardViewMode==='list');drawViewButtons();
  $('filterSummary').textContent=`目前載入 ${currentCardRows.length.toLocaleString()} 張，篩選後 ${shown.length.toLocaleString()} 張；價格僅採可驗證買取資料`;
  host.innerHTML=shown.length?shown.map(c=>{const price=priceFor(c),number=c.officialCardNumber||c.printings?.[0]?.localCardNumber||'卡號待補',rarity=c.rarity||c.printings?.[0]?.rarity||'稀有度待補',region=rn(c.region||c.printings?.[0]?.region),picture=resilientImage(image(c),name(c),'這張卡尚未收錄可公開顯示的圖片');if(cardViewMode==='list')return `<article class="card card-list" onclick="openCard('${e(c.id)}')"><div class="art">${picture}</div><div class="card-list-main"><h3>${e(name(c))}</h3><div class="meta">${e(original(c)&&original(c)!==name(c)?original(c):'原名待補')}</div></div><div class="card-list-facts"><b>${e(number)}</b><span>${e(rarity)}</span><span class="badge">${e(region)}</span>${price?`<strong>${e(price.currency)} ${Number(price.price).toLocaleString()} 買取</strong>`:'<span class="meta">可靠價格待補</span>'}</div></article>`;return `<article class="card" onclick="openCard('${e(c.id)}')"><div class="art">${picture}</div><h3>${e(name(c))}</h3><div class="meta">${e(number)} · ${e(rarity)}</div>${price?`<div class="card-price">${e(price.currency)} ${Number(price.price).toLocaleString()} 買取</div>`:''}<span class="badge">${e(region)}</span></article>`}).join(''):'<p>目前沒有符合條件的卡片；若是尚未發售商品，代表官方尚未公開卡表。</p>';
};

function cardTextBlock(card){
  const metadata=card.metadata||{},originalText=metadata.effectText||metadata.cardText||metadata.ability||metadata.text||metadata.effect||null,translatedText=metadata.effectTextZh||metadata.cardTextZh||metadata.abilityZh||metadata.textZh||null;
  if(!originalText)return '<div class="state">目前資料來源沒有提供可切換的技能／效果全文；不以自行生成內容補空白。</div>';
  if(!translatedText)return `<div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>中文翻譯尚未收錄；不以未驗證翻譯冒充官方內容。</div>`;
  return `<div class="text-switch"><button class="on" data-text-mode="original">原文</button><button data-text-mode="translated">中文翻譯</button></div><div data-text-panel="original" class="card-rules-text">${e(originalText)}</div><div data-text-panel="translated" class="card-rules-text" hidden>${e(translatedText)}<small>機器翻譯僅供參考，請以卡面原文與官方規則為準。</small></div>`;
}

function activateDetailInteractions(){
  document.querySelectorAll('[data-detail-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-detail-tab]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-detail-panel]').forEach(panel=>panel.hidden=panel.dataset.detailPanel!==button.dataset.detailTab)});
  document.querySelectorAll('[data-text-mode]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-text-mode]').forEach(x=>x.classList.toggle('on',x===button));document.querySelectorAll('[data-text-panel]').forEach(panel=>panel.hidden=panel.dataset.textPanel!==button.dataset.textMode)});
}

openCard=async function(id){
  $('modal').classList.add('open');$('detail').textContent='正在載入…';
  try{
    const [cr,mr,rr]=await Promise.all([fetch('/api/cards/'+encodeURIComponent(id)),fetch('/api/cards/'+encodeURIComponent(id)+'/market'),fetch('/api/reports?cardId='+encodeURIComponent(id)).catch(()=>null)]),cb=await cr.json(),mb=await mr.json(),rb=rr&&rr.ok?await rr.json():{data:{reports:[]}},c=cb.data,m=mb.data||{records:[],meta:{}},reports=rb.data?.reports||[];
    if(!cr.ok)throw Error(cb.error);
    const ps=c.printings||[],ref=ps.find(p=>p.region==='JP')||ps.find(p=>p.region==='TW')||ps.find(p=>p.region==='US')||ps.find(p=>p.region==='KR')||ps[0],versions=ps.map(p=>{const diff=[];if(ref&&p!==ref&&p.localCardNumber&&p.localCardNumber!==ref.localCardNumber)diff.push('卡號不同');if(ref&&p!==ref&&p.rarity&&ref.rarity&&p.rarity!==ref.rarity)diff.push('稀有度不同');return `<div class="state"><b>${e(rn(p.region))}</b>${p===ref?' · <span class="badge">比對基準</span>':''} · ${e(ln(p.language))} · ${e(p.localSetCode)} · ${e(p.localCardNumber)}${diff.length?`<br><span class="meta">版本差異：${e(diff.join('、'))}</span>`:''}</div>`}).join(''),markets=m.records?.length?m.records.map(r=>`<div class="market"><b>${e(r.provider)}</b> · ${e(r.priceType)} · ${e(r.currency)} ${Number(r.amount).toLocaleString()}</div>`).join(''):'<div class="state">目前沒有可靠對應價格，不以假價格補空白。</div>',reportList=reports.length?reports.map(r=>`<div class="state"><b>${e(r.platform)}</b> · ${e(r.currency)} ${Number(r.price).toLocaleString()}<br><span class="meta">使用者回報，尚未驗證</span></div>`).join(''):'<div class="state">目前沒有使用者回報。</div>';
    $('detail').innerHTML=`<div class="detail detail-tabs-layout"><div><div class="detail-art">${resilientImage(image(c),name(c),'這張卡尚未收錄可公開顯示的圖片')}</div><h2>${e(name(c))}</h2><p class="meta">${original(c)?'原名：'+e(original(c)):'原名待補'}</p><p>${e(c.game?.nameZh||G(c.game).nameZh||c.game)}｜${e(c.officialCardNumber)}｜${e(c.rarity||'稀有度待補')}</p></div><div><div class="detail-tabs" role="tablist"><button class="on" data-detail-tab="info">資訊</button><button data-detail-tab="market">跨市場比價</button><button data-detail-tab="trend">成交趨勢</button><button data-detail-tab="reports">使用者回報</button></div><section data-detail-panel="info"><h3>卡片文字</h3>${cardTextBlock(c)}<h3>收錄版本</h3><p class="meta">優先以日版作跨地區比對基準；缺少日版時依序採台版、美版、韓版或其他版本。</p>${versions||'<div class="state">版本待補</div>'}</section><section data-detail-panel="market" hidden><p class="meta">${e(m.meta?.warning||'不同價格性質不混算。')}</p>${markets}</section><section data-detail-panel="trend" hidden><div class="state">目前沒有足以建立可信成交趨勢的已驗證歷史資料，因此不顯示示範曲線或假交易量。</div></section><section data-detail-panel="reports" hidden>${reportList}</section></div></div>`;activateDetailInteractions();
  }catch(error){$('detail').innerHTML=`<div class="state">卡片資料載入失敗：${e(error.message)}</div>`}
};
window.openCard=openCard;

const enhancementStyle=document.createElement('style');enhancementStyle.textContent=`.unified-image-fallback{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f4f4f4,#f4f4f4 10px,#ededed 10px,#ededed 20px);gap:5px;align-content:center}.unified-image-fallback b{color:#555}.unified-image-fallback small{max-width:150px}.view-switch{display:flex;align-self:end;margin-right:auto}.view-switch button,.detail-tabs button,.text-switch button{border:1px solid #d5d5d5;background:#fff;padding:8px 12px;cursor:pointer}.view-switch button:first-child,.detail-tabs button:first-child,.text-switch button:first-child{border-radius:9px 0 0 9px}.view-switch button:last-child,.detail-tabs button:last-child,.text-switch button:last-child{border-radius:0 9px 9px 0}.view-switch button.on,.detail-tabs button.on,.text-switch button.on{background:#111;color:#fff;border-color:#111}.cards.list-view{grid-template-columns:1fr;gap:8px}.card-list{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(180px,auto);gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.card-list .art{width:76px;aspect-ratio:5/7}.card-list h3{white-space:normal;margin:0}.card-list-facts{display:grid;grid-template-columns:repeat(2,minmax(80px,auto));gap:3px 12px;align-items:center}.detail-tabs-layout{grid-template-columns:240px 1fr}.detail-tabs{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--line);margin-bottom:16px}.detail-tabs button{white-space:nowrap;border-radius:0!important;border-width:0 0 3px}.card-rules-text{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:14px;margin-top:8px}.card-rules-text small{display:block;color:#8a6500;margin-top:10px}.text-switch{display:flex}@media(max-width:760px){.view-switch{width:100%}.view-switch button{flex:1}.card-list{grid-template-columns:58px 1fr}.card-list .art{width:58px}.card-list-facts{grid-column:2;grid-template-columns:repeat(2,1fr)}.detail-tabs-layout{grid-template-columns:1fr}.detail-tabs{position:sticky;top:0;background:#fff;z-index:1}}`;document.head.append(enhancementStyle);
installViewToggle();
if(currentCardRows.length)cards(currentCardRows,true);
