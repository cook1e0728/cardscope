const PROMO_RE=/特典|贈品卡|宣傳卡|促銷卡|配布|\b(?:promo(?:tional)?|campaign|bonus|giveaway|prize card)\b|プロモ|キャンペーン|配布|特典|프로모|프로모션|특전/i;
const ACCESSORY_RE=/周邊|周辺|周邊道具|配件|\b(?:accessor(?:y|ies)?|supplies|play ?mats?|sleeves?|storage|binders?|portfolio|deck cases?|deck boxes?|card cases?|dice|coins?|markers?)\b|遊戲墊|游戏垫|卡套|牌套|收納盒|收纳盒|卡冊|卡册|卡盒|牌盒|骰子|硬幣|プレイマット|スリーブ|デッキケース|カードケース|バインダー|サプライ|플레이매트|슬리브|덱 케이스|카드 케이스|바인더/i;
const DECK_RE=/牌組|牌组|構築|构筑|起始(?:牌組|牌组|組合)|預組|预组|試玩|试用|\b(?:starter|structure|constructed|preconstructed|trial|theme|battle|intro|beginner)\s*deck\b|\bdecks?\b|スタートデッキ|スターターデッキ|構築デッキ|トライアルデッキ|デッキ|스타터\s*덱|구축\s*덱/i;
const EVENT_STORE_RE=/賽事|賽事限定|商店限定|店鋪限定|店家限定|參加獎|参加賞|優勝|冠軍(?:獎|奖|卡|賽|赛|活動|活动)|獎品|奖品|大賽|大赛|\b(?:tournament|championship|champion(?:ship)?\s+(?:prize|reward|card)|winner|participation|event|store[- ]exclusive|shop[- ]limited|prize)\b|大会|店舗|ショップ|トーナメント|チャンピオン(?:シップ|大会|賞|カード)|優勝|参加賞|대회|우승|참가상/i;
const SEALED_RE=/密封|原盒|禮盒|礼盒|組合包|组合包|盒裝|盒装|鐵盒|铁盒|卡包|補充包|补充包|擴充包|扩充包|強化補充包|强化补充包|高級補充包|高级补充包|額外補充包|额外补充包|\b(?:booster|expansion|premium|extra)\s*(?:pack|box)?\b|\b(?:booster|display|box|bundle|collection|tin|blister|pack|set)s?\b|ブースターパック|拡張パック|プレミアムパック|ボックス|セット|缶/i;
const KNOWN_SEALED_NAME_RE=/\bgreat encounters\b/i;
const SINGLE_RE=/單卡|单卡|單張卡|单张卡|\b(?:single|individual)\s+card\b|\bcards?\b(?!\s*(?:box|case|sleeves?))/i;
const GENERIC_TYPE_RE=/^(?:商品|產品|产品|周邊商品|周边商品|product|item|merchandise|series|set|tcg product)$/i;

// Product feeds historically used the three labels below. Keep those labels in
// the accepted feed values while adding stable values for the categories that
// used to be collapsed into 原盒.
export const PRODUCT_CATEGORIES=Object.freeze(['原盒','特典卡','周邊道具','decks','event-store','other','singles']);

const CATEGORY_ALIASES=Object.freeze({
  '密封商品':'原盒',sealed:'原盒',
  '特典／贈品':'特典卡',promo:'特典卡',
  accessories:'周邊道具',
  '單卡':'singles',
  '牌組／構築商品':'decks',
  '賽事／商店限定':'event-store',
  '其他':'other'
});

function text(value){return String(value??'').normalize('NFKC').trim()}

function acceptedCategory(value){
  const valueText=text(value);
  if(PRODUCT_CATEGORIES.includes(valueText))return valueText;
  return CATEGORY_ALIASES[valueText]||null;
}

function classifyStructuredType(value){
  const type=text(value);
  if(!type||GENERIC_TYPE_RE.test(type))return null;
  if(/^series$/i.test(type)||/^系列$/.test(type))return 'other';
  if(ACCESSORY_RE.test(type))return '周邊道具';
  if(DECK_RE.test(type))return 'decks';
  if(EVENT_STORE_RE.test(type))return 'event-store';
  if(PROMO_RE.test(type))return '特典卡';
  if(SEALED_RE.test(type))return '原盒';
  if(SINGLE_RE.test(type))return 'singles';
  return null;
}

function classifyName(value){
  const name=text(value);
  // A physical accessory remains an accessory even when its marketing name
  // contains event words such as Champion or Tournament.
  if(ACCESSORY_RE.test(name))return '周邊道具';
  if(DECK_RE.test(name))return 'decks';
  if(EVENT_STORE_RE.test(name))return 'event-store';
  if(PROMO_RE.test(name))return '特典卡';
  if(SEALED_RE.test(name)||KNOWN_SEALED_NAME_RE.test(name))return '原盒';
  if(SINGLE_RE.test(name))return 'singles';
  return 'other';
}

export function classifyProduct(product={}){
  const explicit=acceptedCategory(product.catalogCategory);
  if(explicit)return explicit;

  // Source product types are authoritative. Names are only used when the
  // source did not provide a recognizable structured type.
  for(const type of [product.productType,product.metadata?.productType,product.metadata?.category]){
    const category=classifyStructuredType(type);
    if(category)return category;
  }

  return classifyName([
    product.nameZh,product.nameJa,product.name,product.nameEn,product.nameKo,
    product.metadata?.name,product.metadata?.title
  ].filter(Boolean).join(' '));
}

export function normalizeProduct(product={}){
  const catalogCategory=acceptedCategory(product.catalogCategory)||classifyProduct(product);
  return {...product,catalogCategory,productSubtype:product.productSubtype||product.productType||'類型待補'};
}
