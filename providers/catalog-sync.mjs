const SOURCE_URLS={
  pokemontcg:'https://docs.pokemontcg.io/',
  tcgdex:'https://tcgdex.dev/',
  ygoprodeck:'https://ygoprodeck.com/api-guide/',
  'onepiece-official':'https://asia-en.onepiece-cardgame.com/',
  'onepiece-official-tw':'https://asia-tc.onepiece-cardgame.com/'
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
const PRODUCT_ZH=new Map(Object.entries({'Scarlet & Violet':'朱／紫','Paldea Evolved':'帕底亞進化','Obsidian Flames':'黑曜火焰','Paradox Rift':'悖謬裂谷','Paldean Fates':'帕底亞命運','Temporal Forces':'時空力量','Twilight Masquerade':'暮夜假面','Shrouded Fable':'迷霧傳說','Stellar Crown':'星晶王冠','Surging Sparks':'奔湧火花','Prismatic Evolutions':'稜彩進化','Journey Together':'並肩同行','Destined Rivals':'宿命勁敵','White Flare':'白色火焰','Black Bolt':'黑色雷霆','Mega Evolution':'超級進化','Phantasmal Flames':'幻影火焰','Perfect Order':'完美秩序','Chaos Rising':'混沌崛起','Pitch Black':'漆黑','Sword & Shield':'劍／盾','ROMANCE DAWN':'浪漫黎明','Paramount War':'頂上戰爭','Pillars of Strength':'強大之敵','Kingdoms of Intrigue':'謀略王國','Awakening of the New Era':'新時代的主角','Wings of Captain':'船長之翼','500 Years in the Future':'500 年後的未來','Two Legends':'雙璧霸王','Emperors in the New World':'新世界的四皇','Royal Blood':'王族血統','A Fist of Divine Speed':'神速的一拳','The Three Captains':'三船長','The Three Brothers Bond':'三兄弟的羈絆','Straw Hat Crew':'草帽一夥','Worst Generation':'極惡世代','The Navy':'海軍','Animal Kingdom Pirates':'百獸海賊團','The Seven Warlords of the Sea':'王下七武海','Big Mom Pirates':'BIG MOM 海賊團'}));
const TYPE_ZH={pokemon:'寶可夢系列',yugioh:'遊戲王系列',onepiece:'航海王系列','BOOSTER PACK':'補充包','EXTRA BOOSTER':'額外補充包','PREMIUM BOOSTER':'高級補充包','STARTER DECK':'起始牌組','STARTER DECK EX':'起始牌組 EX','ULTIMATE DECK':'終極牌組',boosters:'補充包',others:'周邊產品'};
export function localizeProductName(game,name,productType){const original=clean(name),exact=PRODUCT_ZH.get(original);if(exact)return exact;let translated=original;for(const [english,zh] of PRODUCT_ZH)translated=translated.replaceAll(english,zh);translated=translated.replace(/BOOSTER PACK/gi,'補充包').replace(/EXTRA BOOSTER/gi,'額外補充包').replace(/PREMIUM BOOSTER/gi,'高級補充包').replace(/STARTER DECK EX/gi,'起始牌組 EX').replace(/STARTER DECK/gi,'起始牌組').replace(/ULTIMATE DECK/gi,'終極牌組').replace(/Official Playmat/gi,'官方遊戲墊').replace(/Official Storage Box/gi,'官方收納盒').replace(/Premium Card Collection/gi,'高級卡片收藏組').replace(/Limited Card Sleeve/gi,'限定卡套');if(translated!==original)return translated;return `${TYPE_ZH[productType]||TYPE_ZH[game]||'系列'}｜${original}`}

export function parsePokemonSpeciesNames(csv){
  const rows=new Map();
  for(const line of String(csv).split(/\r?\n/)){const m=line.match(/^(\d+),(4|9),("(?:[^"]|"")*"|[^,]*),/);if(!m)continue;const id=Number(m[1]),name=m[3].replace(/^"|"$/g,'').replaceAll('""','"'),row=rows.get(id)||{};row[m[2]==='4'?'zh':'en']=name;rows.set(id,row)}
  return rows;
}
export function localizePokemonName(name,pokedexNumbers,speciesNames){
  const row=(pokedexNumbers||[]).map(id=>speciesNames.get(Number(id))).find(x=>x?.zh&&x?.en);if(!row)return null;
  const value=clean(name),lower=value.toLocaleLowerCase(),english=row.en.toLocaleLowerCase();
  if(lower===english)return row.zh;
  if(lower.startsWith(`${english} `))return `${row.zh}${value.slice(row.en.length)}`;
  return null;
}

async function providerJson(url,{timeout=60000}={}){
  for(let attempt=1;attempt<=3;attempt++){const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(timeout)});if(response.ok)return response.json();if(attempt===3||![429,500,502,503,504].includes(response.status))throw new Error(`${new URL(url).hostname}_${response.status}`);await new Promise(resolve=>setTimeout(resolve,attempt*750))}
}
async function providerText(url,{timeout=60000}={}){
  for(let attempt=1;attempt<=3;attempt++){const response=await fetch(url,{headers:{Accept:'text/html','Accept-Language':'en','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(timeout)});if(response.ok)return response.text();if(attempt===3||![429,500,502,503,504].includes(response.status))throw new Error(`${new URL(url).hostname}_${response.status}`);await new Promise(resolve=>setTimeout(resolve,attempt*750))}
}

async function upsert(db,path,rows,onConflict='id'){
  if(path==='/tcg_products'||path==='/tcg_series')rows=rows.map(row=>{if(row.name_zh)return row;const nameZh=localizeProductName(row.game_id,row.name_en,row.product_type);return {...row,name_zh:nameZh,metadata:{...(row.metadata||{}),translationStatus:'unofficial',translationOriginal:row.name_en}}});
  const conflictColumns=onConflict.split(','),deduped=[...new Map(rows.map(row=>[conflictColumns.map(column=>String(row[column]??'')).join('\u001f'),row])).values()];let written=0;
  for(const batch of chunks(deduped)){
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

export function parseOnePieceProducts(html,base=SOURCE_URLS['onepiece-official']){
  const items=[],re=/<li class="linkListColBox" data-cat="([^"]+)">[\s\S]*?<a href="([^"]+)" class="linkListColItem">[\s\S]*?<img[^>]+data-src="([^"]+)"[^>]*>[\s\S]*?<h4 class="linkListColTitle">([\s\S]*?)<\/h4>[\s\S]*?<time[^>]+datetime="([^"]+)"/g;
  let m;
  while((m=re.exec(html))){const sourceUrl=absolute(m[2],base),providerId=new URL(sourceUrl).pathname.replace(/\/$/,'').split('/').pop()||String(items.length);items.push({id:`onepiece-product-${slug(providerId)}`,game_id:'onepiece',series_id:null,official_code:null,product_type:decodeHtml(m[1]),name_zh:null,name_ja:null,name_en:decodeHtml(m[4]),name_ko:null,aliases:[],region:'ASIA',language:'en',release_date:ymd(m[5]),image_url:absolute(m[3],base),image_kind:'sealed-product',source:'onepiece-official',source_url:sourceUrl,provider_id:providerId,metadata:{category:decodeHtml(m[1])},updated_at:new Date().toISOString()})}
  return items;
}

export function parseOnePieceCards(html,base='https://asia-en.onepiece-cardgame.com/cardlist/'){
  const cards=[],seen=new Set(),re=/<a class="modalOpen"[\s\S]*?data-src="([^"]*\/images\/cardlist\/card\/([^"?]+?\.png)[^"]*)"[^>]*alt="([^"]*)"[^>]*><\/a>\s*<dl[\s\S]*?<div class="infoCol">\s*<span>([^<]+)<\/span>\s*\|\s*<span>([^<]+)<\/span>\s*\|\s*<span>([^<]+)<\/span>[\s\S]*?<div class="cardName">([^<]+)<\/div>/g;
  let m;
  while((m=re.exec(html))){const number=clean(m[4]),file=clean(m[2]),providerId=file.replace(/\.png$/i,''),key=`${number}:${providerId}`;if(seen.has(key))continue;seen.add(key);cards.push({providerId,number,rarity:clean(m[5]),cardType:clean(m[6]),name:decodeHtml(m[7]),imageUrl:absolute(m[1],base),sourceUrl:base})}
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
    const [setBody,speciesCsv]=await Promise.all([providerJson('https://api.pokemontcg.io/v2/sets?pageSize=250&orderBy=-releaseDate'),providerText('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv')]),speciesNames=parsePokemonSpeciesNames(speciesCsv);
    const series=(setBody.data||[]).map(s=>({id:`pokemon-pokemontcg-${slug(s.id)}`,game_id:'pokemon',official_code:s.id,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,region:'US',language:'en-US',release_date:ymd(s.releaseDate),aliases:[s.id,s.series,s.ptcgoCode].filter(Boolean),source_url:'https://www.pokemontcg.io/',image_url:s.images?.logo||null,image_kind:'series-logo',source:provider,provider_id:s.id,metadata:{ptcgoCode:s.ptcgoCode||null,printedTotal:s.printedTotal,total:s.total,symbolUrl:s.images?.symbol||null},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);
    const products=series.map(s=>({id:`pokemon-series-${slug(s.provider_id)}`,game_id:'pokemon',series_id:s.id,official_code:s.official_code,product_type:'系列',name_zh:null,name_ja:null,name_en:s.name_en,name_ko:null,aliases:s.aliases,region:'US',language:'en-US',release_date:s.release_date,image_url:s.image_url,image_kind:'series-logo',source:provider,source_url:s.source_url,provider_id:s.provider_id,metadata:s.metadata,updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_products',products);
    const selectedSeries=series.slice(0,Number.isFinite(maxPages)?Math.max(0,maxPages):series.length);let processedSets=0;const missedSets=[];
    for(const setBatch of chunks(selectedSeries,6)){
      const payloads=await Promise.all(setBatch.map(async set=>{try{return {set,items:await providerJson(`https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${encodeURIComponent(set.provider_id)}.json`)}}catch(error){return {set,error}}}));
      for(const {set,items,error} of payloads){if(error){missedSets.push({id:set.provider_id,error:error.message});continue}stats.seen+=items.length;stats.cursor=set.provider_id;const cardRows=items.map(c=>{const nameZh=localizePokemonName(c.name,c.nationalPokedexNumbers,speciesNames);return {id:`pokemon-pokemontcg-${slug(c.id)}`,canonical_id:`pokemon-pokemontcg-${slug(c.id)}`,game_id:'pokemon',series_id:set.id,official_card_number:c.number||c.id,rarity:c.rarity||null,name_zh:nameZh,name_ja:null,name_en:c.name,name_ko:null,aliases:nameZh?[nameZh]:[],source:provider,provider_id:c.id,search_text:searchText(c.name,nameZh,c.number,c.id,set.name_en,set.provider_id,set.aliases),metadata:{supertype:c.supertype||null,subtypes:c.subtypes||[],nationalPokedexNumbers:c.nationalPokedexNumbers||[]},updated_at:new Date().toISOString()}});stats.written+=await upsert(db,'/tcg_cards',cardRows);const printingRows=items.map(c=>({card_id:`pokemon-pokemontcg-${slug(c.id)}`,series_id:set.id,region:'US',language:'en-US',local_set_code:set.provider_id,local_card_number:c.number||c.id,rarity:c.rarity||null,image_url:c.images?.small||null,source_url:`https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/${encodeURIComponent(c.id)}/`,release_date:set.release_date,source:provider,provider_id:c.id,image_rehost_required:false,metadata:{imageLarge:c.images?.large||null},updated_at:new Date().toISOString()}));stats.written+=await upsert(db,'/tcg_printings',printingRows,'source,provider_id');processedSets++}
    }
    stats.metadata={sets:series.length,processedSets,totalCards:stats.seen,missedSets,dataSource:'PokemonTCG/pokemon-tcg-data'};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

async function syncPokemonZhTw(db){
  const provider='tcgdex-zh-tw',runId=await startRun(db,provider,'catalog'),stats={seen:0,written:0,cursor:null,metadata:{}};
  try{
    const [cards,sets]=await Promise.all([providerJson('https://api.tcgdex.net/v2/zh-tw/cards'),providerJson('https://api.tcgdex.net/v2/zh-tw/sets')]);
    const series=(sets||[]).map(s=>({id:`pokemon-tcgdex-tw-${slug(s.id)}`,game_id:'pokemon',official_code:s.id,name_zh:s.name||null,name_ja:null,name_en:null,name_ko:null,region:'TW',language:'zh-Hant-TW',release_date:ymd(s.releaseDate),aliases:[s.id].filter(Boolean),source_url:`https://www.tcgdex.net/database/sets/${encodeURIComponent(s.id)}`,image_url:s.logo?`${s.logo}.webp`:null,image_kind:'series-logo',source:provider,provider_id:s.id,metadata:{symbolUrl:s.symbol?`${s.symbol}.webp`:null,total:s.cardCount?.total??s.cardCount?.official??null},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);
    stats.written+=await upsert(db,'/tcg_products',series.map(s=>({id:`pokemon-tcgdex-tw-series-${slug(s.provider_id)}`,game_id:'pokemon',series_id:s.id,official_code:s.official_code,product_type:'系列',name_zh:s.name_zh,name_ja:null,name_en:null,name_ko:null,aliases:s.aliases,region:'TW',language:'zh-Hant-TW',release_date:s.release_date,image_url:s.image_url,image_kind:'series-logo',source:provider,source_url:s.source_url,provider_id:s.provider_id,metadata:s.metadata,updated_at:new Date().toISOString()})));
    const setIds=series.map(s=>String(s.provider_id)).sort((a,b)=>b.length-a.length),seriesById=new Map(series.map(s=>[String(s.provider_id).toLocaleLowerCase(),s.id]));
    for(const batch of chunks(cards||[],150)){
      const normalized=batch.map(c=>{const id=String(c.id),setId=setIds.find(value=>id.toLocaleLowerCase().startsWith(`${value.toLocaleLowerCase()}-`))||id.split('-')[0],seriesId=seriesById.get(setId.toLocaleLowerCase())||null,imageUrl=c.image?`${c.image}/low.webp`:null;return {...c,setId,seriesId,imageUrl}});
      stats.written+=await upsert(db,'/tcg_cards',normalized.map(c=>({id:`pokemon-tcgdex-tw-${slug(c.id)}`,canonical_id:`pokemon-tcgdex-tw-${slug(c.id)}`,game_id:'pokemon',series_id:c.seriesId,official_card_number:c.localId||c.id,rarity:null,name_zh:c.name||null,name_ja:null,name_en:null,name_ko:null,aliases:[c.id].filter(Boolean),source:provider,provider_id:c.id,search_text:searchText(c.name,c.localId,c.id,c.setId),metadata:{tcgdexId:c.id},updated_at:new Date().toISOString()})));
      stats.written+=await upsert(db,'/tcg_printings',normalized.map(c=>({card_id:`pokemon-tcgdex-tw-${slug(c.id)}`,series_id:c.seriesId,region:'TW',language:'zh-Hant-TW',local_set_code:c.setId,local_card_number:c.localId||c.id,rarity:null,image_url:c.imageUrl,source_url:`https://www.tcgdex.net/database/cards/${encodeURIComponent(c.id)}`,release_date:null,source:provider,provider_id:c.id,image_rehost_required:false,metadata:{imageBase:c.image||null},updated_at:new Date().toISOString()})),'source,provider_id');stats.seen+=batch.length;stats.cursor=batch.at(-1)?.id||stats.cursor;
    }
    stats.metadata={sets:series.length,cards:stats.seen,language:'zh-Hant-TW',dataSource:'TCGdex'};await finishRun(db,runId,'completed',stats);return stats;
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
      stats.written+=await upsert(db,'/tcg_printings',printings,'source,provider_id');
    }
    stats.metadata={sets:series.length,cards:cards.length,imagePolicy:'rehost-required'};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

async function syncOnePiece(db){
  const provider='onepiece-official',runId=await startRun(db,'onepiece-official-tw','catalog'),stats={seen:0,written:0,cursor:null,metadata:{}};
  try{
    const [productsHtml,indexHtml]=await Promise.all([providerText('https://asia-en.onepiece-cardgame.com/products/'),providerText('https://asia-en.onepiece-cardgame.com/cardlist/?search=true')]),productCovers=parseOnePieceProducts(productsHtml),setOptions=parseOnePieceSeries(indexHtml),series=setOptions.map(s=>({id:`onepiece-official-${slug(s.code)}`,game_id:'onepiece',official_code:s.code,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,region:'ASIA',language:'en',release_date:null,aliases:[s.code],source_url:`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`,image_url:null,image_kind:'series-logo',source:provider,provider_id:s.providerId,metadata:{productType:s.productType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',series);
    const coverById=new Map(productCovers.map(p=>[p.id,p])),optionProducts=setOptions.map(s=>{const base={id:`onepiece-product-${slug(s.code)}`,game_id:'onepiece',series_id:`onepiece-official-${slug(s.code)}`,official_code:s.code,product_type:s.productType,name_zh:null,name_ja:null,name_en:s.name,name_ko:null,aliases:[s.code],region:'ASIA',language:'en',release_date:null,image_url:null,image_kind:'series-logo',source:provider,source_url:`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`,provider_id:slug(s.code),metadata:{cardListSeriesId:s.providerId},updated_at:new Date().toISOString()},cover=coverById.get(base.id);return cover?{...base,name_en:cover.name_en||base.name_en,product_type:cover.product_type||base.product_type,release_date:cover.release_date,image_url:cover.image_url,image_kind:'sealed-product',source_url:cover.source_url,metadata:{...base.metadata,...cover.metadata}}:base}),extraCovers=productCovers.filter(p=>!optionProducts.some(x=>x.id===p.id));stats.written+=await upsert(db,'/tcg_products',[...optionProducts,...extraCovers]);
    const pages=[];for(let i=0;i<setOptions.length;i+=4){const batch=setOptions.slice(i,i+4),htmls=await Promise.all(batch.map(s=>providerText(`https://asia-en.onepiece-cardgame.com/cardlist/?search=true&series=${s.providerId}`)));pages.push(...htmls);if(i+4<setOptions.length)await new Promise(resolve=>setTimeout(resolve,150))}
    const cards=[],seenCards=new Set();for(const html of pages)for(const card of parseOnePieceCards(html)){const key=card.providerId;if(seenCards.has(key))continue;seenCards.add(key);cards.push(card)}stats.seen=productCovers.length+setOptions.length+cards.length;
    const cardRows=cards.map(c=>({id:`onepiece-official-${slug(c.providerId)}`,canonical_id:`onepiece-${slug(c.number)}`,game_id:'onepiece',series_id:null,official_card_number:c.number,rarity:c.rarity||null,name_zh:null,name_ja:null,name_en:c.name,name_ko:null,aliases:[],source:provider,provider_id:c.providerId,search_text:searchText(c.name,c.number,c.rarity,c.cardType),metadata:{cardType:c.cardType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_cards',cardRows);
    const seriesByCode=new Map(series.map(s=>[s.official_code.replace('-',''),s.id])),printingRows=cards.map(c=>({card_id:`onepiece-official-${slug(c.providerId)}`,series_id:seriesByCode.get((c.number.split('-')[0]||'').replace('-',''))||null,region:'ASIA',language:'en',local_set_code:c.number.split('-')[0]||'unknown',local_card_number:c.number,rarity:c.rarity||null,image_url:c.imageUrl,source_url:c.sourceUrl,release_date:null,source:provider,provider_id:c.providerId,image_rehost_required:false,metadata:{cardType:c.cardType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_printings',printingRows,'source,provider_id');const counts=new Map();for(const printing of printingRows)if(printing.series_id)counts.set(printing.series_id,(counts.get(printing.series_id)||0)+1);stats.written+=await upsert(db,'/tcg_series',series.map(s=>({...s,metadata:{...s.metadata,cardsCount:counts.get(s.id)||0}})));
    const twBase='https://asia-tc.onepiece-cardgame.com/',twCardBase=`${twBase}cardlist/`,[twProductsHtml,twIndexHtml]=await Promise.all([providerText(`${twBase}products/`),providerText(`${twCardBase}?search=true`)]),twCovers=parseOnePieceProducts(twProductsHtml,twBase),twOptions=parseOnePieceSeries(twIndexHtml),twSeries=twOptions.map(s=>({id:`onepiece-official-tw-${slug(s.code)}`,game_id:'onepiece',official_code:s.code,name_zh:s.name,name_ja:null,name_en:null,name_ko:null,region:'TW',language:'zh-Hant-TW',release_date:null,aliases:[s.code],source_url:`${twCardBase}?search=true&series=${s.providerId}`,image_url:null,image_kind:'series-logo',source:'onepiece-official-tw',provider_id:s.providerId,metadata:{productType:s.productType},updated_at:new Date().toISOString()}));
    stats.written+=await upsert(db,'/tcg_series',twSeries);
    const twProducts=twOptions.map(s=>{const cover=twCovers.find(p=>String(p.name_en||'').includes(s.code));return {id:`onepiece-tw-product-${slug(s.code)}`,game_id:'onepiece',series_id:`onepiece-official-tw-${slug(s.code)}`,official_code:s.code,product_type:s.productType,name_zh:cover?.name_en||s.name,name_ja:null,name_en:null,name_ko:null,aliases:[s.code],region:'TW',language:'zh-Hant-TW',release_date:cover?.release_date||null,image_url:cover?.image_url||null,image_kind:cover?.image_url?'sealed-product':'series-logo',source:'onepiece-official-tw',source_url:cover?.source_url||`${twCardBase}?search=true&series=${s.providerId}`,provider_id:s.providerId,metadata:{cardListSeriesId:s.providerId},updated_at:new Date().toISOString()}});
    stats.written+=await upsert(db,'/tcg_products',twProducts);
    const twPages=[];for(let i=0;i<twOptions.length;i+=4){const batch=twOptions.slice(i,i+4),htmls=await Promise.all(batch.map(s=>providerText(`${twCardBase}?search=true&series=${s.providerId}`)));twPages.push(...htmls);if(i+4<twOptions.length)await new Promise(resolve=>setTimeout(resolve,150))}
    const twCards=[],seenTw=new Set();for(const html of twPages)for(const card of parseOnePieceCards(html,twCardBase)){if(seenTw.has(card.providerId))continue;seenTw.add(card.providerId);twCards.push(card)}
    const englishByProviderId=new Map(cards.map(c=>[c.providerId,c])),twSeriesByCode=new Map(twSeries.map(s=>[s.official_code.replace('-',''),s.id]));
    stats.written+=await upsert(db,'/tcg_cards',twCards.map(c=>{const en=englishByProviderId.get(c.providerId);return {id:`onepiece-official-${slug(c.providerId)}`,canonical_id:`onepiece-${slug(c.number)}`,game_id:'onepiece',series_id:seriesByCode.get((c.number.split('-')[0]||'').replace('-',''))||null,official_card_number:c.number,rarity:c.rarity||en?.rarity||null,name_zh:c.name,name_ja:null,name_en:en?.name||null,name_ko:null,aliases:[c.name,en?.name].filter(Boolean),source:provider,provider_id:c.providerId,search_text:searchText(c.name,en?.name,c.number,c.rarity,c.cardType),metadata:{cardType:c.cardType},updated_at:new Date().toISOString()}}));
    stats.written+=await upsert(db,'/tcg_printings',twCards.map(c=>({card_id:`onepiece-official-${slug(c.providerId)}`,series_id:twSeriesByCode.get((c.number.split('-')[0]||'').replace('-',''))||null,region:'TW',language:'zh-Hant-TW',local_set_code:c.number.split('-')[0]||'unknown',local_card_number:c.number,rarity:c.rarity||null,image_url:c.imageUrl,source_url:c.sourceUrl,release_date:null,source:'onepiece-official-tw',provider_id:c.providerId,image_rehost_required:false,metadata:{cardType:c.cardType},updated_at:new Date().toISOString()})),'source,provider_id');
    stats.seen+=twCovers.length+twOptions.length+twCards.length;stats.metadata={products:optionProducts.length,productCovers:productCovers.length,sets:series.length,cards:cards.length,twProducts:twProducts.length,twSets:twSeries.length,twCards:twCards.length};await finishRun(db,runId,'completed',stats);return stats;
  }catch(error){await finishRun(db,runId,'failed',stats,error);throw error}
}

export async function catalogProvidersNeedingSync(db,maxAgeHours=72){
  const cutoff=new Date(Date.now()-maxAgeHours*3600000).toISOString(),rows=await db(`/catalog_sync_runs?select=provider&status=eq.completed&started_at=gte.${encodeURIComponent(cutoff)}&limit=100`),completed=new Set((rows||[]).map(row=>row.provider)),providerNames={pokemon:'pokemontcg',pokemonZhTw:'tcgdex-zh-tw',onepiece:'onepiece-official-tw',yugioh:'ygoprodeck'};return Object.entries(providerNames).filter(([,stored])=>!completed.has(stored)).map(([runtime])=>runtime);
}

export async function shouldSyncCatalog(db,maxAgeHours=72){return (await catalogProvidersNeedingSync(db,maxAgeHours)).length>0}

export async function syncCatalog(db,{providers=['pokemon','onepiece','yugioh'],maxPokemonPages=Infinity}={}){
  const results={};
  for(const provider of providers){try{results[provider]=provider==='pokemon'?await syncPokemon(db,{maxPages:maxPokemonPages}):provider==='pokemonZhTw'?await syncPokemonZhTw(db):provider==='onepiece'?await syncOnePiece(db):await syncYugioh(db)}catch(error){results[provider]={error:error.message}}}
  return results;
}

