import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ui-enhancements.js', import.meta.url), 'utf8');

test('詳細頁主圖先用被點開的那張卡的版本，不是作品層的比對基準（排球少年 HV-P02-077 S／極／極P）', () => {
  assert.match(source, /selectedPrinting=ps\.find\(p=>p\.cardId&&String\(p\.cardId\)===String\(id\)\)\|\|ps\.find\(p=>c\.referencePrintingId/);
  assert.doesNotMatch(source, /const selectedPrinting=ps\.find\(p=>c\.referencePrintingId/);
});

test('收錄版本列出稀有度，其他卡的版本可點擊切換且不改變上一張／下一張的位置', () => {
  assert.match(source, /data-version-card="\$\{e\(p\.cardId\)\}"/);
  assert.match(source, /openCard\(button\.dataset\.versionCard,\{keepPosition:true\}\)/);
  assert.match(source, /if\(!options\.keepPosition\)\{activeDetailCardId=id;detailReturnCardId=id\}/);
  assert.match(source, /\$\{p\.rarity\?` · \$\{rarityMarkup\(p\.rarity,cardGameId\(c\)\)\}`:''\}/);
});

test('卡圖下方的版本切換：2–4 個版本、各屬一個地區、名稱不重複才顯示；沒有自己卡圖的版本標「無圖」並說明暫用哪一版的圖', () => {
  assert.match(source, /list\.length<2\|\|list\.length>4\|\|list\.some\(p=>regionsOf\(String\(p\.cardId\)\)\.size>1\)\)return''/);
  assert.match(source, /if\(new Set\(plain\)\.size<plain\.length\)return''/);
  assert.match(source, /noOwnImage\(p\)\?' <small>· 無圖<\/small>'/);
  assert.match(source, /卡圖還沒收錄，先顯示\$\{e\(rn\(standInFrom\.region,c\.game\)\)\}的圖。/);
  // zh-TW 與 zh-Hant-TW 視為同一語言
  const sameLang = new Function(`${source.match(/const sameLang=[^\n]*/)[0]};return sameLang`)();
  assert.equal(sameLang('zh-TW', 'zh-Hant-TW'), true);
  assert.equal(sameLang('ja-JP', 'zh-Hant-TW'), false);
  assert.equal(sameLang('', 'ja-JP'), false);
});
