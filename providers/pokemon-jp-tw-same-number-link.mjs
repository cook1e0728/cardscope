import { sameTwName } from './pokemon-tw-official.mjs';

// ADR 0024: link Japanese cards to the Taiwanese card with the same series code and official
// number, only inside aligned series. pairs: every JP/TW card pair sharing code and number,
// [{ code, num, jp_id, jc (JP canonical), jn, tw_id, tc, tn, jp_dupes, tw_links }]; linkedElsewhere:
// codes whose JP cards are already linked to a TW card of another number.
const BATCH = 100;
const sameName = (a, b) => sameTwName(a, b) || sameTwName(b, a);

export function planJpTwSameNumberLinks(pairs, linkedElsewhere = []) {
  const misaligned = new Map(linkedElsewhere.map(code => [code, 'LINKED_TO_OTHER_NUMBER']));
  for (const pair of pairs) {
    if (pair.jc === pair.jp_id && pair.jn && !sameName(pair.jn, pair.tn) && !misaligned.has(pair.code)) misaligned.set(pair.code, `NAME_MISMATCH:${pair.num}`);
  }
  const rows = [], skipped = [];
  for (const pair of pairs) {
    if (misaligned.has(pair.code) || pair.jc === pair.tw_id) continue;
    const reason = pair.jc !== pair.jp_id ? 'JP_ALREADY_LINKED'
      : !pair.jn ? 'JP_NAME_MISSING'
      : pair.tc !== pair.tw_id || pair.tw_links > 0 ? 'TW_CANONICAL_SHARED'
      : pair.jp_dupes !== 1 ? 'JP_NUMBER_REPEATED'
      : null;
    if (reason) skipped.push({ code: pair.code, num: pair.num, jpCardId: pair.jp_id, reason });
    else rows.push({ jpCardId: pair.jp_id, twCardId: pair.tw_id, code: pair.code });
  }
  if (new Set(rows.map(row => row.twCardId)).size !== rows.length) throw new Error('TW_CARD_PLANNED_TWICE');
  rows.sort((a, b) => a.code.localeCompare(b.code) || a.jpCardId.localeCompare(b.jpCardId));
  const plans = [];
  for (let i = 0; i < rows.length; i += BATCH) plans.push({ version: 1, rule: 'adr-0024', rows: rows.slice(i, i + BATCH).map(({ jpCardId, twCardId }) => ({ jpCardId, twCardId })) });
  const byCode = {};
  for (const row of rows) byCode[row.code] = (byCode[row.code] || 0) + 1;
  return { plans, byCode, misaligned: Object.fromEntries(misaligned), skipped };
}
