import { pokemonJpPlanDigest } from './pokemon-jp-import-sql.mjs';
import { officialJpDetailUrl } from './pokemon-jp-official.mjs';

// ADR 0039: the tcgdex-ja series S9a/S10a/S11a/S12a hold one card per number, but the Japanese official
// card search lists two detail pages for 226 same-number, same-name, same-rarity-icon groups. The smaller
// official card ID is the existing card (version 1); every other page becomes `<base>-v<k>`
// (private.split_pokemon_jp_archive_variants, same rules as ADR 0035). No network or database calls.

const FN = 'private.split_pokemon_jp_archive_variants';
const SERIES = ['S9a', 'S10a', 'S11a', 'S12a'];
const IMAGE_HOST = 'https://www.pokemon-card.com';
const IMAGE_PATH = /^\/assets\/images\/card_images\/large\/[A-Za-z0-9_/.-]+\.jpg$/;
const MAX_CARDS = 100;
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;
const numeric = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/**
 * details: official-rarity cache `.details` ({ [cardId]: { nameJa, setMark, number, rarityIcon, ... } });
 * thumbs: official-card-images cache `.thumbs` ({ [cardId]: '/assets/images/card_images/large/...jpg' });
 * baseCards: [{ id, code, num, name_ja, has_image, official_ids }] for the tcgdex-ja cards of those series.
 * Returns { plans: [{ series, plan, bases, cards, baseImages }], skipped, summary } where plan is the
 * p_plan argument of the SQL function (each plan <= 100 new cards, a base card never split, one series each).
 */
export function buildJpArchiveVariantPlans({ details, thumbs, baseCards, series = SERIES }) {
  const bases = new Map();
  for (const base of baseCards) {
    const key = [base.code, base.num, base.name_ja].join('\u0000');
    bases.set(key, [...(bases.get(key) || []), base]);
  }
  const groups = new Map();
  const pages = Object.values(details).filter(page => series.includes(page.setMark));
  for (const page of pages) {
    if (!page.number || !page.nameJa) continue;
    const key = [page.setMark, page.number, page.nameJa].join('\u0000');
    groups.set(key, [...(groups.get(key) || []), page]);
  }
  const skipped = [];
  const rowsBySeries = new Map(series.map(code => [code, []]));
  const counts = new Map(series.map(code => [code, { series: code, officialPages: 0, groups: 0, singlePageGroups: 0, multiPageGroups: 0, skipped: {} }]));
  for (const page of pages) counts.get(page.setMark).officialPages++;
  for (const [key, group] of groups) {
    const [code, number, nameJa] = key.split('\u0000');
    const count = counts.get(code);
    count.groups++;
    if (group.length < 2) { count.singlePageGroups++; continue; }
    count.multiPageGroups++;
    const ids = group.map(page => String(page.cardId)).sort((a, b) => Number(a) - Number(b));
    const skip = reason => {
      count.skipped[reason] = (count.skipped[reason] || 0) + 1;
      skipped.push({ series: code, number, nameJa, cardIds: ids, reason });
    };
    const found = bases.get(key) || [];
    if (ids.some(id => !/^[0-9]{1,9}$/.test(id)) || new Set(ids).size !== ids.length) { skip('bad-card-id'); continue; }
    if (found.length === 0) { skip('no-base'); continue; }
    if (found.length > 1) { skip('multiple-bases'); continue; }
    if (new Set(group.map(page => page.rarityIcon ?? null)).size > 1) { skip('rarity-mismatch'); continue; }
    if (ids.some(id => !thumbs[id])) { skip('missing-thumb'); continue; }
    if (ids.some(id => !IMAGE_PATH.test(thumbs[id]))) { skip('bad-image-path'); continue; }
    if (ids.length - 1 > MAX_CARDS) { skip('too-many-pages'); continue; }
    const [base] = found;
    if (base.official_ids && JSON.stringify(base.official_ids) !== JSON.stringify(ids)) { skip('base-official-ids-differ'); continue; }
    const image = id => `${IMAGE_HOST}${thumbs[id]}`;
    rowsBySeries.get(code).push({
      baseCardId: base.id,
      seriesCode: code,
      number,
      nameJa,
      officialCardIds: ids,
      baseOfficial: { officialCardId: ids[0], imageUrl: image(ids[0]), sourceUrl: officialJpDetailUrl(ids[0]) },
      variants: ids.slice(1).map((id, i) => {
        const variantIndex = i + 2;
        return {
          cardId: `${base.id}-v${variantIndex}`,
          officialCardId: id,
          variantIndex,
          variantName: `版本 ${variantIndex}${thumbs[id].endsWith('_m.jpg') ? '（ミラー）' : ''}`,
          imageUrl: image(id),
          sourceUrl: officialJpDetailUrl(id)
        };
      }),
      hasImage: Boolean(base.has_image)
    });
  }
  const plans = [];
  for (const code of series) {
    const rows = rowsBySeries.get(code).sort((a, b) => numeric(a.number, b.number) || numeric(a.baseCardId, b.baseCardId));
    let chunk = [], cards = 0;
    const flush = () => {
      if (!chunk.length) return;
      plans.push({
        series: code,
        plan: { version: 1, rule: 'adr-0039', rows: chunk.map(({ hasImage, ...row }) => row) },
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
  const summary = series.map(code => {
    const mine = plans.filter(item => item.series === code);
    return { ...counts.get(code), plannedBases: mine.reduce((sum, item) => sum + item.bases, 0), plannedNewCards: mine.reduce((sum, item) => sum + item.cards, 0), baseImagesToAdd: mine.reduce((sum, item) => sum + item.baseImages, 0), plans: mine.length };
  });
  return { plans, skipped, summary };
}

/**
 * baseImages: how many base cards of the plan have no card_images row (the base page's official image is
 * added to those). The gated statement runs the dry run, checks the exact counts, then writes in the same
 * statement; the replay statement must find every card already split.
 */
export function buildJpArchiveVariantSql(plan, actor, baseImages) {
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
    `-- ADR 0039 archive variant split: ${b} base cards, ${n} new cards, ${baseImages} base images (${FN}). planDigest ${digest}`,
    'create temporary table jp_archive_variant_result (v jsonb) on commit drop;',
    'do $do$',
    'declare d jsonb; r jsonb;',
    'begin',
    `  d := ${call(true)};`,
    ...check('d', true, 'unexpected dry run'),
    `  r := ${call(false)};`,
    ...check('r', false, 'unexpected split'),
    '  insert into jp_archive_variant_result values (r);',
    'end',
    '$do$;',
    'select v from jp_archive_variant_result;',
    ''
  ].join('\n');
  const replay = [
    `-- ADR 0039 archive variant split replay: must change nothing. planDigest ${digest}`,
    'create temporary table jp_archive_variant_result (v jsonb) on commit drop;',
    'do $do$',
    'declare r jsonb;',
    'begin',
    `  r := ${call(false)};`,
    `  if not (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)}`,
    `    or r->'inserted' <> '{"cards": 0, "printings": 0, "images": 0, "baseImages": 0}'::jsonb`,
    `    or r->'updated' <> '{"baseCards": 0, "basePrintings": 0}'::jsonb then raise exception 'replay changed rows %', r; end if;`,
    '  insert into jp_archive_variant_result values (r);',
    'end',
    '$do$;',
    'select v from jp_archive_variant_result;',
    ''
  ].join('\n');
  return { digest, gated, replay };
}
