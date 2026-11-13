// 首頁「最夯＝本彈大獎」（docs/AGENT_BATON.md 2026-11-13 提案）：每個主流遊戲取近 90 天最新的主流補充包，列出最高稀有度的卡。
// 只有挑選規則，沒有 I/O；server.mjs 的 loadPackPrizes 負責讀卡與快取。
import {DECK_RE,ACCESSORY_RE,PROMO_RE} from './products.mjs';
import {rarityRank} from './normalize.mjs';

export const PACK_PRIZE_WINDOW_DAYS=90,PACK_PRIZE_LIMIT=10;
// top：這個稀有度（含）以上才算大獎，排名依 data/rarity-rankings.json。code：只收這些系列代號（航海王只看 OP／EB／PRB）。
export const PACK_PRIZE_GAMES=Object.freeze([
  {game:'pokemon',top:'SAR'},
  {game:'onepiece',top:'SEC',code:/^(?:OP|EB|PRB)-?\d/i},
  {game:'weiss-schwarz',top:'SP'}
]);
// 台灣版有中文名與卡圖，排第一；美版不收（台灣玩家買的是亞洲版）。
const REGION_ORDER=['TW','JP','ASIA'];
const NOT_MAIN=new RegExp([DECK_RE,ACCESSORY_RE,PROMO_RE].map(re=>re.source).join('|'),'i');
const names=s=>[s.nameZh,s.nameJa,s.nameEn].filter(Boolean).join(' ');
const sameRelease=(a,b)=>a.officialCode&&b.officialCode?String(a.officialCode).toUpperCase()===String(b.officialCode).toUpperCase():a.id===b.id;

// 近期主流的「彈」，新到舊；每一彈是它已發售的各版本（台灣→日本→亞洲），呼叫端依序試，台版缺卡時退回同彈日版。
// 只要有一個版本在近 windowDays 天內發售就算近期；排序看這一彈最早的發售日（台版常比日版晚幾個月）。
// 名稱檢查看同代號的所有版本（不限地區與日期）：任一版本像預組／周邊／特典就整彈排除（台版名稱常沒寫「牌組」）。
export function prizeSeriesCandidates(series,{game,code}={},today=new Date().toISOString().slice(0,10),windowDays=PACK_PRIZE_WINDOW_DAYS){
  const since=new Date(Date.parse(today)-windowDays*86400000).toISOString().slice(0,10);
  const mine=(series||[]).filter(s=>s?.game===game),out=s=>REGION_ORDER.includes(s.region)&&s.releaseDate&&s.releaseDate<=today;
  const releases=[];
  for(const s of mine){
    if(!out(s)||s.releaseDate<since||releases.some(r=>sameRelease(r[0],s)))continue;
    const family=mine.filter(o=>sameRelease(o,s));
    if(family.some(o=>NOT_MAIN.test(names(o)))||(code&&!code.test(String(s.officialCode||''))))continue;
    releases.push(family.filter(out).sort((x,y)=>REGION_ORDER.indexOf(x.region)-REGION_ORDER.indexOf(y.region)));
  }
  const debut=r=>r.map(o=>o.releaseDate).sort()[0];
  return releases.sort((a,b)=>debut(b).localeCompare(debut(a))||String(a[0].id).localeCompare(String(b[0].id)));
}

// 航海王異圖：官方卡號後面帶 _p1、_p2…（同卡號、稀有度不變）。
export const isAltArt=card=>/_p\d+$/i.test(String(card?.providerId||''));
// 先比新台幣（歐元與美元參考價混在一起時才可比），沒有匯率時才比原幣。
const priceOf=card=>Number(card?.referencePrice?.amountTwd)||Number(card?.referencePrice?.amount)||0;
// 同一張卡（跨版本合併）在這一彈的版本：稀有度、卡號以它為準（重印可能比頂層稀有度低）。
const inSeries=(card,seriesId)=>(seriesId&&card?.printings?.find(p=>p?.seriesId===seriesId))||{};
const rarityIn=(card,seriesId)=>inSeries(card,seriesId).rarity||card?.rarity;

// 稀有度（含）top 以上的卡：稀有度高的先，同稀有度異圖在原版前，再依參考價高到低（新彈常沒價格，只當次要），最後依卡號。
export function prizeCards(game,top,cards,{seriesId=null,limit=PACK_PRIZE_LIMIT}={}){
  const max=rarityRank(game,top),rank=card=>rarityRank(game,rarityIn(card,seriesId));
  return (cards||[]).filter(card=>card?.id&&rank(card)<=max)
    .sort((a,b)=>rank(a)-rank(b)||isAltArt(b)-isAltArt(a)||priceOf(b)-priceOf(a)||String(a.providerId||a.id).localeCompare(String(b.providerId||b.id),'en',{numeric:true}))
    .slice(0,limit);
}

// 給前端的精簡卡片列（跟 /api/hot-cards 同一組欄位，再加稀有度、異圖、參考價）。
export function prizeRow(card,series){
  const here=inSeries(card,series?.id);
  return {cardId:card.id,name:card.nameZh||card.nameJa||card.nameEn||card.officialCardNumber||card.id,cardNumber:card.officialCardNumber||here.localCardNumber||null,
    rarity:rarityIn(card,series?.id)||null,altArt:isAltArt(card),seriesCode:series?.officialCode||null,seriesName:series?.nameZh||series?.nameJa||series?.nameEn||null,
    game:card.game||series?.game||null,imageUrl:card.imageUrl||null,referencePrice:card.referencePrice||null};
}
