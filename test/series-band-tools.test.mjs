import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [band,css]=await Promise.all(['../series-band.js','../look-clean.css'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));

test('picking a series or product from the expanded grid collapses it before scrolling',()=>{
  const click=band.slice(band.indexOf('band.onclick=event=>'));
  assert.ok(click.indexOf("if(band.classList.contains('is-grid')){bandExpanded[game]=false;bandFilter[game]='';bandShown[game]=SHOW_STEP;render()}")>0,'the grid collapses and re-renders first');
  assert.ok(click.indexOf('render()}')<click.indexOf('openProduct(card.dataset.id)'),'the product path scrolls after the collapse');
  assert.ok(click.indexOf('render()}')<click.indexOf('openSeries(item)'),'the series path scrolls after the collapse');
});

test('the expand button follows whether the grid is showing, filter included',()=>{
  assert.match(band,/const open=band\.classList\.contains\('is-grid'\);bandExpanded\[game\]=!open;if\(open\)bandFilter\[game\]=''/,'a click while the grid shows closes it and clears the filter');
  assert.match(band,/toggle\.textContent=grid\?'收合':'展開全部';toggle\.setAttribute\('aria-expanded',grid\)/,'paint keeps the label and aria-expanded in sync');
});

test('filtering dims the tabs and says what is searched',()=>{
  assert.match(band,/band\.classList\.toggle\('is-filtering',filtering\)/);
  assert.match(band,/class="series-band-scope" role="status" hidden>/);
  assert.match(css,/\.series-band\.is-filtering \.series-band-tabs\{opacity:\.45\}/);
});

test('typing in the filter is debounced, composition still applies at its end',()=>{
  assert.match(band,/filter\.oninput=event=>\{if\(event\.isComposing\)return;clearTimeout\(timer\);timer=setTimeout\(apply,120\)\}/);
  assert.match(band,/filter\.addEventListener\('compositionend',apply\)/);
  assert.match(band,/if\(!filter\.isConnected\)return/,'a stale timer never paints a replaced band');
});

test('focus lands somewhere real after switching version and after 顯示更多',()=>{
  assert.match(band,/<h2 tabindex="-1">\$\{esc\(seriesName\(item\)\)\}<\/h2>/);
  assert.match(band,/focusTitleUntil=Date\.now\(\)\+10000;select\.value=/);
  assert.match(band,/document\.querySelector\('#selectedProduct h2'\)\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(band,/const before=band\.querySelectorAll\('\.band-tile'\)\.length;[^\n]*band\.querySelectorAll\('\.band-tile'\)\[before\]\?\.focus\(\)/);
});

test('touch targets are 44px and the rail arrows respect reduced motion and the keyboard',()=>{
  assert.match(css,/\.selected-other-regions button\{min-height:44px;/);
  assert.match(css,/grid-template-columns:44px minmax\(0,1fr\) 44px/);
  assert.match(css,/width:44px;height:44px;min-height:0;margin-top:calc\(var\(--rail-mid,82px\) - 22px\)/);
  assert.match(band,/behavior:matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\?'auto':'smooth'/);
  assert.match(band,/button\.tabIndex=-1;/);
  assert.match(band,/button\.setAttribute\('aria-label',dir<0\?'往左看更多系列':'往右看更多系列'\)/,'the arrows keep their labels');
});

test('home latest sits on the cream background (方案一), so its arrows use the shared light style',()=>{
  assert.doesNotMatch(css,/\.home-latest \.rail-wrap \.rail-nav\{/);
  assert.match(css,/\.rail-wrap \.rail-nav:disabled\{background:#E6DFD2/);
});

test('a borrowed Japanese release date that is still in the future is not used for sorting',()=>{
  assert.match(band,/sortDates\.set\(item,borrowed>today\(\)\?'':borrowed\)/);
});
