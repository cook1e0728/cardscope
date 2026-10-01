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
  const sql = `with k as (select ${sqlText(plan.manifestHash)}::text mh, ${sqlText(plan.series.metadata.manifestHash)}::text smh, ${sqlText(plan.sourceHash)}::text sh, ${sqlText(plan.seedHash)}::text seh, ${sqlText(plan.sourceObservedAt)}::text obs, ${sqlText(archive?.repository ?? '')}::text repo, ${sqlText(archive?.commit ?? '')}::text sha),
c(n, name, rar) as (values ${values}),
p as (select jsonb_build_object(
  'planVersion', ${Number(plan.planVersion)}, 'source', ${sqlText(plan.source)}, 'seriesProviderId', ${sqlText(code)},
  'manifestHash', k.mh, 'sourceHash', k.sh, 'seedHash', k.seh, 'sourceObservedAt', k.obs,
  'series', jsonb_build_object('id', ${sqlText(s.id)}, 'provider_id', ${sqlText(s.provider_id)}, 'name_ja', ${sqlText(s.name_ja)},
    'release_date', ${s.release_date == null ? 'null::text' : sqlText(s.release_date)}, 'source_url', ${sqlText(s.source_url)},
    'metadata', jsonb_build_object(
      'sourceEvidence', jsonb_build_object('url', ${sqlText(s.metadata.sourceEvidence.url)}, 'urlType', 'derived-provider-endpoint', 'observedAt', k.obs${evidence ? `, ${evidence}` : ''}),
      'manifestHash', k.smh, 'sourceHash', k.sh, 'seedHash', k.seh)),
  'cards', (select jsonb_agg(jsonb_build_object(
      'id', ${sqlText(s.id + '-')} || lower(c.n), 'provider_id', ${sqlText(code + '-')} || c.n, 'official_card_number', c.n,
      'name_ja', c.name, 'rarity_code', c.rar::text,
      'search_text', c.name || ' ' || c.n || ' ' || ${sqlText(code + '-')} || c.n || ' ' || lower(${sqlText(code)} || c.n),
      'source_url', ${sqlText(`https://api.tcgdex.net/v2/ja/cards/${code}-`)} || c.n, 'release_date', ${s.release_date == null ? 'null::text' : sqlText(s.release_date)},
      'metadata', jsonb_build_object('tcgdexId', ${sqlText(code + '-')} || c.n,
        'sourceEvidence', jsonb_build_object('url', ${sqlText(`https://api.tcgdex.net/v2/ja/cards/${code}-`)} || c.n, 'urlType', 'derived-provider-endpoint', 'observedAt', k.obs${cardEvidence ? `, ${cardEvidence}` : ''}),
        'manifestHash', k.mh, 'sourceHash', k.sh, 'seedHash', k.seh)) order by c.n collate "C") from c)${plan.batch ? `,
  'batch', jsonb_build_object('index', ${Number(plan.batch.index)}, 'count', ${Number(plan.batch.count)}, 'seriesCardCount', ${Number(plan.batch.seriesCardCount)})` : ''}
) as plan from k)
`;
  const hashed = `select plan, encode(pg_catalog.sha256(convert_to(plan::text, 'UTF8')), 'hex') as digest from p`;
  const call = flag => `private.${plan.batch ? 'import_pokemon_jp_metadata_batch' : 'import_pokemon_jp_metadata'}(plan, ${sqlText(actor)}, ${flag})`;
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
    and dry->'inserted' = '{"series":${plan.batch && plan.batch.index !== 1 ? 0 : 1},"cards":${n},"canonical":${n},"printings":${n}}'::jsonb
  then ${call(false)} end as result
from (select plan, digest, case when digest = ${sqlText(digest)} then ${call(true)} end as dry from (${hashed}) h offset 0) d;
` };
}

/**
 * Same idea for private.enrich_pokemon_jp_metadata plans: rebuild the plan in
 * SQL from (number, Japanese name, Chinese name, basis, rarity) rows and call
 * the function only when the rebuilt jsonb hashes to the plan digest. Links
 * are derived as pokemon-tcgdex-tw-<set>-<number> for 'tw-official' rows, so
 * a card that does not follow that template is rejected here.
 */
