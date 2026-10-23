import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAffix, buildBases, planJpNames } from '../scripts/fill-pokemon-jp-zh-name-affix.mjs';

const card = (id, name_ja, name_zh, b = 'tw-official') => ({ id, name_ja, name_zh, b });

test('splits only the six affixes, keeps the remaining name intact', () => {
  assert.deepEqual(splitAffix('ルガルガンex'), { base: 'ルガルガン', sep: '', affix: 'ex' });
  assert.deepEqual(splitAffix('ガチグマ アカツキ ex'), { base: 'ガチグマ アカツキ', sep: ' ', affix: 'ex' });
  assert.equal(splitAffix('ミュウツーVMAX').affix, 'VMAX');
  assert.equal(splitAffix('ミュウツーVSTAR').affix, 'VSTAR');
  assert.equal(splitAffix('ヒスイ ドレディアV').base, 'ヒスイ ドレディア');
  assert.equal(splitAffix('ミュウツーBREAK').affix, '');
  assert.equal(splitAffix('カイリュー').affix, '');
});

const evidence = [
  card('a', 'ルギア', '洛奇亞'), card('b', 'ルギアV', '洛奇亞V'),
  card('c', 'ガチグマ アカツキex', '月月熊 赫月 ex'), card('d', 'ガチグマ アカツキ', '月月熊 赫月', 'tw-official-same-number'),
  card('e', 'サーナイト', '沙奈朵'), card('f', 'サーナイトEX', 'M沙奈朵EX'),
  card('g', 'ロケット団のミミッキュ', '<火箭隊的>謎擬Q'),
  card('h', 'ピカチュウ', '皮卡丘', 'derived-cross-series') // derived names are never evidence
];

test('official names only: derived cards are not evidence, plain and affixed cards both count', () => {
  const b = buildBases(evidence);
  assert.deepEqual([...b.get('ルギア').zh], ['洛奇亞']);
  assert.equal(b.has('ピカチュウ'), false);
});

test('plans unique bases, keeps the official affix spacing, refuses everything else', () => {
  const t = [
    card('t1', 'ルギアVMAX', null), card('t2', 'ルギアex', ''),            // unique base -> filled
    card('t3', 'ガチグマ アカツキV', null),                                  // official spelling uses " ex": reuse the observed separator
    card('t4', 'サーナイトGX', null),                                        // 沙奈朵 vs M沙奈朵: not unique
    card('t5', 'ロケット団のミミッキュex', null),                           // markup in the base is not normalised
    card('t6', 'ピカチュウV', null), card('t7', 'ルギアBREAK', null), card('t8', 'ルギア', null), // no evidence / not affix / plain (ADR 0013's job)
    card('t9', 'ルギアV', '洛奇亞V')                                         // already has a name
  ];
  const { plan, skipped, ambiguous } = planJpNames([...evidence, ...t]);
  assert.deepEqual(plan.map(p => [p.id, p.name_zh, p.affix, p.source_card_id]), [
    ['t1', '洛奇亞VMAX', 'VMAX', 'a'], ['t2', '洛奇亞ex', 'ex', 'a'], ['t3', '月月熊 赫月 V', 'V', 'c']
  ]);
  assert.deepEqual(Object.fromEntries(skipped), { 'base-not-unique': 1, 'markup-in-base': 1, 'base-not-in-official-names': 1, 'not-affix-card': 2 });
  assert.deepEqual(ambiguous.map(a => [a.id, a.candidates.sort()]), [['t4', ['M沙奈朵', '沙奈朵']]]);
});

test('an official card whose zh does not carry the same affix poisons the base', () => {
  const { plan, skipped } = planJpNames([card('a', 'ルギアV', '洛奇亞'), card('t', 'ルギアex', null)]);
  assert.equal(plan.length, 0);
  assert.equal(skipped.get('evidence-affix-mismatch'), 1);
});
