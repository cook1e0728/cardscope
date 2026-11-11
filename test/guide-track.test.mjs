import test from 'node:test';import assert from 'node:assert/strict';
import {guideFrames} from '../scripts/guide-track.mjs';
test('兔子嚮導：開場揮手、字幕開頭說話、之後換指定姿勢、片尾停在最後一格',()=>{
  const caps=[{t:.5,zh:'一'},{t:4,zh:'二',pose:'point'},{t:8,zh:null}],f=guideFrames(caps,10,10);
  assert.equal(f.length,100);
  assert.deepEqual([f[0],f[3]],['wave-a','wave-b']);           // 0.3 秒換一格揮手
  assert.match(f[17],/^talk-/);                                 // 1.7 秒：第一句還在說
  assert.equal(f[30],'idle');                                   // 第一句說完（說 1.8 秒）
  assert.equal(f[40],'talk-b');assert.equal(f[42],'talk-a');    // 第二句開口、0.16 秒後閉口
  assert.equal(f[70],'point');assert.equal(f[95],'point');       // 片尾沿用最後的姿勢
});
