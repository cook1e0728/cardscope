const SOURCE_URLS={
  pokemontcg:'https://docs.pokemontcg.io/',
  ygoprodeck:'https://ygoprodeck.com/api-guide/',
  'onepiece-official':'https://asia-en.onepiece-cardgame.com/'
};

const clean=s=>String(s||'').trim();
const slug=s=>clean(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unknown';
const ymd=s=>clean(s).replaceAll('/','-').slice(0,10)||null;
const searchText=(...values)=>{
  const raw=[...new Set(values.flat(Infinity).filter(Boolean).map(clean))];
  const normalized=raw.map(v=>v.toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-]/g,''));
  return [...new Set([...raw,...normalized])].join(' ');
};
const chunks=(rows,size=150)=>Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));
const absolute=(value,base)=>value?new URL(value,base).href:null;
const decodeHtml=s=>clean(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/&#039;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/\s+/g,' ');

async function providerJson(url,{timeout=60000}={}){
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`${new URL(url).hostname}_${response.status}`);
  return response.json();
}
async function providerText(url,{timeout=60000}={}){
  const response=await fetch(url,{headers:{Accept:'text/html','Accept-Language':'en','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`${new URL(url).hostname}_${response.status}`);
  return response.text();
}

async function upsert(db,path,rows,onConflict='id'){
  let written=0;
  for(const batch of chunks(rows)){
    await db(`${path}?on_conflict=${encodeURIComponent(onConflict)}`,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(batch)});
    written+=batch.length;
  }
  return written;
}
async function startRun(db,provider,scope){
  const rows=await db('/catalog_sync_runs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify([{provider,scope,status:'running'}])});
  return rows?.[0]?.id;
}
async function finishRun(db,id,status,stats,error=null){
  if(!id)return;
  await db(`/catalog_sync_runs?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,rows_seen:stats.seen||0,rows_written:stats.written||0,cursor:stats.cursor||null,error:error?String(error).slice(0,1000):null,metadata:stats.metadata||{},finished_at:new Date().toISOString()})});
}

export function parseOnePieceProducts(html){
  const items=[],re=/<li class="linkListColBox" data-cat="([^"]+)">[\s\S]*?<a href="([^"]+)" class="linkListColItem">[\s\S]*?<img[^>]+data-src="([^"]+)"[^>]*>[\s\S]*?<h4 class="linkListColTitle">([\s\S]*?)<\/h4>[\s\S]*?<time[^>]+datetime="([^"]+)"/g;
  let m;
  while((m=re.exec(html))){const sourceUrl=absolute(m[2],SOURCE_URLS['onepiece-official']),providerId=new URL(sourceUrl).pathname.replace(/\/$/,'').split('/').pop()||String(items.length);items.push({id:`onepiece-product-${slug(providerId)}`,game_id:'onepiece',series_id:null,official_code:null,product_type:decodeHtml(m[1]),name_zh:null,name_ja:null,name_en:decodeHtml(m[4]),name_ko:null,aliases:[],region:'ASIA',language:'en',release_date:ymd(m[5]),image_url:absolute(m[3],SOURCE_URLS['onepiece-official']),image_kind:'sealed-product',source:'onepiece-official',source_url:sourceUrl,provider_id:providerId,metadata:{category:decodeHtml(m[1])},updated_at:new Date().toISOString()})}
  return items;
}

export function parseOnePieceCards(html){
  const cards=[],seen=new Set(),re=/<a class="modalOpen"[\s\S]*?data-src="([^"]*\/images\/cardlist\/card\/([^"?]+?\.png)[^"]*)"[^>]*alt="([^"]*)"[^>]*><\/a>\s*<dl[\s\S]*?<div class="infoCol">\s*<span>([^<]+)<\/span>\s*\|\s*<span>([^<]+)<\/span>\s*\|\s*<span>([^<]+)<\/span>[\s\S]*?<div class="cardName">([^<]+)<\/div>/g;
  let m;
  while((m=re.exec(html))){const number=clean(m[4]),file=clean(m[2]),providerId=file.replace(/\.png$/i,''),key=`${number}:${providerId}`;if(seen.has(key))continue;seen.add(key);cards.push({providerId,number,rarity:clean(m[5]),cardType:clean(m[6]),name:decodeHtml(m[7]),imageUrl:absolute(m[1],'https://asia-en.onepiece-cardgame.com/cardlist/'),sourceUrl:'https://asia-en.onepiece-cardgame.com/cardlist/'})}
  return cards;
}

export function parseOnePieceSeries(html){
  const rows=[],seen=new Set(),re=/<option value="(\d+)"[^>]*>([^<]+)/g;let m;
  while((m=re.exec(html))){const providerId=m[1],name=decodeHtml(m[2]),code=name.match(/\[([^\]]+)\]/)?.[1]||null;if(!code||seen.has(providerId))continue;seen.add(providerId);const productType=name.split('-')[0].replace(/<br[^>]*>/gi,'').trim()||'系列';rows.push({providerId,code,name,productType})}
  return rows;
}

async function syncPokemon(db,{maxPages=Infinity}={}){
  const provider='pokemontcg',runId=await startRun(db,provider,'catalog'),stats={seen:0,written:0,cursor:null,metadata:{}};
  try{
    const setBody=await providerJson('https://api.pokemontcg.io/v2/sets?pageSize=250&orderBy=-releaseDate');
    const series=(setBody.data||[]).map(s=>({id:`pokemon-pokemontcg-${slug(s.id)}`,game_id:'pokemon',official_code:s.ptcgoCode||s.id,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,region:'US',language:'en-US',release_date:ymd(s.releaseDate),aliases:[s.id,s.series,s.ptcgoCode].filter(Boolean),source_url:'https://www.pokemontcg.io/',image_url:s.images?.logo||null,image_kind:'series-logo',source:provider,provider_id:s.id,metadata:{printedTotal:s.printedTotal,total:s.total,symbolUrl:s.images?.symbol||null},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);
    const products=series.map(s=>({id:`pokemon-series-${slug(s.provider_id)}`,game_id:'pokemon',series_id:s.id,official_code:s.official_code,product_type:'系列',name_zh:null,name_ja:null,name_en:s.name_en,name_ko:null,aliases:s.aliases,region:'US',language:'en-US',release_date:s.release_date,image_url:s.image_url,image_kind:'series-logo',source:provider,source_url:s.source_url,provider_id:s.provider_id,metadata:s.metadata,updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_products',products);
    const seriesByProvider=new Map(series.map(s=>[s.provider_id,s.id]));let page=1,totalCount=Infinity;
    while((page-1)*250<totalCount&&page<=maxPages){
      const url=new URL('https://api.pokemontcg.io/v2/cards');url.searchParams.set('page',String(page));url.searchParams.set('pageSize','250');url.searchParams.set('select','id,name,number,rarity,images,set,supertype,subtypes,updatedAt');
      const body=await providerJson(url);const items=body.data||[];totalCount=Number(body.totalCount)||0;stats.seen+=items.length;stats.cursor=String(page);
      const cardRows=items.map(c=>({id:`pokemon-pokemontcg-${slug(c.id)}`,canonical_id:`pokemon-pokemontcg-${slug(c.id)}`,game_id:'pokemon',series_id:seriesByProvider.get(c.set?.id)||null,official_card_number:c.number||c.id,rarity:c.rarity||null,name_zh:null,name_ja:null,name_en:c.name,name_ko:null,aliases:[],source:provider,provider_id:c.id,search_text:searchText(c.name,c.number,c.id,c.set?.name,c.set?.id),metadata:{supertype:c.supertype||null,subtypes:c.subtypes||[],providerUpdatedAt:c.updatedAt||null},updated_at:new Date().toISOString()}));
      stats.written+=await upsert(db,'/tcg_cards',cardRows);
      const printingRows=items.map(c=>({card_id:`pokemon-pokemontcg-${slug(c.id)}`,series_id:seriesByProvider.get(c.set?.id)||null,region:'US',language:'en-US',local_set_code:c.set?.id||null,local_card_number:c.number||c.id,rarity:c.rarity||null,image_url:c.images?.small||null,source_url:`https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/${encodeURIComponent(c.id)}/`,release_date:ymd(c.set?.releaseDate),source:provider,provider_id:c.id,image_rehost_required:false,metadata:{imageLarge:c.images?.large||null},updated_at:new Date().toISOString()}));
      stats.written+=await upsert(db,'/tcg_printings',printingRows,'card_id,region,language,local_set_code,local_card_number');page++;
    }
    stats.metadata={sets:series.length,totalCards:totalCount,pages:page-1};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

async function syncYugioh(db){
  const provider='ygoprodeck',runId=await startRun(db,provider,'catalog'),stats={seen:0,written:0,cursor:null,metadata:{}};
  try{
    const [sets,cardsBody]=await Promise.all([providerJson('https://db.ygoprodeck.com/api/v7/cardsets.php'),providerJson('https://db.ygoprodeck.com/api/v7/cardinfo.php',{timeout:120000})]);
    const series=(sets||[]).map(s=>({id:`yugioh-ygoprodeck-${slug(s.set_code||s.set_name)}`,game_id:'yugioh',official_code:s.set_code||slug(s.set_name),name_zh:null,name_ja:null,name_en:s.set_name,name_ko:null,region:'US',language:'en-US',release_date:ymd(s.tcg_date),aliases:[s.set_code].filter(Boolean),source_url:SOURCE_URLS.ygoprodeck,image_url:s.set_image||null,image_kind:'series-logo',source:provider,provider_id:s.set_code||s.set_name,metadata:{cardsCount:Number(s.num_of_cards)||null},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);stats.written+=await upsert(db,'/tcg_products',series.map(s=>({id:`yugioh-series-${slug(s.provider_id)}`,game_id:'yugioh',series_id:s.id,official_code:s.official_code,product_type:'系列',name_zh:null,name_ja:null,name_en:s.name_en,name_ko:null,aliases:s.aliases,region:'US',language:'en-US',release_date:s.release_date,image_url:s.image_url,image_kind:'series-logo',source:provider,source_url:s.source_url,provider_id:s.provider_id,metadata:s.metadata,updated_at:new Date().toISOString()})));
    const seriesByName=new Map(series.map(s=>[s.name_en,s.id])),cards=cardsBody.data||[];stats.seen=cards.length;
    for(const batch of chunks(cards,100)){
      const cardRows=batch.map(c=>({id:`yugioh-ygoprodeck-${c.id}`,canonical_id:`yugioh-ygoprodeck-${c.id}`,game_id:'yugioh',series_id:seriesByName.get(c.card_sets?.[0]?.set_name)||null,official_card_number:String(c.id),rarity:c.card_sets?.[0]?.set_rarity||null,name_zh:null,name_ja:null,name_en:c.name,name_ko:null,aliases:[c.archetype].filter(Boolean),source:provider,provider_id:String(c.id),search_text:searchText(c.name,c.id,c.archetype,(c.card_sets||[]).flatMap(s=>[s.set_name,s.set_code])),metadata:{type:c.type||null,race:c.race||null,attribute:c.attribute||null},updated_at:new Date().toISOString()}));
      stats.written+=await upsert(db,'/tcg_cards',cardRows);
      const printings=batch.flatMap(c=>(c.card_sets||[{set_name:null,set_code:String(c.id),set_rarity:null}]).map((s,i)=>({card_id:`yugioh-ygoprodeck-${c.id}`,series_id:seriesByName.get(s.set_name)||null,region:'US',language:'en-US',local_set_code:s.set_name||'unspecified',local_card_number:s.set_code||String(c.id),rarity:s.set_rarity||null,image_url:null,source_url:`https://db.ygoprodeck.com/card/?search=${encodeURIComponent(c.name)}`,release_date:null,source:provider,provider_id:`${c.id}:${s.set_code||i}`,image_rehost_required:true,metadata:{providerImageUrl:c.card_images?.[0]?.image_url_small||null,setPriceUsd:s.set_price||null},updated_at:new Date().toISOString()})));
      stats.written+=await upsert(db,'/tcg_printings',printings,'card_id,region,language,local_set_code,local_card_number');
    }
    stats.metadata={sets:series.length,cards:cards.length,imagePolicy:'rehost-required'};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

async function syncOnePiece(db){
  const provider='onepiece-official',runId=await startRun(db,provider,'catalog'),stats={seen:0,written:0,cursor:null,metadata:{}};
  try{
    const [productsHtml,indexHtml]=await Promise.all([providerText('https://asia-en.onepiece-cardgame.com/products/'),providerText('https://asia-en.onepiece-cardgame.com/cardlist/?search=true')]),productCovers=parseOnePieceProducts(productsHtml),setOptions=parseOnePieceSeries(indexHtml),series=setOptions.map(s=>({id:`onepiece-official-${slug(s.code)}`,game_id:'onepiece',official_code:s.code,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,region:'ASIA',language:'en',release_date:null,aliases:[s.code],source_url:`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`,image_url:null,image_kind:'series-logo',source:provider,provider_id:s.providerId,metadata:{productType:s.productType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);
    const coverById=new Map(productCovers.map(p=>[p.id,p])),optionProducts=setOptions.map(s=>{const base={id:`onepiece-product-${slug(s.code)}`,game_id:'onepiece',series_id:`onepiece-official-${slug(s.code)}`,official_code:s.code,product_type:s.productType,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,aliases:[s.code],region:'ASIA',language:'en',release_date:null,image_url:null,image_kind:'series-logo',source:provider,source_url:`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`,provider_id:slug(s.code),metadata:{cardListSeriesId:s.providerId},updated_at:new Date().toISOString()},cover=coverById.get(base.id);return cover?{...base,name_en:cover.name_en||base.name_en,product_type:cover.product_type||base.product_type,release_date:cover.release_date,image_url:cover.image_url,image_kind:'sealed-product',source_url:cover.source_url,metadata:{...base.metadata,...cover.metadata}}:base}),extraCovers=productCovers.filter(p=>!optionProducts.some(x=>x.id===p.id));stats.written+=await upsert(db,'/tcg_products',[...optionProducts,...extraCovers]);
    const pages=[];for(let i=0;i<setOptions.length;i+=4){const batch=setOptions.slice(i,i+4),htmls=await Promise.all(batch.map(s=>providerText(`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`)));pages.push(...htmls);if(i+4<setOptions.length)await new Promise(resolve=>setTimeout(resolve,150))}
    const cards=[],seenCards=new Set();for(const html of pages)for(const card of parseOnePieceCards(html)){const key=card.providerId;if(seenCards.has(key))continue;seenCards.add(key);cards.push(card)}stats.seen=productCovers.length+setOptions.length+cards.length;
    const cardRows=cards.map(c=>({id:`onepiece-official-${slug(c.providerId)}`,canonical_id:`onepiece-${slug(c.number)}`,game_id:'onepiece',series_id:null,official_card_number:c.number,rarity:c.rarity||null,name_zh:null,name_ja:null,name_en:c.name,name_ko:null,aliases:[],source:provider,provider_id:c.providerId,search_text:searchText(c.name,c.number,c.rarity,c.cardType),metadata:{cardType:c.cardType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_cards',cardRows);
    const seriesByCode=new Map(series.map(s=>[s.official_code.replace('-',''),s.id])),printingRows=cards.map(c=>({card_id:`onepiece-official-${slug(c.providerId)}`,series_id:seriesByCode.get((c.number.split('-')[0]||'').replace('-',''))||null,region:'ASIA',language:'en',local_set_code:c.number.split('-')[0]||'unknown',local_card_number:c.number,rarity:c.rarity||null,image_url:c.imageUrl,source_url:c.sourceUrl,release_date:null,source:provider,provider_id:c.providerId,image_rehost_required:false,metadata:{cardType:c.cardType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_printings',printingRows,'card_id,region,language,local_set_code,local_card_number');stats.metadata={products:optionProducts.length,productCovers:productCovers.length,sets:series.length,cards:cards.length};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

export async function shouldSyncCatalog(db,maxAgeHours=72){
  const cutoff=new Date(Date.now()-maxAgeHours*3600000).toISOString(),rows=await db(`/catalog_sync_runs?select=id&status=eq.completed&started_at=gte.${encodeURIComponent(cutoff)}&limit=1`);return !rows?.length;
}

export async function syncCatalog(db,{providers=['pokemon','onepiece','yugioh'],maxPokemonPages=Infinity}={}){
  const results={};
  for(const provider of providers){try{results[provider]=provider==='pokemon'?await syncPokemon(db,{maxPages:maxPokemonPages}):provider==='onepiece'?await syncOnePiece(db):await syncYugioh(db)}catch(error){results[provider]={error:error.message}}}
  return results;
}
