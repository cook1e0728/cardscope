import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const ui=await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8');

test('IP switching prioritizes only the first visible card images',()=>{
  assert.match(html,/CARD_IMAGE_PREFETCH_COUNT=24,CARD_IMAGE_PRIORITY_COUNT=12/);
  assert.match(html,/slice\(0,CARD_IMAGE_PREFETCH_COUNT\)/);
  assert.match(html,/img\.loading='eager'/);
  assert.match(html,/img\.fetchPriority='high'/);
  assert.match(ui,/primeCardImages\(host\.dataset\.cardscopeGame\|\|game,browse\)/);
});

test('stale IP and search responses cannot repaint the selected catalog',()=>{
  assert.match(html,/browseRequestIsCurrent\(state,requestVersion,selectedGame,selectedRegion,selectedRarity,selectedPrice,selectedSort\)/);
  assert.match(html,/if\(game!==id\)return/);
  assert.match(html,/browse!==searchState\|\|game!==searchGame\|\|\$\('browseRegion'\)\.value!==searchRegion/);
  assert.match(html,/body\.data\|\|\[\]\)\.filter\(c=>c\.game===selectedGame\)/);
});

test('image priority is scoped to the currently selected IP',()=>{
  assert.match(html,/host\.dataset\.cardscopeGame=scope\|\|game/);
  assert.match(html,/host\.dataset\.cardscopeGame!==scope/);
  assert.match(html,/scope!==game/);
});
