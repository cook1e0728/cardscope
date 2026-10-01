import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPokemonJpEnrichPlan } from '../providers/pokemon-jp-enrich-plan.mjs';
import { parseTcgdexDataModule, TCGDEX_ARCHIVE_JA_ROOT, TCGDEX_ARCHIVE_REPOSITORY } from '../providers/pokemon-jp-tcgdex-archive.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-enrich-plan.mjs <cards-database checkout> --series <set id> --jp-plan <import-plan.json>',
  '',
  'Builds the private.enrich_pokemon_jp_metadata plan for one imported JP series (ADR 0003).',
  'JP rows come from the series import plan (freshly imported, not yet enriched). TW rows are',
  'expected as tcgdex-zh-tw imported them: id pokemon-tcgdex-tw-<set>-<local>, own canonical,',
  'name = the archive zh-tw name. The printed fingerprints must equal the database before use;',
  'the database function re-checks every link anyway. No network or database calls.'
].join('\n');

const md5 = text => createHash('md5').update(text).digest('hex');

try {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
  const repoDir = args[0];
  const setId = option('series');
  const jpPlanPath = option('jp-plan');
  if (!repoDir || repoDir.startsWith('--') || !setId || !jpPlanPath) throw new Error('ARGUMENTS_REQUIRED');

  const root = join(repoDir, TCGDEX_ARCHIVE_JA_ROOT);
  const groups = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, `${setId}.ts`)))
    .map(entry => entry.name);
  if (groups.length !== 1) throw new Error(`ARCHIVE_SET_NOT_UNIQUE:${setId}`);
  const setDir = join(root, groups[0], setId);
  const commit = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const zhTw = value => (value && typeof value === 'object' ? value['zh-tw'] ?? null : null);
  const ja = value => (typeof value === 'string' ? value : value?.ja ?? null);

  const set = parseTcgdexDataModule(readFileSync(join(root, groups[0], `${setId}.ts`), 'utf8'));
  const archiveCards = readdirSync(setDir).filter(file => file.endsWith('.ts')).sort().map(file => {
    const card = parseTcgdexDataModule(readFileSync(join(setDir, file), 'utf8'));
    return { providerId: `${setId}-${file.slice(0, -3)}`, ja: ja(card.name), zhTw: zhTw(card.name), rarity: card.rarity ?? null };
  });

  const jpPlan = JSON.parse(readFileSync(jpPlanPath, 'utf8'));
  if (jpPlan.seriesProviderId !== setId) throw new Error('JP_PLAN_SERIES_MISMATCH');
  const jpCards = jpPlan.cards.map(card => ({
    id: card.id, provider_id: card.provider_id, name_ja: card.name_ja, name_zh: null, canonical_id: card.id, rarity: card.rarity_code
  }));
  // --after <enrich-plan evidence>: replay an earlier, already-applied enrichment so this plan only fills what is still empty.
  let seriesNameZh = null;
  const afterPath = option('after');
  if (afterPath) {
    const after = JSON.parse(readFileSync(afterPath, 'utf8')).plan;
    if (after.seriesProviderId !== setId) throw new Error('AFTER_PLAN_SERIES_MISMATCH');
    const byId = new Map(jpCards.map(card => [card.id, card]));
    for (const entry of after.cards) {
      const card = byId.get(entry.id);
      if (!card) throw new Error(`AFTER_PLAN_UNKNOWN_CARD:${entry.id}`);
      if (entry.name_zh) card.name_zh = entry.name_zh;
      if (entry.link) card.canonical_id = entry.link;
      if (entry.rarity_code) card.rarity = entry.rarity_code;
    }
    seriesNameZh = after.series?.name_zh ?? null;
  }
  // --cross-names <json>: [[name_ja, { zh, sourceCardId }], ...] (ADR 0004).
  const crossPath = option('cross-names');
  const crossSeriesNames = crossPath ? new Map(JSON.parse(readFileSync(crossPath, 'utf8')).names) : null;

  const twSeriesId = `pokemon-tcgdex-tw-${setId.toLowerCase()}`;
  const twCards = archiveCards.filter(card => card.zhTw).map(card => ({
    id: `pokemon-tcgdex-tw-${card.providerId.toLowerCase()}`, provider_id: card.providerId, name_zh: card.zhTw,
    canonical_id: `pokemon-tcgdex-tw-${card.providerId.toLowerCase()}`, canonicalShared: false
  }));
  const twSeries = zhTw(set.name) && twCards.length ? { id: twSeriesId, official_code: setId, name_zh: zhTw(set.name) } : null;

  const result = buildPokemonJpEnrichPlan({
    jpSeries: { id: jpPlan.series.id, providerId: setId, nameZh: seriesNameZh },
    jpCards,
    archiveSet: { zhTw: zhTw(set.name) },
    archiveCards,
    twSeries,
    twCards: twSeries ? twCards : [],
    sourceArchive: { repository: TCGDEX_ARCHIVE_REPOSITORY, commit },
    crossSeriesNames
  });
  // Compare with: md5(string_agg(concat_ws('|', id, provider_id, name_zh, canonical_id), E'\n' order by id collate "C"))
  result.fingerprints = {
    twCards: md5([...twCards].sort((a, b) => (a.id < b.id ? -1 : 1)).map(c => [c.id, c.provider_id, c.name_zh, c.canonical_id].join('|')).join('\n')),
    twCardCount: twCards.length,
    jpCards: md5([...jpCards].sort((a, b) => (a.id < b.id ? -1 : 1)).map(c => [c.id, c.provider_id, c.name_ja].join('|')).join('\n'))
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
}
