// ADR 0045：免登入收藏的批次參考價（POST /api/prices/reference）。只讀 public.price_snapshots，不打外部來源；純函式便於測試。
export const REFERENCE_MAX_IDS=100,REFERENCE_ID_MAX_LENGTH=128,REFERENCE_ROW_LIMIT=5000,REFERENCE_BODY_MAX_BYTES=20000;
export const REFERENCE_NOTE='參考價為 Cardmarket／TCGplayer 的平台參考價（經 TCGdex 轉供），不是成交價、可售價或台灣行情；新台幣以今日匯率換算，快照日期為該筆參考價的記錄日。';
const PROVIDERS=new Set(['cardmarket','tcgplayer']);

// Trust boundary: strict shape, count, type and length checks; extra keys are rejected. Returns {ids} (deduplicated, input order) or {error}.
export function validateReferenceRequest(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return {error:'請求內容必須是 JSON 物件'};
  if(Object.keys(body).some(key=>key!=='cardIds'))return {error:'只接受 cardIds 欄位'};
  const list=body.cardIds;
  if(!Array.isArray(list)||!list.length)return {error:'cardIds 必須是非空陣列'};
  if(list.length>REFERENCE_MAX_IDS)return {error:`cardIds 最多 ${REFERENCE_MAX_IDS} 筆`};
  for(const id of list)if(typeof id!=='string'||!id||id.length>REFERENCE_ID_MAX_LENGTH||/[\u0000-\u001f\u007f"\\]/.test(id))return {error:'cardIds 內含無效的卡片 ID'};
  return {ids:[...new Set(list)]};
}

// One request; the primary key (card_id, provider, variant, snapshot_date) serves the card_id filter. Newest first so a truncated page drops the oldest rows.
export function referenceQueryParams(ids){return {select:'card_id,provider,variant,currency,snapshot_date,amount',card_id:`in.(${ids.map(id=>`"${id}"`).join(',')})`,order:'snapshot_date.desc',limit:String(REFERENCE_ROW_LIMIT)}}

// Latest row per card+provider+variant (compares dates, so row order does not matter). Cards without rows get prices:[].
export function buildReferencePrices(rows,ids,{fx,amountToTwd,now=Date.now()}){
  const latest=new Map();
  for(const row of rows||[]){
    const amount=Number(row?.amount),date=String(row?.snapshot_date||'').slice(0,10);
    if(!row?.card_id||!PROVIDERS.has(row.provider)||!Number.isFinite(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const key=JSON.stringify([row.card_id,row.provider,row.variant||'']),hit=latest.get(key);
    if(!hit||date>hit.snapshotDate)latest.set(key,{cardId:row.card_id,provider:row.provider,variant:row.variant||'',currency:row.currency,amount,amountTwd:amountToTwd(amount,row.currency,fx),snapshotDate:date});
  }
  const byCard=new Map(ids.map(id=>[id,[]]));
  for(const {cardId,...price} of latest.values())byCard.get(cardId)?.push(price);
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  return {cards:ids.map(cardId=>({cardId,prices:byCard.get(cardId).sort((a,b)=>cmp(a.provider,b.provider)||cmp(a.variant,b.variant))})),meta:{exchangeRates:fx,note:REFERENCE_NOTE,truncated:(rows||[]).length>=REFERENCE_ROW_LIMIT,generatedAt:new Date(now).toISOString()}};
}
