import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../look-v2.css',import.meta.url),'utf8');

test('two alignment lines come from two shared variables (L5 round 5)',()=>{
  assert.match(css,/html\.look-clean\{--card-pad:var\(--s5\);--keyline-off:calc\(var\(--card-pad\) \+ 1px\)/,'--card-pad and --keyline-off are defined once, globally');
  assert.match(css,/html\.look-clean,html\.look-clean body\{--keyline-off:calc\(var\(--card-pad\) \+ 1px\)\}/,'--keyline-off is recomputed where --card-pad is overridden');
  assert.match(css,/#detail\{--card-pad:var\(--s4\)/,'the detail panel sets its own --card-pad');
});

test('latest/hottest pill sits on the outer line and its check mark on the inner line',()=>{
  const sw=css.match(/#homeRails \.rails-switch\{[^}]*\}/g)||[];
  assert.ok(sw.length,'rails-switch rule exists');
  assert.ok(sw.every(rule=>!/margin-left:\s*calc\(-|margin-left:-/.test(rule)),'no negative margin on the pill');
  assert.match(css,/\.rails-switch button\{[^}]*padding-inline:calc\(var\(--keyline-off\) - var\(--pill-bw\) - var\(--pill-gap\)\)/,'pill padding is derived from the variables');
});

test('boxes and plain rows follow the variables, not magic numbers',()=>{
  assert.match(css,/\.hero\{padding-inline:var\(--keyline-off\)\}/,'hero text on the inner line');
  assert.match(css,/\.home-latest-tabs\{padding-left:var\(--keyline-off\)\}/,'series tabs on the inner line');
  assert.match(css,/body\[data-side\] header\.top \.wrap\{max-width:var\(--shell-max\);padding-inline:var\(--s3\) var\(--s6\)\}/,'header aligns with the side nav and the wall');
  assert.match(css,/#sideNav \.side-h,#sideNav \.series-band-scope\{margin-inline:var\(--keyline-off\)\}/,'side nav headings on the inner line');
});
