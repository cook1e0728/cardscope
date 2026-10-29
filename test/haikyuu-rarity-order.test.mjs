import test from 'node:test';
import assert from 'node:assert/strict';
import rankings from '../data/rarity-rankings.json' with { type: 'json' };
import { rarityCanonicalCode, rarityDisplayLabel } from '../providers/normalize.mjs';

const definition = rankings.systems.haikyuu;
const officialBaseOrder = ['極', '秘', '頂', 'S', 'R', 'N', 'D', 'P'];
const expectedHighToLow = ['極P', '極', '秘', '頂P', '頂', 'SP', 'S', 'RP', 'R', 'NP', 'N', 'DP', 'D', 'P'];
const expectedParallelOf = { 極P: '極', 頂P: '頂', SP: 'S', RP: 'R', NP: 'N', DP: 'D' };

test('official Haikyuu rarity vocabulary is represented without cross-IP aliases', () => {
  assert.equal(definition.sourceUrl, 'https://www.takaratomy.co.jp/products/haikyuvobacabreak/cardlist/');
  assert.ok(Array.isArray(definition.evidenceUrls) && definition.evidenceUrls.length >= 2);
  for (const url of definition.evidenceUrls) {
    assert.match(url, /^https:\/\/www\.takaratomy\.co\.jp\/products\/haikyuvobacabreak\//);
  }
  assert.deepEqual(definition.baseCodes, officialBaseOrder);
  assert.deepEqual(definition.parallelOf, expectedParallelOf);
  assert.deepEqual(definition.aliases, {});
  assert.deepEqual(definition.highToLow.map(group => group[0]), expectedHighToLow);
  assert.deepEqual(definition.canonicalCodes, expectedHighToLow);
});

test('極P is highest and low-to-high is an exact reversal', () => {
  assert.equal(definition.highToLow[0][0], '極P');
  assert.deepEqual(
    definition.lowToHigh.map(group => group[0]),
    [...expectedHighToLow].reverse()
  );

  const highIndex = new Map(expectedHighToLow.map((code, index) => [code, index]));
  for (const [parallel, base] of Object.entries(expectedParallelOf)) {
    assert.ok(highIndex.get(parallel) < highIndex.get(base), `${parallel} must precede ${base}`);
  }
});

test('parallel treatments remain distinct from their base rarities', () => {
  for (const [parallel, base] of Object.entries(expectedParallelOf)) {
    assert.equal(rarityCanonicalCode('haikyuu', parallel), parallel);
    assert.equal(rarityDisplayLabel('haikyuu', parallel), parallel);
    assert.notEqual(rarityCanonicalCode('haikyuu', parallel), base);
  }
  for (const code of officialBaseOrder) {
    assert.equal(rarityCanonicalCode('haikyuu', code), code);
    assert.equal(rarityDisplayLabel('haikyuu', code), code);
  }
});

test('Fusion World rarity vocabulary matches the official filter plus the energy-marker group and keeps its order reversible', () => {
  const fw = rankings.systems['dragonball-fw'];
  assert.deepEqual([...fw.canonicalCodes].sort(), ['C', 'L', 'PR', 'R', 'SCR', 'SR', 'UC', '能量標記']);
  assert.deepEqual(fw.highToLow.map(group => group[0]), ['SCR', 'SR', 'L', 'R', 'UC', 'C', 'PR', '能量標記']);
  assert.deepEqual(fw.lowToHigh.map(group => group[0]), [...fw.highToLow.map(group => group[0])].reverse());
  for (const code of fw.canonicalCodes) assert.equal(rarityCanonicalCode('dragonball-fw', code), code);
});
