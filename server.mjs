import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);

// Demo records have the same shape expected from approved provider adapters.
// Never treat a listing price as a completed sale in production.
const cards = [
  { id:'pokemon-mew-ex-sv4a-347', game:'pokemon', gameName:'寶可夢', tag:'寶可夢 · 日文 · S', name:'Mew ex', code:'SV4a 347/190 · Shiny Treasure ex · SSR', median:'NT$ 3,680', listing:'NT$ 3,450', movement:'▲ 8.4% · 30 日', sales:126, range:'3,250–3,550', rows:[['卡拍拍','台灣 · 掛牌','掛牌','3,450'],['SNKRDUNK','日本 · 最近成交','成交','3,620'],['eBay','全球 · 最近成交','成交','3,780'],['遊々亭','日本 · 店家售價','店售','3,910']] },
  { id:'yugioh-dark-magician-girl-qccu', game:'yugioh', gameName:'遊戲王', tag:'遊戲王 · 日文 · QCSE', name:'黑魔導女孩', code:'QCCU-JP002 · QUARTER CENTURY UNITY', median:'NT$ 8,920', listing:'NT$ 8,600', movement:'▲ 3.1% · 30 日', sales:48, range:'8,300–8,750', rows:[['卡拍拍','台灣 · 掛牌','掛牌','8,600'],['SNKRDUNK','日本 · 最近成交','成交','8,770'],['eBay','全球 · 最近成交','成交','9,050'],['遊々亭','日本 · 店家售價','店售','9,240']] },
  { id:'onepiece-luffy-op05-119', game:'onepiece', gameName:'航海王', tag:'航海王 · 日文 · SP', name:'蒙其·D·魯夫', code:'OP05-119 · 新時代主角 · SEC', median:'NT$ 12,450', listing:'NT$ 12,100', movement:'▼ 2.6% · 30 日', sales:72, range:'11,800–12,400', rows:[['卡拍拍','台灣 · 掛牌','掛牌','12,100'],['SNKRDUNK','日本 · 最近成交','成交','12,280'],['eBay','全球 · 最近成交','成交','12,590'],['遊々亭','日本 · 店家售價','店售','12,800']] }
];
const portfolio = { marketValue:124580, unrealizedProfit:18240, trackedCards:42, currency:'TWD' };
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const json = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
let ebayToken = { value:null, expiresAt:0 };
const justTcgCache = new Map();
const providerStatus = () => ({
  justtcg: { enabled:Boolean(process.env.JUSTTCG_API_KEY), capability:'目錄、品相與市場價格（Pokémon／遊戲王／航海王）' },
  ebay: { enabled:Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET), capability:'官方 Browse API：在售掛牌' },
  tcgplayer: { enabled:Boolean(process.env.TCGPLAYER_PUBLIC_KEY && process.env.TCGPLAYER_PRIVATE_KEY), capability:'官方目錄與市場價格' },
  kapaipai: { enabled:false, capability:'等待官方合作／資料授權' },
  snkrdunk: { enabled:false, capability:'等待官方合作／資料授權' },
  yuyutei: { enabled:false, capability:'等待官方合作／資料授權' }
});
async function getEbayToken(){
  if (ebayToken.value && Date.now() < ebayToken.expiresAt) return ebayToken.value;
  const id=process.env.EBAY_CLIENT_ID, secret=process.env.EBAY_CLIENT_SECRET;
  if(!id || !secret) throw new Error('EBAY_NOT_CONFIGURED');
  const auth=Buffer.from(`${id}:${secret}`).toString('base64');
  const response=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'});
  if(!response.ok) throw new Error(`EBAY_AUTH_${response.status}`);
  const body=await response.json(); ebayToken={value:body.access_token,expiresAt:Date.now()+Math.max(60,body.expires_in-60)*1000}; return ebayToken.value;
}
async function searchEbay(query){
  const token=await getEbayToken();
  const url=new URL('https://api.ebay.com/buy/browse/v1/item_summary/search'); url.searchParams.set('q',query);url.searchParams.set('limit','10');
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US'}});
  if(!response.ok) throw new Error(`EBAY_SEARCH_${response.status}`);
  const body=await response.json();
  return (body.itemSummaries || []).map(item=>({source:'eBay',type:'掛牌',title:item.title,price:item.price?.value,currency:item.price?.currency,condition:item.condition,url:item.itemWebUrl,image:item.image?.imageUrl,shipping:item.shippingOptions?.[0]?.shippingCost}));
}
async function justTcg(path, params={}){
  const key=process.env.JUSTTCG_API_KEY;
  if(!key) throw new Error('JUSTTCG_NOT_CONFIGURED');
  const url=new URL(`https://api.justtcg.com/v1${path}`);
  for(const [name,value] of Object.entries(params)) if(value) url.searchParams.set(name,value);
  const cacheKey=url.toString(), cached=justTcgCache.get(cacheKey);
  if(cached && cached.expiresAt>Date.now()) return cached.data;
  const response=await fetch(url,{headers:{'x-api-key':key}});
  if(!response.ok) throw new Error(`JUSTTCG_${response.status}`);
  const data=await response.json(); justTcgCache.set(cacheKey,{data,expiresAt:Date.now()+5*60*1000}); return data;
}

createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/providers') return json(res,200,{data:providerStatus()});
  if (url.pathname === '/api/providers/justtcg/games') { try{return json(res,200,await justTcg('/games'))}catch(error){return json(res,error.message==='JUSTTCG_NOT_CONFIGURED'?503:502,{error:error.message==='JUSTTCG_NOT_CONFIGURED'?'尚未設定 JustTCG API Key':`JustTCG 連線失敗：${error.message}`})} }
  if (url.pathname === '/api/providers/justtcg/search') { const q=(url.searchParams.get('q')||'').trim(), game=url.searchParams.get('game')||''; if(q.length<2)return json(res,400,{error:'請輸入至少兩個字元'}); const games=new Set(['pokemon','pokemon-japan','yugioh','one-piece-card-game']); if(game&&!games.has(game))return json(res,400,{error:'不支援的遊戲分類'}); try{return json(res,200,await justTcg('/cards',{q,game,limit:'10',priceHistoryDuration:'30d'}))}catch(error){return json(res,502,{error:`JustTCG 連線失敗：${error.message}`})} }
  if (url.pathname === '/api/providers/justtcg/cards') { const cardId=url.searchParams.get('cardId'); if(!cardId)return json(res,400,{error:'請提供 cardId'}); try{return json(res,200,await justTcg('/cards',{cardId,priceHistoryDuration:'30d'}))}catch(error){return json(res,error.message==='JUSTTCG_NOT_CONFIGURED'?503:502,{error:error.message==='JUSTTCG_NOT_CONFIGURED'?'尚未設定 JustTCG API Key':`JustTCG 連線失敗：${error.message}`})} }
  if (url.pathname === '/api/providers/ebay/search') { const q=(url.searchParams.get('q')||'').trim(); if(!q) return json(res,400,{error:'請提供 q 搜尋字詞'}); try{return json(res,200,{data:await searchEbay(q)})}catch(error){return json(res,error.message==='EBAY_NOT_CONFIGURED'?503:502,{error:error.message==='EBAY_NOT_CONFIGURED'?'尚未設定 eBay API 金鑰':`eBay 連線失敗：${error.message}`})} }
  if (url.pathname === '/api/cards') return json(res,200,{data:cards});
  if (url.pathname === '/api/search') { const q=(url.searchParams.get('q')||'').trim().toLowerCase(); return json(res,200,{data:cards.filter(c=>!q||Object.values(c).join(' ').toLowerCase().includes(q))}); }
  if (url.pathname.startsWith('/api/cards/')) { const card=cards.find(c=>c.id===decodeURIComponent(url.pathname.slice(11))); return card ? json(res,200,{data:card}) : json(res,404,{error:'找不到這張卡'}); }
  if (url.pathname === '/api/portfolio') return json(res,200,{data:portfolio});
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) return json(res,403,{error:'Forbidden'});
  try { const content=await readFile(file); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(content); }
  catch { json(res,404,{error:'Not found'}); }
}).listen(port, () => console.log(`CardScope is running at http://localhost:${port}`));
