const seriesRegionRank={JP:0,TW:1,US:2,KR:3,ASIA:4};
const seriesGroupState={};
const seriesGameNames={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王',haikyuu:'排球少年', 'weiss-schwarz':'WS 芙莉蓮'};
function pokemonEra(item){
  const code=String(item.officialCode||'').toUpperCase(),year=Number(String(item.releaseDate||'').slice(0,4));
  if(code.startsWith('SV')||year>=2023)return '朱／紫系列';
  if(code.startsWith('SWSH')||(year>=2020&&year<=2022))return '劍／盾系列';
  if(code.startsWith('SM')||(year>=2017&&year<=2019))return '太陽／月亮系列';
  if(code.startsWith('XY')||(year>=2014&&year<=2016))return 'XY 系列';
  if(code.startsWith('BW')||(year>=2011&&year<=2013))return 'BW 系列';
  if(/^(HG|HS|CL|L)/.test(code)||year===2010)return 'LEGEND 系列';
  if(/^(DP|PL)/.test(code)||(year>=2007&&year<=2009))return 'DP 系列';
  if(/^(EX|PCG)/.test(code)||(year>=2003&&year<=2006))return 'ADV／PCG 系列';
  return '經典系列';
}
function seriesGroup(item){
  if(item.game==='pokemon')return pokemonEra(item);
  if(item.game==='onepiece')return /ST|DECK/i.test(`${item.officialCode} ${item.productType}`)?'牌組':'補充包／系列';
  if(item.game==='haikyuu')return /D\d|DECK/i.test(`${item.officialCode} ${item.productType}`)?'起始牌組':'補充包／特典';
  if(item.game==='weiss-schwarz')return /DECK|TD/i.test(`${item.officialCode} ${item.productType}`)?'牌組':'補充包／特典';
  const year=String(item.releaseDate||'').slice(0,4);return year?`${year} 年系列`:'其他系列';
}
function preferredSeriesRows(){
  let rows=P.filter(item=>game==='all'||item.game===game).filter(item=>item.imageUrl);
  rows.sort((a,b)=>(seriesRegionRank[a.region]??9)-(seriesRegionRank[b.region]??9)||String(b.releaseDate||'').localeCompare(String(a.releaseDate||''))||String(a.officialCode||'').localeCompare(String(b.officialCode||'')));
  return rows;
}
function drawSeriesGroups(rows){
  let host=document.getElementById('seriesGroups');
  if(!host){host=document.createElement('div');host.id='seriesGroups';host.className='series-groups';document.getElementById('series').before(host)}
  const groups=[...new Set(rows.map(seriesGroup))],active=seriesGroupState[game]||groups[0];
  if(!groups.includes(active))seriesGroupState[game]=groups[0];
  host.innerHTML=groups.map(label=>`<button class="series-group ${label===(seriesGroupState[game]||groups[0])?'on':''}" data-group="${e(label)}">${e(label)}</button>`).join('');
  host.onclick=event=>{const button=event.target.closest('[data-group]');if(!button)return;seriesGroupState[game]=button.dataset.group;series()};
}
series=function(){
  const allRows=preferredSeriesRows();drawSeriesGroups(allRows);
  const groups=[...new Set(allRows.map(seriesGroup))],active=seriesGroupState[game]||groups[0],rows=allRows.filter(item=>seriesGroup(item)===active);
  $('series').innerHTML=rows.length?rows.map(item=>{const primary=item.nameZh||item.name||item.nameJa||'中文名稱待補',original=item.nameJa||item.name||'',secondary=original&&original!==primary?`<div class="series-original">${e(original)}</div>`:'',date=item.releaseDate?String(item.releaseDate).slice(0,4):'';return`<article class="series-card" onclick="seriesSearch('${e(item.officialCode||item.name)}')"><div class="series-art"><img src="${e(item.imageUrl)}" alt="${e(primary)}" loading="lazy" onerror="this.parentElement.textContent='圖片待補'"></div><h3 title="${e(primary)}">${e(primary)}</h3>${secondary}<div class="series-facts"><b>${e(item.officialCode||'代碼待補')}</b><span>${e(item.versionLabel||rn(item.region))}</span>${date?`<span>${e(date)}</span>`:''}</div></article>`}).join(''):'<p class="meta">此分類目前沒有可驗證的系列圖片。</p>';
};
const seriesStyle=document.createElement('style');seriesStyle.textContent=`.series-groups{display:flex;gap:8px;overflow-x:auto;padding:13px 0 2px}.series-group{border:1px solid #ddd;background:#fff;border-radius:999px;padding:7px 13px;white-space:nowrap;cursor:pointer}.series-group.on{background:#111;color:#fff;border-color:#111}.series-original{font-size:12px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:-1px}.series-facts{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:5px}.series-facts span,.series-facts b{font-size:11px;border-radius:5px;padding:2px 5px;background:#eee}.series-facts b{background:#fff5a8}`;document.head.append(seriesStyle);

