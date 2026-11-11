import test from 'node:test';import assert from 'node:assert/strict';
import {guideFrames,guideFacing,hopRanges,pathExpr,placeGuide,travel} from '../scripts/guide-track.mjs';
test('兔子嚮導：開場揮手、字幕開頭說話、之後換指定姿勢、片尾停在最後一格',()=>{
  const caps=[{t:.5,zh:'一'},{t:4,zh:'二',pose:'point'},{t:8,zh:null}],f=guideFrames(caps,10,10);
  assert.equal(f.length,100);
  assert.deepEqual([f[0],f[3]],['wave-a','wave-b']);           // 0.3 秒換一格揮手
  assert.match(f[17],/^talk-/);                                 // 1.7 秒：第一句還在說
  assert.equal(f[30],'idle');                                   // 第一句說完（說 1.8 秒）
  assert.equal(f[40],'talk-b');assert.equal(f[42],'talk-a');    // 第二句開口、0.16 秒後閉口
  assert.equal(f[70],'point');assert.equal(f[95],'point');       // 片尾沿用最後的姿勢
});
test('有旁白時說到旁白結束；揮手與歡呼區段給原地小跳用',()=>{
  const f=guideFrames([{t:.5,zh:'一',talk:3},{t:5,zh:'二',pose:'cheer'}],8,10);
  assert.match(f[30],/^talk-/);assert.equal(f[36],'idle');
  assert.deepEqual(hopRanges(f,10),[[0,.5],[6.8,8]]);
});
test('跳過去：四格步態循環，落地後用指定姿勢；跳的途中朝前進方向、落地後面向目標',()=>{
  const caps=[{t:0,zh:'嗨',talk:1,talkAs:'wave'},{t:2,zh:'二',talk:.5}],mv={t:3,dur:1,n:2,pose:'point',x:0,face:1};
  const f=guideFrames(caps,5,10,[mv]);
  assert.deepEqual([f[0],f[3]],['wave-b','wave-a']);            // 揮手兩格當說話（wave-b 開口）
  assert.deepEqual(f.slice(30,40),['hop-1','hop-2','hop-3','hop-3','hop-4','hop-1','hop-2','hop-3','hop-3','hop-4']);
  assert.equal(f[41],'point');
  const face=guideFacing([mv],{x:500,face:1},5,10);
  assert.deepEqual([face[10],face[35],face[45]],[1,-1,1]);      // 往左跳時面向左，落地轉回面向目標
  assert.deepEqual(travel({x:0,y:0},{x:400,y:300}),{n:2,dur:.56});
  assert.equal(pathExpr({x:10},[{t:1,x:50,dur:.5,n:1}],'x'),'if(lt(t,1.000),10,10+(40)*clip((t-1.000)/0.5,0,1))');
  assert.match(pathExpr({y:5},[{t:1,y:5,dur:.5,n:2}],'y',30),/-abs\(sin\(PI\*clip\(.*\)\*2\)\)\*30/);
});
test('落點不擋目標與字幕：指定側擋到就換另一側；面向目標',()=>{
  const frame={x:0,y:30,w:1920,h:1100},S=300;
  const a=placeGuide({x:900,y:500,w:200,h:100},S,{side:'left',frame});
  assert.ok(a.x+S*.85<=900);assert.equal(a.face,1);             // 站左邊、面向右
  const b=placeGuide({x:900,y:500,w:200,h:100},S,{side:'left',frame,avoid:[{x:500,y:300,w:400,h:400}]});
  assert.ok(b.x+S*.15>=1100);assert.equal(b.face,-1);           // 左邊被擋，改站右邊面向左
  const c=placeGuide({x:10,y:500,w:200,h:100},S,{side:'left',frame});
  assert.ok(c.x+S*.15>=210);assert.equal(c.face,-1);            // 左邊出畫面時改站右邊，身體不疊在目標上
});