export function buildPokemonJpEnrichSql(plan, { actor, dryRun, gated = false }) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('POKEMON_JP_SQL_ACTOR_REQUIRED');
  if (typeof dryRun !== 'boolean') throw new Error('POKEMON_JP_SQL_DRY_RUN_REQUIRED');
  if (gated && dryRun) throw new Error('POKEMON_JP_SQL_GATE_REQUIRES_IMPORT');
  if (plan?.kind !== 'jp-enrich') throw new Error('POKEMON_JP_ENRICH_PLAN_REQUIRED');
  const code = plan.seriesProviderId;
  const prefix = `${plan.seriesId}-`;
  const rows = plan.cards.map(card => {
    const n = card.id.startsWith(prefix) ? card.id.slice(prefix.length) : null;
    const expected = {
      id: `${prefix}${n}`, name_ja: card.name_ja,
      link: card.basis === 'tw-official' ? `pokemon-tcgdex-tw-${code.toLowerCase()}-${n}` : null,
      name_zh: card.name_zh, basis: card.basis, rarity_code: card.rarity_code,
      ...(card.basis === 'derived-cross-series' ? { nameSource: card.nameSource } : {})
    };
    if (!n || JSON.stringify(expected) !== JSON.stringify(card)) throw new Error(`POKEMON_JP_SQL_CARD_NOT_DERIVABLE:${card.id}`);
    const value = v => (v == null ? 'null' : sqlText(v));
    return `(${sqlText(n)},${value(card.name_ja)},${value(card.name_zh)},${value(card.basis)},${value(card.rarity_code)},${value(card.nameSource)})`;
  });
  const digest = pokemonJpPlanDigest(plan);
  const series = plan.series
    ? `jsonb_build_object('name_zh', ${sqlText(plan.series.name_zh)}, 'twSeriesId', ${sqlText(plan.series.twSeriesId)})`
    : `'null'::jsonb`;
  const cards = rows.length
    ? `(select jsonb_agg(jsonb_build_object('id', ${sqlText(prefix)} || c.n, 'name_ja', c.ja,
      'link', case when c.basis = 'tw-official' then ${sqlText(`pokemon-tcgdex-tw-${code.toLowerCase()}-`)} || c.n end,
      'name_zh', c.zh, 'basis', c.basis, 'rarity_code', c.rar) || case when c.src is null then '{}'::jsonb else jsonb_build_object('nameSource', c.src) end order by ${sqlText(prefix)} || c.n collate "C") from c)`
    : `'[]'::jsonb`;
  const head = `with ${rows.length ? `c(n, ja, zh, basis, rar, src) as (values ${rows.join(',')}),\n` : ''}p as (select jsonb_build_object(
  'planVersion', ${Number(plan.planVersion)}, 'kind', 'jp-enrich', 'source', ${sqlText(plan.source)},
  'seriesProviderId', ${sqlText(code)}, 'seriesId', ${sqlText(plan.seriesId)}, 'evidenceHash', ${sqlText(plan.evidenceHash)},
  'sourceArchive', jsonb_build_object('repository', ${sqlText(plan.sourceArchive.repository)}, 'commit', ${sqlText(plan.sourceArchive.commit)}),
  'series', ${series},
  'cards', ${cards}) as plan)
`;
  const hashed = `select plan, encode(pg_catalog.sha256(convert_to(plan::text, 'UTF8')), 'hex') as digest from p`;
  const call = flag => `private.enrich_pokemon_jp_metadata(plan, ${sqlText(actor)}, ${flag})`;
  if (!gated) {
    return { digest, sql: `${head}select digest, case when digest = ${sqlText(digest)} then ${call(dryRun)} end as result
from (${hashed}) h;
` };
  }
  const changed = {
    cards: plan.cards.length,
    links: plan.cards.filter(c => c.basis === 'tw-official').length,
    derived: plan.cards.filter(c => c.basis === 'derived-same-name' || c.basis === 'derived-cross-series').length,
    rarities: plan.cards.filter(c => c.rarity_code).length,
    series: plan.series ? 1 : 0
  };
  return { digest, sql: `${head}select digest, dry, case when dry->>'replay' = 'false'
    and dry->>'planDigest' = ${sqlText(digest)}
    and dry->'changed' = '${JSON.stringify(changed)}'::jsonb
  then ${call(false)} end as result
from (select plan, digest, case when digest = ${sqlText(digest)} then ${call(true)} end as dry from (${hashed}) h offset 0) d;
` };
}
