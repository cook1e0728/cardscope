import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnePieceSeries, pickOnePiecePromoOption, syncCatalog } from '../providers/catalog-sync.mjs';

// The official card-list dropdown has three options with no bracketed set code. They are not sets, but their pages hold
// the alt-art / promo versions of numbers already synced and the P-xxx promo numbers.
const option=(value,name)=>`<option value="${value}" >${name}</option>`;
const enIndex=['<option value>ALL</option>',option(556101,'BOOSTER PACK &lt;br class=&quot;spInline&quot;&gt;-ROMANCE DAWN- [OP-01]'),option(556701,'Family Deck Set'),option(556901,'Promotion card'),option(556801,'Limited Product Card')].join('\n');
const twIndex=['<option value>全部</option>',option(554101,'補充包 ROMANCE DAWN【OP-01】'),option(554701,'家庭牌組套裝'),option(554901,'推廣卡'),option(554801,'限定商品收錄卡牌')].join('\n');
const card=(file,number,rarity,type,name)=>`<a class="modalOpen" data-fancybox="group_1" data-src="#${file}"><img class="lazy" src="/images/cardlist/dummy.gif" data-src="../images/cardlist/card/${file}.png?260929" alt="${name}"></a>\n<dl class="modalCol" id="${file}"><dt><div class="infoCol">\n<span>${number}</span> | <span>${rarity}</span> | <span>${type}</span>\n</div><div class="cardName">${name}</div></dt></dl>`;
const page=(...cards)=>`<html>${cards.join('\n')}</html>`;

const enPages={
  556101:page(card('OP01-001','OP01-001','L','LEADER','Roronoa Zoro')),
  556701:page(card('P-010','P-010','P','CHARACTER','Family Card')),
  556901:page(card('OP01-001_p1','OP01-001','L','LEADER','Roronoa Zoro'),card('P-001','P-001','P','CHARACTER','Monkey.D.Luffy'),card('P-002','P-002','P','CHARACTER','Nami')),
  556801:page(card('OP01-002_p1','OP01-002','C','CHARACTER','Limited Card'))
};
const twPages={
  554101:page(card('OP01-001','OP01-001','L','LEADER','羅羅亞·索隆')),
  554701:page(card('P-010','P-010','P','CHARACTER','家庭卡')),
  554901:page(card('OP01-001_p1','OP01-001','L','LEADER','羅羅亞·索隆'),card('P-001','P-001','P','CHARACTER','蒙其·D·魯夫'),card('P-002','P-002','P','CHARACTER','娜美')),
  554801:page(card('OP01-002_p1','OP01-002','C','CHARACTER','限定卡'))
};

test('parseOnePieceSeries keeps options without a set code as code:null',()=>{
  const en=parseOnePieceSeries(enIndex),tw=parseOnePieceSeries(twIndex);
  assert.equal(en.length,4);assert.equal(tw.length,4);
  assert.deepEqual(en.filter(s=>!s.code).map(s=>[s.providerId,s.name]),[['556701','Family Deck Set'],['556901','Promotion card'],['556801','Limited Product Card']]);
  assert.deepEqual(tw.filter(s=>!s.code).map(s=>[s.providerId,s.name]),[['554701','家庭牌組套裝'],['554901','推廣卡'],['554801','限定商品收錄卡牌']]);
  assert.equal(en[0].code,'OP-01','coded options are unchanged');
  assert.equal(parseOnePieceSeries(`${option(1,'Family Deck Set')}${option(1,'Family Deck Set')}`).length,1,'still de-duplicated by providerId');
});

test('the promo series is named after the uncoded list holding the most P- cards',()=>{
  const options=parseOnePieceSeries(enIndex),cards=[[],[{number:'P-010'}],[{number:'OP01-001'},{number:'P-001'},{number:'P-002'}],[]];
  assert.equal(pickOnePiecePromoOption(options,cards).providerId,'556901');
  assert.equal(pickOnePiecePromoOption(options,[[{number:'P-001'}],[],[],[]]),null,'a coded list never names the promo series');
  assert.equal(pickOnePiecePromoOption(options,[[],[],[],[]]),null);
});

