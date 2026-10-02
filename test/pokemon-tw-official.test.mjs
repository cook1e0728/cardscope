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
  const entry = (detailId, labels, nameZh = '蛋蛋') => ({ detailId, listCode: 'SV8a', setMark: 'SV8a', number: '001', nameZh, rarityLabels: labels });
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

import { twSetMarkMatches } from '../providers/pokemon-tw-official.mjs';

test('TW set marks must contain the series code as a token, whatever the image naming', () => {
  for (const mark of ['SV6a', 'sv6a_f', 'SV6a F@4x', 'SV6a_F@4x', 'twhk_sv6a_exp', 'exp_SV6a', 'SV6aF_exp']) assert.equal(twSetMarkMatches(mark, 'SV6a'), true, mark);
  assert.equal(twSetMarkMatches('sv6a_f', 'SV6'), false);
  assert.equal(twSetMarkMatches('PROMO.MARK', 'SV-P'), false);
  const entry = { detailId: '1', listCode: 'SV1a', setMark: 'sv1a_f', number: '001', nameZh: '熱帶龍', rarityLabels: ['C'] };
  assert.equal(matchOfficialTwRarity({ code: 'SV1a', num: '001', name_zh: '熱帶龍' }, [entry]).rarity, 'C');
  assert.match(matchOfficialTwRarity({ code: 'SV1a', num: '001', name_zh: '熱帶龍' }, [{ ...entry, setMark: 'sv1_f' }]).quarantine, /SET_MARK_MISMATCH/);
  assert.match(matchOfficialTwRarity({ code: 'SV1a', num: '001', name_zh: '熱帶龍' }, [{ ...entry, listCode: 'SV1S' }]).quarantine, /OFFICIAL_ENTRY_NOT_FOUND/);
});

import { sameTwName } from '../providers/pokemon-tw-official.mjs';

test('TW names may drop one trailing bracket note, as on the Japanese page', () => {
  assert.equal(sameTwName('妮莫（過去）', '妮莫'), true);
  assert.equal(sameTwName('博士的研究(弗圖博士)', '博士的研究(弗圖博士)'), true);
  assert.equal(sameTwName('妮莫的什麼', '妮莫'), false);
  assert.equal(sameTwName('妮莫', ''), false);
});

const statusMigration = await (await import('node:fs/promises')).readFile(new URL('../supabase/migrations/20261002160000_pokemon_tw_printing_status.sql', import.meta.url), 'utf8');

test('TW printing status promotion is upgrade-only and needs a verified card with a known rarity', () => {
  assert.match(statusMigration, /p\.data_status = 'incomplete' and c\.data_status = 'verified'/);
  assert.match(statusMigration, /p\.rarity_code is not null and c\.rarity is not distinct from p\.rarity/);
  assert.match(statusMigration, /limit 100/);
  assert.match(statusMigration, /revoke all on function private\.promote_pokemon_tw_printing_status\(text, text, boolean\) from public, anon, authenticated/);
});

test('TW promos match by the set printed after the slash instead of the generic promo mark', () => {
  const promo = { detailId: '7800', listCode: 'SV-P', setMark: 'PROMO.MARK', number: '001', total: 'SV-P', nameZh: '皮卡丘', rarityLabels: ['無標記'] };
  assert.deepEqual(matchOfficialTwRarity({ code: 'SV-P', num: '001', name_zh: '皮卡丘' }, [promo]), { rarity: 'NONE', detailIds: ['7800'] });
  assert.match(matchOfficialTwRarity({ code: 'SV-P', num: '001', name_zh: '皮卡丘' }, [{ ...promo, total: 'S-P' }]).quarantine, /SET_MARK_MISMATCH/);
});

const sameNumberMigration = await (await import('node:fs/promises')).readFile(new URL('../supabase/migrations/20261003000000_pokemon_jp_from_tw_official.sql', import.meta.url), 'utf8');

test('JP fill from the TW official same-number card is fill-only and rejects conflicts', () => {
  assert.match(sameNumberMigration, /'name-conflict'/);
  assert.match(sameNumberMigration, /'printing-conflict'/);
  assert.match(sameNumberMigration, /pl\.name_zh is not null and c\.name_zh is null/);
  assert.match(sameNumberMigration, /pl\.rarity is not null and p\.rarity_code is null/);
  assert.match(sameNumberMigration, /'nameZhBasis', 'tw-official-same-number'/);
});
