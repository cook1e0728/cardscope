import test from 'node:test';
import assert from 'node:assert/strict';
import { onePieceImageTarget } from '../providers/catalog-core.mjs';
import { mergePrizeRows } from '../providers/pack-prizes.mjs';

test('official image proxy accepts Union Arena card images but only under its card list path', () => {
  assert.ok(onePieceImageTarget('https://www.unionarena-tcg.com/jp/images/cardlist/card/EX17BT_REZ-2-011_p2.png?v9'));
  assert.ok(onePieceImageTarget('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP18-064_p1.png'));
  assert.equal(onePieceImageTarget('https://www.unionarena-tcg.com/images/cardlist/card/x.png'), null);
  assert.equal(onePieceImageTarget('https://www.unionarena-tcg.com/jp/news/x.png'), null);
  assert.equal(onePieceImageTarget('https://asia-tc.onepiece-cardgame.com/jp/images/cardlist/card/x.png'), null);
  assert.equal(onePieceImageTarget('https://evil.unionarena-tcg.com/jp/images/cardlist/card/x.png'), null);
});

test('a TW prize card with no price borrows the same-number JP card even when JP left it out of its prize rows', () => {
  const tw = { cardId: 'pokemon-official-tw-m6a-134', cardNumber: '134', rarity: 'FUR', altArt: false, referencePrice: null };
  const jpPriced = { cardId: 'pokemon-tcgdex-ja-m6a-134', cardNumber: '134', rarity: null, referencePrice: { amount: 10.77, currency: 'EUR', amountTwd: 389 } };
  const other = { cardId: 'pokemon-tcgdex-ja-m6a-999', cardNumber: '999', rarity: null, referencePrice: { amount: 1, currency: 'EUR', amountTwd: 36 } };
  const [row] = mergePrizeRows('pokemon', [{ region: 'TW', rows: [tw], priced: [] }, { region: 'JP', rows: [], priced: [jpPriced, other] }]);
  assert.equal(row.cardId, tw.cardId);
  assert.equal(row.referencePrice.amountTwd, 389);
  assert.equal(row.priceRegion, 'JP');
});
