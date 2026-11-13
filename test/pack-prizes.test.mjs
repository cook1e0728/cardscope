import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PACK_PRIZE_GAMES,prizeSeriesCandidates,prizeCards,prizeRow,isAltArt} from '../providers/pack-prizes.mjs';

// 本彈大獎的挑選規則（providers/pack-prizes.mjs）。系列與卡片樣本取自 2026-11 正式站的實際資料形狀。
const rule=game=>PACK_PRIZE_GAMES.find(r=>r.game===game);
const today='2026-11-13';
const ids=list=>list.map(release=>release.map(s=>s.id));
const S=(id,game,region,officialCode,releaseDate,nameZh,nameJa=null)=>({id,game,region,officialCode,releaseDate,nameZh,nameJa});

test('系列：近 90 天、已發售、新到舊；同一彈的版本台灣在前；美版不收；未來發售不收',()=>{
  const series=[
    S('us-me6','pokemon','US','me6','2026-11-06','Delta Reign'),
    S('jp-m6a','pokemon','JP','M6a','2026-09-16','30th CELEBRATION'),
    S('tw-m6a','pokemon','TW','M6a','2026-09-16','30th CELEBRATION'),
    S('tw-m6','pokemon','TW','M6','2026-08-20','綠寶石風暴'),
    S('jp-old','pokemon','JP','M5','2026-07-01','舊彈'),
    S('jp-next','pokemon','JP','M7','2026-12-01','還沒發售')
  ];
  assert.deepEqual(ids(prizeSeriesCandidates(series,rule('pokemon'),today)),[['tw-m6a','jp-m6a'],['tw-m6']]);
});

test('系列：同一彈任一版本名稱像預組就整彈排除（台版名稱沒寫「牌組」也一樣）',()=>{
  const series=[
    S('tw-mf','pokemon','TW','MF','2026-09-16','太陽伊布・月亮伊布'),
    S('jp-mf','pokemon','JP','MF','2026-09-16',null,'30th CELEBRATION プレミアムデッキセット エーフィ・ブラッキー'),
    S('tw-m6a','pokemon','TW','M6a','2026-09-16','30th CELEBRATION')
  ];
  assert.deepEqual(ids(prizeSeriesCandidates(series,rule('pokemon'),today)),[['tw-m6a']]);
});

test('系列：航海王只看 OP／EB／PRB，起始牌組不收',()=>{
  const series=[
    S('tw-eb05','onepiece','TW','EB-05','2026-10-31','特殊補充包 Heroines Edition【EB-05】'),
    S('asia-eb05','onepiece','ASIA','EB-05','2026-10-30','額外補充包 Heroines Edition vol.2 [EB-05]'),
    S('tw-op17','onepiece','TW','OP-17','2026-08-22','補充包 世界最強的戰士【OP-17】'),
    S('tw-st31','onepiece','TW','ST-31','2026-08-30','紅 蒙其・D・魯夫【ST-31】')
  ];
  assert.deepEqual(ids(prizeSeriesCandidates(series,rule('onepiece'),today)),[['tw-eb05','asia-eb05'],['tw-op17']]);
});

test('系列：日版早於 90 天、台版在 90 天內時，日版名稱是預組也整彈排除；排序看最早發售日，晚出的台版不會排到新彈前面',()=>{
  const series=[
    S('jp-mf','pokemon','JP','MF','2026-07-01',null,'プレミアムデッキセット'),
    S('tw-mf','pokemon','TW','MF','2026-09-20','太陽伊布・月亮伊布'),
    S('jp-old','pokemon','JP','M6','2026-07-31','ストームエメラルダ'),
    S('tw-old','pokemon','TW','M6','2026-10-20','綠寶石風暴'),
    S('jp-new','pokemon','JP','M7','2026-10-01','新彈')
  ];
  assert.deepEqual(ids(prizeSeriesCandidates(series,rule('pokemon'),today)),[['jp-new'],['tw-old','jp-old']]);
});

const C=(providerId,rarity,extra={})=>({id:`c-${providerId}`,providerId,rarity,game:'onepiece',...extra});

