// 示範影片錄影工具（照「示範影片製作手冊」的做法，Node 24 內建 WebSocket 直接連 Chrome DevTools Protocol，不裝套件）。
// 用法：node scripts/record-demo.mjs cardscope   → .demo-out/cardscope.mp4、cardscope-sheet.jpg
// 流程：headless Chrome 實際操作並逐格錄影（只錄網頁）→ 記下字幕與對焦的時間 → ffmpeg 串接、鏡頭對焦、疊字幕、輸出 H.264。
// shortcut: 只做桌機（1440×900 → 1920×1200）；手機觸控圓點與直式輸出等需要時再加。
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const ROOT=path.resolve(import.meta.dirname,'..'),OUT=path.join(ROOT,'.demo-out');
const name=process.argv[2];if(!name){console.error('用法：node scripts/record-demo.mjs <腳本名稱>');process.exit(1)}
import {guideFrames} from './guide-track.mjs';
const script=(await import(new URL(`./demos/${name}.mjs`,import.meta.url))).default;
const W=1440,H=900,DSF=2,OUT_W=1920,OUT_H=1200,FPS=30,BAND=.15,EASE_S=.7,PAD=32,MAX_Z=1.6;
const CHROME=process.env.CHROME||['C:/Program Files/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
const FFMPEG=process.env.DEMO_FFMPEG||'ffmpeg',FFPROBE=process.env.DEMO_FFPROBE||'ffprobe'; // 不用 FFMPEG：有些電腦把它設成資料夾

// ---------- Chrome 與 CDP ----------
const work=fs.mkdtempSync(path.join(os.tmpdir(),'demo-')),frameDir=path.join(work,'frames');fs.mkdirSync(frameDir);fs.mkdirSync(OUT,{recursive:true});
// 全新設定檔：不帶任何登入、cookie、瀏覽紀錄
const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${path.join(work,'profile')}`,`--window-size=${W},${H}`,'--hide-scrollbars','--mute-audio','--no-first-run','--no-default-browser-check','--disable-extensions','about:blank'],{stdio:'ignore'});
let port;for(let i=0;i<100&&!port;i++){await sleep(100);try{port=fs.readFileSync(path.join(work,'profile','DevToolsActivePort'),'utf8').split('\n')[0]}catch{}}
if(!port)throw new Error('Chrome 沒有啟動');
const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});
let seq=0;const pending=new Map(),listeners=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.bad(new Error(`${p.method}: ${m.error.message}`)):p.ok(m.result)}else for(const f of listeners.get(m.method)||[])f(m.params)};
const send=(method,params={})=>new Promise((ok,bad)=>{const id=++seq;pending.set(id,{ok,bad,method});ws.send(JSON.stringify({id,method,params}))});
const on=(method,f)=>listeners.set(method,[...(listeners.get(method)||[]),f]);
const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};

await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:DSF,mobile:false});
await send('Browser.setDownloadBehavior',{behavior:'deny'}).catch(()=>{});
on('Page.javascriptDialogOpening',()=>send('Page.handleJavaScriptDialog',{accept:false}));
await send('Page.addScriptToEvaluateOnNewDocument',{source:OVERLAY()});
if(script.init)await send('Page.addScriptToEvaluateOnNewDocument',{source:script.init}); // 例如關掉首次造訪導覽

// ---------- 錄影 ----------
const frames=[],events=[];let recording=false,frameNo=0;
on('Page.screencastFrame',({data,metadata,sessionId})=>{send('Page.screencastFrameAck',{sessionId});if(!recording)return;const file=path.join(frameDir,`${String(frameNo++).padStart(6,'0')}.jpg`);fs.writeFileSync(file,Buffer.from(data,'base64'));frames.push({file,t:metadata.timestamp})});
const now=()=>Date.now()/1000;
let cursor={x:W*.62,y:H*.55},flip=1;
const loaded=()=>new Promise(ok=>{const f=()=>{listeners.set('Page.loadEventFired',(listeners.get('Page.loadEventFired')||[]).filter(g=>g!==f));ok()};on('Page.loadEventFired',f)});
async function goto(url){const l=loaded();await send('Page.navigate',{url});await l;await evaluate(`window.__demo&&__demo.place(${cursor.x},${cursor.y})`)}

// 元素：CSS 選擇器，或「text: 字樣」用畫面上的文字找（優先按鈕與連結，取最貼近的那個）
const FIND=`(q,closest)=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};let el;
  if(q.startsWith('text:')){const t=q.slice(5).trim();const all=[...document.querySelectorAll('button,a,[role=button],[role=option],li,label,h1,h2,h3,h4,span,b,div,p')].filter(e=>vis(e)&&e.textContent.includes(t));
    all.sort((a,b)=>((b.matches('button,a,[role=button],[role=option]')?1:0)-(a.matches('button,a,[role=button],[role=option]')?1:0))||a.textContent.length-b.textContent.length);el=all[0]}
  else el=[...document.querySelectorAll(q)].find(vis);
  if(el&&closest)el=el.closest(closest)||el;if(!el)throw new Error('找不到元素：'+q);return el}`;
async function rectOf(q,{closest,reveal=true}={}){
  const r=await evaluate(`(()=>{const el=(${FIND})(${JSON.stringify(q)},${JSON.stringify(closest||'')});const b=el.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}})()`);
  if(reveal&&(r.y<0||r.y+Math.min(r.h,H*.6)>H*(1-BAND))){
    await evaluate(`(()=>{const el=(${FIND})(${JSON.stringify(q)},${JSON.stringify(closest||'')});el.scrollIntoView({block:'center',behavior:'smooth'})})()`);await sleep(900);return rectOf(q,{closest,reveal:false});
  }
  return r;
}
// 游標沿微彎的弧線移動：時間＝320ms＋距離×0.45ms（380–950ms），弧度＝距離×8%（最多 60px）左右交替
async function moveTo(x,y){
  const dist=Math.hypot(x-cursor.x,y-cursor.y);if(dist<2)return;
  const dur=Math.min(950,Math.max(380,320+dist*.45)),bend=Math.min(60,dist*.08)*(flip=-flip);
  await evaluate(`__demo.move(${cursor.x},${cursor.y},${x},${y},${dur},${bend})`);cursor={x,y};
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
}
const center=r=>({x:Math.round(r.x+r.w/2),y:Math.round(r.y+r.h/2)});
const KEYS={Enter:13,Escape:27,Tab:9,ArrowDown:40,ArrowUp:38};

const d={
  wait:ms=>sleep(ms),
  async waitFor(q,{timeout=15000}={}){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(`(()=>{try{(${FIND})(${JSON.stringify(q)});return true}catch{return false}})()`))return;await sleep(200)}throw new Error('等不到元素：'+q)},
  goto,
  eval:js=>evaluate(js),
  caption(zh,en,{top=false,pose}={}){events.push({t:now(),type:'caption',zh,en,top,pose})},
  async focus(q,{pad=PAD,closest}={}){const r=await rectOf(q,{closest});events.push({t:now(),type:'focus',z:zoomFor(r,pad)});await sleep(EASE_S*1000+100)},
  async unfocus(){events.push({t:now(),type:'focus',z:{z:1,x:0,y:0}});await sleep(EASE_S*1000+100)},
  async hover(q,opt){const p=center(await rectOf(q,opt));await moveTo(p.x,p.y)},
  async click(q,opt){const p=center(await rectOf(q,opt));await moveTo(p.x,p.y);await sleep(120);
    await evaluate('__demo.press()');await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await sleep(70);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await sleep(250)},
  async type(q,text,{delay=110}={}){if(q)await d.click(q);for(const ch of text){await send('Input.insertText',{text:ch});await sleep(delay)}},
  async key(k){const code=KEYS[k];for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code,...(k==='Enter'&&type==='keyDown'?{text:'\r'}:{})});await sleep(150)},
  async scroll(dy,{ms=1100}={}){await evaluate(`window.scrollBy({top:${dy},behavior:'smooth'})`);await sleep(ms)},
};
// 倍率＝min(畫面寬÷(區塊寬＋左右留白), 可用高度÷(區塊高＋上下留白), 2)；小於 1.08 不放大。區塊放到字幕保留帶上方那塊的正中央。
function zoomFor(r,pad){
  const avail=H*(1-BAND);let z=Math.min(W/(r.w+2*pad),avail/(r.h+2*pad),MAX_Z);if(z<1.08)return {z:1,x:0,y:0};
  const c=center(r);let x=c.x-(W/2)/z,y=c.y-(avail/2)/z;x=Math.max(0,Math.min(W-W/z,x));y=Math.max(0,Math.min(H-H/z,y));
  return {z:+z.toFixed(3),x:x*DSF,y:y*DSF};
}

// ---------- 執行腳本 ----------
let failed=null;
try{
  if(script.warm)await fetch(script.warm).catch(()=>{});
  if(script.prime){await script.prime(d);} // 錄影前先走一次，讓伺服器快取熱起來
  await goto(script.start);await sleep(script.settle??2500);
  await send('Page.startScreencast',{format:'jpeg',quality:88,maxWidth:W*DSF,maxHeight:H*DSF,everyNthFrame:1});
  recording=true;await evaluate('__demo.nudge()');await sleep(400);events.push({t:now(),type:'start'});
  await script.run(d);
  await ending();
}catch(e){failed=e;fs.writeFileSync(path.join(OUT,`${name}-error.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
recording=false;await send('Page.stopScreencast').catch(()=>{});
if(failed){console.error('錄影中斷：',failed.message,`（錯誤畫面：.demo-out/${name}-error.png）`);await shutdown();process.exit(1)}

