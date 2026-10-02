import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOfficialJpRarity, officialJpListUrl, officialJpRarity, parseOfficialJpDetail, parseOfficialJpList } from '../providers/pokemon-jp-official.mjs';

const detail = (rarity = '<img src="/assets/images/card/rarity/ic_rare_rr.gif" width="24" />') => `<h1 class="Heading1 mt20">マシマシラex</h1> <div class="Box"><div class="LeftBox"><img class="fit" src="/x.jpg" alt="マシマシラex" /> <div class="subtext Text-fjalla"> <img src="/assets/images/card/regulation_logo_1/SV8a.gif" class="img-regulation" alt="SV8a" /> &nbsp;103&nbsp;/&nbsp;187&nbsp; ${rarity} </div>`;

test('official detail page yields set mark, number, name and rarity icon', () => {
  assert.deepEqual(parseOfficialJpDetail(detail()), { nameJa: 'マシマシラex', setMark: 'SV8a', number: '103', total: '187', rarityIcon: 'ic_rare_rr' });
  assert.equal(parseOfficialJpDetail(detail('')).rarityIcon, null);
  assert.deepEqual(parseOfficialJpDetail('<h1 class="Heading1">x</h1>'), { nameJa: 'x', setMark: null, number: null, total: null, rarityIcon: null });
});

test('rarity icons map to existing codes (dropping _c), while missing or unknown icons are quarantined', () => {
  assert.deepEqual(officialJpRarity('ic_rare_sar'), { rarity: 'SAR' });
  assert.deepEqual(officialJpRarity('ic_rare_ace'), { rarity: 'ACE' });
  assert.deepEqual(officialJpRarity('ic_rare_sr_c'), { rarity: 'SR' });
  assert.deepEqual(officialJpRarity('ic_rare_u_c'), { rarity: 'U' });
  assert.deepEqual(officialJpRarity(null), { quarantine: 'OFFICIAL_NO_RARITY_ICON' });
  assert.match(officialJpRarity('ic_rare_new').quarantine, /UNKNOWN_RARITY_ICON/);
});

test('matching needs the same set, number and NFKC Japanese name', () => {
  const page = parseOfficialJpDetail(detail());
  assert.deepEqual(matchOfficialJpRarity({ code: 'SV8a', num: '103', name_ja: 'マシマシラex' }, page), { rarity: 'RR' });
  assert.deepEqual(matchOfficialJpRarity({ code: 'SV8a', num: '103', name_ja: 'マシマシラｅｘ' }, page), { rarity: 'RR' });
  assert.match(matchOfficialJpRarity({ code: 'SV8', num: '103', name_ja: 'マシマシラex' }, page).quarantine, /SET_MISMATCH/);
  assert.match(matchOfficialJpRarity({ code: 'SV8a', num: '104', name_ja: 'マシマシラex' }, page).quarantine, /NUMBER_MISMATCH/);
  assert.match(matchOfficialJpRarity({ code: 'SV8a', num: '103', name_ja: 'モモワロウex' }, page).quarantine, /NAME_MISMATCH/);
});

test('list parsing keeps order and rejects unexpected responses', () => {
  assert.deepEqual(parseOfficialJpList({ result: 1, hitCnt: '2', maxPage: 1, cardList: [{ cardID: '1' }, { cardID: '2' }] }), { hitCount: 2, maxPage: 1, cardIds: ['1', '2'] });
  assert.throws(() => parseOfficialJpList({ result: 0 }), /OFFICIAL_LIST_UNEXPECTED/);
  assert.match(officialJpListUrl('SV8a', 2), /pg=SV8a&.*page=2/);
});

import { readFile } from 'node:fs/promises';
const migration = await readFile(new URL('../supabase/migrations/20261002095027_pokemon_jp_official_rarity.sql', import.meta.url), 'utf8');

test('official rarity migration fills nulls only, rechecks identity, audits append-only and stays private', () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function private\.fill_pokemon_jp_official_rarity\(jsonb, text, boolean\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function private\.fill_pokemon_jp_official_rarity\(jsonb, text, boolean\) to service_role/);
  assert.match(migration, /v_count < 1 or v_count > 100/);
  for (const reason of ["'series'", "'number'", "'name'", "'rarity-code'", "'printing-conflict'", "'card-conflict'"]) assert.ok(migration.includes(reason), reason);
  assert.match(migration, /where p\.id = pl\.printing_id and c\.id = p\.card_id and p\.rarity_code is null/);
  assert.match(migration, /where c\.id = pl\.card_id and c\.rarity is null/);
  assert.match(migration, /catalog_jp_rarity_audit_no_change[\s\S]*before update or delete/);
  assert.match(migration, /errcode = 'CJ005'/);
});
