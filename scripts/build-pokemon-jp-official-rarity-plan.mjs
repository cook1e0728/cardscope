import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchOfficialJpRarity, officialJpDetailUrl } from '../providers/pokemon-jp-official.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-rarity-plan.mjs <jp-printings.json> <cache.json> <out-dir> [--actor NAME]',
  '',
  'Turns cached pokemon-card.com facts into plans of at most 100 rows per series and one gated SQL',
  'file per plan (the call must change exactly the planned rows, or the whole request rolls back):',
  '  fill      empty rarities                      private.fill_pokemon_jp_official_rarity (ADR 0007)',
  '  correct   rarities that differ from official  private.correct_pokemon_jp_official_rarity (ADR 0009)',
  '  identity  pending cards the page confirms     private.promote_pokemon_jp_official_identity (ADR 0008)',
  'jp-printings.json: every tcgdex-ja printing [{ code, num, printing_id, card_id, name_ja, rarity, card_status }].',
  'Also writes official-rarity-report.json with every quarantined row. No network or database calls.'
].join('\n');

const KINDS = {
  fill: { fn: 'private.fill_pokemon_jp_official_rarity', key: 'filled', adr: '0007' },
  correct: { fn: 'private.correct_pokemon_jp_official_rarity', key: 'corrected', adr: '0009' },
  identity: { fn: 'private.promote_pokemon_jp_official_identity', key: 'promoted', adr: '0008' }
};

try {
  const args = process.argv.slice(2);
  const [printingsPath, cachePath, outDir] = args;
  if (!printingsPath || !cachePath || !outDir) throw new Error('ARGUMENTS_REQUIRED');
  const actorIndex = args.indexOf('--actor');
  const actor = actorIndex === -1 ? 'claude-code-local:aa26488931' : args[actorIndex + 1];
  const printings = JSON.parse(readFileSync(printingsPath, 'utf8'));
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const byIdentity = new Map(Object.values(cache.details).filter(d => d.setMark && d.number).map(d => [`${d.setMark}|${d.number}`, d]));

  const plans = { fill: new Map(), correct: new Map(), identity: new Map() }, quarantined = [], notFetched = [];
  const add = (kind, code, row) => { const rows = plans[kind].get(code) || []; rows.push(row); plans[kind].set(code, rows); };
  for (const row of printings) {
    const detail = byIdentity.get(`${row.code}|${row.num}`);
    if (!detail) { notFetched.push({ code: row.code, num: row.num, rarity: row.rarity, cardStatus: row.card_status }); continue; }
    const base = { code: row.code, num: row.num, nameJa: row.name_ja, officialCardId: detail.cardId, url: officialJpDetailUrl(detail.cardId) };
    const decision = matchOfficialJpRarity(row, detail);
    // Identity needs set, number and name to agree; the rarity icon does not matter for it.
    const identityOk = !decision.quarantine || /^(OFFICIAL_NO_RARITY_ICON|UNKNOWN_RARITY_ICON)/.test(decision.quarantine);
    if (identityOk && row.card_status === 'pending') add('identity', row.code, { cardId: row.card_id, number: row.num, nameJa: row.name_ja, officialCardId: detail.cardId });
    if (decision.quarantine) { quarantined.push({ ...base, database: row.rarity, reason: decision.quarantine }); continue; }
    const target = { printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, nameJa: row.name_ja };
    if (!row.rarity) add('fill', row.code, { ...target, rarity: decision.rarity, officialCardId: detail.cardId });
    else if (row.rarity !== decision.rarity) add('correct', row.code, { ...target, from: row.rarity, rarity: decision.rarity, officialCardId: detail.cardId });
  }

  mkdirSync(outDir, { recursive: true });
  const files = [], counts = {};
  for (const [kind, byCode] of Object.entries(plans)) {
    const { fn, key, adr } = KINDS[kind];
    counts[kind] = 0;
    for (const [code, rows] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
      rows.sort((a, b) => a.number.localeCompare(b.number));
      counts[kind] += rows.length;
      for (let start = 0, part = 1; start < rows.length; start += 100, part++) {
        const plan = { version: 1, seriesProviderId: code, rows: rows.slice(start, start + 100) };
        const json = JSON.stringify(plan);
        if (json.includes('$plan$') || actor.includes("'")) throw new Error('PLAN_QUOTE_COLLISION');
        const name = `${kind}-${code}-${String(part).padStart(2, '0')}`;
        writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
        writeFileSync(join(outDir, `${name}.sql`), [
          `-- ${name}: ${kind} ${plan.rows.length} rows (ADR ${adr}). Rolls back unless exactly that many change.`,
          'create temporary table jp_official_result (v jsonb) on commit drop;',
          'do $do$',
          'declare r jsonb;',
          'begin',
          `  r := ${fn}($plan$${json}$plan$::jsonb, '${actor}', false);`,
          `  if (r->>'replay')::boolean or (r->>'${key}')::int <> ${plan.rows.length} then raise exception 'unexpected ${kind} result %', r; end if;`,
          '  insert into jp_official_result values (r);',
          'end',
          '$do$;',
          'select v from jp_official_result;',
          ''
        ].join('\n'));
        writeFileSync(join(outDir, `${name}-replay.sql`), `-- ${name} replay: must change nothing.\nselect ${fn}($plan$${json}$plan$::jsonb, '${actor}', false) v;\n`);
        files.push({ name, kind, rows: plan.rows.length });
      }
    }
  }
  const reasons = quarantined.reduce((tally, row) => { const reason = row.reason.split(':')[0]; tally[reason] = (tally[reason] || 0) + 1; return tally; }, {});
  const summary = { ...counts, quarantined: quarantined.length, quarantineReasons: reasons, notFetched: notFetched.length, files: files.length };
  writeFileSync(join(outDir, 'official-rarity-report.json'), `${JSON.stringify({ ...summary, plans: files, quarantined, notFetched }, null, 1)}\n`);
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
