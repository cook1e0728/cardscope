import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOfficialTwRarity, officialTwListUrl, officialTwRarityCode, parseOfficialTwDetail, parseOfficialTwList, twNameKey } from '../providers/pokemon-tw-official.mjs';

const detail = `<h1 class="pageHeader cardDetail"> <span class="evolveMarker"> 基礎 </span> 電電蟲 </h1> ... <section class="expansionColumn"> <p> <span class="expansionSymbol"> <img src="https://asia.pokemon-card.com/tw/card-img/mark/SV6a_F.png"> </span> <span class="alpha"> H </span> <span class="collectorNumber"> 001/064 </span> </p> </section>`;

test('TW detail page yields set mark, number and Chinese name without the evolve marker', () => {
  assert.deepEqual(parseOfficialTwDetail(detail), { nameZh: '電電蟲', setMark: 'SV6a', number: '001', total: '064' });
  assert.deepEqual(parseOfficialTwDetail('<p>nothing</p>'), { nameZh: null, setMark: null, number: null, total: null });
});

test('TW list pages give detail IDs and the page count', () => {
  assert.deepEqual(parseOfficialTwList('<a href="/tw/card-search/detail/10583/"></a><a href="/tw/card-search/detail/10584/"></a><span class="resultTotalPages">/ 共 5 頁</span>'), { detailIds: ['10583', '10584'], totalPages: 5 });
  assert.deepEqual(parseOfficialTwList('<ul class="list"></ul>'), { detailIds: [], totalPages: 0 });
  assert.match(officialTwListUrl({ seriesCode: 'SV8a', rarityValue: 11, page: 2 }), /expansionCodes=SV8a&rarity%5B%5D=11&pageNo=2/);
});

test('TW rarity labels map to database codes; 無標記 is NONE; unknown labels are quarantined', () => {
  assert.deepEqual(officialTwRarityCode('無標記'), { rarity: 'NONE' });
  assert.deepEqual(officialTwRarityCode('SAR'), { rarity: 'SAR' });
  assert.match(officialTwRarityCode('MA').quarantine, /UNMAPPED_TW_RARITY/);
});

test('TW names compare after dropping source name markup only', () => {
  assert.equal(twNameKey('<火箭隊的>超夢ex'), twNameKey('火箭隊的超夢ex'));
  assert.equal(twNameKey('坂木的領導力[支援者]'), twNameKey('坂木的領導力'));
  assert.equal(twNameKey('招式學習器 ‌衰退'), twNameKey('招式學習器 衰退'));
  assert.notEqual(twNameKey('未知圖騰 [A]'), twNameKey('未知圖騰'));
});

test('a TW printing takes the rarity only when every official entry for its number agrees', () => {
  const printing = { code: 'SV8a', num: '001', name_zh: '蛋蛋' };
  const entry = (detailId, labels, nameZh = '蛋蛋') => ({ detailId, setMark: 'SV8a', number: '001', nameZh, rarityLabels: labels });
  assert.deepEqual(matchOfficialTwRarity(printing, [entry('1', ['無標記']), entry('2', ['無標記'])]), { rarity: 'NONE', detailIds: ['1', '2'] });
  assert.match(matchOfficialTwRarity(printing, [entry('1', ['無標記']), entry('2', ['RR'])]).quarantine, /RARITY_AMBIGUOUS/);
  assert.match(matchOfficialTwRarity(printing, [entry('1', [])]).quarantine, /RARITY_AMBIGUOUS/);
  assert.match(matchOfficialTwRarity(printing, [entry('1', ['C'], '別的')]).quarantine, /NAME_MISMATCH/);
  assert.match(matchOfficialTwRarity(printing, []).quarantine, /OFFICIAL_ENTRY_NOT_FOUND/);
});

import { normalizeRarityValue } from '../providers/normalize.mjs';

test('a source "None" stays unknown; only the exact code NONE is No rarity mark', () => {
  assert.equal(normalizeRarityValue('pokemon', 'None').known, false);
  assert.equal(normalizeRarityValue('pokemon', 'none').known, false);
  assert.equal(normalizeRarityValue('pokemon', 'NONE').code, 'NONE');
  assert.equal(normalizeRarityValue('pokemon', '無標記').code, 'NONE');
});

import { twSetMarkKey } from '../providers/pokemon-tw-official.mjs';

test('TW set marks compare without the image-name suffix or case', () => {
  for (const mark of ['SV6a', 'sv6a_f', 'SV6a F@4x', 'SV6a_F']) assert.equal(twSetMarkKey(mark), 'SV6A');
  assert.notEqual(twSetMarkKey('SV6'), twSetMarkKey('SV6a'));
  assert.equal(matchOfficialTwRarity({ code: 'SV1a', num: '001', name_zh: '熱帶龍' }, [{ detailId: '1', setMark: 'sv1a_f', number: '001', nameZh: '熱帶龍', rarityLabels: ['C'] }]).rarity, 'C');
});
