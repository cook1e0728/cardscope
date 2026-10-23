import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ADR 0044 Q10（詳細頁分頁與資訊）、Q11（SAMPLE 角落預覽）、Q12（稀有度代碼）、收藏用語。
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
  assert.match(ui, /<span>\$\{rarityHtml\}<\/span><span class="badge">/);
  assert.match(ui, /data-tier="\$\{rarityTier\(rarity\)\}">\$\{rarityHtml\}<\/span>/);
  assert.match(ui, /rarityMarkup\(rarity,gameId\)\|\|e\(rarity\)/);
  assert.match(ui, /<dt>稀有度<\/dt><dd>\$\{rarities\}/);
  assert.doesNotMatch(ui, /\$\{e\(rarity\)\}<\/span>/, '不再直接輸出原文稀有度');
});

test('分頁：資訊／價格／走勢三個，使用者回報先隱藏，沒有成交趨勢分頁', () => {
  const tabs = run(`detailTabsMarkup()`), labels = [...tabs.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['資訊', '價格', '走勢', '使用者回報']);
  assert.match(tabs, /role="tablist"/);
  assert.equal((tabs.match(/role="tab"/g) || []).length, 4);
  assert.match(tabs, /id="detail-tab-info"[^>]*aria-selected="true"[^>]*tabindex="0"/, '選中的分頁在 Tab 順序內');
  assert.match(tabs, /id="detail-tab-market"[^>]*aria-selected="false"[^>]*tabindex="-1"/, '其餘用方向鍵（roving tabindex）');
  assert.match(tabs, /data-detail-tab="reports"[^>]*hidden/);
  assert.doesNotMatch(tabs, /成交趨勢|跨市場比價/);
  assert.match(run(`detailPanel('reports',false,'x')`), /hidden/, '回報面板即使傳入不隱藏也維持隱藏');
  assert.match(run(`detailPanel('info',false,'x')`), /^<section role="tabpanel" id="detail-panel-info" aria-labelledby="detail-tab-info" tabindex="0" data-detail-panel="info">x<\/section>$/);
  assert.match(run(`detailPanel('trend',true,'x')`), /data-detail-panel="trend" hidden>/);
});

test('分頁鍵盤操作：左右鍵、Home、End 移動並啟用，並且不會同時換卡', () => {
  assert.match(ui, /list\.onkeydown=event=>\{const tabs=\[\.\.\.list\.querySelectorAll\('\[role="tab"\]'\)\]\.filter\(tab=>!tab\.hidden\)/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(ui, new RegExp(`${key}:`));
  assert.match(ui, /event\.preventDefault\(\);tabs\[next\]\.focus\(\);tabs\[next\]\.click\(\)/);
  assert.match(ui, /x\.setAttribute\('aria-selected',String\(on\)\);x\.tabIndex=on\?0:-1/);
  assert.match(ui, /document\.addEventListener\('keydown',event=>\{if\(event\.defaultPrevented\)return;/);
});

test('價格分頁只放比價內容（走勢移到走勢分頁），並說明是參考價', () => {
  const market = ui.match(/detailPanel\('market',true,[^]*?\$\{detailPanel\('trend'/)[0];
  assert.match(market, /<h3>跨市場比價<\/h3>/);
  assert.match(market, /不是成交價或台灣行情；新台幣為換算參考/);
  assert.match(market, /marketBlock\(m\)/);
  assert.doesNotMatch(market, /price-trend/);
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
  assert.match(ui, /\$\{detailInfoMeta\(c,ps,selectedPrinting\)\}<h3>卡片文字<\/h3>/);
});

test('SAMPLE 浮水印只有一套：角落預覽已移除，卡圖自帶 SAMPLE 的照舊不疊', () => {
  assert.doesNotMatch(ui, /sample-corner|SAMPLE_CORNER_DEFAULT|cardscope-preview-sample/);
  assert.match(ui, /const sample=options\.embeddedSample\|\|options\.suppressOverlay\?'':`<span class="card-sample-watermark"/);
});

test('我的收藏：用語統一為「我的收藏」與「張」，並提供 window.openCollection', () => {
  assert.doesNotMatch(ui, /追蹤清單|\$\{totalQuantity\} 件| 件<|件數/);
  assert.match(ui, /<b>我的收藏<\/b><span> 共 \$\{collectionTotal\(\)\} 張<\/span>/);
  assert.match(ui, /function collectionTotal\(\)\{return collectionIds\(\)\.reduce\(\(sum,id\)=>sum\+watchQuantity\(id\),0\)\}/, '頂部摘要與清單視窗用同一個張數（數量就是收藏）');
  assert.match(ui, /<b>已加入我的收藏<\/b>/);
  assert.match(ui, /aria-label="我的收藏張數"/);
  assert.match(ui, /window\.openCollection=openCollection;/);
  assert.match(ui, /dialog\.showModal\(\)/, '用原生 dialog，焦點鎖定、Escape 與焦點返回由瀏覽器處理');
  assert.match(ui, /<h2 id="collectionTitle"[^>]*>我的收藏<\/h2>/);
});
