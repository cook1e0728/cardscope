// 價格時間軸上標示的市場事件：只收查得到官方來源的整個遊戲層級事件，手動維護，不是針對單張卡，也不代表造成漲跌。
export const MARKET_EVENTS=[
  {date:'2026-10-24',game:'pokemon',title:'Mega Evolution—Delta Reign 發售前活動開始',source:'Pokémon 官方',url:'https://www.pokemon.com/us/news/play-at-a-pokemon-tcg-mega-evolution-delta-reign-prerelease-event'},
  {date:'2026-11-06',game:'pokemon',title:'Mega Evolution—Delta Reign 英文版發售',source:'Pokémon 官方',url:'https://www.pokemon.com/us/pokemon-tcg/mega-evolution-delta-reign'}
];
const UPCOMING_DAYS=45;
export function marketEventsFor(game,from,now=Date.now()){const until=new Date(now+UPCOMING_DAYS*86400000).toISOString().slice(0,10);return MARKET_EVENTS.filter(event=>event.game===game&&event.date>=from&&event.date<=until)}
