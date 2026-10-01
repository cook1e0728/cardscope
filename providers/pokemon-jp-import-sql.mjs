import { createHash } from 'node:crypto';

/**
 * PostgreSQL's jsonb text form: object keys ordered by byte length, then
 * bytes; ", " and ": " separators. Hashing it reproduces the planDigest that
 * private.import_pokemon_jp_metadata computes from p_plan::text.
 */
export function postgresJsonbText(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(', ')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => {
      const a = Buffer.from(left);
      const b = Buffer.from(right);
      return a.length - b.length || Buffer.compare(a, b);
    });
    return `{${keys.map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export function pokemonJpPlanDigest(plan) {
  return createHash('sha256').update(postgresJsonbText(plan), 'utf8').digest('hex');
}

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

function expectedCard(plan, card, evidenceExtra) {
  const n = card.official_card_number;
  const code = plan.seriesProviderId;
  const url = `https://api.tcgdex.net/v2/ja/cards/${code}-${n}`;
  return {
    id: `${plan.series.id}-${n.toLowerCase()}`,
    provider_id: `${code}-${n}`,
    official_card_number: n,
    name_ja: card.name_ja,
    rarity_code: card.rarity_code,
    search_text: [card.name_ja, n, `${code}-${n}`, `${code}${n}`.toLowerCase()].join(' '),
    source_url: url,
    release_date: plan.series.release_date,
    metadata: {
      tcgdexId: `${code}-${n}`,
      sourceEvidence: {
        url,
        urlType: 'derived-provider-endpoint',
        observedAt: plan.sourceObservedAt,
        ...evidenceExtra(n)
      },
      manifestHash: plan.manifestHash,
      sourceHash: plan.sourceHash,
      seedHash: plan.seedHash
    }
  };
}

/**
 * Emit SQL that rebuilds `plan` inside PostgreSQL from a short
 * (number, name, rarity) list and calls the importer only when the rebuilt
 * jsonb hashes to the plan's digest, so a pasted typo can never write data.
 * Throws when any card does not follow the derivable template.
 */
export function buildPokemonJpImportSql(plan, { actor, dryRun, gated = false }) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('POKEMON_JP_SQL_ACTOR_REQUIRED');
  if (typeof dryRun !== 'boolean') throw new Error('POKEMON_JP_SQL_DRY_RUN_REQUIRED');
  if (gated && dryRun) throw new Error('POKEMON_JP_SQL_GATE_REQUIRES_IMPORT');
  const archive = plan.series.metadata.sourceEvidence.archive;
  const archiveExtra = archive
    ? n => ({ retrievedVia: 'github-archive', archive: { repository: archive.repository, commit: archive.commit, path: `${archive.path.slice(0, -3)}/${n}.ts` } })
    : () => ({});
  for (const card of plan.cards) {
    if (JSON.stringify(expectedCard(plan, card, archiveExtra)) !== JSON.stringify(card)) {
      throw new Error(`POKEMON_JP_SQL_CARD_NOT_DERIVABLE:${card.provider_id}`);
    }
  }
  const digest = pokemonJpPlanDigest(plan);
  const s = plan.series;
  const evidence = archive
    ? `'retrievedVia', 'github-archive', 'archive', jsonb_build_object('repository', k.repo, 'commit', k.sha, 'path', ${sqlText(archive.path)})`
    : null;
  const cardEvidence = archive
    ? `'retrievedVia', 'github-archive', 'archive', jsonb_build_object('repository', k.repo, 'commit', k.sha, 'path', ${sqlText(archive.path.slice(0, -3) + '/')} || c.n || '.ts')`
    : null;
  const values = plan.cards
    .map(card => `(${sqlText(card.official_card_number)},${sqlText(card.name_ja)},${card.rarity_code == null ? 'null' : sqlText(card.rarity_code)})`)
    .join(',');
  const code = plan.seriesProviderId;
  const sql = `with k as (select ${sqlText(plan.manifestHash)}::text mh, ${sqlText(plan.sourceHash)}::text sh, ${sqlText(plan.seedHash)}::text seh, ${sqlText(plan.sourceObservedAt)}::text obs, ${sqlText(archive?.repository ?? '')}::text repo, ${sqlText(archive?.commit ?? '')}::text sha),
c(n, name, rar) as (values ${values}),
p as (select jsonb_build_object(
  'planVersion', ${Number(plan.planVersion)}, 'source', ${sqlText(plan.source)}, 'seriesProviderId', ${sqlText(code)},
  'manifestHash', k.mh, 'sourceHash', k.sh, 'seedHash', k.seh, 'sourceObservedAt', k.obs,
  'series', jsonb_build_object('id', ${sqlText(s.id)}, 'provider_id', ${sqlText(s.provider_id)}, 'name_ja', ${sqlText(s.name_ja)},
    'release_date', ${s.release_date == null ? 'null::text' : sqlText(s.release_date)}, 'source_url', ${sqlText(s.source_url)},
    'metadata', jsonb_build_object(
      'sourceEvidence', jsonb_build_object('url', ${sqlText(s.metadata.sourceEvidence.url)}, 'urlType', 'derived-provider-endpoint', 'observedAt', k.obs${evidence ? `, ${evidence}` : ''}),
      'manifestHash', k.mh, 'sourceHash', k.sh, 'seedHash', k.seh)),
  'cards', (select jsonb_agg(jsonb_build_object(
      'id', ${sqlText(s.id + '-')} || lower(c.n), 'provider_id', ${sqlText(code + '-')} || c.n, 'official_card_number', c.n,
      'name_ja', c.name, 'rarity_code', c.rar::text,
      'search_text', c.name || ' ' || c.n || ' ' || ${sqlText(code + '-')} || c.n || ' ' || lower(${sqlText(code)} || c.n),
      'source_url', ${sqlText(`https://api.tcgdex.net/v2/ja/cards/${code}-`)} || c.n, 'release_date', ${s.release_date == null ? 'null::text' : sqlText(s.release_date)},
      'metadata', jsonb_build_object('tcgdexId', ${sqlText(code + '-')} || c.n,
        'sourceEvidence', jsonb_build_object('url', ${sqlText(`https://api.tcgdex.net/v2/ja/cards/${code}-`)} || c.n, 'urlType', 'derived-provider-endpoint', 'observedAt', k.obs${cardEvidence ? `, ${cardEvidence}` : ''}),
        'manifestHash', k.mh, 'sourceHash', k.sh, 'seedHash', k.seh)) order by c.n collate "C") from c)
) as plan from k)
`;
  const hashed = `select plan, encode(pg_catalog.sha256(convert_to(plan::text, 'UTF8')), 'hex') as digest from p`;
  const call = flag => `private.import_pokemon_jp_metadata(plan, ${sqlText(actor)}, ${flag})`;
  if (!gated) {
    return { digest, sql: `${sql}select digest, case when digest = ${sqlText(digest)} then ${call(dryRun)} end as result
from (${hashed}) h;
` };
  }
  // Gated import: a dry run in the inner query (an optimisation fence keeps it
  // first) must report a fresh, collision-free insert of exactly this plan
  // before the outer query performs the real write in the same statement.
  const n = plan.cards.length;
  return { digest, sql: `${sql}select digest, dry, case when dry->>'replay' = 'false'
    and dry->>'planDigest' = ${sqlText(digest)}
    and dry->'before' = '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb
    and dry->'inserted' = '{"series":1,"cards":${n},"canonical":${n},"printings":${n}}'::jsonb
  then ${call(false)} end as result
from (select plan, digest, case when digest = ${sqlText(digest)} then ${call(true)} end as dry from (${hashed}) h offset 0) d;
` };
}
