import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const definition=html.match(/zhParts=s=>\{[\s\S]*?\},name=/)[0].replace(/,name=$/,'');
const zhParts=vm.runInNewContext(`(()=>{const ${definition};return zhParts})()`);

test('display drops TW source name markup but keeps the stored text recoverable',()=>{
  assert.deepEqual({...zhParts('<火箭隊的>超夢ex')},{name:'火箭隊的超夢ex',note:''});
  assert.deepEqual({...zhParts('坂木的領導力[支援者]')},{name:'坂木的領導力',note:'支援者'});
  assert.deepEqual({...zhParts('噗隆隆[進化前分岐α]')},{name:'噗隆隆',note:'進化前分岐α'});
  assert.deepEqual({...zhParts('招式學習器 ‌衰退')},{name:'招式學習器 衰退',note:''});
});

test('display keeps brackets that are part of the printed name',()=>{
  assert.equal(zhParts('未知圖騰 [A]').name,'未知圖騰 [A]');
  assert.equal(zhParts('博士的研究（山梨博士）').name,'博士的研究（山梨博士）');
  assert.equal(zhParts('基本【雷】能量').name,'基本【雷】能量');
  assert.equal(zhParts(null).name,'');
});

test('detail page shows the bracket note beside the cleaned Chinese name',async()=>{
  const ui=await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8');
  assert.match(ui,/zhPart=zhParts\(c\.nameZh\),zhName=zhPart\.name\|\|'中文名稱待補'/);
  assert.match(ui,/zhPart\.note\?/);
});

test('detail page notes rarities corrected from the official card page', async () => {
  const ui = await readFile(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
  assert.match(ui, /p\.metadata\?\.rarityBeforeOfficial\?\.rarity&&p\.rarity/);
  assert.match(ui, /依官方修正（原資料為 \$\{e\(p\.metadata\.rarityBeforeOfficial\.rarity\)\}）/);
});