test('One Piece sync reads the uncoded lists, adds the promo series and keeps sets and products to coded options',async()=>{
  const originalFetch=globalThis.fetch,originalSetTimeout=globalThis.setTimeout,requested=[],writes=new Map();
  // The one-second politeness pause is real in production; here it would only slow the test.
  globalThis.setTimeout=(fn,ms,...args)=>originalSetTimeout(fn,ms>=1000?0:ms,...args);
  globalThis.fetch=async input=>{
    const url=new URL(typeof input==='string'?input:input.url);requested.push(url.href);
    const tw=url.hostname.startsWith('asia-tc');
    let body;
    if(url.pathname.startsWith('/products'))body='<html></html>';
    else if(url.pathname==='/cardlist/'&&url.searchParams.has('series'))body=(tw?twPages:enPages)[url.searchParams.get('series')];
    else if(url.pathname==='/cardlist/')body=tw?twIndex:enIndex;
    if(body===undefined)throw new Error(`Unexpected provider request: ${url.href}`);
    return new Response(body,{status:200,headers:{'Content-Type':'text/html'}});
  };
  const db=async(path,options={})=>{
    if(path==='/catalog_sync_runs'&&options.method==='POST')return [{id:'sync-test'}];
    if(options.method==='POST'){const name=path.split('?')[0],rows=JSON.parse(options.body);writes.set(name,[...(writes.get(name)||[]),...rows])}
    return [];
  };
  const last=(table,id)=>(writes.get(table)||[]).filter(row=>row.id===id).at(-1);
  try{
    const result=await syncCatalog(db,{providers:['onepiece']});
    assert.ok(!result.onepiece.error,JSON.stringify(result.onepiece));
    for(const ids of [['556101','556701','556901','556801'],['554101','554701','554901','554801']])for(const id of ids)assert.ok(requested.some(url=>url.includes('cardlist/?search=true&series='+id)),`card page ${id} is requested`);

    const series=writes.get('/tcg_series'),seriesIds=new Set(series.map(row=>row.id));
    assert.deepEqual([...seriesIds].sort(),['onepiece-official-op-01','onepiece-official-p','onepiece-official-tw-op-01','onepiece-official-tw-p']);
    const promo=last('/tcg_series','onepiece-official-p'),twPromo=last('/tcg_series','onepiece-official-tw-p');
    assert.deepEqual([promo.official_code,promo.name_en,promo.region,promo.provider_id,promo.source,promo.metadata.productType],['P','Promotion card','ASIA','556901','onepiece-official','Promotion card']);
    assert.equal(promo.source_url,'https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=556901');
    assert.deepEqual([twPromo.official_code,twPromo.name_zh,twPromo.region,twPromo.provider_id,twPromo.source,twPromo.metadata.productType],['P','推廣卡','TW','554901','onepiece-official-tw','推廣卡']);
    assert.equal(twPromo.source_url,'https://asia-tc.onepiece-cardgame.com/cardlist/?search=true&series=554901');

    const products=writes.get('/tcg_products');
    assert.deepEqual(products.map(row=>row.series_id).sort(),['onepiece-official-op-01','onepiece-official-tw-op-01'],'no product for the uncoded lists or the promo series');
    assert.ok(products.every(row=>row.official_code==='OP-01'));

    const printing=(source,providerId)=>writes.get('/tcg_printings').find(row=>row.source===source&&row.provider_id===providerId);
    assert.equal(printing('onepiece-official','P-001').series_id,'onepiece-official-p');
    assert.equal(printing('onepiece-official','P-010').series_id,'onepiece-official-p');
    assert.equal(printing('onepiece-official','OP01-001_p1').series_id,'onepiece-official-op-01','alt art from an uncoded page keeps its set');
    assert.equal(printing('onepiece-official','OP01-002_p1').series_id,'onepiece-official-op-01');
    assert.equal(printing('onepiece-official-tw','P-001').series_id,'onepiece-official-tw-p');
    assert.equal(printing('onepiece-official-tw','OP01-001_p1').series_id,'onepiece-official-tw-op-01');
    assert.equal(last('/tcg_cards','onepiece-official-p-001').series_id,'onepiece-official-p');
    assert.equal(last('/tcg_cards','onepiece-official-op01-001-p1').series_id,'onepiece-official-op-01');

    assert.equal(last('/tcg_series','onepiece-official-op-01').metadata.cardsCount,3);
    assert.equal(last('/tcg_series','onepiece-official-p').metadata.cardsCount,3);
    assert.equal(last('/tcg_series','onepiece-official-tw-op-01').metadata.cardsCount,3);
    assert.equal(last('/tcg_series','onepiece-official-tw-p').metadata.cardsCount,3);
    assert.equal(result.onepiece.metadata.twCards,6);
  }finally{
    globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;
  }
});
