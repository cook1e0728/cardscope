import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokemonJpArchiveSnapshot,
  parseTcgdexDataModule
} from '../providers/pokemon-jp-tcgdex-archive.mjs';
import { planPokemonJpManifest } from '../providers/pokemon-jp-manifest.mjs';
import { buildPokemonJpImportPlan } from '../providers/pokemon-jp-import-plan.mjs';

const COMMIT = 'c5c0a8a63fe81746d05b9c95e8f51ed6931f7e78';
const OBSERVED_AT = '2026-10-01T10:00:00.000Z';
const NO_ROWS = { series: [], cards: [], printings: [] };

const setSource = `import { Set } from '../../interfaces'
import serie from '../SV'

const set: Set = {
\tid: 'SVT',
\tname: {
\t\tja: 'テストセット',
\t\t'zh-tw': '測試'
\t},
\tserie: serie,
\tcardCount: {
\t\tofficial: 2
\t},
\treleaseDate: {
\t\tja: '2024-06-07'
\t}
}

export default set
`;

const cardSource = (name, rarity) => `import { Card } from "../../../interfaces"
import Set from "../SVT"

// comment
const card: Card = {
\tset: Set,
\tname: {
\t\tja: "${name}"
\t},
\thp: 110,
\tattacks: [{
\t\tcost: ["Water", "Colorless"],
\t\tdamage: 30,
\t\teffect: { ja: "相手の\\"ポケモン\\"に、50ダメージ。" }
\t}],
\tlegal: { standard: false, expanded: true },
\trarity: "${rarity}",
};

export default card
`;

function archiveSnapshot(cards = [['001.ts', cardSource('マンタイン', 'Common')], ['002.ts', cardSource('サンダー', 'Illustration rare')]]) {
  return buildPokemonJpArchiveSnapshot({
    commit: COMMIT,
    seriesGroup: 'SV',
    setId: 'SVT',
    setSource,
    cardSources: cards.map(([file, source]) => ({ file, source })),
    observedAt: OBSERVED_AT,
    existingJpRows: NO_ROWS
  });
}

test('TCGdex data modules parse as plain literals', () => {
  const card = parseTcgdexDataModule(cardSource('マンタイン', 'Common'));
  assert.deepEqual(card.set, { $ref: 'Set' });
  assert.equal(card.name.ja, 'マンタイン');
  assert.equal(card.attacks[0].effect.ja, '相手の"ポケモン"に、50ダメージ。');
  assert.deepEqual(card.legal, { standard: false, expanded: true });
  assert.equal(card.hp, 110);
  assert.equal(parseTcgdexDataModule(setSource).name['zh-tw'], '測試');
});

test('TCGdex data modules reject anything that would need execution', () => {
  const wrap = body => `const card: Card = ${body}\n\nexport default card\n`;
  for (const body of [
    '{ name: fetch("x") }',
    '{ name: `template` }',
    '{ ...other }',
    '{ name: "a" + "b" }',
    '{ get name() { return 1 } }',
    '{ name: "a", name: "b" }'
  ]) {
    assert.throws(() => parseTcgdexDataModule(wrap(body)), /TCGDEX_ARCHIVE_/, body);
  }
  assert.throws(() => parseTcgdexDataModule(`import x from 'y'\nrunSomething()\n${wrap('{}')}`), /UNSUPPORTED_HEADER/);
  assert.throws(() => parseTcgdexDataModule(`${wrap('{}')}\nexport const other = 1\n`), /EXPORT_NOT_FOUND/);
});

test('archive snapshot mirrors API card rows and pins the commit', () => {
  const snapshot = archiveSnapshot();
  assert.deepEqual(snapshot.sourceArchive, { repository: 'tcgdex/cards-database', commit: COMMIT, setFile: 'data-asia/SV/SVT.ts' });
  assert.deepEqual(snapshot.sets, [{ id: 'SVT', name: 'テストセット', releaseDate: '2024-06-07', region: 'JP', locale: 'ja-JP' }]);
  assert.deepEqual(snapshot.cards[1], {
    id: 'SVT-002',
    localId: '002',
    name: 'サンダー',
    category: null,
    rarity: 'Illustration rare',
    set: { id: 'SVT', name: 'テストセット', cardCount: { official: 2, total: 2 } },
    sourceFile: 'data-asia/SV/SVT/002.ts'
  });
  assert.throws(() => archiveSnapshot([['001.ts', cardSource('', 'Common')]]), /missing-ja-name/);
  assert.throws(() => buildPokemonJpArchiveSnapshot({ ...archiveSnapshot(), commit: 'main', seriesGroup: 'SV', setId: 'SVT', setSource, cardSources: [] }), /COMMIT_REQUIRED/);
});

test('archive provenance reaches the manifest and the import plan', () => {
  const manifest = planPokemonJpManifest(archiveSnapshot(), { seriesId: 'SVT' });
  assert.equal(manifest.quarantined.length, 0);
  assert.deepEqual(manifest.provenance.sourceArchive, { repository: 'tcgdex/cards-database', commit: COMMIT, setFile: 'data-asia/SV/SVT.ts' });
  const plan = buildPokemonJpImportPlan(manifest);
  assert.equal(plan.series.source_url, 'https://api.tcgdex.net/v2/ja/sets/SVT');
  assert.deepEqual(plan.series.metadata.sourceEvidence.archive, { repository: 'tcgdex/cards-database', commit: COMMIT, path: 'data-asia/SV/SVT.ts' });
  assert.equal(plan.cards[1].source_url, 'https://api.tcgdex.net/v2/ja/cards/SVT-002');
  assert.equal(plan.cards[1].rarity_code, 'AR');
  assert.deepEqual(plan.cards[1].metadata.sourceEvidence, {
    url: 'https://api.tcgdex.net/v2/ja/cards/SVT-002',
    urlType: 'derived-provider-endpoint',
    observedAt: OBSERVED_AT,
    retrievedVia: 'github-archive',
    archive: { repository: 'tcgdex/cards-database', commit: COMMIT, path: 'data-asia/SV/SVT/002.ts' }
  });
});

test('archive snapshots bind the source hash and reject mismatched files', () => {
  const snapshot = archiveSnapshot();
  const withoutArchive = { ...snapshot };
  delete withoutArchive.sourceArchive;
  assert.notEqual(
    planPokemonJpManifest(snapshot, { seriesId: 'SVT' }).provenance.sourceHash,
    planPokemonJpManifest(withoutArchive, { seriesId: 'SVT' }).provenance.sourceHash
  );

  const moved = { ...snapshot, cards: snapshot.cards.map((card, index) => index === 0 ? { ...card, sourceFile: 'data-asia/SV/OTHER/001.ts' } : card) };
  const manifest = planPokemonJpManifest(moved, { seriesId: 'SVT' });
  assert.deepEqual(manifest.quarantined.map(row => [row.sourceProviderId, row.reasons]), [['SVT-001', ['archive-source-file-mismatch']]]);

  for (const sourceArchive of [
    { ...snapshot.sourceArchive, repository: 'someone/fork' },
    { ...snapshot.sourceArchive, commit: 'c5c0a8a' },
    { ...snapshot.sourceArchive, setFile: 'data-asia/SV/OTHER.ts' },
    { ...snapshot.sourceArchive, extra: true }
  ]) {
    assert.throws(() => planPokemonJpManifest({ ...snapshot, sourceArchive }, { seriesId: 'SVT' }), /INVALID_POKEMON_JP_SOURCE_ARCHIVE/);
  }
});
