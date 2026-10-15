import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTwOfficialVariantPlans, buildTwOfficialVariantSql } from '../providers/pokemon-tw-official-variant-plan.mjs';
import { pokemonJpPlanDigest } from '../providers/pokemon-jp-import-sql.mjs';

const page = (nameZh, setMark, number, total = '100') => ({ nameZh, setMark, number, total });
const base = (code, num, nameZh, ids, extra = {}) => ({
  id: `pokemon-official-tw-${code.toLowerCase()}-${num}`, source: 'asia-pokemon-card-official-tw', provider_id: ids[0], code, num, name_zh: nameZh, ids, has_image: false, ...extra
});
const details = {
  100: page('藤藤蛇', 'SV11B_exp', '001'), 101: page('藤藤蛇', 'SV11B_exp', '001'),
  200: page('<阿響的>凱羅斯', 'twhk_m2a_exp', '001'), 210: page('<阿響的>凱羅斯', 'twhk_m2a_exp', '001'), 220: page('<阿響的>凱羅斯', 'twhk_m2a_exp', '001'),
  300: page('好友寶芬', 'PROMO.MARK', '230', 'SV-P'), 301: page('好友寶芬', 'PROMO.MARK', '230', 'SV-P'),
  400: page('超級球', 'twhk_SVI_exp', '052'), 401: page('超級球', 'twhk_SVI_exp', '052'), 402: page('超級球', 'twhk_SVI_exp', '052'), 403: page('超級球', 'twhk_SVI_exp', '052')
};
const bases = [
  base('SV11B', '001', '藤藤蛇', ['100', '101']),
  base('M2a', '001', '<阿響的>凱羅斯', ['200', '210', '220'], { has_image: true }),
  base('SV-P', '230', '好友寶芬', ['300', '301']),
  { ...base('SV2a', '052', '超級球', ['400', '401', '402', '403']), id: 'pokemon-tcgdex-tw-sv2a-052', source: 'tcgdex-zh-tw', provider_id: 'SV2a-052' }
];
const details2 = { ...details, 400: page('超級球', 'SV2a_exp', '052'), 401: page('超級球', 'SV2a_exp', '052'), 402: page('超級球', 'SV2a_exp', '052'), 403: page('超級球', 'SV2a_exp', '052') };

test('ADR 0043: the smallest official ID stays on the base card, the others become version cards numbered by ID order', () => {
  const { plans, skipped, summary } = buildTwOfficialVariantPlans({ details: details2, baseCards: bases });
  assert.deepEqual(skipped, []);
  assert.deepEqual(plans.map(item => [item.series, item.bases, item.cards, item.baseImages]), [['M2a', 1, 2, 0], ['SV-P', 1, 1, 1], ['SV11B', 1, 1, 1], ['SV2a', 1, 3, 1]]);
  const [m2a, , sv11b, sv2a] = plans.map(item => item.plan);
  assert.deepEqual(sv11b, {
    version: 1, rule: 'adr-0043', rows: [{
      baseCardId: 'pokemon-official-tw-sv11b-001', seriesCode: 'SV11B', number: '001', nameZh: '藤藤蛇', officialDetailIds: ['100', '101'],
      baseOfficial: { detailId: '100', imageUrl: 'https://asia.pokemon-card.com/tw/card-img/tw00000100.png', sourceUrl: 'https://asia.pokemon-card.com/tw/card-search/detail/100/' },
      variants: [{ cardId: 'pokemon-official-tw-sv11b-001-v2', detailId: '101', variantIndex: 2, variantName: '版本 2', imageUrl: 'https://asia.pokemon-card.com/tw/card-img/tw00000101.png', sourceUrl: 'https://asia.pokemon-card.com/tw/card-search/detail/101/' }]
    }]
  });
  assert.deepEqual(Object.keys(sv11b.rows[0]), ['baseCardId', 'seriesCode', 'number', 'nameZh', 'officialDetailIds', 'baseOfficial', 'variants']);
  assert.deepEqual(m2a.rows[0].variants.map(v => [v.cardId, v.detailId, v.variantIndex, v.variantName]), [['pokemon-official-tw-m2a-001-v2', '210', 2, '版本 2'], ['pokemon-official-tw-m2a-001-v3', '220', 3, '版本 3']]);
  assert.deepEqual(sv2a.rows[0].variants.map(v => v.variantName), ['版本 2', '版本 3', '版本 4']);
  assert.ok(!('hasImage' in m2a.rows[0]));
  assert.deepEqual(summary.map(row => [row.series, row.baseCards, row.plannedBases, row.plannedNewCards, row.baseImagesToAdd, row.plans]), [['M2a', 1, 1, 2, 0, 1], ['SV-P', 1, 1, 1, 1, 1], ['SV11B', 1, 1, 1, 1, 1], ['SV2a', 1, 1, 3, 1, 1]]);
});

