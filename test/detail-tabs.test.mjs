import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ADR 0044 Q10（詳細頁資訊；分頁已在階段 4 移除，改成連續排列）、Q11（SAMPLE 角落預覽）、Q12（稀有度代碼）、收藏用語。
const ui = readFileSync(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rankings = JSON.parse(readFileSync(new URL('../data/rarity-rankings.json', import.meta.url), 'utf8'));

// 只把需要的純函式從原始碼切出來，放進有 stub 的 vm 執行。
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const canonicalCode = html.match(/const rarityRankingToken=.*\|\|raw\};/)[0];
const context = vm.createContext({ e: esc, rn: region => ({ JP: '日版', TW: '台版' }[region] || region), rarityRankings: rankings, cardGameId: card => typeof card?.game === 'object' ? card.game.id : card?.game });
vm.runInContext(`${canonicalCode}\n${between('function rarityInfo', '// DP-era')}\n${between('const DETAIL_SOURCE_NAMES', '// ADR 0042')}`, context);
const run = code => vm.runInContext(code, context);

test('稀有度：長名稱換成代碼、全名放 title，NONE 顯示無標記', () => {
  const sar = run(`rarityMarkup('Special Illustration Rare','pokemon')`);
  assert.equal(sar, '<abbr class="rarity-code" title="Special Illustration Rare">SAR</abbr>');
  assert.doesNotMatch(sar.replace(/title="[^"]*"/, ''), /Special/, '畫面文字只有代碼');
  assert.match(run(`rarityMarkup('SAR','pokemon')`), /title="Special Art Rare">SAR</, '本來就是代碼時，全名取自 rarity-rankings.json 的別名');
  assert.match(run(`rarityMarkup('NONE','pokemon')`), /title="沒有稀有度標記">無標記</);
  assert.match(run(`rarityMarkup('無標記','pokemon')`), />無標記</, '已被 rarityText 轉成無標記的值不會再被當成原文');
  assert.equal(run(`rarityMarkup('','pokemon')`), '');
  assert.equal(run(`rarityMarkup('Ultra Mystery','pokemon')`), '<abbr class="rarity-code">Ultra Mystery</abbr>', '對不到代碼的原文照原樣顯示，不亂猜');
  assert.match(run(`rarityMarkup('Double Rare','pokemon',true)`), /<abbr class="rarity-code" title="Double Rare">RR<\/abbr><small class="meta rarity-full">（Double Rare）<\/small>/, '詳細頁另附可見的小字全名');
  assert.equal(run(`cardRarityLabel({game:'pokemon',rarity:'Special Illustration Rare'})`), 'SAR');
  assert.equal(run(`cardRarityLabel({game:{id:'pokemon'},printings:[{rarity:'NONE'}]})`), 'NONE', '分組與排序用的值保留 NONE');
  assert.equal(run(`cardRarityLabel({game:'pokemon'})`), '稀有度待補');
});

test('格子、清單、分組標題與收錄版本都經由稀有度代碼顯示', () => {
  assert.match(ui, /rarityHtml=cardRarityMarkup\(card\)/);
  assert.match(ui, /<span>\$\{rarityHtml\}<\/span>\$\{versionMarkup\}/);
  assert.match(ui, /data-tier="\$\{rarityTier\(rarity\)\}">\$\{rarityHtml\}<\/span>/);
  assert.match(ui, /rarityMarkup\(rarity,gameId\)\|\|e\(rarity\)/);
  assert.match(ui, /<dt>稀有度<\/dt><dd>\$\{rarities\}/);
  assert.doesNotMatch(ui, /\$\{e\(rarity\)\}<\/span>/, '不再直接輸出原文稀有度');
});

test('沒有分頁：資訊與價格連續排列，價格區塊有標題可跳；分頁程式、回報面板都已移除', () => {
  assert.doesNotMatch(ui, /detailTabsMarkup|detailPanel\(|DETAIL_TABS|role="tablist"|<button[^>]*role="tab"|data-detail-tab|detail-tabs/, '階段 4：詳細頁不再有分頁');
  assert.doesNotMatch(html, /detail-tabs/);
  assert.doesNotMatch(ui, /api\/reports|reportList/, '開卡不再請求 /api/reports，回報面板程式已移除');
  // 價格區塊：標題（可聚焦、跳轉的目標）＋價格內容（市場資料回來前標 aria-busy，只有這塊在忙）
  assert.match(ui, /<section class="detail-price-section" id="detailPrice" aria-labelledby="detailPriceTitle"><h3 class="detail-section-title" id="detailPriceTitle" tabindex="-1">價格<\/h3><div data-price-body aria-busy="true">/);
  assert.match(ui, /body\.removeAttribute\('aria-busy'\)/, '市場資料回來後只拿掉價格區塊的忙碌標記');
  // 頂端列：上一張、下一張、位置、跳到價格、關閉，都在 #detail 之外（換卡重畫時焦點與狀態不掉）
  for (const marker of ['data-card-step="-1"', 'data-card-step="1"', 'id="detailPos"', 'data-detail-jump', 'id="close"']) assert.ok(html.includes(marker), marker);
  assert.ok(html.indexOf('class="detail-bar"') < html.indexOf('<div id="detail">'), '頂端列在 #detail 之前');
  assert.match(ui, /function jumpToPrice\(\)\{\s*const title=\$\('detailPriceTitle'\);if\(!title\)return;\s*title\.scrollIntoView\(/);
  assert.match(ui, /title\.focus\(\{preventScroll:true\}\)/, '跳過去之後焦點也到價格標題（鍵盤與讀屏使用者）');
});

// 方向鍵換卡的判斷（階段 4 五件事之三）：側板常駐，所以焦點在搜尋框、側欄、工具列、選單時方向鍵是它們自己的。
const keyContext = mode => {
  const body = { closest: () => null }, document = { body, documentElement: { closest: () => null } };
  const context = vm.createContext({ document, window: { detailMode: () => mode } });
  vm.runInContext(between('function canStepWithKey', '// 先畫卡牆已有的資料'), context);
  // 假節點：kinds 是它符合的選擇器片段，closest 回傳 this 或 null
  const node = (...kinds) => ({ closest(selector) { return selector.split(',').some(part => kinds.includes(part.trim())) ? this : null } });
  return { can: event => vm.runInContext('canStepWithKey', context)(event), node, body };
};

test('方向鍵換卡：桌機側板只在焦點位於側板、卡牆或沒有焦點時換；輸入元件、側欄、工具列、選單不換', () => {
  const { can, node, body } = keyContext('panel');
  assert.equal(can({ target: node('#modal', '#cards') }), true, '焦點在側板或卡牆內');
  assert.equal(can({ target: null }), true, '沒有焦點');
  assert.equal(can({ target: body }), true, '焦點在 body');
  for (const kind of ['input', 'select', 'textarea', '[role="combobox"]', '[role="listbox"]', '[role="slider"]', '[role="tab"]', '[role="radio"]', '[role="menu"]', '[contenteditable="true"]'])
    assert.equal(can({ target: node(kind, '#modal') }), false, `${kind} 的方向鍵是它自己的（即使在側板裡）`);
  assert.equal(can({ target: node('nav') }), false, '側欄、工具列的按鈕（不在側板或卡牆內）不換卡');
  assert.equal(can({ target: node('#modal', '#cards'), shiftKey: true }), false, '帶修飾鍵的不換卡');
  for (const key of ['altKey', 'ctrlKey', 'metaKey']) assert.equal(can({ target: node('#modal'), [key]: true }), false, key);
});

test('方向鍵換卡：<1000px 全螢幕詳細頁沒有別的東西可操作，非輸入元件都可換卡；輸入元件照樣不換', () => {
  const { can, node } = keyContext('page');
  assert.equal(can({ target: node('nav') }), true);
  assert.equal(can({ target: node('input') }), false);
  assert.equal(can({ target: node('select') }), false);
});

test('Escape 與方向鍵的接線：Escape 只在 navigation-state.js 處理，縮放視窗開著時兩者都不動詳細頁', () => {
  assert.match(ui, /document\.addEventListener\('keydown',event=>\{if\(event\.defaultPrevented\)return;/);
  assert.match(ui, /if\(!\$\('modal'\)\?\.classList\.contains\('open'\)\|\|\$\('cardZoom'\)\?\.classList\.contains\('open'\)\)return;const step=\{ArrowLeft:-1,ArrowRight:1\}\[event\.key\];if\(step&&canStepWithKey\(event\)\)openAdjacentCard\(step\)/);
  assert.doesNotMatch(ui, /event\.key==='Escape'[^;]*\$\('modal'\)\.classList\.remove\('open'\)/, '關閉詳細頁只走 window.closeCardDetail');
});

test('資訊分頁：系列名（含版本與代碼）、資料來源名稱、更新時間；缺的標示待補', () => {
  context.card = { series: { nameZh: '超電突破', officialCode: 'SV8', region: 'JP' }, source: null };
  context.printings = [{ source: 'pokemon-card-official-jp', updatedAt: '2026-10-01T03:00:00Z' }, { source: 'tcgdex-ja', updatedAt: '2026-10-12T08:00:00Z' }, { source: 'pokemon-tw-official' }];
  context.selected = { sourceUrl: 'https://www.pokemon-card.com/card-search/details.php/card/1' };
  const info = run(`detailInfoMeta(card,printings,selected)`);
  assert.match(info, /<dt>系列<\/dt><dd>超電突破（日版・SV8）<\/dd>/);
  assert.match(info, /<dt>資料來源<\/dt><dd>日本官方卡片搜尋、TCGdex、台灣官方卡片搜尋 <a href="https:\/\/www\.pokemon-card\.com[^"]*" target="_blank" rel="noopener noreferrer">原始頁面<\/a><\/dd>/);
  assert.match(info, /<dt>更新時間<\/dt><dd><time datetime="2026-10-12T08:00:00Z">2026-10-12<\/time><\/dd>/, '取各版本最新的更新時間');
  const bare = run(`detailInfoMeta({},[{}],null)`);
  assert.match(bare, /<dd>系列待補<\/dd>/);
  assert.match(bare, /<dd>來源待補<\/dd>/);
  assert.doesNotMatch(bare, /更新時間|原始頁面/);
  assert.equal(run(`DETAIL_SOURCE_NAMES.pokemontcg`), 'PokemonTCG');
  assert.equal(run(`detailInfoMeta({},[{source:'some-new-source'}],null)`).includes('some-new-source'), true, '未知來源 id 照原樣顯示');
  const registry = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  for (const id of ['pokemon-jp', 'pokemon-tw', 'onepiece-tw', 'ygoprodeck', 'weiss-schwarz-official', 'haikyu-official', 'pokemontcg']) {
    assert.ok(registry.sources.some(source => source.id === id), `${id} 在來源註冊表內`);
    assert.ok(run(`DETAIL_SOURCE_NAMES['${id}']`), `${id} 有中文顯示名稱`);
  }
  assert.match(ui, /\$\{detailInfoMeta\(c,ps,selectedPrinting\)\}\$\{cardTextBlock\(c\)\}/);
  assert.match(ui, /return `<h3>卡片文字<\/h3><div class="text-switch">/, '有卡面文字才出現「卡片文字」標題');
});

test('SAMPLE 浮水印只有一套：角落預覽已移除，卡圖自帶 SAMPLE 的照舊不疊', () => {
  assert.doesNotMatch(ui, /sample-corner|SAMPLE_CORNER_DEFAULT|cardscope-preview-sample/);
  assert.match(ui, /const sample=options\.embeddedSample\|\|options\.suppressOverlay\?'':`<span class="card-sample-watermark"/);
});

test('我的收藏：用語統一為「我的收藏」與「張」，並提供 window.openCollection', () => {
  assert.doesNotMatch(ui, /追蹤清單|\$\{totalQuantity\} 件| 件<|件數/);
  assert.match(ui, /<span class="wl-count"><b>我的收藏<\/b> 共 \$\{collectionTotal\(\)\} 張<\/span>/);
  assert.match(ui, /function collectionTotal\(\)\{return collectionIds\(\)\.reduce\(\(sum,id\)=>sum\+watchQuantity\(id\),0\)\}/, '頂部摘要與清單視窗用同一個張數（數量就是收藏）');
  assert.match(ui, /<b>已加入我的收藏<\/b>/);
  assert.match(ui, /class="watchlist-inline" data-action="watchlist" role="group" aria-label="\$\{title\}，已收藏 \$\{quantity\} 張"/, '卡片上的「− 數量 ＋」是一組，朗讀出卡名與目前張數');
  assert.match(ui, /window\.openCollection=openCollection;/);
  assert.match(ui, /function openCollection\(\)\{return window\.openView\?\.\('collection'\)\}/, '頂欄與底部導覽走 pushState 的收藏頁，不再開對話框');
  assert.doesNotMatch(ui, /showModal|collectionDialog/);
  assert.match(ui, /\$\('cardsTitle'\)\.textContent='我的收藏'/);
});
