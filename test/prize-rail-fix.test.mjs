import test from 'node:test';
import assert from 'node:assert/strict';
import { onePieceImageTarget } from '../providers/catalog-core.mjs';
import { prizeRow } from '../providers/pack-prizes.mjs';

test('official image proxy accepts Union Arena card images but only under its card list path', () => {
  assert.ok(onePieceImageTarget('https://www.unionarena-tcg.com/jp/images/cardlist/card/EX17BT_REZ-2-011_p2.png?v9'));
  assert.ok(onePieceImageTarget('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP18-064_p1.png'));
  assert.equal(onePieceImageTarget('https://www.unionarena-tcg.com/images/cardlist/card/x.png'), null);
  assert.equal(onePieceImageTarget('https://www.unionarena-tcg.com/jp/news/x.png'), null);
  assert.equal(onePieceImageTarget('https://asia-tc.onepiece-cardgame.com/jp/images/cardlist/card/x.png'), null);
  assert.equal(onePieceImageTarget('https://evil.unionarena-tcg.com/jp/images/cardlist/card/x.png'), null);
});

test('prize row keeps the region of a borrowed linked-printing price', () => {
  const series = { id: 's', officialCode: 'M6a', game: 'pokemon' };
  const card = { id: 'pokemon-official-tw-m6a-134', game: 'pokemon', officialCardNumber: '134', referencePrice: { amount: 10, currency: 'EUR', amountTwd: 360 }, referencePriceRegion: 'JP' };
  assert.equal(prizeRow(card, series).priceRegion, 'JP');
  assert.equal('priceRegion' in prizeRow({ ...card, referencePriceRegion: undefined }, series), false);
});