// 結尾：最後一格縮到 88%、模糊淡出 → 底色換成深色 → 主視覺從模糊浮現 → 專案名稱往上滑入，停到 3.6 秒
async function ending(){
  events.push({t:now(),type:'caption',zh:null});
  const shot=(await send('Page.captureScreenshot',{format:'jpeg',quality:90})).data;const e=script.ending||{};
  const html=`<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;overflow:hidden;background:${e.from||'#F8F5EE'};font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;animation:bg .01s linear .45s forwards}
  @keyframes bg{to{background:${e.bg||'#1B1733'}}}
  .last{position:fixed;inset:0;background:url(data:image/jpeg;base64,${shot}) center/cover;animation:out .7s cubic-bezier(.4,0,.2,1) .25s forwards}
  @keyframes out{to{transform:scale(.88);filter:blur(8px);opacity:0}}
  .hero{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:22px}
  .hero img{width:${e.imgWidth||300}px;opacity:0;transform:scale(.94);filter:blur(6px);animation:in .83s cubic-bezier(.2,.7,.2,1) .42s forwards}
  @keyframes in{to{opacity:1;transform:none;filter:none}}
  .t{text-align:center;opacity:0;transform:translateY(24px);animation:up .52s cubic-bezier(.2,.7,.2,1) .95s forwards}
  .t b{display:block;font:300 40px/1.2 'Space Grotesk','Noto Sans TC',sans-serif;color:#F6F1E6;letter-spacing:-.01em}.t span{display:block;margin-top:8px;font-size:22px;color:#C9C1DA}
  @keyframes up{to{opacity:1;transform:none}}</style>
  <div class="hero"><img src="${e.image}" alt=""><div class="t"><b>${e.title||''}</b><span>${e.subtitle||''}</span></div></div><div class="last"></div>`;
  await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html});
  await sleep(3600);
}

