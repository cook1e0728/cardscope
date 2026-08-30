const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
const nativeFetch = globalThis.fetch;
const fetch = (url, options={}) => nativeFetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)});

function numeric(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function searchYgoProDeck(query,{limit=10}={}){
  const q=String(query||'').trim();
  if(q.length<2) throw new Error('YGOPRODECK_QUERY_TOO_SHORT');
  const key=`${q.toLowerCase()}:${limit}`;
  const hit=cache.get(key);
  if(hit&&hit.expiresAt>Date.now()) return hit.data;

  const url=new URL('https://db.ygoprodeck.com/api/v7/cardinfo.php');
  url.searchParams.set('fname',q);
  url.searchParams.set('num',String(Math.min(Math.max(Number(limit)||10,1),20)));
  url.searchParams.set('offset','0');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'CardScope/1.0'}});
  if(!response.ok){
    if(response.status===400) return [];
    throw new Error(`YGOPRODECK_${response.status}`);
  }
  const body=await response.json();
  const data=(body.data||[]).map(card=>({
    provider:'ygoprodeck',
    game:'yugioh',
    providerCardId:String(card.id),
    name:card.name,
    type:card.type||null,
    race:card.race||null,
    attribute:card.attribute||null,
    archetype:card.archetype||null,
    description:card.desc||null,
    imageUrl:card.card_images?.[0]?.image_url_small||null,
    imageRehostRequired:true,
    sets:(card.card_sets||[]).map(set=>({
      setName:set.set_name||null,
      setCode:set.set_code||null,
      rarity:set.set_rarity||null,
      setPriceUsd:numeric(set.set_price)
    })),
    referencePrices:{
      cardmarketEur:numeric(card.card_prices?.[0]?.cardmarket_price),
      tcgplayerUsd:numeric(card.card_prices?.[0]?.tcgplayer_price),
      ebayUsd:numeric(card.card_prices?.[0]?.ebay_price),
      amazonUsd:numeric(card.card_prices?.[0]?.amazon_price),
      coolstuffincUsd:numeric(card.card_prices?.[0]?.coolstuffinc_price)
    },
    priceType:'market',
    priceNote:'YGOPRODeck 回傳各平台跨版本最低參考價；不是 CardScope 驗證成交價。',
    observedAt:new Date().toISOString()
  }));
  cache.set(key,{data,expiresAt:Date.now()+CACHE_MS});
  return data;
}

