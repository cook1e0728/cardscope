import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../look-v2.css',import.meta.url),'utf8');

test('shared padding variables stay defined globally and in detail panel',()=>{
  assert.match(css,/html\.look-clean\{--card-pad:var\(--s5\);--keyline-off:calc\(var\(--card-pad\) \+ 1px\)/,'--card-pad and --keyline-off are defined once, globally');
  assert.match(css,/html\.look-clean,html\.look-clean body\{--keyline-off:calc\(var\(--card-pad\) \+ 1px\)\}/,'--keyline-off is recomputed where --card-pad is overridden');
  assert.match(css,/#detail\{--card-pad:var\(--s4\)/,'the detail panel sets its own --card-pad');
});

test('latest/hottest pill sits on the left axis with centered spacious labels and no negative margin',()=>{
  const sw=css.match(/#homeRails \.rails-switch\{[^}]*\}/g)||[];
  assert.ok(sw.length,'rails-switch rule exists');
  assert.ok(sw.every(rule=>!/margin-left:\s*calc\(-|margin-left:-/.test(rule)),'no negative margin on the pill');
  assert.match(css,/\.rails-switch button\{[^}]*padding-inline:20px/,'landing segmented buttons keep spacious horizontal padding');
  assert.match(css,/\.view-switch button\)?\{[^}]*display:inline-flex;align-items:center;justify-content:center/,'segmented buttons center text horizontally and vertically');
});

test('all sections and plain rows align cleanly to the single left keyline (padding-left:0)',()=>{
  assert.match(css,/\.hero\{padding-inline:var\(--keyline-off\)\}/,'hero box keeps internal padding');
  assert.match(css,/\.home-latest-tabs\{padding-left:0\}/,'series tabs align flush with outer edge');
  assert.match(css,/body\[data-side\] #main :is\(#seriesCrumbs,#cardsTitle,#cardsMeta,#seriesProgress,#watchlistSummary,#collExtras\)\{padding-left:0\}/,'wall headings align flush with controls and cards');
  assert.match(css,/#detail :is\(nav\.crumbs,\.detail-visual>h2,\.detail-subname,\.detail-position,\.detail-section-title,p\.meta\.card-text-empty\)\{padding-left:0\}/,'detail headings align flush with actions and panels');
  assert.match(css,/body\[data-side\] header\.top \.wrap\{max-width:var\(--shell-max\);padding-inline:var\(--s3\) var\(--s6\)\}/,'header aligns with the side nav and the wall');
  assert.match(css,/#sideNav \.side-h,#sideNav \.series-band-scope\{margin-inline:var\(--keyline-off\)\}/,'side nav headings stay aligned with side items');
});

test('rails-rail, subheadings, footer/filter links, detail-bar, and crumbs align flush to 0px',()=>{
  assert.match(css,/body\[data-view="landing"\] #homeRails \.rails-rail\{margin-inline:-4px;padding:8px 4px 14px;scroll-padding-inline:4px\}/,'scrollable rails-rail uses symmetric -4px margin and 4px scroll-padding so first card aligns at 0px without clipping shadows or triggering left fade');
  assert.match(css,/@media \(min-width:1200px\)\{[^@]*#main #homeRails :is\(#railsPanel-trending,#railsPanel-hot\) \.rails-rail\{margin-inline:0;padding:8px 0 14px\}/,'desktop grid rails-rail resets horizontal padding and margin to 0');
  assert.match(css,/\.rails-sub\{margin:12px 0 0;/,'rails subheadings have 0 horizontal margin');
  assert.match(css,/:is\(\.rails-more a,\.coll-market-link\)\{[^}]*padding:0;/,'rails-more and collection market links align text flush to left edge');
  assert.match(css,/#cardTools #filterSummary\{[^}]*padding:9px 0;/,'filterSummary zeroes horizontal padding');
  assert.match(css,/\.detail-bar\{[^}]*padding:6px var\(--s5\);/,'desktop detail-bar matches #detail horizontal padding');
  assert.match(css,/@media \(max-width:760px\)\{html\.look-clean #modal #detail\{[^}]*\}html\.look-clean #modal \.detail-bar\{padding:6px var\(--s4\)\}\}/,'mobile detail-bar matches #detail horizontal padding');
  assert.match(css,/:is\(\.crumbs a,\.about-intro p>a:only-child\)\{[^}]*justify-content:flex-start;min-width:var\(--btn-h\);min-height:var\(--btn-h\)\}/,'crumb links keep 44x44 target size while aligning text flush left');
});
