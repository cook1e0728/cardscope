import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// B2：分頁標題。文案與 providers/seo.mjs 的伺服器端標題一致；六種頁面（首頁／遊戲／搜尋／系列／卡片詳細／收藏／關於）標題必須各不相同。
const ui = await readFile(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
const start = ui.indexOf('// ── 分頁標題 ──'), end = ui.indexOf('// ── 分頁標題 end ──');
assert.ok(start > 0 && end > start, 'the title section exists');
const section = ui.slice(start, end);

function load(setup = '') {
  const document = { title: 'initial', body: { dataset: {} }, getElementById: () => null };
  const modal = { classList: { contains: () => modal.open }, open: false };
  const context = vm.createContext({ document, window: {}, console });
  context.window = context;
  vm.runInContext(`var inCollectionView=()=>document.body.dataset.view==='collection',game='all',browse={seriesId:'',total:0},C={series:[]},cardFilters={rarity:'all'},seriesTotals=new Map(),activeSearch=null,
    G=id=>({nameZh:({pokemon:'寶可夢',onepiece:'航海王'})[id]||''}),$=id=>id==='modal'?globalThis.__modal:null,
    zhParts=name=>({name:name||''}),original=c=>c.nameJa||c.nameEn||'',printingSeries=(c,selected)=>selected?.series||c.series,
    rarityInfo=raw=>({code:raw||'NONE'}),cardRarityRaw=c=>c.rarity,cardGameId=c=>c.game;${setup}`, context);
  context.__modal = modal;
  vm.runInContext(section, context);
  return { context, document, modal, run: code => vm.runInContext(code, context) };
}

test('exact title copy matches the server (providers/seo.mjs)', () => {
  const { run } = load();
  const title = view => run(`pageTitleFor(${JSON.stringify(view)})`);
  assert.equal(title({ kind: 'home' }), 'CardScope｜TCG 卡牌圖鑑');
  assert.equal(title({ kind: 'game', game: '寶可夢' }), '寶可夢卡牌圖鑑｜CardScope');
  assert.equal(title({ kind: 'search', query: '皮卡丘' }), '「皮卡丘」搜尋結果｜CardScope');
  assert.equal(title({ kind: 'series', name: '151', region: '日版', game: '寶可夢', count: 207 }), '151 卡表｜日版寶可夢・共 207 張｜CardScope');
  assert.equal(title({ kind: 'series', name: '151', region: '日版', game: '寶可夢', count: null }), '151 卡表｜日版寶可夢｜CardScope', 'the count is dropped when unknown');
  assert.equal(title({ kind: 'card', name: '皮卡丘', original: 'ピカチュウ', number: '025/165', rarity: 'RR', series: '151' }), '皮卡丘（ピカチュウ） 025/165 RR｜151｜CardScope');
  assert.equal(title({ kind: 'collection' }), '我的收藏｜CardScope');
  assert.equal(title({ kind: 'market' }), '卡牌參考價漲跌與時事｜CardScope');
  assert.equal(title({ kind: 'about' }), '資料收錄狀態｜CardScope');
  assert.equal(title({ kind: 'privacy' }), '隱私說明｜CardScope');
});

test('missing card parts are omitted cleanly, with no stray separators', () => {
  const { run } = load();
  const title = view => run(`pageTitleFor(${JSON.stringify({ kind: 'card', ...view })})`);
  assert.equal(title({ name: '皮卡丘' }), '皮卡丘｜CardScope');
  assert.equal(title({ name: '皮卡丘', original: 'ピカチュウ' }), '皮卡丘（ピカチュウ）｜CardScope');
  assert.equal(title({ name: '皮卡丘', number: '025/165' }), '皮卡丘 025/165｜CardScope');
  assert.equal(title({ name: '皮卡丘', rarity: 'SAR', series: '151' }), '皮卡丘 SAR｜151｜CardScope');
  assert.equal(title({ name: '皮卡丘', number: ' ', rarity: '', series: null }), '皮卡丘｜CardScope');
  for (const text of [title({ name: '皮卡丘', series: '151' }), title({ name: 'x', original: 'y' })]) assert.ok(!/｜｜|（）|\s{2}|\s｜/.test(text), text);
  // 沒有可用資料時退回首頁標題，而不是印出「undefined」
  assert.equal(run('pageTitleFor({kind:"card"})'), 'CardScope｜TCG 卡牌圖鑑');
  assert.equal(run('pageTitleFor({kind:"search",query:" "})'), 'CardScope｜TCG 卡牌圖鑑');
  assert.equal(run('pageTitleFor(null)'), 'CardScope｜TCG 卡牌圖鑑');
});

test('the page kinds produce distinct titles from real page state', () => {
  const h = load(`
    C={series:[{id:'s1',nameZh:'151',region:'JP'}]};`);
  const seen = new Map(), record = (label, expected) => {
    h.run('syncPageTitle()');
    assert.equal(h.document.title, expected, label);
    assert.ok(!seen.has(h.document.title), `${label} duplicates ${seen.get(h.document.title)}`);
    seen.set(h.document.title, label);
  };
  record('home', 'CardScope｜TCG 卡牌圖鑑');
  h.run("game='pokemon'");
  record('game', '寶可夢卡牌圖鑑｜CardScope');
  h.run("browse.seriesId='s1';browse.total=207");
  record('series', '151 卡表｜日版寶可夢・共 207 張｜CardScope');
  h.run("browse.seriesId='';game='all';activeSearch={q:'皮卡丘'}");
  record('search', '「皮卡丘」搜尋結果｜CardScope');
  h.run("activeSearch=null;document.body.dataset.view='about'");
  record('about', '資料收錄狀態｜CardScope');
  h.run("document.body.dataset.view='privacy'");
  record('privacy', '隱私說明｜CardScope');
  h.run("document.body.dataset.view='collection'");
  record('collection', '我的收藏｜CardScope');
  h.run("document.body.dataset.view='market'");
  record('market', '卡牌參考價漲跌與時事｜CardScope');
  h.run("document.body.dataset.view='';game='pokemon'");
  h.modal.open = true;
  h.run("detailTitleInfo={name:'皮卡丘',original:'ピカチュウ',number:'025/165',rarity:'RR',series:'151'}");
  record('card detail', '皮卡丘（ピカチュウ） 025/165 RR｜151｜CardScope');
  assert.equal(seen.size, 9);
});

test('closing the card detail or the collection restores the title of the page underneath', () => {
  const h = load("C={series:[{id:'s1',nameZh:'151',region:'TW'}]};");
  h.run("game='pokemon';browse.seriesId='s1'");
  h.run('syncPageTitle()');
  const underneath = h.document.title;
  assert.equal(underneath, '151 卡表｜台版寶可夢｜CardScope');
  h.modal.open = true; h.run("detailTitleInfo={name:'皮卡丘',original:'',number:'',rarity:'',series:'151'}");
  h.run('syncPageTitle()');
  assert.equal(h.document.title, '皮卡丘｜151｜CardScope');
  h.modal.open = false;
  h.run('syncPageTitle()');
  assert.equal(h.document.title, underneath, 'closing the modal returns to the series title');
  h.run("document.body.dataset.view='collection'");
  h.run('syncPageTitle()');
  assert.equal(h.document.title, '我的收藏｜CardScope');
  h.run("document.body.dataset.view=''");
  h.run('syncPageTitle()');
  assert.equal(h.document.title, underneath, 'closing the collection returns to the series title');
});

test('the series count uses the known total first and the unfiltered listing total second', () => {
  const h = load("C={series:[{id:'s1',nameZh:'151',region:'JP'}]};game='pokemon';browse.seriesId='s1';");
  h.run('browse.total=60;cardFilters.rarity="RR"'); h.run('syncPageTitle()');
  assert.equal(h.document.title, '151 卡表｜日版寶可夢｜CardScope', 'a filtered listing total is not the series size');
  h.run('cardFilters.rarity="all"'); h.run('syncPageTitle()');
  assert.equal(h.document.title, '151 卡表｜日版寶可夢・共 60 張｜CardScope');
  h.run('seriesTotals.set("s1",207)'); h.run('syncPageTitle()');
  assert.equal(h.document.title, '151 卡表｜日版寶可夢・共 207 張｜CardScope');
});

test('a failure while computing the title keeps the current title instead of throwing', () => {
  const h = load();
  h.run('G=()=>{throw new Error("boom")};game="pokemon"');
  h.document.title = 'keep me';
  assert.doesNotThrow(() => h.run('syncPageTitle()'));
  assert.equal(h.document.title, 'keep me');
});

test('openCard sets the title from the loaded card, resets it on a new open, and the page hooks re-sync', () => {
  assert.match(ui, /if\(!options\.keepPosition\)detailTitleInfo=null;/, 'a new card clears the previous card title info');
  assert.match(ui, /detailTitleInfo=cardTitleParts\(c,selectedPrinting\);syncPageTitle\(\);/, 'the detail view sets the title when its content is drawn');
  assert.match(ui, /new MutationObserver\(syncPageTitle\)/, 'closing the modal or switching view re-syncs');
  assert.match(ui, /watch\(document\.body,\['data-view','data-game'\]\)/, 'entering or leaving the collection or market page re-syncs');
});
