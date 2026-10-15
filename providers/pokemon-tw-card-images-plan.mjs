import { createHash } from 'node:crypto';
import { OFFICIAL_TW_ORIGIN, sameTwName, twNameKey, twSetMarkMatches } from './pokemon-tw-official.mjs';

// ADR 0031: Taiwanese cards with no image at all get an external link to their own official card
// image, never another region's. This module decides which official detail ID belongs to which
// card and writes the gated SQL; it makes no network or database calls.

export const TW_CARD_IMAGE_SOURCE = 'pokemon-tw-official';
export const TW_CARD_IMAGE_LANGUAGE = 'zh-Hant-TW';
export const TW_CARD_IMAGE_RIGHTS_NOTE = 'ADR 0031';
const BATCH_SIZE = 250;

export const officialTwImageUrl = detailId => `${OFFICIAL_TW_ORIGIN}/tw/card-img/tw${String(detailId).padStart(8, '0')}.png`;

/**
 * cards: [{ card_id, code, num, name_zh, ids }] (cards with no image; ids = metadata.officialDetailIds or null)
 * allCards: [{ card_id, code, name_zh }] every Taiwanese card, to prove a name is unique inside its series
 * cache: { seriesLists, details } from the Taiwanese official card search (ADR 0010)
 *
 * a. exactly one official detail ID on the printing (checked against the cached detail page when there is one)
 * b. several IDs under one number (same-number versions): never written, the card cannot say which one it is
 * c. no ID: the one cached detail of that series with the same number, set mark and name; a series entry with
 *    no number at all (basic energy, V-UNION) counts only when it is the series' only entry of that name and
 *    the database holds only one card of that name in the series
 */
export function planTwOfficialCardImages({ cards, allCards, cache }) {
  const listIds = code => Object.values(cache.seriesLists?.[code]?.pages || {}).flat().map(String);
  // null when a listed card has no cached detail page (the series cannot prove uniqueness then)
  const entries = code => listIds(code).every(id => cache.details[id]) ? listIds(code).map(id => ({ id, ...cache.details[id] })) : null;
  const dbNames = new Map();
  for (const card of allCards) { const key = `${card.code}|${twNameKey(card.name_zh)}`; dbNames.set(key, (dbNames.get(key) || 0) + 1); }
  const matched = [], unmatched = [];
  // The series filter decides which set a card belongs to; the set mark is only a consistency check, and promo
  // entries without a number (basic energy, special pages) carry a generic PROMO.MARK, so for those the series list is the proof.
  const agrees = (card, detail, id) => sameTwName(card.name_zh, detail.nameZh) && (twSetMarkMatches(detail.setMark, card.code) || detail.total === card.code || (!detail.number && listIds(card.code).includes(String(id))));
  const reject = (card, group, reason) => unmatched.push({ cardId: card.card_id, code: card.code, number: card.num, nameZh: card.name_zh, group, reason });

  for (const card of cards) {
    const ids = (card.ids || []).map(String);
    if (ids.length > 1) { reject(card, 'b', `MULTIPLE_OFFICIAL_VERSIONS:${ids.join('|')}`); continue; }
    if (ids.length === 1) {
      const detail = cache.details[ids[0]];
      if (!detail) { matched.push({ cardId: card.card_id, code: card.code, number: card.num, nameZh: card.name_zh, detailId: ids[0], group: 'a', basis: 'metadata-only' }); continue; }
      if (!agrees(card, detail, ids[0])) { reject(card, 'a', `METADATA_ID_DISAGREES_WITH_DETAIL:${ids[0]}:${detail.setMark}:${detail.number}:${detail.nameZh}`); continue; }
      matched.push({ cardId: card.card_id, code: card.code, number: card.num, nameZh: card.name_zh, detailId: ids[0], group: 'a', basis: 'metadata-and-detail' });
      continue;
    }
    if (!cache.seriesLists?.[card.code]?.complete) { reject(card, 'c', 'OFFICIAL_SERIES_LIST_NOT_CACHED'); continue; }
    const list = entries(card.code);
    if (!list) { reject(card, 'c', 'OFFICIAL_DETAIL_NOT_CACHED'); continue; }
    const numbered = list.filter(entry => entry.number === card.num);
    if (numbered.length > 1) { reject(card, 'c', `SAME_NUMBER_VERSIONS:${numbered.map(entry => entry.id).join('|')}`); continue; }
    if (numbered.length === 1) {
      if (!agrees(card, numbered[0], numbered[0].id)) { reject(card, 'c', `NAME_OR_SET_MISMATCH:${numbered[0].id}:${numbered[0].setMark}:${numbered[0].nameZh}`); continue; }
      matched.push({ cardId: card.card_id, code: card.code, number: card.num, nameZh: card.name_zh, detailId: numbered[0].id, group: 'c', basis: 'series-number-name' });
      continue;
    }
    const sameName = list.filter(entry => !entry.number && sameTwName(card.name_zh, entry.nameZh));
    if (sameName.length !== 1) { reject(card, 'c', sameName.length ? `NUMBERLESS_NAME_AMBIGUOUS:${sameName.map(entry => entry.id).join('|')}` : 'OFFICIAL_ENTRY_NOT_FOUND'); continue; }
    if (dbNames.get(`${card.code}|${twNameKey(card.name_zh)}`) !== 1) { reject(card, 'c', 'DATABASE_NAME_NOT_UNIQUE_IN_SERIES'); continue; }
    matched.push({ cardId: card.card_id, code: card.code, number: card.num, nameZh: card.name_zh, detailId: sameName[0].id, group: 'c', basis: 'series-numberless-name' });
  }

  // A detail ID may serve one card only; a clash drops every card involved.
  const byDetail = new Map();
  for (const row of matched) byDetail.set(row.detailId, [...(byDetail.get(row.detailId) || []), row]);
  const clashing = new Set([...byDetail.values()].filter(rows => rows.length > 1).flat().map(row => row.cardId));
  const accepted = matched.filter(row => !clashing.has(row.cardId));
  for (const row of matched.filter(row => clashing.has(row.cardId))) unmatched.push({ cardId: row.cardId, code: row.code, number: row.number, nameZh: row.nameZh, group: row.group, reason: `DETAIL_ID_CLASH:${row.detailId}` });
  const bySetNumber = (a, b) => a.code.localeCompare(b.code, 'en') || a.cardId.localeCompare(b.cardId, 'en', { numeric: true });
  accepted.sort(bySetNumber);
  unmatched.sort(bySetNumber);
  return { matched: accepted, unmatched };
}

