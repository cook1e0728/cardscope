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
  assert.match(source, /\$\{p\.rarity\?` · \$\{e\(rarityText\(p\.rarity\)\)\}`:''\}/);
});
