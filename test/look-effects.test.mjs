import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// look-effects.js／.css：互動動效的守門測試（不跑瀏覽器，只檢查三道閘門、功能偵測與安全限制是否還在）。
const js = readFileSync(new URL('../look-effects.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../look-effects.css', import.meta.url), 'utf8');

test('motion gates: reduced-motion, pause switch and hover+fine pointer are all honoured', () => {
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /data-cs-paused/);
  assert.match(js, /hover: hover\) and \(pointer: fine/);
  assert.match(css, /prefers-reduced-motion:no-preference/);
  assert.match(css, /\(hover:hover\) and \(pointer:fine\)/);
  assert.match(css, /:not\(\[data-cs-paused\]\)/);
  assert.match(css, /html\[data-cs-paused\] \.fx-tilt-btn/);
});

test('hidden reveal state only exists after JS adds .fx-pre, never by default', () => {
  const rules = [...css.matchAll(/([^{}@]+)\{[^{}]*opacity:0[^{}]*\}/g)].map(match => match[1]);
  assert.ok(rules.length > 0);
  for (const selector of rules) assert.match(selector, /\.fx-pre|\.fx-holo-layer::/, `opacity:0 only on .fx-pre or the decorative holo pseudo layers: ${selector.trim()}`);
  assert.match(js, /typeof IntersectionObserver === 'function'/);
});

test('card-open transition feature-detects startViewTransition and falls back to the plain open', () => {
  assert.match(js, /typeof doc\.startViewTransition !== 'function'/);
  assert.match(js, /return original\.apply\(this, args\)/);
  assert.match(js, /skipTransition/);
  assert.match(css, /::view-transition-group\(fx-card\)/);
});

test('DeviceOrientationEvent.requestPermission is only called inside the button click handler', () => {
  const calls = [...js.matchAll(/DeviceOrientationEvent\.requestPermission\(/g)];
  assert.equal(calls.length, 1);
  const clickStart = js.indexOf("button.addEventListener('click'"), at = calls[0].index;
  assert.ok(clickStart > 0 && at > clickStart, 'the call sits after the click listener opens');
  assert.ok(!js.slice(clickStart, at).includes('\n    });\n'), 'and before that listener closes');
  assert.match(js, /MAX = 12/);
});

test('decorative layers are aria-hidden and non-interactive; no inline handlers, eval or external hosts', () => {
  assert.match(js, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(css, /\.fx-holo-layer\{[^}]*pointer-events:none/);
  assert.match(css, /\.fx-burst\{[^}]*pointer-events:none/);
  assert.doesNotMatch(js, /\beval\(|new Function|innerHTML|setAttribute\('on|https?:\/\//);
  assert.doesNotMatch(css, /@import|url\(/);
});

test('animates only compositor-friendly properties', () => {
  const animated = [...js.matchAll(/\.animate\(\[([^\]]*)\]/g)].map(match => match[1]).join(' ');
  for (const property of animated.matchAll(/(\w+):/g)) assert.match(property[1], /^(transform|opacity|strokeDasharray|strokeDashoffset)$/);
});