// ---------- 合成 ----------
const t0=events.find(e=>e.type==='start').t-.4,first=frames.findIndex(f=>f.t>=t0-.05),used=frames.slice(Math.max(0,first-1));
const T=f=>Math.max(0,f.t-t0),end=now()-t0;
// 固定 30fps：每格取當下最新的截圖（硬連結，不複製）。截圖有時是 1x、有時是 2x 尺寸，先統一尺寸；zoompan 輸出的時間戳會亂，要 setpts 重排＋passthrough，否則編碼時丟約 4 秒、片尾被截掉
const seqDir=path.join(work,'seqDir');fs.mkdirSync(seqDir);
for(let k=0,i=0,n=Math.ceil(end*FPS);k<n;k++){while(i+1<used.length&&T(used[i+1])<=k/FPS)i++;fs.linkSync(used[i].file,path.join(seqDir,String(k).padStart(6,'0')+'.jpg'))}

// 鏡頭：每次變化 0.7 秒緩動（兩頭慢、中間快）
const focus=events.filter(e=>e.type==='focus').map(e=>({t:e.t-t0,...e.z}));
const curve=key=>{let expr=null,prev=key==='z'?1:0;for(const f of focus){const p=`clip((it-${f.t.toFixed(3)})/${EASE_S},0,1)`,s=`(${p}*${p}*(3-2*${p}))`;const seg=`${prev}+(${(f[key]-prev).toFixed(3)})*${s}`;expr=expr?`if(lt(it,${f.t.toFixed(3)}),${expr},${seg})`:`if(lt(it,${f.t.toFixed(3)}),${prev},${seg})`;prev=f[key]}return expr||String(prev)};
const zoompan=`zoompan=z='${curve('z')}':x='clip(${curve('x')},0,iw-iw/zoom)':y='clip(${curve('y')},0,ih-ih/zoom)':d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}`;

