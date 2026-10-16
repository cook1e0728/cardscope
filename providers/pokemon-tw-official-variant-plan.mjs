import { pokemonJpPlanDigest } from './pokemon-jp-import-sql.mjs';
import { officialTwDetailUrl, sameTwName, twSetMarkMatches } from './pokemon-tw-official.mjs';
import { officialTwImageUrl } from './pokemon-tw-card-images-plan.mjs';

// ADR 0043: a Taiwanese card whose printing lists several official detail IDs (metadata.officialDetailIds) under one
// number is several official versions. The smallest ID is the existing card (version 1); every other page becomes
// `<base>-v<k>` (private.split_pokemon_tw_official_variants, same rules as ADR 0035 / 0039). The cached official detail
// pages hold only name, set mark and number, so names are the neutral 「版本 k」. No network or database calls.
// Addendum (2026-10-17): a base card that already shows a TCGdex image corresponds to the official page whose image it is
// (compared image by image, docs/evidence/pokemon-tw/variant-split-20261017/). `imageMatches` maps that base card to its page; when it
// is not the smallest ID the row carries `baseVersionIndex` (its position in the sorted IDs), the base card is that version
// and the smallest ID becomes a new card `<base>-v1`. A base card with a printing image and no match is never split.

const FN = 'private.split_pokemon_tw_official_variants';
const MAX_CARDS = 100;
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;
const numeric = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/**
 * details: official detail cache `.details` ({ [detailId]: { nameZh, setMark, number, total } });
 * baseCards: [{ id, source, code, num, name_zh, ids, has_image, printing_image }] one row per card whose TW printing lists >= 2 official IDs
 *   (has_image: the card has a card_images row or a printing image_url; printing_image: it has a printing image_url, i.e. a TCGdex image).
 * imageMatches: { [baseCardId]: detailId } the official page the base card's existing printing image shows (required when printing_image).
 * Returns { plans: [{ series, plan, bases, cards, baseImages }], skipped, summary }; plan is the p_plan argument of the SQL
 * function (each plan <= 100 new cards, a base card never split, one series each).
 */
export function buildTwOfficialVariantPlans({ details, baseCards, imageMatches = {} }) {
  const skipped = [];
  const codes = [...new Set(baseCards.map(base => base.code))].sort();
  const rowsBySeries = new Map(codes.map(code => [code, []]));
  const counts = new Map(codes.map(code => [code, { series: code, baseCards: 0, skipped: {} }]));
  for (const base of baseCards) {
    const count = counts.get(base.code);
    count.baseCards++;
    const ids = (base.ids || []).map(String);
    const skip = reason => {
      count.skipped[reason] = (count.skipped[reason] || 0) + 1;
      skipped.push({ cardId: base.id, series: base.code, number: base.num, nameZh: base.name_zh, detailIds: ids, reason });
    };
    if (ids.length < 2) { skip('single-version'); continue; }
    if (ids.some(id => !/^[0-9]{1,9}$/.test(id)) || new Set(ids).size !== ids.length) { skip('bad-detail-id'); continue; }
    if (JSON.stringify(ids) !== JSON.stringify([...ids].sort((a, b) => Number(a) - Number(b)))) { skip('ids-not-sorted'); continue; }
    if (ids.length - 1 > MAX_CARDS) { skip('too-many-versions'); continue; }
    if (ids.some(id => !details[id])) { skip('detail-not-cached'); continue; }
    const wrong = ids.find(id => {
      const page = details[id];
      // The page must be the same number and name; the set mark is a consistency check (promo pages carry PROMO.MARK and the series in `total`).
      return page.number !== base.num || !sameTwName(base.name_zh, page.nameZh) || !(twSetMarkMatches(page.setMark, base.code) || page.total === base.code);
    });
    if (wrong) { skip(`detail-disagrees:${wrong}:${details[wrong].setMark}:${details[wrong].number}:${details[wrong].nameZh}`); continue; }
    const matched = imageMatches[base.id] === undefined ? null : String(imageMatches[base.id]);
    if (matched !== null && !ids.includes(matched)) { skip(`image-match-not-listed:${matched}`); continue; }
    if (matched === null && base.printing_image) { skip('base-image-version-unknown'); continue; }
    const baseIndex = matched === null ? 1 : ids.indexOf(matched) + 1;
    if (base.source === 'asia-pokemon-card-official-tw' && String(base.provider_id) !== ids[baseIndex - 1]) { skip(baseIndex === 1 ? 'base-provider-not-smallest' : 'base-provider-not-matched'); continue; }
    rowsBySeries.get(base.code).push({
      baseCardId: base.id,
      seriesCode: base.code,
      number: base.num,
      nameZh: base.name_zh,
      officialDetailIds: ids,
      ...(baseIndex === 1 ? {} : { baseVersionIndex: baseIndex }),
      baseOfficial: { detailId: ids[baseIndex - 1], imageUrl: officialTwImageUrl(ids[baseIndex - 1]), sourceUrl: officialTwDetailUrl(ids[baseIndex - 1]) },
      variants: ids.flatMap((id, i) => {
        const variantIndex = i + 1;
        return variantIndex === baseIndex ? [] : [{ cardId: `${base.id}-v${variantIndex}`, detailId: id, variantIndex, variantName: `版本 ${variantIndex}`, imageUrl: officialTwImageUrl(id), sourceUrl: officialTwDetailUrl(id) }];
      }),
      hasImage: Boolean(base.has_image)
    });
  }
  const plans = [];
  for (const code of codes) {
    const rows = rowsBySeries.get(code).sort((a, b) => numeric(a.number, b.number) || numeric(a.baseCardId, b.baseCardId));
    let chunk = [], cards = 0;
    const flush = () => {
      if (!chunk.length) return;
      plans.push({
        series: code,
        plan: { version: 1, rule: 'adr-0043', rows: chunk.map(({ hasImage, ...row }) => row) },
        bases: chunk.length,
        cards,
        baseImages: chunk.filter(row => !row.hasImage).length
      });
      chunk = []; cards = 0;
    };
    for (const row of rows) {
      if (cards + row.variants.length > MAX_CARDS) flush();
      chunk.push(row);
      cards += row.variants.length;
    }
    flush();
  }
  const summary = codes.map(code => {
    const mine = plans.filter(item => item.series === code);
    return { ...counts.get(code), plannedBases: mine.reduce((sum, item) => sum + item.bases, 0), plannedNewCards: mine.reduce((sum, item) => sum + item.cards, 0), baseImagesToAdd: mine.reduce((sum, item) => sum + item.baseImages, 0), plans: mine.length };
  });
  return { plans, skipped, summary };
}