test('ADR 0043: cards that disagree with their cached official pages are skipped and reported', () => {
  const reason = (card, cache = details2) => {
    const result = buildTwOfficialVariantPlans({ details: cache, baseCards: [card] });
    assert.equal(result.plans.length, 0);
    assert.equal(result.skipped.length, 1);
    return result.skipped[0].reason;
  };
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['100'])), 'single-version');
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['101', '100'])), 'ids-not-sorted');
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['100', '100'])), 'bad-detail-id');
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['100', 'x1'])), 'bad-detail-id');
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['100', '999'])), 'detail-not-cached');
  assert.match(reason(base('SV11B', '002', '藤藤蛇', ['100', '101'])), /^detail-disagrees:100:SV11B_exp:001:藤藤蛇$/);
  assert.match(reason(base('SV11B', '001', '別的名字', ['100', '101'])), /^detail-disagrees:100/);
  assert.match(reason(base('SV11B', '001', '藤藤蛇', ['100', '101']), { ...details2, 101: page('藤藤蛇', 'SV11W_exp', '001') }), /^detail-disagrees:101:SV11W_exp/);
  assert.equal(reason(base('SV11B', '001', '藤藤蛇', ['100', '101'], { provider_id: '101' })), 'base-provider-not-smallest');
  // a TCGdex base has its own Provider ID; only the official-source base must carry the smallest ID
  assert.equal(buildTwOfficialVariantPlans({ details: details2, baseCards: [bases[3]] }).plans.length, 1);
});

test('ADR 0043: set marks that differ in case or carry a suffix still match, a name with Source markup matches the plain official name', () => {
  const cache = { 100: page('<阿響的>凱羅斯', 'SV11B_exp', '001'), 101: page('阿響的凱羅斯', 'sv11b_F', '001') };
  const { plans, skipped } = buildTwOfficialVariantPlans({ details: cache, baseCards: [base('SV11B', '001', '<阿響的>凱羅斯', ['100', '101'])] });
  assert.deepEqual(skipped, []);
  assert.equal(plans.length, 1);
});

test('ADR 0043: plans hold at most 100 new cards, never split a base card, and cover one series each', () => {
  const cache = {}, list = [];
  for (let i = 1; i <= 50; i++) {
    const number = String(i).padStart(3, '0');
    for (const offset of [0, 1, 2]) cache[1000 + i * 10 + offset] = page(`卡${i}`, 'twhk_m2a_exp', number);
    list.push(base('M2a', number, `卡${i}`, [1000 + i * 10, 1001 + i * 10, 1002 + i * 10].map(String)));
  }
  // 50 bases x 2 new cards = 100 fills one plan; the 51st base starts the next
  cache[9000] = page('卡51', 'twhk_m2a_exp', '051'); cache[9001] = page('卡51', 'twhk_m2a_exp', '051'); cache[9002] = page('卡51', 'twhk_m2a_exp', '051');
  list.push(base('M2a', '051', '卡51', ['9000', '9001', '9002']));
  cache[9100] = page('別', 'SV11B_exp', '001'); cache[9101] = page('別', 'SV11B_exp', '001');
  list.push(base('SV11B', '001', '別', ['9100', '9101']));
  const { plans, summary } = buildTwOfficialVariantPlans({ details: cache, baseCards: list });
  assert.deepEqual(plans.map(item => [item.series, item.bases, item.cards]), [['M2a', 50, 100], ['M2a', 1, 2], ['SV11B', 1, 1]]);
  for (const item of plans) assert.ok(item.plan.rows.reduce((sum, row) => sum + row.variants.length, 0) <= 100);
  assert.deepEqual(plans[0].plan.rows.map(row => row.number).slice(0, 3), ['001', '002', '003']);
  assert.equal(summary.find(row => row.series === 'M2a').plans, 2);
});