test('卡片：航海王 SEC 以上；同稀有度異圖在原版前；SR 異圖不算',()=>{
  const cards=[C('OP17-118','SEC'),C('OP17-118_p1','SEC'),C('OP17-033_p1','TR'),C('OP17-081_p1','SP卡'),C('OP17-005_p1','SR'),C('OP17-119','SEC'),C('OP17-119_p2','SEC')];
  assert.deepEqual(prizeCards('onepiece','SEC',cards).map(c=>c.providerId),['OP17-033_p1','OP17-081_p1','OP17-118_p1','OP17-119_p2','OP17-118','OP17-119']);
  assert.equal(isAltArt({providerId:'OP17-118_p1'}),true);
  assert.equal(isAltArt({providerId:'20042'}),false);
});

test('卡片：寶可夢 SAR 以上（含 FUR／MUR），同稀有度參考價高的先，沒價格的排後面；最多 10 張',()=>{
  const P=(n,rarity,amount)=>({id:`p${n}`,providerId:String(n),rarity,game:'pokemon',...(amount?{referencePrice:{amount}}:{})});
  const out=prizeCards('pokemon','SAR',[P(1,'AR',50),P(2,'SAR',5),P(3,'SAR',25),P(4,'FUR'),P(5,'SAR'),P(6,'MUR'),P(7,'RR',99)]);
  assert.deepEqual(out.map(c=>c.id),['p6','p4','p3','p2','p5']);
  assert.equal(prizeCards('pokemon','SAR',Array.from({length:30},(_,i)=>P(i,'SAR'))).length,10);
});

test('卡片：參考價先比新台幣（歐元與美元混在一起時）',()=>{
  const P=(n,price)=>({id:`p${n}`,providerId:String(n),rarity:'SAR',game:'pokemon',referencePrice:price});
  assert.deepEqual(prizeCards('pokemon','SAR',[P(1,{amount:21,currency:'USD',amountTwd:672}),P(2,{amount:20,currency:'EUR',amountTwd:700})]).map(c=>c.id),['p2','p1']);
});

test('卡片：稀有度與卡號以這一彈的版本為準（跨版本合併的卡，頂層稀有度可能是別彈的）',()=>{
  const reprint={id:'r',providerId:'1',rarity:'SAR',game:'pokemon',printings:[{seriesId:'old',rarity:'SAR'},{seriesId:'new',rarity:'C',localCardNumber:'010'}]};
  const onlyPrinting={id:'p',providerId:'2',rarity:null,game:'pokemon',printings:[{seriesId:'new',rarity:'SAR',localCardNumber:'090'}]};
  assert.deepEqual(prizeCards('pokemon','SAR',[reprint,onlyPrinting],{seriesId:'new'}).map(c=>c.id),['p']);
  assert.equal(prizeRow(onlyPrinting,{id:'new'}).rarity,'SAR');
  assert.equal(prizeRow(onlyPrinting,{id:'new'}).cardNumber,'090');
});

test('卡片：黑白雙翼 SP 以上（SSP 在 SP 前），RRR 不算',()=>{
  const W=(n,rarity)=>({id:`w${n}`,providerId:String(n),rarity,game:'weiss-schwarz'});
  assert.deepEqual(prizeCards('weiss-schwarz','SP',[W(1,'SP'),W(2,'RRR'),W(3,'SSP'),W(4,'SR1')]).map(c=>c.id),['w3','w1']);
});

test('prizeRow：中文名優先、帶系列代號與異圖標記，不帶原始 metadata',()=>{
  const row=prizeRow({id:'x',game:'onepiece',nameZh:'娜美',nameEn:'Nami',providerId:'EB05-061_p1',officialCardNumber:'EB05-061',rarity:'SEC',imageUrl:'https://i/x.png',metadata:{secret:1}},{officialCode:'EB-05',nameZh:'特殊補充包'});
  assert.deepEqual(row,{cardId:'x',name:'娜美',cardNumber:'EB05-061',rarity:'SEC',altArt:true,seriesCode:'EB-05',seriesName:'特殊補充包',game:'onepiece',imageUrl:'https://i/x.png',referencePrice:null});
});

test('手動置頂清單是合法 JSON，pinned 是字串陣列',async()=>{
  const data=JSON.parse(await readFile(new URL('../data/pack-prizes.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(data.pinned)&&data.pinned.every(id=>typeof id==='string'));
});
