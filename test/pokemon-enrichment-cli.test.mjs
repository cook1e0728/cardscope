import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const planScript = fileURLToPath(new URL('../scripts/plan-pokemon-enrichment.mjs', import.meta.url));
const runScript = fileURLToPath(new URL('../scripts/run-pokemon-enrichment.mjs', import.meta.url));

function invoke(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true
  });
}

test('both Pokémon enrichment CLIs document exact series and inclusive numeric range options', () => {
  for (const script of [planScript, runScript]) {
    const result = invoke(script, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--series <code>/);
    assert.match(result.stdout, /--card-number-from <n>/);
    assert.match(result.stdout, /--card-number-to <n>/);
  }
});

test('plan CLI rejects a reversed numeric range before any source request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cardscope-enrichment-cli-'));
  const snapshotPath = join(directory, 'snapshot.json');
  await writeFile(snapshotPath, JSON.stringify({ cards: [], printings: [], cardNames: [] }), 'utf8');
  try {
    const result = invoke(planScript, [
      snapshotPath,
      '--series', 'SV4A',
      '--card-number-from', '10',
      '--card-number-to', '2'
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INVALID_POKEMON_CARD_NUMBER_RANGE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
