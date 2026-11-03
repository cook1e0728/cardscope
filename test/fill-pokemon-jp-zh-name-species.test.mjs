import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpeciesCsv, checkSpecies, planSpeciesNames } from '../scripts/fill-pokemon-jp-zh-name-species.mjs';

const csv = ['pokemon_species_id,local_language_id,name,genus', '25,1,ピカチュウ,', '25,4,皮卡丘,', '194,1,ウパー,', '194,4,烏波,', '37,1,ロコン,', '37,4,六尾,', '778,1,ミミッキュ,', '778,4,謎擬Ｑ,', '282,1,サーナイト,', '282,4,沙奈朵,', '9,1,ピカチュウ,', '9,4,別的,'].join('\n');

test('species csv: ja-Hrkt -> zh-Hant, NFKC, a Japanese name shared by two species is dropped', () => {
  const species = parseSpeciesCsv(csv);
  assert.equal(species.get('ウパー'), '烏波');
  assert.equal(species.get('ミミッキュ'), '謎擬Q');
  assert.equal(species.has('ピカチュウ'), false);
});

test('species our TW-official names contradict are not used', () => {
  const species = parseSpeciesCsv(csv);
  const conflicts = checkSpecies(species, [
    { id: 'a', name_ja: 'サーナイトEX', name_zh: 'M沙奈朵EX', b: 'tw-official-same-number' },
    { id: 'b', name_ja: 'ミミッキュV', name_zh: '謎擬ＱV', b: 'tw-official' },
    { id: 'c', name_ja: 'ウパー', name_zh: '別的', b: 'derived-cross-series' }
  ]);
  assert.deepEqual(conflicts.map(c => c.ja), ['サーナイト'], '全形半形不算衝突；推導來的名稱不當證據');
  assert.equal(species.has('サーナイト'), false);
});

test('plan: plain species, regional form, kanji prefix only via one TW name, everything else skipped', () => {
  const species = new Map([['ウパー', '烏波'], ['ロコン', '六尾'], ['ピカチュウ', '皮卡丘']]);
  const rows = ['ウパー', 'ヌオー', 'ロコンGX', 'アローラロコン', '名探偵ピカチュウ', '偵探ピカチュウ', 'カナザワのピカチュウ', 'シロナ'].map(name_ja => ({ id: name_ja, name_ja }));
  rows.push({ id: 'done', name_ja: 'ウパー', name_zh: '烏波' });
  const { plan, skipped } = planSpeciesNames(rows, species, new Set(['名偵探皮卡丘', '臺北的皮卡丘']));
  assert.deepEqual(plan.map(p => [p.name_ja, p.name_zh, p.rule]), [
    ['ウパー', '烏波', 'species'], ['ロコンGX', '六尾GX', 'species'], ['アローラロコン', '阿羅拉 六尾', 'regional-form'], ['名探偵ピカチュウ', '名偵探皮卡丘', 'tw-name']
  ]);
  assert.deepEqual(Object.fromEntries(skipped), { 'no-species': 2, 'prefix-not-in-tw-names': 1, 'prefix-not-kanji': 1 });
});
