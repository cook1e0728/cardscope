import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJpArchiveVariantPlans, buildJpArchiveVariantSql } from '../providers/pokemon-jp-archive-variant-plan.mjs';
import { pokemonJpPlanDigest } from '../providers/pokemon-jp-import-sql.mjs';

const page = (cardId, setMark, number, nameJa, rarityIcon = 'ic_rare_c_c') => ({ cardId: String(cardId), setMark, number, nameJa, rarityIcon });
const thumb = (cardId, setMark, suffix = 'P_X') => `/assets/images/card_images/large/${setMark}/${String(cardId).padStart(6, '0')}_${suffix}.jpg`;
const base = (code, num, nameJa, extra = {}) => ({ id: `pokemon-tcgdex-ja-${code.toLowerCase()}-${num}`, code, num, name_ja: nameJa, has_image: false, official_ids: null, ...extra });
const build = (pages, bases, series) => {
  const details = Object.fromEntries(pages.map(p => [p.cardId, p]));
  const thumbs = Object.fromEntries(pages.filter(p => !p.noThumb).map(p => [p.cardId, thumb(p.cardId, p.setMark, p.mirror ? 'P_X_m' : 'P_X')]));
  return buildJpArchiveVariantPlans({ details, thumbs, baseCards: bases, ...(series ? { series } : {}) });
};

const pages = [
  page(200, 'S9a', '001', 'ナゾノクサ'), page(100, 'S9a', '001', 'ナゾノクサ'), // pages out of order: 100 is version 1
  { ...page(300, 'S9a', '002', 'ビリジオン'), mirror: false }, page(310, 'S9a', '002', 'ビリジオン'), { ...page(320, 'S9a', '002', 'ビリジオン'), mirror: true },
  page(400, 'S9a', '003', 'ひとり'), // single page: not a split target
  page(500, 'S10a', '001', 'パラス'), page(501, 'S10a', '001', 'パラス'),
  page(600, 'SV1', '001', 'ほか'), page(601, 'SV1', '001', 'ほか') // outside the four series
];
const bases = [base('S9a', '001', 'ナゾノクサ'), base('S9a', '002', 'ビリジオン', { has_image: true }), base('S9a', '003', 'ひとり'), base('S10a', '001', 'パラス')];

test('ADR 0039: same number and name pages form groups, the smaller card ID is version 1', () => {
  const { plans, skipped, summary } = build(pages, bases);
  assert.deepEqual(skipped, []);
  assert.deepEqual(plans.map(item => [item.series, item.bases, item.cards, item.baseImages]), [['S9a', 2, 3, 1], ['S10a', 1, 1, 1]]);
  const [first, second] = plans[0].plan.rows;
  assert.deepEqual(plans[0].plan, { version: 1, rule: 'adr-0039', rows: [first, second] });
  assert.deepEqual(Object.keys(first), ['baseCardId', 'seriesCode', 'number', 'nameJa', 'officialCardIds', 'baseOfficial', 'variants']);
  assert.equal(first.baseCardId, 'pokemon-tcgdex-ja-s9a-001');
  assert.deepEqual(first.officialCardIds, ['100', '200']);
  assert.deepEqual(first.baseOfficial, { officialCardId: '100', imageUrl: 'https://www.pokemon-card.com/assets/images/card_images/large/S9a/000100_P_X.jpg', sourceUrl: 'https://www.pokemon-card.com/card-search/details.php/card/100/regu/all' });
  assert.deepEqual(first.variants, [{ cardId: 'pokemon-tcgdex-ja-s9a-001-v2', officialCardId: '200', variantIndex: 2, variantName: '版本 2', imageUrl: 'https://www.pokemon-card.com/assets/images/card_images/large/S9a/000200_P_X.jpg', sourceUrl: 'https://www.pokemon-card.com/card-search/details.php/card/200/regu/all' }]);
  assert.deepEqual(second.variants.map(v => [v.cardId, v.officialCardId, v.variantIndex]), [['pokemon-tcgdex-ja-s9a-002-v2', '310', 2], ['pokemon-tcgdex-ja-s9a-002-v3', '320', 3]]);
  assert.deepEqual(second.officialCardIds, ['300', '310', '320']);
  assert.ok(!('hasImage' in first) && !('hasImage' in second));
  assert.deepEqual(summary.map(row => [row.series, row.officialPages, row.groups, row.singlePageGroups, row.multiPageGroups, row.plannedBases, row.plannedNewCards, row.baseImagesToAdd, row.plans]), [
    ['S9a', 6, 3, 1, 2, 2, 3, 1, 1], ['S10a', 2, 1, 0, 1, 1, 1, 1, 1], ['S11a', 0, 0, 0, 0, 0, 0, 0, 0], ['S12a', 0, 0, 0, 0, 0, 0, 0, 0]
  ]);
});

test('ADR 0039: a page whose image file name ends in _m is named with the mirror suffix', () => {
  const mirrored = [page(100, 'S9a', '001', 'ナゾノクサ'), { ...page(200, 'S9a', '001', 'ナゾノクサ'), mirror: true }, { ...page(300, 'S9a', '001', 'ナゾノクサ'), mirror: true }];
  const { plans } = build(mirrored, [base('S9a', '001', 'ナゾノクサ')]);
  const [row] = plans[0].plan.rows;
  assert.deepEqual(row.variants.map(v => v.variantName), ['版本 2（ミラー）', '版本 3（ミラー）']);
  assert.ok(row.variants[0].imageUrl.endsWith('_m.jpg'));
  const plain = build([page(100, 'S9a', '001', 'ナゾノクサ'), page(200, 'S9a', '001', 'ナゾノクサ')], [base('S9a', '001', 'ナゾノクサ')]);
  assert.equal(plain.plans[0].plan.rows[0].variants[0].variantName, '版本 2');
});

