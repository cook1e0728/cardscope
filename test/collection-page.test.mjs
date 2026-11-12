import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 重新設計 v2 階段 5：收藏頁（?view=collection）與行情頁（?view=market）。路由與上一頁、管理選單、匯入失敗不毀資料、側板改品況／備註會存下來。
// 畫面細節（卡牆標籤、側欄、escape）在 collection-unified／escape-markup／collection-store；SEO 在 seo.test。真瀏覽器的流程在 scripts/beta-browser-smoke.mjs。
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const ui = read('ui-enhancements.js'), nav = read('navigation-state.js'), html = read('index.html'), rails = read('home-rails.js'), events = read('market-events.js'), switcher = read('game-switcher.js');
const win = {};
new Function('window', read('collection-store.js'))(win);
const CS = win.CollectionStore;
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };
const backup = items => JSON.stringify({ app: 'cardscope-collection', version: 2, exportedAt: '2026-11-13T00:00:00.000Z', items });

test('route: 我的收藏 and 行情 are SPA views — pushState then restore, popstate restores, so the back button returns to the page before', () => {
  assert.match(nav, /const SITE_VIEWS=\['about','privacy','collection','market'\]/);
  assert.match(nav, /history\.pushState\(\{\},'',view\?`\$\{location\.pathname\}\?view=\$\{view\}`:location\.pathname\);\s*return restore\(readLocation\(\)\)/, 'openView pushes a new history step (never replaceState)');
  assert.match(nav, /window\.addEventListener\('popstate',\(\)=>\{if\(skipRestore\)\{skipRestore=false;return\}return restore\(readLocation\(\)\)\}\)/);
  assert.match(nav, /game:allowedGames\.has\(requestedGame\)&&!\['collection','market'\]\.includes\(view\)\?requestedGame:'all'/, 'these pages belong to no game');
  assert.match(ui, /function openCollection\(\)\{return window\.openView\?\.\('collection'\)\}/);
  assert.match(switcher, /scope\.openCollection\(\)/, '頂欄與底部導覽的收藏鈕走 openCollection');
  assert.match(switcher, /\['collection','market'\]\.includes\(document\.body\?\.dataset\?\.view\)&&typeof scope\.openView==='function'\)return Promise\.resolve\(scope\.openView\(''\)\)/, '圖鑑鈕從這兩頁先回首頁');
  assert.doesNotMatch(ui + html, /collectionDialog|collection-dialog|showModal\(\).*collection/, 'the old collection dialog is gone');
});

test('market page entries: home 最夯 link (a[data-spa]), the collection page text link, the footer link; the top bar stays at three buttons', () => {
  assert.match(rails, /<p class="rails-more"><a href="\/\?view=market" data-spa>看完整行情<\/a><\/p>/);
  assert.match(ui, /<a class="coll-market-link" href="\/\?view=market" data-spa>看卡牌行情<\/a>/);
  assert.match(html, /<a href="\/\?view=market" data-spa>行情<\/a>/);
  assert.equal((html.match(/<nav class="bottom"[\s\S]*?<\/nav>/)[0].match(/<button /g) || []).length, 3);
  assert.match(html, /<h2 id="marketTitle" tabindex="-1">行情<\/h2>/);
  assert.match(events, /if\(view\.view!=='market'\)\{section\.hidden=true;return\}/, 'events are fetched only on the market page');
});

test('manage menu: a real menu (aria, arrow keys, Esc closes only the menu and returns focus), every action says what happened', () => {
  const keys = between('function onCollectionKey', 'function onCollectionChange');
  assert.match(keys, /Escape/);
  assert.match(keys, /preventDefault/, 'Esc is consumed so the side panel stays open (navigation-state skips defaultPrevented)');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) assert.ok(keys.includes(key), key);
  const item = between('function onManageItem', 'function onCollectionClick');
  assert.match(item, /\$\('collManageBtn'\)\?\.focus\(\)/, 'focus returns to the 管理 button');
  assert.match(item, /downloadWatchlistCsv\(\);collectionStatus\(`已下載清單 CSV（\$\{collectionItems\(\)\.length\} 款）。`\)/);
  assert.match(item, /\$\('collFile'\)\?\.click\(\)/, 'import opens the file picker; nothing is read until a file is chosen');
});

// 切出匯入的兩個函式放進 vm：壞檔、超大檔、寫入失敗都不能動到既有收藏。
function importHarness(existing) {
  const statuses = [], commits = [];
  const sandbox = vm.createContext({
    CS, collectionUi: { pending: null, pricesState: 'idle', showSeries: false }, statuses, commits,
    collectionStatus: message => statuses.push(message), renderCollectionExtras() {}, $: () => null, collectionItems: () => existing,
    commitItems: items => { commits.push(items); return sandbox.storageOk; }, storageOk: true, confirm: () => true,
    refreshGrid() {}, resolveCollection: async () => {}, rerenderCollection() {}, loadCollectionPrices: async () => {}, loadSeriesTotals() {}
  });
  vm.runInContext(between('async function importCollectionFile', '// 側板的欄位'), sandbox);
  return sandbox;
}
const fileOf = (text, name = 'backup.json') => ({ name, size: text.length, text: async () => text });
const mine = [{ id: 'a', canonicalId: '', favorite: false, quantity: 3, condition: 'NM', finish: '', note: 'keep me' }];

