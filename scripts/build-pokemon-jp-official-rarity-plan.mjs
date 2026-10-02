import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchOfficialJpRarity, officialJpDetailUrl, officialJpRarity } from '../providers/pokemon-jp-official.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-rarity-plan.mjs <needed.json> <cache.json> <out-dir> [--existing existing.json] [--actor NAME]',
  '',
  'Turns cached pokemon-card.com facts (ADR 0007) into private.fill_pokemon_jp_official_rarity plans of at',
  'most 100 rows per series, one gated SQL file per plan (the call must fill exactly the planned rows, or',
  'the whole request rolls back), plus a report of quarantined rows. With --existing (JP printings that',
  'already have a rarity: [{ code, num, name_ja, rarity }]) it also lists official values that differ;',
  'those are only reported, never written. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [neededPath, cachePath, outDir] = args;
  if (!neededPath || !cachePath || !outDir) throw new Error('ARGUMENTS_REQUIRED');
  const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
  const actor = option('actor') || 'claude-code-local:aa26488931';
  const needed = JSON.parse(readFileSync(neededPath, 'utf8'));
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const byIdentity = new Map(Object.values(cache.details).filter(d => d.setMark && d.number).map(d => [`${d.setMark}|${d.number}`, d]));

  const planned = new Map(), quarantined = [];
  for (const row of needed) {
    const detail = byIdentity.get(`${row.code}|${row.num}`);
    if (!detail) { quarantined.push({ code: row.code, num: row.num, printingId: row.printing_id, reason: 'OFFICIAL_PAGE_NOT_FETCHED' }); continue; }
    const decision = matchOfficialJpRarity(row, detail);
    if (!decision.rarity) { quarantined.push({ code: row.code, num: row.num, printingId: row.printing_id, officialCardId: detail.cardId, reason: decision.quarantine }); continue; }
    const rows = planned.get(row.code) || [];
    rows.push({ printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, nameJa: row.name_ja, rarity: decision.rarity, officialCardId: detail.cardId });
    planned.set(row.code, rows);
  }

  const differences = [];
  if (option('existing')) {
    for (const row of JSON.parse(readFileSync(option('existing'), 'utf8'))) {
      const detail = byIdentity.get(`${row.code}|${row.num}`);
      if (!detail) continue;
      const official = officialJpRarity(detail.rarityIcon);
      if (official.rarity && official.rarity !== row.rarity) differences.push({ code: row.code, num: row.num, nameJa: row.name_ja, database: row.rarity, official: official.rarity, officialCardId: detail.cardId, url: officialJpDetailUrl(detail.cardId) });
    }
  }

  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const [code, rows] of [...planned].sort(([a], [b]) => a.localeCompare(b))) {
    rows.sort((a, b) => a.number.localeCompare(b.number));
    for (let start = 0, part = 1; start < rows.length; start += 100, part++) {
      const plan = { version: 1, seriesProviderId: code, rows: rows.slice(start, start + 100) };
      const json = JSON.stringify(plan);
      if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
      const name = `${code}-official-rarity-${String(part).padStart(2, '0')}`;
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), [
        `-- ${name}: fill ${plan.rows.length} JP rarities from pokemon-card.com (ADR 0007). Rolls back unless exactly that many are filled.`,
        'create temporary table jp_fill_result (v jsonb) on commit drop;',
        'do $do$',
        'declare r jsonb;',
        'begin',
        `  r := private.fill_pokemon_jp_official_rarity($plan$${json}$plan$::jsonb, '${actor}', false);`,
        `  if (r->>'replay')::boolean or (r->>'filled')::int <> ${plan.rows.length} then raise exception 'unexpected fill result %', r; end if;`,
        '  insert into jp_fill_result values (r);',
        'end',
        '$do$;',
        'select v from jp_fill_result;',
        ''
      ].join('\n'));
      writeFileSync(join(outDir, `${name}-replay.sql`), `-- ${name} replay: must change nothing.\nselect private.fill_pokemon_jp_official_rarity($plan$${json}$plan$::jsonb, '${actor}', false) v;\n`);
      files.push({ name, rows: plan.rows.length });
    }
  }
  const summary = { planned: [...planned.values()].reduce((n, rows) => n + rows.length, 0), quarantined: quarantined.length, differences: differences.length, files };
  writeFileSync(join(outDir, 'official-rarity-report.json'), `${JSON.stringify({ ...summary, quarantined, differences }, null, 1)}\n`);
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
