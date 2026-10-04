import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialTwSupplementPlan, buildOfficialTwSupplementSql } from '../providers/pokemon-tw-official-supplement-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-official-supplement-plan.mjs <tw-cache.json> <archive-printings.json> <out-dir> --series CODE,CODE [--actor NAME]',
  '',
  'ADR 0023: plans for private.supplement_pokemon_tw_official_series, adding the numbers a Source archive',
  'Taiwanese series lacks from the Taiwanese official card search cache. archive-printings.json:',
  '[{ code, series_id, num, name_zh }] for every printing of those archive series. A series is planned only',
  'when every existing number carries the official name. Writes <CODE>-supplement.json/.sql/-replay.sql and',
  '<CODE>-supplement-report.json. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [cachePath, archivePath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!cachePath || !archivePath || !outDir || !flag('--series')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const code of flag('--series').split(',')) {
    const rows = archive.filter(row => row.code === code);
    const seriesIds = [...new Set(rows.map(row => row.series_id))];
    if (seriesIds.length !== 1) throw new Error(`ARCHIVE_SERIES_NOT_SINGLE:${code}:${seriesIds.join('|')}`);
    const ids = Object.values(cache.seriesLists?.[code]?.pages || {}).flat();
    const observedAt = ids.map(id => cache.details[id]?.fetchedAt).filter(Boolean).sort().at(-1);
    const result = buildOfficialTwSupplementPlan({ code, seriesId: seriesIds[0], existing: rows.map(({ num, name_zh }) => ({ num, name_zh })), cache, observedAt });
    let digest = null;
    if (result.plan) {
      const sql = buildOfficialTwSupplementSql(result.plan, actor);
      digest = sql.digest;
      writeFileSync(join(outDir, `${code}-supplement.json`), `${JSON.stringify(result.plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${code}-supplement.sql`), sql.gated);
      writeFileSync(join(outDir, `${code}-supplement-replay.sql`), sql.replay);
    }
    writeFileSync(join(outDir, `${code}-supplement-report.json`), `${JSON.stringify({ summary: result.summary, planDigest: digest, misaligned: result.misaligned, quarantined: result.quarantined, rarityUnknown: result.rarityUnknown, added: result.plan?.cards.map(card => ({ number: card.official_card_number, name: card.name_zh, rarity: card.rarity_code, ids: card.metadata.officialDetailIds })) ?? [] }, null, 1)}\n`);
    console.log(JSON.stringify({ ...result.summary, planDigest: digest }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
