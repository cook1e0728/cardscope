const BUCKET='card-images';
const SOURCE='cardscope-yugioh-cache';
const chunks=(rows,size)=>Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));
async function dbAll(db,path,maxRows=50000){const rows=[];for(let offset=0;offset<maxRows;offset+=1000){const separator=path.includes('?')?'&':'?',batch=await db(`${path}${separator}limit=${Math.min(1000,maxRows-offset)}&offset=${offset}`);rows.push(...(batch||[]));if(!batch||batch.length<1000)break}return rows}

async function storageRequest(path,options={}){
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
  if(!base||!key)throw new Error('SUPABASE_NOT_CONFIGURED');
  const response=await fetch(`${base}/storage/v1${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,...(options.headers||{})},signal:AbortSignal.timeout(30000)});
  if(!response.ok){const body=await response.text().catch(()=>'');throw new Error(`STORAGE_${response.status}:${body.slice(0,180)}`)}
  return response;
}

async function ensureBucket(){
  try{await storageRequest(`/bucket/${BUCKET}`);return}
  catch(error){if(!/^STORAGE_(400|404):/.test(String(error.message)))throw error}
  await storageRequest('/bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:BUCKET,name:BUCKET,public:true,file_size_limit:600000,allowed_mime_types:['image/jpeg','image/png','image/webp']})});
}

async function cacheOne(db,card){
  const providerId=String(card.provider_id||'').replace(/\D/g,'');
  if(!providerId)throw new Error('INVALID_PROVIDER_ID');
  const sourceUrl=`https://images.ygoprodeck.com/images/cards_small/${providerId}.jpg`,response=await fetch(sourceUrl,{headers:{Accept:'image/jpeg','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`YGOPRODECK_IMAGE_${response.status}`);
  const contentType=(response.headers.get('content-type')||'').split(';')[0];
  if(!['image/jpeg','image/png','image/webp'].includes(contentType))throw new Error(`INVALID_IMAGE_TYPE_${contentType}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length||bytes.length>600000)throw new Error(`INVALID_IMAGE_SIZE_${bytes.length}`);
  const objectPath=`yugioh/${providerId}.jpg`;
  await storageRequest(`/object/${BUCKET}/${objectPath}`,{method:'POST',headers:{'Content-Type':contentType,'Cache-Control':'31536000','x-upsert':'true'},body:bytes});
  const imageUrl=`${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  await db(`/tcg_printings?card_id=eq.${encodeURIComponent(card.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({image_url:imageUrl,image_rehost_required:false,updated_at:new Date().toISOString()})});
  await db('/card_images?on_conflict=card_id,source,image_url',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([{card_id:card.id,language:'en-US',source:SOURCE,image_url:imageUrl,source_url:sourceUrl,is_primary:true,fetched_at:new Date().toISOString()}])});
  return bytes.length;
}

async function restoreCachedPrinting(db,cardId,imageUrl){
  await db(`/tcg_printings?card_id=eq.${encodeURIComponent(cardId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({image_url:imageUrl,image_rehost_required:false,updated_at:new Date().toISOString()})});
}
async function cacheWithRetry(db,card){let lastError;for(let attempt=1;attempt<=3;attempt++){try{return await cacheOne(db,card)}catch(error){lastError=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*500))}}throw lastError}

export async function cacheYugiohImages(db,{limit=15000,concurrency=4}={}){
  await ensureBucket();
  const [cards,cached,missingPrintings]=await Promise.all([
    dbAll(db,'/tcg_cards?select=id,provider_id&source=eq.ygoprodeck&order=id',Math.max(1,Number(limit)||15000)),
    dbAll(db,`/card_images?select=card_id,image_url&source=eq.${SOURCE}`,20000),
    dbAll(db,'/tcg_printings?select=card_id&source=eq.ygoprodeck&image_url=is.null',50000)
  ]),cachedByCard=new Map((cached||[]).map(row=>[row.card_id,row.image_url])),missingCards=new Set((missingPrintings||[]).map(row=>row.card_id)),pending=(cards||[]).filter(card=>missingCards.has(card.id));
  const stats={seen:pending.length,written:0,failed:0,bytes:0,errors:[]};
  for(const batch of chunks(pending,Math.max(1,Number(concurrency)||4))){
    const results=await Promise.allSettled(batch.map(card=>cachedByCard.has(card.id)?restoreCachedPrinting(db,card.id,cachedByCard.get(card.id)).then(()=>0):cacheWithRetry(db,card)));
    results.forEach((result,index)=>{if(result.status==='fulfilled'){stats.written++;stats.bytes+=result.value}else{stats.failed++;if(stats.errors.length<20)stats.errors.push({cardId:batch[index].id,error:result.reason?.message||String(result.reason)})}});
  }
  return stats;
}

export async function yugiohImageStatus(db){
  const [cards,cached]=await Promise.all([dbAll(db,'/tcg_cards?select=id&source=eq.ygoprodeck',20000),dbAll(db,`/card_images?select=card_id&source=eq.${SOURCE}`,20000)]);
  return {total:(cards||[]).length,cached:(cached||[]).length,missing:Math.max(0,(cards||[]).length-(cached||[]).length)};
}
