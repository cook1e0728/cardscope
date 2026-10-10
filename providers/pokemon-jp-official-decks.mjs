// ADR 0032：同一系列代碼由多個商品（牌組）各自從 001 編號時，以官方詳細頁的「収録商品」分盒。

const decodeEntities = text => text
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/**
 * 從官方卡片詳細頁取出「収録商品」：頁面的 SubSection 裡每個 `Link-arrow` 連結是一個商品。
 * 回傳 [{ name, path }]，名稱保留官方原字串（含全形空白），沒有収録商品時回傳空陣列。
 */
export function parseOfficialJpProducts(html) {
  const section = String(html).split('class="SubSection"')[1] ?? '';
  const products = [];
  for (const match of section.matchAll(/<a href="([^"]*)" class="Link Link-arrow">([^<]*)<\/a>/g)) {
    const name = decodeEntities(match[2]).trim();
    if (name) products.push({ name, path: match[1] });
  }
  return products;
}

/**
 * 把一個系列代碼的官方清單依「収録商品」分盒。只在系列有同號不同名（ADR 0025 排除的情況）時使用。
 * 每頁須恰好一個収録商品；各盒依最小官方卡片 ID 排序，第 1 盒沿用原代碼，第 k 盒為 `<代碼>-<k>`。
 * 同一盒內卡號不可重複；沒有卡號的頁面（基本能量等）留給匯入計畫照常隔離。
 * 回傳 [{ deckCode, productName, productPath, cardIds }]。
 */
export function groupOfficialJpDecks({ code, cache, products }) {
  const list = cache.lists?.[code];
  if (!list) throw new Error(`OFFICIAL_LIST_MISSING:${code}`);
  const decks = new Map();
  for (const cardId of list.cardIds) {
    const found = products.cards?.[cardId]?.products;
    if (!found) throw new Error(`OFFICIAL_PRODUCTS_MISSING:${code}:${cardId}`);
    if (found.length !== 1) throw new Error(`OFFICIAL_PRODUCTS_NOT_SINGLE:${code}:${cardId}:${found.length}`);
    const [{ name, path }] = found;
    if (!decks.has(name)) decks.set(name, { productName: name, productPath: path, cardIds: [] });
    decks.get(name).cardIds.push(String(cardId));
  }
  if (decks.size < 2) throw new Error(`NOT_MULTI_DECK:${code}`);
  const ordered = [...decks.values()].map(deck => ({ ...deck, cardIds: deck.cardIds.sort((a, b) => Number(a) - Number(b)) }))
    .sort((a, b) => Number(a.cardIds[0]) - Number(b.cardIds[0]));
  return ordered.map((deck, index) => {
    const numbers = deck.cardIds.map(id => cache.details[id]?.number).filter(Boolean);
    if (new Set(numbers).size !== numbers.length) throw new Error(`DECK_NUMBER_REPEATED:${code}:${deck.productName}`);
    return { deckCode: index === 0 ? code : `${code}-${index + 1}`, ...deck };
  });
}