test('import: a file that is not a CardScope backup, too big or unreadable leaves the existing collection untouched and says so', async () => {
  for (const text of ['{ nope', JSON.stringify({ app: 'other', version: 2, items: [] }), backup([]).replace('"version":2', '"version":9')]) {
    const sb = importHarness(mine);
    await sb.importCollectionFile(fileOf(text));
    assert.equal(sb.collectionUi.pending, null, text.slice(0, 20));
    assert.deepEqual(sb.commits, []);
    assert.match(sb.statuses.at(-1), /沒有匯入：.*既有收藏沒有變動/);
  }
  const big = importHarness(mine);
  await big.importCollectionFile({ name: 'big.json', size: CS.LIMITS.fileMaxChars + 1, text: async () => assert.fail('a too-big file is never read') });
  assert.match(big.statuses.at(-1), /檔案過大/);
  const unreadable = importHarness(mine);
  await unreadable.importCollectionFile({ name: 'x.json', size: 10, text: async () => { throw new Error('boom'); } });
  assert.match(unreadable.statuses.at(-1), /讀不到這個檔案。既有收藏沒有變動/);
  assert.deepEqual(unreadable.commits, []);
});

test('import: a good file only becomes a preview; nothing is written until 確認匯入, and a failed write says the old collection stays', async () => {
  const sb = importHarness(mine);
  await sb.importCollectionFile(fileOf(backup([{ id: 'b', quantity: 2 }, { id: 'a', quantity: 1 }])));
  assert.equal(sb.collectionUi.pending.parsed.items.length, 2);
  assert.deepEqual(sb.commits, [], 'the preview does not write');
  sb.storageOk = false;
  await sb.confirmCollectionImport();
  assert.equal(sb.commits.length, 1);
  assert.match(sb.statuses.at(-1), /無法寫入瀏覽器儲存空間.*匯入已取消，既有收藏沒有變動/);
  assert.ok(sb.collectionUi.pending, 'the preview stays so the user can retry after exporting');
  const merged = sb.commits[0];
  assert.equal(merged.find(row => row.id === 'a').quantity, 3, 'merge keeps the larger quantity, never adds up');
  assert.equal(merged.find(row => row.id === 'a').note, 'keep me');
  sb.storageOk = true;
  await sb.confirmCollectionImport();
  assert.equal(sb.collectionUi.pending, null);
  assert.match(sb.statuses.at(-1), /已匯入：新增 1 筆、更新 0 筆/);
});

test('side panel: condition, 閃卡版本 and note save on every change; the note is cut at the limit; a failed write warns', () => {
  const meta = { a: { id: 'a', game: 'pokemon' } }, statuses = [];
  const sandbox = vm.createContext({ CS, watchlistMeta: meta, persistCollection: () => sandbox.ok, ok: true, collectionStatus: m => statuses.push(m), refreshCollectionValue() {} });
  vm.runInContext(between('function onCollectionField', '// 舊資料的作品層 ID'), sandbox);
  sandbox.onCollectionField({ dataset: { collField: 'condition' }, value: 'LP' }, 'a');
  assert.deepEqual([meta.a.condition, meta.a.game], ['LP', 'pokemon'], 'other snapshot fields are kept');
  sandbox.onCollectionField({ dataset: { collField: 'note' }, value: 'n'.repeat(CS.LIMITS.noteMax + 50) }, 'a');
  assert.equal(meta.a.note.length, CS.LIMITS.noteMax);
  sandbox.onCollectionField({ dataset: { collField: 'finish' }, value: 'holo' }, 'a');
  assert.equal(meta.a.finish, 'holo');
  assert.deepEqual(statuses, []);
  sandbox.ok = false;
  sandbox.onCollectionField({ dataset: { collField: 'note' }, value: 'x' }, 'a');
  assert.match(statuses.at(-1), /無法寫入瀏覽器儲存空間/);
  sandbox.onCollectionField({ dataset: {}, value: 'x' }, 'a');
  sandbox.onCollectionField({ dataset: { collField: 'note' }, value: 'x' }, '');
  assert.equal(statuses.length, 1, 'no field or no id: nothing happens');
});

test('export + CSV: the backup file name carries the date, the status line says what was saved, and the export round-trips through the importer', () => {
  assert.match(ui, /filename=`cardscope-collection-\$\{window\.taipeiDate\(\)\}\.json`;downloadFile\(filename/);
  const items = [{ id: 'a', canonicalId: '', favorite: false, quantity: 2, condition: 'LP', finish: '', note: 'hello', seriesId: 's', game: 'pokemon', region: 'JP' }];
  const parsed = CS.parseImport(JSON.stringify(CS.exportBackup(items)));
  assert.deepEqual(parsed.items, items);
  assert.equal(parsed.problems.length, 0);
});