/**
 * baseImages: how many base cards of the plan have no image at all (the base page's official image is added to those).
 * The gated statement runs the dry run, checks the exact counts, then writes in the same statement; the replay statement
 * must find every card already split. The temporary table is dropped first so several statements can share one transaction
 * (the whole-batch rollback test).
 */
export function buildTwOfficialVariantSql(plan, actor, baseImages) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('ACTOR_REQUIRED');
  if (!Number.isInteger(baseImages) || baseImages < 0) throw new Error('BASE_IMAGES_REQUIRED');
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const digest = pokemonJpPlanDigest(plan);
  const b = plan.rows.length;
  const n = plan.rows.reduce((sum, row) => sum + row.variants.length, 0);
  const call = dry => `${FN}($plan$${json}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  const check = (v, dry, what) => [
    `  if (${v}->>'replay')::boolean or (${v}->>'dryRun')::boolean is distinct from ${dry} or ${v}->>'planDigest' <> ${sqlText(digest)}`,
    `    or ${v}->'inserted' <> '{"cards": ${n}, "printings": ${n}, "images": ${n}, "baseImages": ${baseImages}}'::jsonb`,
    `    or ${v}->'updated' <> '{"baseCards": ${b}, "basePrintings": ${b}}'::jsonb then raise exception '${what} %', ${v}; end if;`
  ];
  const gated = [
    `-- ADR 0043 TW variant split: ${b} base cards, ${n} new cards, ${baseImages} base images (${FN}). planDigest ${digest}`,
    'drop table if exists pg_temp.tw_official_variant_result;',
    'create temporary table tw_official_variant_result (v jsonb) on commit drop;',
    'do $do$',
    'declare d jsonb; r jsonb;',
    'begin',
    `  d := ${call(true)};`,
    ...check('d', true, 'unexpected dry run'),
    `  r := ${call(false)};`,
    ...check('r', false, 'unexpected split'),
    '  insert into tw_official_variant_result values (r);',
    'end',
    '$do$;',
    'select v from tw_official_variant_result;',
    ''
  ].join('\n');
  const replay = [
    `-- ADR 0043 TW variant split replay: must change nothing. planDigest ${digest}`,
    'drop table if exists pg_temp.tw_official_variant_result;',
    'create temporary table tw_official_variant_result (v jsonb) on commit drop;',
    'do $do$',
    'declare r jsonb;',
    'begin',
    `  r := ${call(false)};`,
    `  if not (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)}`,
    `    or r->'inserted' <> '{"cards": 0, "printings": 0, "images": 0, "baseImages": 0}'::jsonb`,
    `    or r->'updated' <> '{"baseCards": 0, "basePrintings": 0}'::jsonb then raise exception 'replay changed rows %', r; end if;`,
    '  insert into tw_official_variant_result values (r);',
    'end',
    '$do$;',
    'select v from tw_official_variant_result;',
    ''
  ].join('\n');
  return { digest, gated, replay };
}
