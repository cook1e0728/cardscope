import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecies, composeZh, planNames } from '../scripts/fill-pokemon-us-zh-names.mjs';

const card = (id, name_en, name_zh, dex, st = 'Pokémon') => ({ id, name_en, name_zh, dex, st });
const rows = [
  card('a', 'Charizard', '噴火龍', [6]), card('b', 'Charizard ex', '噴火龍 ex', [6]),
  card('c', 'Vulpix', '六尾', [37]), card('d', 'Pikachu V', '皮卡丘 V', [25]), // only a suffixed card knows Pikachu
  card('e', 'Tapu Koko', '卡璞・鳴鳴', [785])
];

test('species table is built from existing zh names and strips suffixes', () => {
  const sp = buildSpecies(rows);
  assert.deepEqual(sp.get(6), { en: 'Charizard', zh: '噴火龍' });
  assert.deepEqual(sp.get(25), { en: 'Pikachu', zh: '皮卡丘' });
});

test('composes species, regional form and affixes; refuses what the database cannot prove', () => {
  const sp = buildSpecies(rows), z = (en, dex, st) => composeZh(card('x', en, null, dex, st), sp);
  assert.equal(z('Charizard-GX', [6]).zh, '噴火龍 GX');
  assert.equal(z('Charizard-EX', [6]).zh, '噴火龍 EX');
  assert.equal(z('Charizard VMAX', [6]).zh, '噴火龍 VMAX');
  assert.equal(z('Alolan Vulpix', [37]).zh, '阿羅拉 六尾');
  assert.equal(z('Galarian Pikachu V', [25]).zh, '伽勒爾 皮卡丘 V');
  assert.equal(z('Tapu Koko-GX', [785]).zh, '卡璞・鳴鳴 GX');
  for (const [en, dex, st, reason] of [
    ['Dark Charizard', [6], 'Pokémon', 'prefix:Dark'], ['Mega Charizard ex', [6], 'Pokémon', 'prefix:Mega'], ["Erika's Vulpix", [37], 'Pokémon', "prefix:Erika's"],
    ['Charizard LEGEND', [6], 'Pokémon', 'suffix:LEGEND'], ['Charizard & Vulpix-GX', [6, 37], 'Pokémon', 'tag-team-multi-species'],
    ['Nidoran ♀', [29], 'Pokémon', 'species-not-in-db'], ['Okidogi', [], 'Pokémon', 'no-pokedex-number'], ['Erika', [], 'Trainer', 'supertype:Trainer']
  ]) assert.equal(z(en, dex, st).reason, reason, en);
});

test('plan only covers cards without a Chinese name', () => {
  const { plan } = planNames([...rows, card('f', 'Alolan Vulpix', null, [37]), card('g', 'Vulpix', '六尾', [37])]);
  assert.deepEqual(plan.map(p => [p.id, p.name_zh, p.rule]), [['f', '阿羅拉 六尾', 'regional-form']]);
});
