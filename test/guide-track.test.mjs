import test from 'node:test';import assert from 'node:assert/strict';
import {guideFrames,hopRanges,pathExpr} from '../scripts/guide-track.mjs';
test('兔子嚮導：開場揮手、字幕開頭說話、之後換指定姿勢、片尾停在最後一格',()=>{
  const caps=[{t:.5,zh:'一'},{t:4,zh:'二',pose:'point'},{t:8,zh:null}],f=guideFrames(caps,10,10);
  assert.equal(f.length,100);
  assert.deepEqual([f[0],f[3]],['wave-a','wave-b']);           // 0.3 秒換一格揮手
  assert.match(f[17],/^talk-/);                                 // 1.7 秒：第一句還在說
  assert.equal(f[30],'idle');                                   // 第一句說完（說 1.8 秒）
  assert.equal(f[40],'talk-b');assert.equal(f[42],'talk-a');    // 第二句開口、0.16 秒後閉口
  assert.equal(f[70],'point');assert.equal(f[95],'point');       // 片尾沿用最後的姿勢
});
test('有旁白時說到旁白結束；揮手與歡呼區段給跳躍用',()=>{
  const f=guideFrames([{t:.5,zh:'一',talk:3},{t:5,zh:'二',pose:'cheer'}],8,10);
  assert.match(f[30],/^talk-/);assert.equal(f[36],'idle');
  assert.deepEqual(hopRanges(f,10),[[0,.5],[6.8,8]]);           // 開口說話優先於開場揮手
});
test('跳到新位置：騰空時 cheer、落地後用該次指定的姿勢；邊揮手邊說的開場',()=>{
  const caps=[{t:0,zh:'嗨',talk:1,talkAs:'wave'},{t:2,zh:'二',talk:.5}],f=guideFrames(caps,5,10,[{t:3,pose:'point'}]);
  assert.deepEqual([f[0],f[3]],['wave-b','wave-a']);            // 揮手兩格當說話（wave-b 開口）
  assert.equal(f[31],'cheer');assert.equal(f[36],'point');assert.equal(f[49],'point');
  assert.equal(pathExpr({x:10},[{t:1,x:50}],'x'),'if(lt(t,1.000),10,10+(40)*clip((t-1.000)/0.55,0,1))');
  assert.match(pathExpr({y:5},[{t:1,y:5}],'y',100),/-sin\(PI\*clip/);
});
