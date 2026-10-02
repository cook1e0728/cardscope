import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICIAL_TW_RARITY_FILTERS, officialTwRarityCode, sameTwName, twNameKey, twSetMarkMatches } from '../providers/pokemon-tw-official.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-from-tw-official-plan.mjs <jp-printings.json> <tw-cache.json> <out-dir> --series CODE,CODE [--actor NAME]',
  '',
  'Plans for private.fill_pokemon_jp_from_tw_official (ADR 0011): empty Japanese Chinese names and rarities',
  'from the Taiwanese official card with the same series code and number. A series is used only when every',
  'Japanese card that already has a Chinese name or a rarity agrees with the Taiwanese official card of the',
  'same number. jp-printings.json: [{ code, num, printing_id, card_id, name_ja, name_zh, rarity, series_id }].',
  'Writes alignment-report.json. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [jpPath, cachePath, outDir] = args;
  const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
  if (!jpPath || !cachePath || !outDir || !option('series')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = option('actor') || 'claude-code-local:aa26488931';
  const codes = option('series').split(',');
  const jpRows = JSON.parse(readFileSync(jpPath, 'utf8'));
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  if (!Object.keys(OFFICIAL_TW_RARITY_FILTERS).every(value => cache.rarityLists?.[value]?.complete)) throw new Error('TW_RARITY_LISTS_INCOMPLETE');
  const labelsById = new Map();
  for (const [value, list] of Object.entries(cache.rarityLists)) for (const id of Object.values(list.pages).flat()) labelsById.set(id, [...(labelsById.get(id) || []), OFFICIAL_TW_RARITY_FILTERS[value]]);

  const report = { series: {}, plans: [] };
  mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    const list = cache.seriesLists?.[code];
    const ids = list?.complete ? Object.values(list.pages).flat() : [];
    if (!ids.length || ids.some(id => !cache.details[id])) { report.series[code] = { status: 'NOT_READY' }; continue; }
    // One official value per number: every version must agree on name and rarity.
    const official = new Map();
    for (const id of ids) {
      const detail = cache.details[id];
      if (!detail.number || !(twSetMarkMatches(detail.setMark, code) || detail.total === code)) continue;
      const entry = official.get(detail.number) || { names: new Set(), rarities: new Set(), ids: [] };
      entry.names.add(detail.nameZh);
      for (const label of labelsById.get(id) || ['?']) entry.rarities.add(label);
      if ((labelsById.get(id) || []).length !== 1) entry.rarities.add('?');
      entry.ids.push(id);
      official.set(detail.number, entry);
    }
    const valueOf = number => {
      const entry = official.get(number);
      if (!entry) return null;
      const name = entry.names.size === 1 ? [...entry.names][0] : null;
      const rarityLabel = entry.rarities.size === 1 && !entry.rarities.has('?') ? [...entry.rarities][0] : null;
      const rarity = rarityLabel ? officialTwRarityCode(rarityLabel).rarity || null : null;
      return { name, rarity, ids: entry.ids };
    };
    const rows = jpRows.filter(row => row.code === code);
    const disagreements = [];
    for (const row of rows) {
      const value = valueOf(row.num);
      if (!value) continue;
      if (row.name_zh && value.name && !sameTwName(row.name_zh, value.name) && twNameKey(row.name_zh) !== twNameKey(value.name)) disagreements.push({ num: row.num, field: 'name', database: row.name_zh, official: value.name });
      if (row.rarity && value.rarity && row.rarity !== value.rarity) disagreements.push({ num: row.num, field: 'rarity', database: row.rarity, official: value.rarity });
    }
    const checked = rows.filter(row => valueOf(row.num) && (row.name_zh || row.rarity)).length;
    if (disagreements.length) { report.series[code] = { status: 'REJECTED_MISALIGNED', checked, disagreements }; continue; }
    // Agreement on a handful of cards proves nothing about numbering: at least half of the series must be checkable.
    if (checked * 2 < rows.length) { report.series[code] = { status: 'REJECTED_UNVERIFIABLE', checked, rows: rows.length }; continue; }

    const planRows = [];
    for (const row of rows) {
      const value = valueOf(row.num);
      if (!value) continue;
      const nameZh = !row.name_zh && value.name ? value.name : null;
      const rarity = !row.rarity && value.rarity ? value.rarity : null;
      if (!nameZh && !rarity) continue;
      planRows.push({ printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, nameJa: row.name_ja, nameZh, rarity, officialDetailIds: value.ids });
    }
    report.series[code] = { status: 'ALIGNED', checked, planned: planRows.length, names: planRows.filter(r => r.nameZh).length, rarities: planRows.filter(r => r.rarity).length, missingOfficial: rows.filter(row => !official.get(row.num)).map(row => row.num) };
    planRows.sort((a, b) => a.number.localeCompare(b.number));
    const seriesId = rows[0]?.series_id;
    for (let start = 0, part = 1; start < planRows.length; start += 100, part++) {
      const plan = { version: 1, seriesId, rows: planRows.slice(start, start + 100) };
      const json = JSON.stringify(plan);
      if (json.includes('$plan$') || actor.includes("'")) throw new Error('PLAN_QUOTE_COLLISION');
      const name = `jp-tw-same-number-${code}-${String(part).padStart(2, '0')}`;
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), [
        `-- ${name}: ${plan.rows.length} rows (ADR 0011). Rolls back unless every planned row changes.`,
        'create temporary table jp_tw_result (v jsonb) on commit drop;',
        'do $do$',
        'declare r jsonb;',
        'begin',
        `  r := private.fill_pokemon_jp_from_tw_official($plan$${json}$plan$::jsonb, '${actor}', false);`,
        `  if (r->>'replay')::boolean or (r->>'names')::int <> ${plan.rows.filter(r => r.nameZh).length} or (r->>'rarities')::int <> ${plan.rows.filter(r => r.rarity).length} then raise exception 'unexpected result %', r; end if;`,
        '  insert into jp_tw_result values (r);',
        'end',
        '$do$;',
        'select v from jp_tw_result;',
        ''
      ].join('\n'));
      writeFileSync(join(outDir, `${name}-replay.sql`), `-- ${name} replay: must change nothing.\nselect private.fill_pokemon_jp_from_tw_official($plan$${json}$plan$::jsonb, '${actor}', false) v;\n`);
      report.plans.push({ name, rows: plan.rows.length });
    }
  }
  writeFileSync(join(outDir, 'alignment-report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify({ series: Object.fromEntries(Object.entries(report.series).map(([code, value]) => [code, { ...value, disagreements: value.disagreements?.length, missingOfficial: value.missingOfficial?.length }])), plans: report.plans.length }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