test('ADR 0043: the gated SQL runs the dry run, checks the exact counts, then writes; the replay must change nothing', () => {
  const { plans } = buildTwOfficialVariantPlans({ details: details2, baseCards: bases });
  const { plan, baseImages } = plans[3];
  assert.throws(() => buildTwOfficialVariantSql(plan, ' ', baseImages), /ACTOR_REQUIRED/);
  assert.throws(() => buildTwOfficialVariantSql(plan, 'tester'), /BASE_IMAGES_REQUIRED/);
  const { digest, gated, replay } = buildTwOfficialVariantSql(plan, 'tester', baseImages);
  assert.equal(digest, pokemonJpPlanDigest(plan));
  assert.match(gated, /private\.split_pokemon_tw_official_variants\(\$plan\$\{"version":1,"rule":"adr-0043"/);
  assert.match(gated, /, 'tester', true\)/);
  assert.match(gated, /, 'tester', false\)/);
  assert.match(gated, /'\{"cards": 3, "printings": 3, "images": 3, "baseImages": 1\}'::jsonb/);
  assert.match(gated, /'\{"baseCards": 1, "basePrintings": 1\}'::jsonb/);
  assert.ok(gated.includes(`'${digest}'`));
  assert.match(gated, /unexpected dry run/);
  assert.match(gated, /drop table if exists pg_temp\.tw_official_variant_result;/);
  assert.match(gated, /insert into tw_official_variant_result values \(r\)/);
  assert.match(replay, /, 'tester', false\)/);
  assert.match(replay, /not \(r->>'replay'\)::boolean/);
  assert.match(replay, /'\{"cards": 0, "printings": 0, "images": 0, "baseImages": 0\}'::jsonb/);
  assert.ok(!/, true\)/.test(replay));
  assert.throws(() => buildTwOfficialVariantSql({ ...plan, rows: [{ ...plan.rows[0], nameZh: '$plan$' }] }, 'tester', 0), /PLAN_QUOTE_COLLISION/);
});

test('ADR 0043: the migration defines the audited function with the same rule, ID checks and row-count guards', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261016100000_pokemon_tw_official_variant_split.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function private\.split_pokemon_tw_official_variants\(/);
  assert.match(sql, /create table if not exists private\.catalog_tw_variant_split_audit/);
  assert.match(sql, /before update or delete on private\.catalog_tw_variant_split_audit/);
  assert.match(sql, /before truncate on private\.catalog_tw_variant_split_audit/);
  assert.match(sql, /accepts 1-100 distinct new cards per call/);
  assert.match(sql, /v_source constant text := 'asia-pokemon-card-official-tw'/);
  assert.match(sql, /v_image_source constant text := 'pokemon-tw-official'/);
  assert.match(sql, /'版本 ' \|\| pl\.idx/);
  assert.match(sql, /select pl\.card_id, p\.region, p\.language, p\.local_set_code, p\.local_card_number, null,/);
  assert.match(sql, /wrote an unexpected row count/);
  assert.match(sql, /grant execute on function private\.split_pokemon_tw_official_variants\(jsonb, text, boolean\) to service_role;/);
  assert.ok(!/\bdelete from\b/i.test(sql));
});