const quote = value => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`UNSAFE_SQL_VALUE:${value}`);
  return `'${value}'`;
};

/**
 * Four SQL files per batch: dry (read-only counts), test (whole batch, ends in a deliberate
 * exception so nothing is kept), write (exact row-count assertions) and replay (must insert 0).
 */
export function buildTwCardImageSql(rows, name) {
  const count = rows.length;
  const values = rows.map(row => `(${quote(row.cardId)}, ${quote(row.detailId)})`).join(',\n');
  const plan = `create temporary table tw_img_plan (card_id text primary key, detail_id text not null) on commit drop;
insert into tw_img_plan (card_id, detail_id) values
${values};
create temporary table tw_img_todo on commit drop as
  select p.card_id, p.detail_id, c.canonical_id
  from tw_img_plan p
  join tcg_cards c on c.id = p.card_id and c.game_id = 'pokemon'
  where exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.region = 'TW')
    and not exists (select 1 from card_images ci where ci.card_id = p.card_id)
    and not exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.image_url is not null and g.image_url <> '');`;
  const insert = `  insert into card_images (card_id, language, source, image_url, source_url, is_primary, canonical_id, image_rights_status, rights_note)
  select t.card_id, '${TW_CARD_IMAGE_LANGUAGE}', '${TW_CARD_IMAGE_SOURCE}',
    '${OFFICIAL_TW_ORIGIN}/tw/card-img/tw' || lpad(t.detail_id, 8, '0') || '.png',
    '${OFFICIAL_TW_ORIGIN}/tw/card-search/detail/' || t.detail_id || '/',
    true, t.canonical_id, 'not-provided', '${TW_CARD_IMAGE_RIGHTS_NOTE}'
  from tw_img_todo t;
  get diagnostics n = row_count;`;
  const checks = expected => `  select count(*) into n from tw_img_todo;
  if n <> ${expected} then raise exception 'ELIGIBLE_COUNT_MISMATCH % <> ${expected}', n; end if;`;
  const header = kind => `-- ${name} ${kind}: ${count} Taiwanese cards, official external image (ADR 0031).`;
  const verify = 'select count(*) as images_now from card_images ci join tw_img_plan p on p.card_id = ci.card_id where ci.rights_note = \'ADR 0031\' and ci.source = \'pokemon-tw-official\';';
  return {
    // No leading comment: run-sql --read-only accepts only text that starts with select or with.
    dry: `with plan (card_id, detail_id) as (values
${values}
)
select count(*) as planned,
  count(*) filter (where c.id is not null and c.game_id = 'pokemon') as cards_found,
  count(*) filter (where c.id is not null and exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.region = 'TW') and not exists (select 1 from card_images ci where ci.card_id = p.card_id) and not exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.image_url is not null and g.image_url <> '')) as eligible,
  count(distinct p.detail_id) as distinct_detail_ids,
  ${count} as expected
from plan p left join tcg_cards c on c.id = p.card_id;
-- ${name} dry run (read-only): ${count} Taiwanese cards, official external image (ADR 0031).
`,
    test: `${header('rollback test')} Always ends in an exception, so nothing is kept.
${plan}
do $do$
declare n int;
begin
${checks(count)}
${insert}
  if n <> ${count} then raise exception 'INSERT_COUNT_MISMATCH % <> ${count}', n; end if;
  raise exception 'ROLLBACK_TEST_OK ${name} inserted=%', n;
end
$do$;
`,
    write: `${header('write')} Rolls back unless exactly that many rows are inserted.
${plan}
do $do$
declare n int;
begin
${checks(count)}
${insert}
  if n <> ${count} then raise exception 'INSERT_COUNT_MISMATCH % <> ${count}', n; end if;
end
$do$;
${verify}
`,
    replay: `${header('replay')} Must insert nothing.
${plan}
do $do$
declare n int;
begin
${checks(0)}
end
$do$;
${verify}
`
  };
}

export function twCardImageBatches(rows, size = BATCH_SIZE) {
  const batches = [];
  for (let start = 0; start < rows.length; start += size) batches.push(rows.slice(start, start + size));
  return batches;
}

export const twCardImagePlanDigest = rows => createHash('sha256').update(rows.map(row => `${row.cardId}=${row.detailId}`).join('\n'), 'utf8').digest('hex');