// 字幕：用 Chrome 畫成透明 PNG（不會跟著鏡頭放大），每句顯示到下一句，淡入淡出各 0.25 秒
const caps=events.filter(e=>e.type==='caption').map(e=>({...e,t:e.t-t0}));const capFiles=[];
await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:OUT_W/W,mobile:false});
await send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
for(let i=0;i<caps.length;i++){const c=caps[i];if(!c.zh)continue;const until=(caps[i+1]?.t??end)-c.t;
  const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@500&display=block"><style>html,body{margin:0;background:transparent}
  .c{position:fixed;left:50%;${c.top?'top:9%':'bottom:3.5%'};transform:translateX(-50%);max-width:68%;box-sizing:border-box;padding:10px 26px 12px;border-radius:16px;background:rgba(27,23,51,.9);border:1px solid #4A4470;text-align:center;font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif}
  .zh{font-size:22px;font-weight:500;line-height:1.45;color:#F6F1E6}.en{font-size:15px;line-height:1.45;color:#C9C1DA}</style><div class="c"><div class="zh">${esc(c.zh)}</div><div class="en">${esc(c.en||'')}</div></div>`;
  await send('Page.navigate',{url:'about:blank'});await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html});
  // 第一句字幕時樣式表常還沒載完，fonts.ready 會立刻成立而截到空白框：先等 link 載入、再指定載入這句要用的字
  await evaluate(`new Promise(r=>{const l=document.querySelector('link');l.sheet?r():(l.onload=l.onerror=r)}).then(()=>document.fonts.load("500 22px 'Noto Sans TC'",${JSON.stringify(c.zh+(c.en||''))})).then(()=>document.fonts.ready).then(()=>new Promise(r=>setTimeout(r,300)))`);
  const file=path.join(work,`cap${i}.png`);fs.writeFileSync(file,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));capFiles.push({file,t:c.t,dur:until});}
await shutdown();