test('ADR 0039: groups without exactly one base, with different rarity icons, or without thumbnails are skipped and reported', () => {
  const group = [page(100, 'S9a', '001', 'ナゾノクサ'), page(200, 'S9a', '001', 'ナゾノクサ')];
  const reason = (pagesIn, basesIn) => {
    const result = build(pagesIn, basesIn);
    assert.equal(result.plans.length, 0);
    assert.equal(result.skipped.length, 1);
    return result.skipped[0];
  };
  assert.deepEqual(reason(group, []), { series: 'S9a', number: '001', nameJa: 'ナゾノクサ', cardIds: ['100', '200'], reason: 'no-base' });
  assert.equal(reason(group, [base('S9a', '001', 'ナゾノクサ'), base('S9a', '001', 'ナゾノクサ', { id: 'other' })]).reason, 'multiple-bases');
  assert.equal(reason(group, [base('S9a', '001', 'ナゾノクサ', { name_ja: 'ちがう' })]).reason, 'no-base');
  assert.equal(reason([group[0], page(200, 'S9a', '001', 'ナゾノクサ', 'ic_rare_u_u')], [base('S9a', '001', 'ナゾノクサ')]).reason, 'rarity-mismatch');
  assert.equal(reason([group[0], { ...group[1], noThumb: true }], [base('S9a', '001', 'ナゾノクサ')]).reason, 'missing-thumb');
  assert.equal(reason(group, [base('S9a', '001', 'ナゾノクサ', { official_ids: ['100', '999'] })]).reason, 'base-official-ids-differ');
  const summary = build(group, []).summary[0];
  assert.deepEqual([summary.multiPageGroups, summary.plannedNewCards, summary.skipped], [1, 0, { 'no-base': 1 }]);
  // a base that already carries the same official IDs is still planned (the SQL function decides replay)
  assert.equal(build(group, [base('S9a', '001', 'ナゾノクサ', { official_ids: ['100', '200'] })]).plans.length, 1);
});

test('ADR 0039: plans hold at most 100 new cards, never split a base card, and cover one series each', () => {
  const many = [], list = [];
  for (let i = 1; i <= 99; i++) {
    const number = String(i).padStart(3, '0');
    many.push(page(1000 + i * 2, 'S12a', number, `カード${i}`), page(1001 + i * 2, 'S12a', number, `カード${i}`));
    list.push(base('S12a', number, `カード${i}`));
  }
  // base 100 has three pages (two new cards): 99 + 2 > 100 so it starts the next plan whole
  many.push(page(5000, 'S12a', '100', 'ながい'), page(5001, 'S12a', '100', 'ながい'), page(5002, 'S12a', '100', 'ながい'));
  list.push(base('S12a', '100', 'ながい'));
  many.push(page(9000, 'S11a', '001', 'べつ'), page(9001, 'S11a', '001', 'べつ'));
  list.push(base('S11a', '001', 'べつ'));
  const { plans, summary } = build(many, list);
  assert.deepEqual(plans.map(item => [item.series, item.bases, item.cards]), [['S11a', 1, 1], ['S12a', 99, 99], ['S12a', 1, 2]]);
  for (const item of plans) assert.ok(item.plan.rows.reduce((sum, row) => sum + row.variants.length, 0) <= 100);
  assert.deepEqual(plans[2].plan.rows[0].officialCardIds, ['5000', '5001', '5002']);
  assert.deepEqual(plans[1].plan.rows.map(row => row.number).slice(0, 3), ['001', '002', '003']);
  assert.equal(summary.find(row => row.series === 'S12a').plans, 2);
  assert.equal(summary.find(row => row.series === 'S12a').plannedNewCards, 101);
});

test('ADR 0039: the gated SQL runs the dry run, checks the exact counts, then writes; the replay must change nothing', () => {
  const { plans } = build(pages, bases);
  const { plan, baseImages } = plans[0];
  assert.throws(() => buildJpArchiveVariantSql(plan, ' ', baseImages), /ACTOR_REQUIRED/);
  assert.throws(() => buildJpArchiveVariantSql(plan, 'tester'), /BASE_IMAGES_REQUIRED/);
  const { digest, gated, replay } = buildJpArchiveVariantSql(plan, 'tester', baseImages);
  assert.equal(digest, pokemonJpPlanDigest(plan));
  assert.match(gated, /private\.split_pokemon_jp_archive_variants\(\$plan\$\{"version":1,"rule":"adr-0039"/);
  assert.match(gated, /, 'tester', true\)/);
  assert.match(gated, /, 'tester', false\)/);
  assert.match(gated, /'\{"cards": 3, "printings": 3, "images": 3, "baseImages": 1\}'::jsonb/);
  assert.match(gated, /'\{"baseCards": 2, "basePrintings": 2\}'::jsonb/);
  assert.ok(gated.includes(`'${digest}'`));
  assert.match(gated, /unexpected dry run/);
  assert.match(gated, /insert into jp_archive_variant_result values \(r\)/);
  assert.match(replay, /, 'tester', false\)/);
  assert.match(replay, /not \(r->>'replay'\)::boolean/);
  assert.match(replay, /'\{"cards": 0, "printings": 0, "images": 0, "baseImages": 0\}'::jsonb/);
  assert.ok(!/, true\)/.test(replay));
  assert.throws(() => buildJpArchiveVariantSql({ ...plan, rows: [{ ...plan.rows[0], nameJa: '$plan$' }] }, 'tester', 0), /PLAN_QUOTE_COLLISION/);
});
