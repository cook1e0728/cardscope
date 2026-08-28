import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
  yuyutei: { enabled:false, capability:'等待官方合作／資料授權' },
  reportsDb: { enabled:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY), capability:'使用者回報成交價（Supabase）' },
  yuyuteiScraper: { enabled:Boolean(process.env.SCRAPE_SECRET), capability:'遊々亭買取行情爬蟲（需手動/排程觸發）' }
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

// ---------- 使用者回報成交價（存在 Supabase，避免重新部署就歸零）----------
const ALLOWED_PLATFORMS = ['卡拍拍','露天拍賣','蝦皮購物','露天/蝦皮以外的台灣賣場','其他'];
const ALLOWED_CURRENCIES = ['TWD','USD','JPY','EUR'];
const MAX_PRICE = 5000000;
const reportRateLimit = new Map(); // hashedIp -> timestamps[]

// 回傳給前端的欄位固定用這個別名清單，維持跟舊版檔案儲存時一模一樣的 JSON 格式，
// 這樣 index.html 完全不用改。
const PUBLIC_SELECT = 'id,cardName:card_name,cardId:card_id,game,platform,currency,price,condition,note,tradedAt:traded_at,createdAt:created_at,status';

function supabaseConfigured(){
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function supabaseFetch(pathAndQuery, options = {}){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const response = await fetch(`${url}/rest/v1${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if(!response.ok){
    const text = await response.text().catch(()=> '');
    throw new Error(`SUPABASE_${response.status}:${text.slice(0,200)}`);
  }
  if(response.status === 204) return null;
  return response.json();
}

function hashIp(ip){
  return createHash('sha256').update(String(ip)).digest('hex').slice(0,16);
}
function clientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  if(fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function isRateLimited(ip){
  const key = hashIp(ip);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 小時
  const maxPerWindow = 5;
  const timestamps = (reportRateLimit.get(key) || []).filter(t => now - t < windowMs);
  if(timestamps.length >= maxPerWindow){
    reportRateLimit.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  reportRateLimit.set(key, timestamps);
  return false;
}

function readJsonBody(req, maxBytes = 10_000){
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if(size > maxBytes){
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if(chunks.length === 0) return resolve({});
      try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch{ reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function validateReport(body){
  const errors = [];
  const cardName = String(body.cardName || '').trim();
  const cardId = body.cardId ? String(body.cardId).trim() : null;
  const game = body.game ? String(body.game).trim() : null;
  const platform = String(body.platform || '').trim();
  const currency = String(body.currency || 'TWD').trim().toUpperCase();
  const price = Number(body.price);
  const condition = body.condition ? String(body.condition).trim().slice(0, 40) : null;
  const note = body.note ? String(body.note).trim().slice(0, 200) : null;
  const tradedAtRaw = body.tradedAt ? String(body.tradedAt).trim() : null;

  if(!cardName || cardName.length > 100) errors.push('請提供卡片名稱（1-100 字元）');
  if(!ALLOWED_PLATFORMS.includes(platform)) errors.push(`platform 必須是以下其中之一：${ALLOWED_PLATFORMS.join('、')}`);
  if(!ALLOWED_CURRENCIES.includes(currency)) errors.push(`currency 必須是以下其中之一：${ALLOWED_CURRENCIES.join('、')}`);
  if(!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) errors.push(`price 必須是大於 0 且不超過 ${MAX_PRICE} 的數字`);

  let tradedAt = new Date().toISOString();
  if(tradedAtRaw){
    const d = new Date(tradedAtRaw);
    if(isNaN(d.getTime())) errors.push('tradedAt 日期格式不正確');
    else if(d.getTime() > Date.now() + 24*60*60*1000) errors.push('tradedAt 不能是未來日期');
    else tradedAt = d.toISOString();
  }

  if(errors.length) return { valid:false, errors };
  return { valid:true, value:{ cardName, cardId, game, platform, currency, price, condition, note, tradedAt } };
}

function median(nums){
  const s = [...nums].sort((a,b)=>a-b);
  const mid = Math.floor(s.length/2);
  return s.length % 2 ? s[mid] : (s[mid-1]+s[mid]) / 2;
}

function buildStats(rows){
  const byCurrency = {};
  for(const r of rows){
    if(!byCurrency[r.currency]) byCurrency[r.currency] = [];
    byCurrency[r.currency].push(Number(r.price));
  }
  const stats = {};
  for(const [currency, prices] of Object.entries(byCurrency)){
    stats[currency] = {
      count: prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      median: median(prices),
      avg: Math.round((prices.reduce((a,b)=>a+b,0) / prices.length) * 100) / 100
    };
  }
  return stats;
}

async function insertReport(record){
  const rows = await supabaseFetch('/reports?select=' + encodeURIComponent(PUBLIC_SELECT), {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([record])
  });
  return rows[0];
}

async function fetchReportsForStats({ cardId, cardName, game }){
  // 這支只拿 currency/price，用來算統計，不需要別名，減少資料量
  const params = new URLSearchParams({ select:'currency,price' });
  if(cardId) params.set('card_id', `eq.${cardId}`);
  else if(cardName) params.set('card_name', `ilike.*${cardName}*`);
  if(game) params.set('game', `eq.${game}`);
  return supabaseFetch(`/reports?${params.toString()}`);
}

async function fetchRecentReports({ cardId, cardName, game, limit }){
  const params = new URLSearchParams({ select:PUBLIC_SELECT, order:'traded_at.desc', limit:String(limit) });
  if(cardId) params.set('card_id', `eq.${cardId}`);
  else if(cardName) params.set('card_name', `ilike.*${cardName}*`);
  if(game) params.set('game', `eq.${game}`);
  return supabaseFetch(`/reports?${params.toString()}`);
}

// ---------- 遊々亭買取行情爬蟲 ----------
// 只接受 yuyu-tei.jp/buy/ 開頭的買取頁網址，例如 https://yuyu-tei.jp/buy/poc/s/m06
// 頻率請自行控制在一天 1-2 次，不要短時間內大量呼叫。
async function scrapeYuyutei(targetUrl){
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CardScopeBot/1.0; +https://cardscope.onrender.com)' }
  });
  if(!res.ok) throw new Error(`FETCH_${res.status}`);
  const html = await res.text();

  const setTitleMatch = html.match(/<h3 class="fw-bold py-3">\s*<span class="line1"><\/span>\s*([^<]+)<\/h3>/);
  const setTitle = setTitleMatch ? setTitleMatch[1].trim() : null;

  const gameMatch = targetUrl.match(/\/buy\/([a-z0-9]+)\//i);
  const game = gameMatch ? gameMatch[1] : 'unknown';

  // 依出現順序把「稀有度標題」跟「卡片區塊」混在一起排序，
  // 這樣就能知道每張卡屬於哪個稀有度分組。
  const tokens = [];
  const rarityRe = /<span class="py-2 d-inline-block px-2 me-2 text-white fw-bold">([^<]+)<\/span>\s*Card List/g;
  let m;
  while((m = rarityRe.exec(html))) tokens.push({ type:'rarity', index:m.index, value:m[1].trim() });

  const cardRe = /<div class="card-product position-relative mt-4[^"]*"/g;
  while((m = cardRe.exec(html))) tokens.push({ type:'card', index:m.index });

  tokens.sort((a,b)=>a.index-b.index);

  const cards = [];
  let currentRarity = null;
  for(let i=0;i<tokens.length;i++){
    const t = tokens[i];
    if(t.type==='rarity'){ currentRarity = t.value; continue; }

    const end = i+1<tokens.length ? tokens[i+1].index : Math.min(html.length, t.index+3000);
    const chunk = html.slice(t.index, end);

    const verMatch = chunk.match(/value="([^"]+)" class="cart_ver"/);
    const cidMatch = chunk.match(/value="([^"]+)" class="cart_cid"/);
    const numberMatch = chunk.match(/text-center my-2">([^<]+)<\/span>/);
    const nameMatch = chunk.match(/text-primary fw-bold">([^<]+)<\/h4>/);
    const priceMatch = chunk.match(/<strong class="d-block text-end[^"]*">\s*([\d,]+)\s*円/);
    const oldPriceMatch = chunk.match(/<del>\s*([\d,]+)\s*円\s*<\/del>/);

    if(!verMatch || !cidMatch || !priceMatch) continue; // 結構跟預期不符就跳過這張，不讓整批失敗

    cards.push({
      setCode: verMatch[1],
      cardCode: cidMatch[1],
      number: numberMatch ? numberMatch[1].trim() : null,
      name: nameMatch ? nameMatch[1].trim() : null,
      rarity: currentRarity,
      price: Number(priceMatch[1].replace(/,/g,'')),
      previousPrice: oldPriceMatch ? Number(oldPriceMatch[1].replace(/,/g,'')) : null,
      cardUrl: `https://yuyu-tei.jp/buy/${game}/card/${verMatch[1]}/${cidMatch[1]}`,
      imageUrl: `https://card.yuyu-tei.jp/${game}/100_140/${verMatch[1]}/${cidMatch[1]}.jpg`
    });
  }

  return { game, setTitle, cards };
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

  // ---- 使用者回報成交價 ----
  if (url.pathname === '/api/reports/meta') {
    return json(res,200,{data:{ platforms:ALLOWED_PLATFORMS, currencies:ALLOWED_CURRENCIES, maxPrice:MAX_PRICE }});
  }

  if (url.pathname === '/api/reports' && req.method === 'POST') {
    if(!supabaseConfigured()){
      return json(res,503,{error:'尚未設定資料庫（SUPABASE_URL / SUPABASE_SERVICE_KEY）'});
    }
    if(isRateLimited(clientIp(req))){
      return json(res,429,{error:'回報太頻繁了，請稍後再試（每小時最多 5 次）'});
    }
    let body;
    try{ body = await readJsonBody(req); }
    catch(error){ return json(res, error.message==='BODY_TOO_LARGE'?413:400, {error: error.message==='BODY_TOO_LARGE'?'內容過長':'JSON 格式錯誤'}); }

    const result = validateReport(body);
    if(!result.valid) return json(res,400,{error:'資料驗證失敗',details:result.errors});

    const record = {
      card_name: result.value.cardName,
      card_id: result.value.cardId,
      game: result.value.game,
      platform: result.value.platform,
      currency: result.value.currency,
      price: result.value.price,
      condition: result.value.condition,
      note: result.value.note,
      traded_at: result.value.tradedAt,
      reporter_hash: hashIp(clientIp(req)),
      status: 'unverified'
    };

    try{
      const saved = await insertReport(record);
      return json(res,201,{data:saved});
    }catch(error){
      console.error('寫入 Supabase 失敗：', error.message);
      return json(res,502,{error:'資料庫寫入失敗，請稍後再試'});
    }
  }

  if (url.pathname === '/api/reports' && req.method === 'GET') {
    if(!supabaseConfigured()){
      return json(res,503,{error:'尚未設定資料庫（SUPABASE_URL / SUPABASE_SERVICE_KEY）'});
    }
    const cardId = url.searchParams.get('cardId');
    const cardName = url.searchParams.get('cardName');
    const game = url.searchParams.get('game') || null;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);

    if(!cardId && !cardName){
      return json(res,400,{error:'請提供 cardId 或 cardName 其中一個查詢參數'});
    }

    try{
      const [statsRows, recentRows] = await Promise.all([
        fetchReportsForStats({ cardId, cardName, game }),
        fetchRecentReports({ cardId, cardName, game, limit })
      ]);
      return json(res,200,{ data:{ reports: recentRows, stats: buildStats(statsRows), total: statsRows.length } });
    }catch(error){
      console.error('查詢 Supabase 失敗：', error.message);
      return json(res,502,{error:'資料庫查詢失敗，請稍後再試'});
    }
  }

  // ---- 遊々亭爬蟲觸發（受保護） ----
  if (url.pathname === '/api/admin/scrape/yuyutei' && (req.method === 'POST' || req.method === 'GET')) {
    const token = req.headers['x-scrape-token'] || url.searchParams.get('token');
    if(!process.env.SCRAPE_SECRET || token !== process.env.SCRAPE_SECRET){
      return json(res,401,{error:'未授權，請帶正確的 x-scrape-token'});
    }
    if(!supabaseConfigured()) return json(res,503,{error:'尚未設定資料庫'});

    let targetUrl = url.searchParams.get('url');
    if(req.method==='POST'){
      try{ const body = await readJsonBody(req); targetUrl = body.url || targetUrl; }
      catch{ return json(res,400,{error:'JSON 格式錯誤'}); }
    }
    if(!targetUrl || !targetUrl.startsWith('https://yuyu-tei.jp/buy/')){
      return json(res,400,{error:'請提供合法的 yuyu-tei.jp 買取頁網址，例如 https://yuyu-tei.jp/buy/poc/s/m06'});
    }

    try{
      const { game, setTitle, cards } = await scrapeYuyutei(targetUrl);
      if(cards.length===0){
        return json(res,200,{data:{message:'頁面解析成功但沒抓到任何卡片，可能是網站改版了，需要檢查解析規則', game, setTitle, count:0}});
      }

      const rows = cards.map(c=>({
        source:'yuyutei', game, set_code:c.setCode, set_name:setTitle, card_code:c.cardCode,
        card_number:c.number, rarity:c.rarity, card_name:c.name, price:c.price,
        previous_price:c.previousPrice, currency:'JPY', card_url:c.cardUrl, image_url:c.imageUrl,
        scraped_at:new Date().toISOString()
      }));

      const chunkSize = 200;
      for(let i=0;i<rows.length;i+=chunkSize){
        await supabaseFetch('/jp_buyback_prices?on_conflict=source,game,set_code,card_code', {
          method:'POST',
          headers:{ Prefer:'resolution=merge-duplicates' },
          body: JSON.stringify(rows.slice(i,i+chunkSize))
        });
      }

      return json(res,200,{data:{message:'抓取並存檔成功', game, setTitle, count:rows.length}});
    }catch(error){
      console.error('遊々亭抓取失敗：', error.message);
      return json(res,502,{error:`抓取失敗：${error.message}`});
    }
  }

  // ---- 查詢已存的日版買取行情（公開，供前台之後使用）----
  if (url.pathname === '/api/jp-prices' && req.method === 'GET') {
    if(!supabaseConfigured()) return json(res,503,{error:'尚未設定資料庫'});
    const cardName = url.searchParams.get('cardName');
    const game = url.searchParams.get('game');
    if(!cardName) return json(res,400,{error:'請提供 cardName'});

    const select = 'cardName:card_name,cardCode:card_code,rarity,price,previousPrice:previous_price,currency,cardUrl:card_url,imageUrl:image_url,setName:set_name,scrapedAt:scraped_at';
    const params = new URLSearchParams({ select, card_name:`ilike.*${cardName}*`, order:'scraped_at.desc', limit:'20' });
    if(game) params.set('game', `eq.${game}`);

    try{
      const rows = await supabaseFetch(`/jp_buyback_prices?${params.toString()}`);
      return json(res,200,{data:rows});
    }catch(error){
      return json(res,502,{error:'查詢失敗，請稍後再試'});
    }
  }

  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) return json(res,403,{error:'Forbidden'});
  try { const content=await readFile(file); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(content); }
  catch { json(res,404,{error:'Not found'}); }
}).listen(port, () => console.log(`CardScope is running at http://localhost:${port}`));