// 兩段：先串接＋鏡頭成中間檔，再疊字幕。字幕輸入都從 0 秒開始、整段長度，用淡入淡出的時間點決定出現區間
// （改過：字幕用 setpts 位移時，ffmpeg 的輸入佇列會互等而卡死）
const base=path.join(work,'base.mp4'),mp4=path.join(OUT,`${name}.mp4`),dur=end.toFixed(3);
execFileSync(FFMPEG,['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(seqDir,'%06d.jpg'),'-vf',`scale=${W*DSF}:${H*DSF},${zoompan},setpts=N/${FPS}/TB,setsar=1`,'-fps_mode','passthrough','-t',dur,'-an','-c:v','libx264','-preset','veryfast','-crf','12','-pix_fmt','yuv420p',base],{stdio:'inherit'});
const args=['-y','-loglevel','error','-i',base];
capFiles.forEach(c=>args.push('-framerate',String(FPS),'-loop','1','-t',dur,'-i',c.file));
let graph=`[0:v]setpts=N/${FPS}/TB[v0]`; // 第一段的時間戳仍不規則（格數對、時長短約 4 秒），解碼後按格號重排
capFiles.forEach((c,i)=>{graph+=`;[${i+1}:v]format=rgba,fade=in:st=${c.t.toFixed(3)}:d=0.25:alpha=1,fade=out:st=${Math.max(c.t,c.t+c.dur-.25).toFixed(3)}:d=0.25:alpha=1[c${i}];[v${i}][c${i}]overlay=shortest=1[v${i+1}]`});
let last=capFiles.length;
// 兔子嚮導（腳本設 guide:{dir} 才有）：每格硬連結一張姿勢圖成序列，疊在左下角、字幕左邊；片尾畫面出現時淡出
if(script.guide){
  const g=script.guide,gDir=path.join(work,'guide'),size=g.size||260;fs.mkdirSync(gDir);
  guideFrames(caps,end,FPS).forEach((p,k)=>fs.linkSync(path.join(ROOT,g.dir,p+'.png'),path.join(gDir,String(k).padStart(6,'0')+'.png')));
  const outT=(caps.find(c=>!c.zh)?.t??end).toFixed(3);
  args.push('-framerate',String(FPS),'-i',path.join(gDir,'%06d.png'));
  graph+=`;[${last+1}:v]format=rgba,scale=${size}:${size}:flags=area,fade=in:st=0.15:d=0.3:alpha=1,fade=out:st=${outT}:d=0.3:alpha=1[g];[v${last}][g]overlay=${g.x??36}:H-${size}-${g.bottom??18}:shortest=1[v${last+1}]`;last++;
}
args.push('-filter_complex',graph,'-map',`[v${last}]`,'-t',dur,'-an','-c:v','libx264','-preset','slow','-crf','23','-pix_fmt','yuv420p','-r',String(FPS),'-movflags','+faststart',mp4);
execFileSync(FFMPEG,args,{stdio:'inherit'});
// 總覽圖：每 3 秒一格，上傳前逐格看敏感資訊
const secs=Number(execFileSync(FFPROBE,['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4]).toString());
execFileSync(FFMPEG,['-y','-loglevel','error','-i',mp4,'-vf',`fps=1/3,scale=480:-1,tile=4x${Math.ceil(secs/3/4)}:padding=6:color=white`,'-frames:v','1',path.join(OUT,`${name}-sheet.jpg`)]);
if(process.env.DEMO_DEBUG)fs.writeFileSync(path.join(OUT,`${name}-debug.json`),JSON.stringify({events:events.map(e=>({...e,t:+(e.t-t0).toFixed(2)})),frames:used.length},null,1));
if(process.env.DEMO_DEBUG)console.log('中間檔：'+work);else fs.rmSync(work,{recursive:true,force:true});
console.log(`完成：.demo-out/${name}.mp4（${secs.toFixed(1)} 秒，${(fs.statSync(mp4).size/1048576).toFixed(1)} MB），總覽圖 .demo-out/${name}-sheet.jpg`);

async function shutdown(){try{await send('Browser.close')}catch{}ws.close();chrome.kill()}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// 每個新頁面最上層疊一層游標：深灰實心箭頭＋白描邊，按下縮到 88%；點擊時從尖端放射 12 道線（0.56 秒）
function OVERLAY(){return `(()=>{if(window.__demo)return;const NS='http://www.w3.org/2000/svg';let root,arrow,pos={x:${W*.62},y:${H*.55}};
const mount=()=>{if(root||!document.documentElement)return;root=document.createElement('div');root.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict';
arrow=document.createElementNS(NS,'svg');arrow.setAttribute('width','26');arrow.setAttribute('height','32');arrow.setAttribute('viewBox','0 0 26 32');arrow.style.cssText='position:absolute;left:0;top:0;transform-origin:2px 2px;transition:scale .09s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))';
arrow.innerHTML='<path d="M2 2 L2 25 L8.2 19.4 L12.4 29 L16.6 27.2 L12.5 17.8 L21 17.8 Z" fill="#3a3a3a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>';root.append(arrow);document.documentElement.append(root);draw()};
const draw=()=>{if(arrow)arrow.style.translate=(pos.x-2)+'px '+(pos.y-2)+'px'};
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount):mount();
window.__demo={place(x,y){pos={x,y};mount();draw()},nudge(){mount();pos={x:pos.x+.5,y:pos.y};draw()},
 move(x0,y0,x1,y1,dur,bend){mount();const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy)||1,cx=(x0+x1)/2-dy/len*bend,cy=(y0+y1)/2+dx/len*bend,t0=performance.now();
  return new Promise(ok=>{const step=now=>{const p=Math.min(1,(now-t0)/dur),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2,u=1-e;pos={x:u*u*x0+2*u*e*cx+e*e*x1,y:u*u*y0+2*u*e*cy+e*e*y1};draw();p<1?requestAnimationFrame(step):ok()};requestAnimationFrame(step)})},
 press(){mount();arrow.style.scale='.88';setTimeout(()=>arrow.style.scale='1',160);const b=document.createElement('div');b.style.cssText='position:absolute;left:'+pos.x+'px;top:'+pos.y+'px;width:0;height:0';
  for(let i=0;i<12;i++){const long=i%2===0,arm=document.createElement('div');arm.style.cssText='position:absolute;left:0;top:0;width:0;height:0;rotate:'+(i*30)+'deg';
   const segs=long?[[14,6],[23,10]]:[[14,4],[21,4]];for(const [at,l] of segs){const s=document.createElement('i');s.style.cssText='position:absolute;left:-1.25px;top:'+(-at-l)+'px;width:2.5px;height:'+l+'px;border-radius:2px;background:#3a3a3a;box-shadow:0 0 0 1.5px #fff,0 0 4px 2px rgba(255,255,255,.8)';arm.append(s)}
   arm.animate([{scale:.55,opacity:0},{scale:.9,opacity:1,offset:.09},{scale:1.18,opacity:0}],{duration:560,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});b.append(arm)}
  root.append(b);setTimeout(()=>b.remove(),620)}};})();`}
