const PROMO_RE=/特典|贈品卡|宣傳卡|促銷卡|\b(?:promo(?:tional)?|campaign|bonus card|prize card)\b|プロモ|キャンペーン|프로모|프로모션|특전/i;
const ACCESSORY_RE=/周邊|周辺|周邊道具|配件|\b(?:accessor(?:y|ies)?|supplies|play ?mats?|sleeves?|storage|binders?|portfolio|deck cases?|card cases?|dice|coins?|markers?|counters?)\b|遊戲墊|游戏垫|卡套|牌套|收納盒|收纳盒|卡冊|卡册|卡盒|牌盒|骰子|硬幣|プレイマット|スリーブ|デッキケース|カードケース|バインダー|サプライ|플레이매트|슬리브|덱 케이스|카드 케이스|바인더/i;

export const PRODUCT_CATEGORIES=['原盒','特典卡','周邊道具'];

export function classifyProduct(product={}){
  const text=[product.productType,product.nameZh,product.nameJa,product.name,product.nameEn,product.nameKo,product.metadata?.category,product.metadata?.productType].filter(Boolean).join(' ');
  if(PROMO_RE.test(text))return '特典卡';
  if(ACCESSORY_RE.test(text))return '周邊道具';
  return '原盒';
}

export function normalizeProduct(product={}){
  const catalogCategory=PRODUCT_CATEGORIES.includes(product.catalogCategory)?product.catalogCategory:classifyProduct(product);
  return {...product,catalogCategory,productSubtype:product.productSubtype||product.productType||'類型待補'};
}
