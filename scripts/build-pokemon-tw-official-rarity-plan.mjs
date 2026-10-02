import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICIAL_TW_RARITY_FILTERS, matchOfficialTwRarity } from '../providers/pokemon-tw-official.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-official-rarity-plan.mjs <tw-printings.json> <tw-cache.json> <out-dir>',
  '        [--jp <jp-printings.json> --jp-cache <jp-official-cache.json>] [--actor NAME]',
  '',
  'Plans for private.fill_pokemon_official_rarity_tw (ADR 0010), at most 100 rows each, one gated SQL file',
  'per plan (the call must fill exactly the planned rows, or the request rolls back):',
  '  tw-official  empty TW rarities from the Taiwanese official search (all entries for the number agree)',
  '  jp-via-tw    empty JP rarities whose Japanese official page shows no rarity icon, taken from the',
  '               linked TW printing that already holds a Taiwanese official rarity (run after tw-official',
  '               is written, with freshly exported printings).',
  'tw-printings.json: [{ code, num, printing_id, card_id, name_zh, rarity, rarity_basis, series_id }]',
  'jp-printings.json: [{ code, num, printing_id, card_id, name_ja, rarity, series_id, linked_card_id }]',
  'Writes official-rarity-report.json with every quarantined row. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [twPath, cachePath, outDir] = args;
  if (!twPath || !cachePath || !outDir) throw new Error('ARGUMENTS_REQUIRED');
  const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
  const actor = option('actor') || 'claude-code-local:aa26488931';
  const twRows = JSON.parse(readFileSync(twPath, 'utf8'));
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));

  // Which rarity lists name each detail ID (only complete lists count).
  const labelsById = new Map();
  for (const [value, list] of Object.entries(cache.rarityLists || {})) {
    if (!list.complete) continue;
    for (const id of Object.values(list.pages).flat()) labelsById.set(id, [...(labelsById.get(id) || []), OFFICIAL_TW_RARITY_FILTERS[value]]);
  }
  const allRarityListsComplete = Object.keys(OFFICIAL_TW_RARITY_FILTERS).every(value => cache.rarityLists?.[value]?.complete);
  if (!allRarityListsComplete) throw new Error('TW_RARITY_LISTS_INCOMPLETE');
  const entriesByIdentity = new Map();
  for (const [code, list] of Object.entries(cache.seriesLists || {})) {
    if (!list.complete) continue;
    const ids = Object.values(list.pages).flat();
    if (ids.some(id => !cache.details[id])) continue; // a series counts only once every detail page is cached
    for (const id of ids) {
      const detail = cache.details[id];
      const key = `${code}|${detail.number}`;
      entriesByIdentity.set(key, [...(entriesByIdentity.get(key) || []), { detailId: id, ...detail, listCode: code, rarityLabels: labelsById.get(id) || [] }]);
    }
  }
  const readySeries = new Set(Object.entries(cache.seriesLists || {}).filter(([, list]) => list.complete && Object.values(list.pages).flat().every(id => cache.details[id])).map(([code]) => code));

  const plans = { 'tw-official': new Map(), 'jp-via-tw': new Map() }, quarantined = [], waiting = [];
  const add = (kind, seriesId, row) => { const rows = plans[kind].get(seriesId) || []; rows.push(row); plans[kind].set(seriesId, rows); };
  for (const row of twRows.filter(item => !item.rarity)) {
    if (!readySeries.has(row.code)) { waiting.push({ code: row.code, num: row.num }); continue; }
    const decision = matchOfficialTwRarity(row, entriesByIdentity.get(`${row.code}|${row.num}`) || []);
    if (decision.quarantine) { quarantined.push({ kind: 'tw-official', code: row.code, num: row.num, name: row.name_zh, reason: decision.quarantine }); continue; }
    add('tw-official', row.series_id, { printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, name: row.name_zh, rarity: decision.rarity, officialDetailIds: decision.detailIds });
  }

  if (option('jp')) {
    const jpCache = JSON.parse(readFileSync(option('jp-cache'), 'utf8'));
    const jpPages = new Map(Object.values(jpCache.details).filter(d => d.setMark && d.number).map(d => [`${d.setMark}|${d.number}`, d]));
    const twById = new Map(twRows.map(row => [row.card_id, row]));
    for (const row of JSON.parse(readFileSync(option('jp'), 'utf8')).filter(item => !item.rarity)) {
      const page = jpPages.get(`${row.code}|${row.num}`);
      if (!page || page.rarityIcon) continue; // only cards whose Japanese page shows no rarity icon
      const tw = row.linked_card_id && twById.get(row.linked_card_id);
      if (!tw) { quarantined.push({ kind: 'jp-via-tw', code: row.code, num: row.num, name: row.name_ja, reason: 'NO_TW_LINK' }); continue; }
      if (tw.code !== row.code || tw.num !== row.num) { quarantined.push({ kind: 'jp-via-tw', code: row.code, num: row.num, name: row.name_ja, reason: `TW_LINK_DIFFERENT_NUMBER:${tw.code}-${tw.num}` }); continue; }
      if (!tw.rarity || tw.rarity_basis !== 'asia-pokemon-card-official-tw') { waiting.push({ code: row.code, num: row.num, jp: true }); continue; }
      add('jp-via-tw', row.series_id, { printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, name: row.name_ja, rarity: tw.rarity, viaCardId: tw.card_id });
    }
  }

  mkdirSync(outDir, { recursive: true });
  const files = [], counts = {};
  for (const [kind, bySeries] of Object.entries(plans)) {
    counts[kind] = 0;
    for (const [seriesId, rows] of [...bySeries].sort(([a], [b]) => a.localeCompare(b))) {
      rows.sort((a, b) => a.number.localeCompare(b.number));
      counts[kind] += rows.length;
      for (let start = 0, part = 1; start < rows.length; start += 100, part++) {
        const plan = { version: 1, kind, seriesId, rows: rows.slice(start, start + 100) };
        const json = JSON.stringify(plan);
        if (json.includes('$plan$') || actor.includes("'")) throw new Error('PLAN_QUOTE_COLLISION');
        const name = `${kind}-${seriesId.replace(/^pokemon-tcgdex-/, '')}-${String(part).padStart(2, '0')}`;
        writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
        writeFileSync(join(outDir, `${name}.sql`), [
          `-- ${name}: ${kind} ${plan.rows.length} rows (ADR 0010). Rolls back unless exactly that many are filled.`,
          'create temporary table official_tw_result (v jsonb) on commit drop;',
          'do $do$',
          'declare r jsonb;',
          'begin',
          `  r := private.fill_pokemon_official_rarity_tw($plan$${json}$plan$::jsonb, '${actor}', false);`,
          `  if (r->>'replay')::boolean or (r->>'filled')::int <> ${plan.rows.length} then raise exception 'unexpected ${kind} result %', r; end if;`,
          '  insert into official_tw_result values (r);',
          'end',
          '$do$;',
          'select v from official_tw_result;',
          ''
        ].join('\n'));
        writeFileSync(join(outDir, `${name}-replay.sql`), `-- ${name} replay: must change nothing.\nselect private.fill_pokemon_official_rarity_tw($plan$${json}$plan$::jsonb, '${actor}', false) v;\n`);
        files.push({ name, kind, rows: plan.rows.length });
      }
    }
  }
  const reasons = quarantined.reduce((tally, row) => { const reason = `${row.kind}:${row.reason.split(':')[0]}`; tally[reason] = (tally[reason] || 0) + 1; return tally; }, {});
  const summary = { ...counts, quarantined: quarantined.length, quarantineReasons: reasons, waiting: waiting.length, files: files.length };
  writeFileSync(join(outDir, 'official-rarity-report.json'), `${JSON.stringify({ ...summary, plans: files, quarantined, waiting }, null, 1)}\n`);
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
