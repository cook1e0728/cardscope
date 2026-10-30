// 時事：手動維護的官方消息（整個遊戲層級），加上目錄裡的新系列發售日。都不是針對單張卡，也不代表造成漲跌。
export const MARKET_EVENTS=[
  {date:'2026-10-24',game:'pokemon',title:'Mega Evolution—Delta Reign 發售前活動開始',source:'Pokémon 官方',url:'https://www.pokemon.com/us/news/play-at-a-pokemon-tcg-mega-evolution-delta-reign-prerelease-event'},
  {date:'2026-11-06',game:'pokemon',title:'Mega Evolution—Delta Reign 英文版發售',source:'Pokémon 官方',url:'https://www.pokemon.com/us/pokemon-tcg/mega-evolution-delta-reign'}
];
const UPCOMING_DAYS=45,REGIONS={JP:'日版',US:'美版',TW:'台版',ASIA:'亞洲版'};
// game 為 null 時回傳所有遊戲
export function marketEventsFor(game,from,now=Date.now()){const until=new Date(now+UPCOMING_DAYS*86400000).toISOString().slice(0,10);return MARKET_EVENTS.filter(event=>(!game||event.game===game)&&event.date>=from&&event.date<=until)}
// 目錄列 → 事件；沒有 https 來源或名稱的不列，不顯示查不到出處的事件。
export function catalogEventsFrom(rows){
  const events=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const date=String(row?.release_date||'').slice(0,10),name=String(row?.name_zh||row?.name_ja||row?.name_en||'').replace(/^[^｜]+｜/,'').trim();let host='';
    try{const url=new URL(row?.source_url);if(url.protocol==='https:')host=url.hostname.replace(/^www\./,'')}catch{}
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&name&&host&&row.game_id)events.push({date,game:row.game_id,title:`${REGIONS[row.region]||''}${REGIONS[row.region]?' ':''}新系列發售：${name}`,source:host,url:row.source_url});
  }
  return events;
}
export const mergeMarketEvents=(...lists)=>{const seen=new Set();return lists.flat().filter(event=>{const key=`${event.game}|${event.date}|${event.title}`;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)};
