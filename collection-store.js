// 我的收藏（ADR 0045，v0 免登入）：純函式，不碰 DOM 與 localStorage，方便測試。資料只存在這台裝置。
// 一筆收藏 = {id（實體卡 id）, canonicalId, favorite, quantity, condition, finish, note}；價格不存，只在看總值時向 /api/prices/reference 查。
(root=>{
  const CONDITIONS=[['','未指定'],['NM','近全新 NM'],['LP','輕微使用痕跡 LP'],['MP','中度使用痕跡 MP'],['HP','明顯使用痕跡 HP'],['DMG','損傷 DMG'],['SLAB','鑑定卡（不計入參考總值）']];
  const LIMITS={itemsMax:10000,fileMaxChars:2097152,idMax:128,finishMax:60,noteMax:200,quantityMax:999};
  const BACKUP_APP='cardscope-collection',BACKUP_VERSION=2,BACKUP_VERSIONS=[1,2]; // v2 adds the optional seriesId／game／region hints; v1 files still import
  const PROVIDER_LABELS={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
  const CONTROL=/[\u0000-\u001f\u007f]/g,FINISH=/^[A-Za-z0-9._-]*$/;
  const idOf=value=>typeof value==='string'&&value.length>0&&value.length<=LIMITS.idMax&&!/[\u0000-\u001f\u007f]/.test(value);
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  // Why an item is unusable (shown in the import preview), or '' when it passes. normalizeItem is this check plus the clean copy.
  function problem(raw){
    if(!plain(raw))return'不是物件';
    if(!idOf(raw.id))return'卡 id 缺少或不合理';
    const canonicalId=raw.canonicalId==null||raw.canonicalId===''?'':raw.canonicalId,condition=raw.condition==null?'':raw.condition,finish=raw.finish==null?'':raw.finish,note=raw.note==null?'':raw.note,quantity=raw.quantity==null?0:raw.quantity,favorite=raw.favorite==null?false:raw.favorite;
    if(canonicalId!==''&&!idOf(canonicalId))return'作品層 id 不合理';
    if(typeof favorite!=='boolean')return'favorite 必須是 true 或 false';
    if(!Number.isInteger(quantity)||quantity<0||quantity>LIMITS.quantityMax||(!favorite&&quantity===0))return`數量必須是 1–${LIMITS.quantityMax} 的整數`;
    if(!CONDITIONS.some(([key])=>key===condition))return'品況不認得';
    if(typeof finish!=='string'||finish.length>LIMITS.finishMax||!FINISH.test(finish))return'版本格式不合理';
    if(typeof note!=='string'||note.length>LIMITS.noteMax)return`備註超過 ${LIMITS.noteMax} 字`;
    return'';
  }
  // seriesId／game／region are hints for series progress: a malformed hint is dropped, never a reason to lose the card; empty ones are left out of the item.
  const HINT=/^[A-Za-z0-9._:-]{1,40}$/;
  const hintsOf=raw=>{const out={};if(idOf(raw.seriesId))out.seriesId=raw.seriesId;if(typeof raw.game==='string'&&HINT.test(raw.game))out.game=raw.game;if(typeof raw.region==='string'&&HINT.test(raw.region))out.region=raw.region;return out};
  // Strict per-item check for untrusted input (backup files). Returns a clean item or null; never throws.
  function normalizeItem(raw){
    if(problem(raw))return null;
    const {id}=raw,canonicalId=raw.canonicalId||'',condition=raw.condition||'',finish=raw.finish||'',note=raw.note||'',quantity=raw.quantity||0,favorite=raw.favorite||false;
    return{id,canonicalId,favorite,quantity,condition,finish,note:note.replace(CONTROL,' ').trim(),...hintsOf(raw)};
  }

  // Same card twice: star if either has it, larger quantity (re-importing never doubles), the existing text fields win unless empty.
  function mergeItem(a,b){return{id:a.id,canonicalId:a.canonicalId||b.canonicalId,favorite:a.favorite||b.favorite,quantity:Math.max(a.quantity,b.quantity),condition:a.condition||b.condition,finish:a.finish||b.finish,note:a.note||b.note,...hintsOf({seriesId:a.seriesId||b.seriesId,game:a.game||b.game,region:a.region||b.region})}}
  function mergeItems(existing,incoming){
    const map=new Map(existing.map(item=>[item.id,item]));let added=0,merged=0;
    for(const item of incoming){const hit=map.get(item.id);if(hit){const next=mergeItem(hit,item);if(JSON.stringify(next)!==JSON.stringify(hit))merged++;map.set(item.id,next)}else{map.set(item.id,item);added++}}
    return{items:[...map.values()],added,merged};
  }

  // Compact on purpose (empty fields left out): 10,000 cards must still fit under the 2 MB import limit.
  const exportItem=({id,canonicalId,favorite,quantity,condition,finish,note,seriesId,game,region})=>Object.fromEntries(Object.entries({id,canonicalId,favorite:favorite||'',quantity,condition,finish,note,seriesId,game,region}).filter(([,value])=>value!==''&&value!=null));
  function exportBackup(items,now=new Date()){return{app:BACKUP_APP,version:BACKUP_VERSION,exportedAt:now.toISOString(),items:items.map(exportItem)}}

  // The one validator behind both the old parseBackup and the import preview. Whole-file problems reject the file; single bad items are skipped with a reason.
  function readBackupJson(text){
    let data;try{data=JSON.parse(text)}catch{return{error:'不是有效的 JSON 檔案'}}
    if(!plain(data)||data.app!==BACKUP_APP)return{error:'不是 CardSeek 收藏備份檔'};
    if(!BACKUP_VERSIONS.includes(data.version))return{error:'備份檔版本不支援'};
    if(!Array.isArray(data.items))return{error:'備份檔缺少 items'};
    if(data.items.length>LIMITS.itemsMax)return{error:`備份檔超過 ${LIMITS.itemsMax.toLocaleString('en-US')} 筆上限`};
    return{rows:data.items};
  }
  const UNSAFE_ID=new Set(['__proto__','constructor','prototype']);
  function collect(rows,{strict=false}={}){
    const seen=new Map(),problems=[];
    rows.forEach((raw,index)=>{
      let reason=problem(raw);if(!reason&&strict&&UNSAFE_ID.has(raw.id))reason='卡 id 不安全';
      if(reason){problems.push({index:index+1,reason});return}
      // Import: owning means quantity >= 1; a star-only item from an old v1 backup counts as 1 (same rule as the app).
      let item=normalizeItem(raw);if(strict)item={...item,favorite:false,quantity:collectedQuantity(item)};
      seen.set(item.id,seen.has(item.id)?mergeItem(seen.get(item.id),item):item);
    });
    return{items:[...seen.values()],problems};
  }
  function parseBackup(text){
    if(typeof text!=='string'||!text.trim())return{error:'檔案是空的'};
    if(text.length>LIMITS.fileMaxChars)return{error:'檔案過大（上限 2 MB）'};
    const file=readBackupJson(text);if(file.error)return file;
    const {items,problems}=collect(file.rows);
    return{items,skipped:problems.length};
  }

  // CSV as written by the 「下載清單 CSV」 button (BOM, quoted cells, a leading ' in front of formula-like text). Returns rows of cells.
  function parseCsv(text){
    const rows=[];let row=[],cell='',quoted=false;
    const src=text.charCodeAt(0)===0xFEFF?text.slice(1):text;
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(quoted){if(ch==='"'){if(src[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=ch}
      else if(ch==='"'&&cell==='')quoted=true;
      else if(ch===','){row.push(cell);cell=''}
      else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&src[i+1]==='\n')i++;row.push(cell);cell='';rows.push(row);row=[]}
      else cell+=ch;
    }
    if(cell!==''||row.length){row.push(cell);rows.push(row)}
    return rows.filter(cells=>cells.some(value=>value!==''));
  }
  const CSV_COLUMNS={'卡片 ID':'id','作品層 ID':'canonicalId','數量':'quantity','品況':'condition','版本':'finish','備註':'note','系列 ID':'seriesId','遊戲':'game','地區':'region'};
  function readBackupCsv(text){
    const table=parseCsv(text),header=table[0]||[],cols=header.map(name=>CSV_COLUMNS[name.trim()]);
    if(!cols.includes('id')||!cols.includes('quantity'))return{error:'不是 CardSeek 匯出的 CSV（缺少「卡片 ID」或「數量」欄）'};
    if(table.length-1>LIMITS.itemsMax)return{error:`CSV 超過 ${LIMITS.itemsMax.toLocaleString('en-US')} 筆上限`};
    const unquote=value=>value.replace(/^'(?=\s*[=+@-])/,'');
    return{rows:table.slice(1).map(cells=>{
      const raw={};cols.forEach((key,at)=>{if(key)raw[key]=unquote(cells[at]??'')});
      // quantity is text in a CSV: digits only; anything else stays a string so the shared check rejects it
      if(/^\d+$/.test(raw.quantity))raw.quantity=Number(raw.quantity);
      const label=raw.condition;if(label)raw.condition=CONDITIONS.find(([key,name])=>key===label||name===label)?.[0]??label;else raw.condition='';
      return raw;
    })};
  }

  // Import preview input: a CardSeek JSON backup or CSV. Every check runs here, before anything is written; bad rows are skipped with the reason.
  function parseImport(text){
    if(typeof text!=='string'||!text.trim())return{error:'檔案是空的'};
    text=text.replace(/^﻿/,''); // 記事本／Excel 存的 UTF-8 檔開頭有 BOM，JSON.parse 會失敗
    if(text.length>LIMITS.fileMaxChars)return{error:'檔案過大（上限 2 MB）'};
    const format=text.trimStart()[0]==='{'?'json':'csv',file=format==='json'?readBackupJson(text):readBackupCsv(text);
    if(file.error)return file;
    const {items,problems}=collect(file.rows,{strict:true});
    return{format,items,problems,rows:file.rows.length};
  }
  // What an import would do. Merge: the same card keeps the larger quantity (never adds, so importing twice changes nothing). Replace: the file becomes the whole collection.
  function planImport(existing,incoming,replace=false){
    if(!replace){const merged=mergeItems(existing,incoming);return{items:merged.items,added:merged.added,updated:merged.merged,unchanged:incoming.length-merged.added-merged.merged,removed:0}}
    const old=new Map(existing.map(item=>[item.id,item])),keep=new Set(incoming.map(item=>item.id));let added=0,updated=0,unchanged=0;
    for(const item of incoming){const hit=old.get(item.id);if(!hit)added++;else if(JSON.stringify(hit)!==JSON.stringify(item))updated++;else unchanged++}
    return{items:incoming,added,updated,unchanged,removed:existing.filter(item=>!keep.has(item.id)).length};
  }

  // Owning a card is quantity > 0. The old star list moves into quantities once: an existing count stays, a star without a valid count becomes 1.
  function migrateFavorites(favoriteIds,watchlist){
    const next={...watchlist};let added=0;
    for(const id of favoriteIds){const count=Number(next[id]);if(idOf(id)&&!(Number.isInteger(count)&&count>0)){next[id]=1;added++}}
    return{watchlist:next,added};
  }
  // A starred item from an old backup (quantity 0) counts as 1.
  const collectedQuantity=item=>item.quantity>0?item.quantity:item.favorite?1:0;

  // Legacy storage (cardscope-favorites array, cardscope-watchlist {id:quantity}, cardscope-watchlist-meta {id:snapshot}) <-> items.
  function itemsFromLegacy(favoriteIds,watchlist,meta){
    const has=id=>favoriteIds.has?favoriteIds.has(id):favoriteIds.includes(id);
    return[...new Set([...favoriteIds,...Object.keys(watchlist||{})])].map(id=>{
      const m=meta?.[id]||{},count=Number(watchlist?.[id]),quantity=Number.isInteger(count)&&count>0?Math.min(count,LIMITS.quantityMax):0,item={id,canonicalId:m.canonicalId,favorite:has(id),quantity,condition:m.condition,finish:m.finish,note:m.note,seriesId:m.seriesId,game:m.game,region:m.region};
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

  // The only finish a card has prices for (all rows share one finish key and it is not blank), else ''. The UI shows it as the default version; nothing is stored.
  const soleFinish=prices=>{const rows=prices||[];return rows.length&&new Set(rows.map(p=>finishKey(p.variant))).size===1?rows[0].variant||'':''};

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

  // Series progress. Owned = cards (not copies) in the collection that belong to the series: stored seriesId, or (older entries without one) an id on the wall now showing.
  function ownedInSeries(items,seriesId,wallIds=[]){
    const wall=new Set(wallIds.map(String)),hit=new Set();
    for(const item of items)if(collectedQuantity(item)>0&&((seriesId&&item.seriesId===seriesId)||wall.has(item.id)))hit.add(item.id);
    return hit.size;
  }
  function seriesProgress(owned,total){
    const have=Math.min(Math.max(owned,0),total);
    return{owned:have,total,missing:total-have,percent:total>0?have>=total?100:Math.min(99,Math.floor(have/total*100)):0};
  }
  // Collection grouped by the stored seriesId, most cards first; entries without one are counted apart (opening their series wall fills it in).
  function seriesBreakdown(items,limit=10){
    const groups=new Map();let unknown=0;
    for(const item of items){if(collectedQuantity(item)<1)continue;if(!item.seriesId){unknown++;continue}const group=groups.get(item.seriesId)||{seriesId:item.seriesId,game:item.game||'',owned:0};group.owned++;if(!group.game&&item.game)group.game=item.game;groups.set(item.seriesId,group)}
    const rows=[...groups.values()].sort((a,b)=>b.owned-a.owned||(a.seriesId<b.seriesId?-1:1));
    return{rows:rows.slice(0,limit),seriesCount:rows.length,unknown};
  }

  // ---- 雲端同步（docs/NEXT_PHASE_PLAN.md Y）----
  // 同步用的一筆 = 收藏項目加 updatedAt（ISO 字串），或墓碑 {id,deleted:true,updatedAt}。mergeSync 是純函式：同一 id 取 updatedAt 較新的；
  // 刪除留墓碑，超過 30 天清掉。兩邊順序對調結果相同（時間相同時墓碑勝，再相同就比欄位字串，所以不依賴順序）。
  // shortcut: 墓碑過期後清掉，所以停用超過 30 天的裝置回來時，它那邊沒改過的舊項目會把已刪的卡帶回來；要避免就得保留更久或改用版本向量。
  const SYNC_TOMBSTONE_DAYS=30,SYNC_FUTURE_MS=24*3600*1000;
  const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  const timeOf=value=>{const ms=typeof value==='string'&&ISO_TIME.test(value)?Date.parse(value):NaN;return Number.isFinite(ms)?ms:0};
  const stable=entry=>JSON.stringify(entry,Object.keys(entry).sort());
  // The newer entry wins; on equal time a tombstone beats a live item, then the larger field string (a total order, so the result never depends on argument order).
  function newer(a,b){
    const ta=timeOf(a.updatedAt),tb=timeOf(b.updatedAt);
    if(ta!==tb)return ta>tb?a:b;
    if(Boolean(a.deleted)!==Boolean(b.deleted))return a.deleted?a:b;
    return stable(a)>=stable(b)?a:b;
  }
  function mergeSync(local,remote,now=Date.now()){
    const nowMs=now instanceof Date?now.getTime():typeof now==='string'?Date.parse(now):Number(now),winners=new Map();
    for(const entry of [...(Array.isArray(local)?local:[]),...(Array.isArray(remote)?remote:[])]){
      if(!plain(entry)||!idOf(entry.id)||UNSAFE_ID.has(entry.id))continue;
      const hit=winners.get(entry.id);winners.set(entry.id,hit?newer(hit,entry):entry);
    }
    const limit=nowMs-SYNC_TOMBSTONE_DAYS*86400000;
    return[...winners.values()].filter(entry=>!(entry.deleted&&timeOf(entry.updatedAt)<limit)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  }
  // Untrusted sync entry (the server runs every pushed row through this): a live item passes the same check as an import and gains a valid updatedAt;
  // a tombstone may carry only id, deleted and updatedAt. Returns a clean entry or null; never throws.
  function normalizeSyncEntry(raw){
    if(!plain(raw)||UNSAFE_ID.has(raw.id)||typeof raw.updatedAt!=='string'||!ISO_TIME.test(raw.updatedAt)||!Number.isFinite(Date.parse(raw.updatedAt)))return null;
    if(raw.deleted!==undefined){
      return raw.deleted===true&&idOf(raw.id)&&Object.keys(raw).sort().join()==='deleted,id,updatedAt'?{id:raw.id,deleted:true,updatedAt:raw.updatedAt}:null;
    }
    const {updatedAt,...rest}=raw,item=normalizeItem(rest);
    return item&&{...item,updatedAt};
  }
  // The sync code is a password: at least 26 characters of 0-9 A-Z (130 bits when random). Spaces and hyphens (grouped display) and case are ignored. '' when unusable.
  const SYNC_CODE=/^[0-9A-Z]{26,64}$/,SYNC_ALPHABET='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function normalizeSyncCode(text){
    const code=typeof text==='string'&&text.length<=200?text.replace(/[\s-]/g,'').toUpperCase():'';
    return SYNC_CODE.test(code)?code:'';
  }
  // New code: 28 characters of 0-9 A-Z (about 145 bits) from crypto.getRandomValues; bytes >= 252 are skipped so every character is equally likely. Shown as 7 groups of 4.
  function generateSyncCode(cryptoApi=root.crypto){
    let code='';
    while(code.length<28){const bytes=cryptoApi.getRandomValues(new Uint8Array(40));for(const byte of bytes)if(byte<252&&code.length<28)code+=SYNC_ALPHABET[byte%36]}
    return code;
  }
  const formatSyncCode=text=>(normalizeSyncCode(text)||'').replace(/(.{4})(?=.)/g,'$1-');

  root.CollectionStore={CONDITIONS,LIMITS,PROVIDER_LABELS,BACKUP_APP,BACKUP_VERSION,normalizeItem,problem,parseImport,planImport,parseCsv,ownedInSeries,seriesProgress,seriesBreakdown,finishKey,soleFinish,migrateFavorites,collectedQuantity,mergeItems,exportBackup,parseBackup,itemsFromLegacy,locateCard,valuate,mergeSync,generateSyncCode,formatSyncCode,normalizeSyncEntry,normalizeSyncCode,SYNC_TOMBSTONE_DAYS,SYNC_FUTURE_MS};
})(typeof window!=='undefined'?window:globalThis);
