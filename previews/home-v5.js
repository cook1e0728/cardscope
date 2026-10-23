// 首頁預覽第 5 版「極簡聚焦」：三步驟上手卡、標題解碼、「?」信標導覽、導覽列選中狀態。
// 只動這一版的視覺層；原本的 data-nav 點擊由 game-switcher.js 綁好，這裡只轉發 click()。
(()=>{
  'use strict';
  const KEY='cs-tour-v5-done',doc=document,root=doc.documentElement;
  const store={get(){try{return localStorage.getItem(KEY)}catch{return null}},set(){try{localStorage.setItem(KEY,'1')}catch{}},clear(){try{localStorage.removeItem(KEY)}catch{}}};
  const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches||root.hasAttribute('data-cs-paused');
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const vis=el=>!!el&&el.getClientRects().length>0;
  const $=id=>doc.getElementById(id);
  const el=(tag,cls,html)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(html!=null)n.innerHTML=html;return n};

  /* ---------- ① 三步驟上手：三個動作 ---------- */
  const goSearch=()=>{const t=vis($('heroQ'))?$('heroQ'):$('q');t?.focus();t?.scrollIntoView({block:'center',behavior:reduced()?'auto':'smooth'})};
  const goGames=()=>{
    const box=mobile()?doc.querySelector('.mobile-quick-grid'):$('channels');if(!box)return;
    box.scrollIntoView({block:'start',behavior:reduced()?'auto':'smooth'});
    box.querySelector('button')?.focus({preventScroll:true});
  };
  const openCollection=()=>{const b=[...doc.querySelectorAll('[data-nav="collection"]')];(b.find(vis)||b[0])?.click()};
  const STEPS=[
    {n:1,t:'搜尋卡名或卡號',s:'搜尋',h:'例如 SV6a 090、魯夫',run:goSearch},
    {n:2,t:'選遊戲與版本',s:'選遊戲',h:'進入遊戲，翻閱每個系列',run:goGames},
    {n:3,t:'加入我的收藏',s:'加收藏',h:'打開收藏冊，隨時回頭看',run:openCollection}
  ];
  let steps,pills;
  const buildSteps=()=>{
    steps=el('div','v5-steps','<div class="v5-steps-head"><b>三步驟上手</b><button type="button" class="v5-replay"><i aria-hidden="true">?</i>重看導覽提示</button></div>'
      +STEPS.map(s=>`<button type="button" class="v5-step" data-step="${s.n}"><span class="v5-n" aria-hidden="true">${s.n}</span><span class="v5-t"><span class="sr-only">步驟 ${s.n}，</span>${s.t}</span><span class="v5-h">${s.h}</span><span class="v5-s" aria-hidden="true">${s.s}</span></button>`).join(''));
    steps.setAttribute('role','group');steps.setAttribute('aria-label','三步驟上手');
    pills=el('div','v5-pills',STEPS.map(s=>`<button type="button" class="v5-pill" data-step="${s.n}"><span class="v5-n" aria-hidden="true">${s.n}</span><span class="v5-s" aria-hidden="true">${s.s}</span><span class="sr-only">步驟 ${s.n}：${s.t}</span></button>`).join('')
      +'<button type="button" class="v5-replay" aria-label="重看導覽提示"><i aria-hidden="true">?</i><span>重看導覽提示</span></button>');
    pills.setAttribute('role','group');pills.setAttribute('aria-label','三步驟上手');
    for(const box of [steps,pills])box.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.classList.contains('v5-replay'))return replay();
      STEPS[b.dataset.step-1]?.run();
    });
  };
  const mountSteps=()=>{
    const ex=doc.querySelector('.hero>.home-examples'),grid=$('mobileQuickGrid');
    if(ex&&steps.previousElementSibling!==ex)ex.after(steps);
    if(grid&&pills.nextElementSibling!==grid)grid.before(pills);
  };

  /* ---------- ② 標題解碼：視覺層 aria-hidden，原文字一直在 DOM ---------- */
  const POOL='SVOP#0123456789';
  let decoded=false;
  const decode=()=>{
    const h1=doc.querySelector('.hero-intro h1');
    decoded=true;
    setTimeout(()=>root.classList.add('v5-done'),1400);
    if(!h1||!vis(h1)||reduced()||!h1.textContent.trim()){root.classList.add('v5-ready');return}
    const text=h1.textContent,chars=[...text];
    const real=el('span','v5-real');real.textContent=text;h1.textContent='';h1.append(real);
    const ov=el('span','v5-ov');ov.setAttribute('aria-hidden','true');
    const cells=chars.map(()=>{const c=el('span','v5-c');ov.append(c);return c});
    h1.append(ov);h1.classList.add('v5-dec');root.classList.add('v5-ready');
    const step=Math.min(85,520/chars.length),t0=performance.now();let last=-1;
    const frame=now=>{
      const t=now-t0,tick=Math.floor(t/55);let all=true;
      chars.forEach((ch,i)=>{
        const c=cells[i],done=t>=140+i*step||/\s/.test(ch);
        if(done){if(c.dataset.s!==undefined||!c.textContent){delete c.dataset.s;c.textContent=ch}}
        else{all=false;if(tick!==last||!c.textContent){c.dataset.s='';c.textContent=POOL[Math.floor(Math.random()*POOL.length)]}}
      });
      last=tick;
      if(all){ov.remove();h1.classList.remove('v5-dec')}else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  /* ---------- ③ 導覽：「?」信標＋小提示 ---------- */
  const textEnd=h=>{const r=doc.createRange();r.selectNodeContents(h);return r.getBoundingClientRect()};
  const TIPS=[
    {id:'search',t:'從搜尋開始',b:'輸入卡名或卡號，日、台、美版會一起列出。',fixedMobile:true,
      target:()=>mobile()?doc.querySelector('.top .search'):$('homeSearch'),
      pos:(r,m)=>m?{x:r.left+22,y:(doc.querySelector('.top')?.getBoundingClientRect().bottom??r.bottom)+8}:{x:r.left-24,y:r.top+r.height/2}},
    {id:'games',t:'選一個遊戲',b:'點遊戲或版本，直接翻閱該系列的所有卡。',
      target:()=>mobile()?doc.querySelector('.mobile-quick-grid'):$('channels'),
      pos:(r,m)=>m?{x:r.right-22,y:r.bottom+8}:{x:r.left-24,y:r.top+36}},
    {id:'latest',t:'看最新系列',b:'新發售與即將發售的系列放在這裡，點系列磚進去看。',
      target:()=>$('homeLatestTitle'),
      pos:(r,m,e)=>{const x=textEnd(e);return{x:x.right+26,y:x.top+x.height/2}}},
    {id:'collection',t:'我的收藏',b:'在卡片上加入收藏，之後都能從這裡找回來。',fixed:true,
      target:()=>{const b=[...doc.querySelectorAll('[data-nav="collection"]')];return mobile()?b.find(x=>x.closest('nav.bottom')):b.find(x=>x.closest('.nav'))},
      pos:(r,m)=>m?{x:r.right-20,y:r.top+8}:{x:r.right-6,y:r.top+6}}
  ];
  let seen=new Set(),open=null,origin=null,lastFocus=null,raf=0,pop,finished=false;
  const pending=()=>TIPS.filter(t=>!seen.has(t.id)&&vis(t.target()));
  const refocus=n=>{if(!n)return;if(!n.matches('button,a,input,select,textarea,[tabindex]'))n.tabIndex=-1;n.focus({preventScroll:true})};
  const buildTour=()=>{
    TIPS.forEach(t=>{
      const bc=el('button','v5-bc','<span class="v5-ring" aria-hidden="true"></span><span class="v5-dot" aria-hidden="true">?</span>');
      bc.type='button';bc.hidden=true;bc.setAttribute('aria-label','導覽提示：'+t.t);bc.setAttribute('aria-haspopup','dialog');bc.setAttribute('aria-expanded','false');
      bc.querySelector('.v5-ring').addEventListener('animationend',()=>bc.classList.add('v5-still'));
      bc.addEventListener('click',()=>open===t?closePop(true):openPop(t));
      t.bc=bc;
    });
    pop=el('div','v5-pop','<b id="v5PopT"></b><p id="v5PopB"></p><small id="v5PopN"></small><div class="v5-pop-actions"><button type="button" class="v5-skip">全部略過</button><button type="button" class="v5-ok">知道了</button></div>');
    pop.hidden=true;pop.tabIndex=-1;pop.setAttribute('role','dialog');pop.setAttribute('aria-modal','false');pop.setAttribute('aria-labelledby','v5PopT');pop.setAttribute('aria-describedby','v5PopB');
    pop.querySelector('.v5-ok').addEventListener('click',()=>dismiss(open));
    pop.querySelector('.v5-skip').addEventListener('click',()=>finish());
  };
  const place=()=>{
    if(!open)return;
    const r=open.bc.getBoundingClientRect(),w=Math.min(284,innerWidth-24);
    pop.style.width=w+'px';
    const h=pop.offsetHeight,cx=r.left+22;
    const x=Math.max(12,Math.min(innerWidth-12-w,cx<innerWidth/2?cx-22:cx+22-w));
    let y=r.bottom+6;if(y+h>innerHeight-12)y=Math.max(12,r.top-6-h);
    pop.style.transform=`translate(${x}px,${y}px)`;
  };
  const openPop=t=>{
    if(!origin||!doc.contains(origin))origin=lastFocus;
    if(open)open.bc.setAttribute('aria-expanded','false');
    open=t;
    const i=TIPS.indexOf(t)+1;
    pop.querySelector('#v5PopT').textContent=t.t;pop.querySelector('#v5PopB').textContent=t.b;pop.querySelector('#v5PopN').textContent=`提示 ${i}／${TIPS.length}`;
    t.bc.after(pop);pop.hidden=false;t.bc.setAttribute('aria-expanded','true');
    place();pop.querySelector('.v5-ok').focus({preventScroll:true});
  };
  const closePop=back=>{
    if(!open)return;
    const t=open;open=null;pop.hidden=true;t.bc.setAttribute('aria-expanded','false');
    if(back&&!t.bc.hidden)t.bc.focus({preventScroll:true});
  };
  const dismiss=t=>{
    seen.add(t.id);closePop(false);t.bc.hidden=true;
    const pend=pending(),next=pend.find(x=>!x.bc.hidden);
    if(next)next.bc.focus({preventScroll:true});else if(pend.length)refocus(t.target());else finish(t);
  };
  const finish=from=>{
    const t=open||from;closePop(false);finished=true;store.set();
    TIPS.forEach(x=>{x.bc.hidden=true});
    const back=origin&&doc.contains(origin)&&vis(origin)&&!origin.classList.contains('v5-bc')?origin:t&&t.target();
    origin=null;
    refocus(back);
  };
  const replay=()=>{
    store.clear();finished=false;seen=new Set();closePop(false);
    TIPS.forEach(t=>t.bc.classList.remove('v5-still'));
    schedule();
  };
  const update=()=>{
    raf=0;
    mountSteps();
    const view=doc.body.dataset.view;
    doc.querySelectorAll('[data-nav]').forEach(b=>{
      const on=(b.dataset.nav==='search'&&view==='landing')||(b.dataset.nav==='browse'&&view==='game');
      if(on!==b.hasAttribute('aria-current'))on?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');
    });
    if(view!=='landing'){closePop(false);return}
    if(!decoded)decode();
    if(finished||store.get())return;
    const hb=doc.querySelector('.top')?.getBoundingClientRect().bottom||0,dock=doc.querySelector('nav.bottom');
    const lo=hb+14,hi=(dock&&vis(dock)?dock.getBoundingClientRect().top:innerHeight)-10,m=mobile();
    TIPS.forEach(t=>{
      const e=t.target();
      if(seen.has(t.id)||!vis(e)){t.bc.hidden=true;if(open===t)closePop(false);return}
      // 固定在 .top／底部導覽內的目標，信標放在它們後面（.top 有 backdrop-filter，會困住 position:fixed）
      const anchor=e.closest('.top,nav.bottom')||e;
      if(t.bc.previousElementSibling!==anchor){anchor.after(t.bc);if(open===t)t.bc.after(pop)}
      const p=t.pos(e.getBoundingClientRect(),m,e);
      t.bc.hidden=!(t.fixed||(t.fixedMobile&&m)||(p.y>=lo&&p.y<=hi&&p.x>=0&&p.x<=innerWidth));
      t.bc.style.transform=`translate(${Math.max(0,Math.min(innerWidth-44,p.x-22))}px,${p.y-22}px)`;
      if(open===t){if(t.bc.hidden)closePop(false);else place()}
    });
  };
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(update)};

  const start=()=>{
    buildSteps();buildTour();
    doc.body.append(...TIPS.map(t=>t.bc));doc.body.append(pop);
    doc.addEventListener('focusin',e=>{if(!e.target.closest('.v5-bc,.v5-pop'))lastFocus=e.target});
    doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.preventDefault();closePop(true)}});
    doc.addEventListener('pointerdown',e=>{if(open&&!e.target.closest('.v5-pop,.v5-bc'))closePop(false)});
    addEventListener('resize',schedule);addEventListener('scroll',schedule,{passive:true});
    if(typeof MutationObserver!=='undefined'){
      new MutationObserver(schedule).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-view','hidden']});
    }
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(schedule).observe(doc.body);
    update();
  };
  const boot=()=>{try{start()}catch(err){root.classList.add('v5-ready');console.warn('home-v5',err)}};
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot);else boot();
  window.csPreview5={replay};
})();
