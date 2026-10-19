// 我的收藏（ADR 0045，v0 免登入）：純函式，不碰 DOM 與 localStorage，方便測試。資料只存在這台裝置。
// 一筆收藏 = {id（實體卡 id）, canonicalId, favorite, quantity, condition, finish, note}；價格不存，只在看總值時向 /api/prices/reference 查。
(root=>{
  const CONDITIONS=[['','未指定'],['NM','近全新 NM'],['LP','輕微使用痕跡 LP'],['MP','中度使用痕跡 MP'],['HP','明顯使用痕跡 HP'],['DMG','損傷 DMG'],['SLAB','鑑定卡（不計入參考總值）']];
  const LIMITS={itemsMax:2000,fileMaxChars:1000000,idMax:128,finishMax:60,noteMax:200,quantityMax:999};
  const BACKUP_APP='cardscope-collection',BACKUP_VERSION=1;
  const PROVIDER_LABELS={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
  const CONTROL=/[\u0000-\u001f\u007f]/g,FINISH=/^[A-Za-z0-9._-]*$/;
  const idOf=value=>typeof value==='string'&&value.length>0&&value.length<=LIMITS.idMax&&!/[\u0000-\u001f\u007f]/.test(value);
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  // Strict per-item check for untrusted input (backup files). Returns a clean item or null; never throws.
  function normalizeItem(raw){
    if(!plain(raw)||!idOf(raw.id))return null;
    const canonicalId=raw.canonicalId==null||raw.canonicalId===''?'':raw.canonicalId,condition=raw.condition==null?'':raw.condition,finish=raw.finish==null?'':raw.finish,note=raw.note==null?'':raw.note,quantity=raw.quantity==null?0:raw.quantity,favorite=raw.favorite==null?false:raw.favorite;
    if(canonicalId!==''&&!idOf(canonicalId))return null;
    if(typeof favorite!=='boolean'||!Number.isInteger(quantity)||quantity<0||quantity>LIMITS.quantityMax)return null;
    if(!CONDITIONS.some(([key])=>key===condition))return null;
    if(typeof finish!=='string'||finish.length>LIMITS.finishMax||!FINISH.test(finish))return null;
    if(typeof note!=='string'||note.length>LIMITS.noteMax)return null;
    if(!favorite&&quantity===0)return null;
    return{id:raw.id,canonicalId,favorite,quantity,condition,finish,note:note.replace(CONTROL,' ').trim()};
  }

  // Same card twice: star if either has it, larger quantity (re-importing never doubles), the existing text fields win unless empty.
  function mergeItem(a,b){return{id:a.id,canonicalId:a.canonicalId||b.canonicalId,favorite:a.favorite||b.favorite,quantity:Math.max(a.quantity,b.quantity),condition:a.condition||b.condition,finish:a.finish||b.finish,note:a.note||b.note}}
  function mergeItems(existing,incoming){
    const map=new Map(existing.map(item=>[item.id,item]));let added=0,merged=0;
    for(const item of incoming){const hit=map.get(item.id);if(hit){const next=mergeItem(hit,item);if(JSON.stringify(next)!==JSON.stringify(hit))merged++;map.set(item.id,next)}else{map.set(item.id,item);added++}}
    return{items:[...map.values()],added,merged};
  }

  function exportBackup(items,now=new Date()){return{app:BACKUP_APP,version:BACKUP_VERSION,exportedAt:now.toISOString(),items:items.map(({id,canonicalId,favorite,quantity,condition,finish,note})=>({id,canonicalId,favorite,quantity,condition,finish,note}))}}

  // Whole-file problems (size, JSON, shape, version, too many items) reject the file; single bad items are skipped and counted.
  function parseBackup(text){
    if(typeof text!=='string'||!text.trim())return{error:'檔案是空的'};
    if(text.length>LIMITS.fileMaxChars)return{error:'檔案過大（上限 1 MB）'};
    let data;try{data=JSON.parse(text)}catch{return{error:'不是有效的 JSON 檔案'}}
    if(!plain(data)||data.app!==BACKUP_APP)return{error:'不是 CardScope 收藏備份檔'};
    if(data.version!==BACKUP_VERSION)return{error:'備份檔版本不支援'};
    if(!Array.isArray(data.items))return{error:'備份檔缺少 items'};
    if(data.items.length>LIMITS.itemsMax)return{error:`備份檔超過 ${LIMITS.itemsMax} 筆上限`};
    const seen=new Map();let skipped=0;
    for(const raw of data.items){const item=normalizeItem(raw);if(!item){skipped++;continue}seen.set(item.id,seen.has(item.id)?mergeItem(seen.get(item.id),item):item)}
    return{items:[...seen.values()],skipped};
  }

  // Legacy storage (cardscope-favorites array, cardscope-watchlist {id:quantity}, cardscope-watchlist-meta {id:snapshot}) <-> items.
  function itemsFromLegacy(favoriteIds,watchlist,meta){
    const has=id=>favoriteIds.has?favoriteIds.has(id):favoriteIds.includes(id);
    return[...new Set([...favoriteIds,...Object.keys(watchlist||{})])].map(id=>{
      const m=meta?.[id]||{},count=Number(watchlist?.[id]),quantity=Number.isInteger(count)&&count>0?Math.min(count,LIMITS.quantityMax):0,item={id,canonicalId:m.canonicalId,favorite:has(id),quantity,condition:m.condition,finish:m.finish,note:m.note};
      // An old stored entry that fails the strict check must not disappear: keep it with only what is certain.
      return normalizeItem(item)||{id:String(id),canonicalId:'',favorite:has(id),quantity,condition:'',finish:'',note:''};
    });
  }

  // Old entries may hold a canonical id (search, detail) or a physical id (browse). `card` is the /api/cards/:id payload.
  // A canonical id with several physical cards (JP/TW/US) is never guessed: it stays as is with choices to pick from.
  function locateCard(key,card){
    const ps=card?.printings||[],physical=[...new Set([...(card?.physicalCardIds||[]),...ps.map(p=>p.cardId)].filter(Boolean).map(String))],canonicalId=String(card?.canonicalId||card?.id||'');
    if(!physical.length||physical.includes(key))return{id:key,canonicalId};
    if(physical.length===1)return{id:physical[0],canonicalId};
    const seen=new Set();
    return{id:key,canonicalId,ambiguous:true,choices:ps.filter(p=>p.cardId&&!seen.has(p.cardId)&&seen.add(p.cardId)).map(p=>({cardId:String(p.cardId),region:p.region||'',set:p.localSetCode||'',number:p.localCardNumber||'',rarity:p.rarity||'',variant:p.metadata?.variantName||''}))};
  }

  // Cardmarket says holo / TCGplayer says holofoil for the same finish (the site labels them alike), so compare by this key.
  const FINISH_ALIASES={holofoil:'holo',reverseholofoil:'reverse',reverseholo:'reverse'};
  const finishKey=value=>{const key=String(value||'').toLowerCase().replace(/[-_ ]/g,'');return FINISH_ALIASES[key]||key};

  // Reference total. Per provider and entry: a chosen finish must match a snapshot variant (same finish key); with no finish chosen, one variant is used
  // and several variants mean "choose a version" (never picked for the user). Slabs and cards without snapshots are not counted. Sources are never added together.
  function valuate(entries,pricesById){
    const byProvider={},perEntry={},uncounted=[],dates=[];
    for(const {id,quantity,condition,finish} of entries){
      const qty=quantity||1,prices=pricesById[id]||[],counted=[];let needsFinish=false,reason='';
      if(condition==='SLAB')reason='slab';
      else if(!prices.length)reason='none';
      else for(const provider of Object.keys(PROVIDER_LABELS)){
        const own=prices.filter(p=>p.provider===provider);if(!own.length)continue;
        const pick=finish?own.filter(p=>finishKey(p.variant)===finishKey(finish)):own.length===1?own:[];
        if(pick.length!==1){if(!finish)needsFinish=true;continue}
        counted.push({provider,price:pick[0],qty});
      }
      if(!reason&&!counted.length)reason=needsFinish?'choose':'no-match';
      perEntry[id]={counted,reason,needsFinish};
      if(counted.length){for(const {provider,price} of counted){const row=byProvider[provider]??={twd:0,entries:0,missingFx:0};row.entries++;if(Number.isFinite(price.amountTwd))row.twd+=price.amountTwd*qty;else row.missingFx++;dates.push(price.snapshotDate)}}
      else uncounted.push({id,reason});
    }
    dates.sort();
    return{byProvider,perEntry,uncounted,counted:entries.length-uncounted.length,total:entries.length,dateFrom:dates[0]||'',dateTo:dates.at(-1)||''};
  }

  root.CollectionStore={CONDITIONS,LIMITS,PROVIDER_LABELS,BACKUP_APP,BACKUP_VERSION,normalizeItem,finishKey,mergeItems,exportBackup,parseBackup,itemsFromLegacy,locateCard,valuate};
})(typeof window!=='undefined'?window:globalThis);
