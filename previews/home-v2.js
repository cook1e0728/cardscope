// 首頁預覽第 2 版「打字機／跨語言」：標題打字機、跨語言搜尋示範面板、右下步驟卡導覽、底部橫條選中狀態。
// 每一塊各自 try/catch，任何一塊失敗都不影響原本頁面；卡片與名稱只用 /api/search 的真實回應。
(()=>{
  if(window.csPreview2)return;window.csPreview2=true;
  const KEY='cs-tour-v2-done',root=document.documentElement,mq=matchMedia('(prefers-reduced-motion: reduce)');
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const still=()=>mq.matches||root.hasAttribute('data-cs-paused');
  const landing=()=>document.body?.dataset.view==='landing';
  const vis=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const first=(...sels)=>{for(const s of sels){const el=$(s);if(vis(el))return el}return null};
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n};
  const done=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
  const markDone=()=>{try{localStorage.setItem(KEY,'1')}catch{}};
  const safe=(name,fn)=>{try{const r=fn();if(r&&r.catch)r.catch(e=>console.warn('[preview-v2]',name,e))}catch(e){console.warn('[preview-v2]',name,e)}};

  // ---- 底部橫條／頂欄：選中狀態（landing＝搜尋、game＝圖鑑）＋滑動的金色指示條 ----
  function navState(){
    const bar=$('nav.bottom');if(!bar)return;
    const ind=el('span','v2-ind');ind.setAttribute('aria-hidden','true');bar.append(ind);
    const order=['search','browse','collection'];
    const sync=()=>{
      const v=document.body.dataset.view,cur=v==='landing'?'search':v==='game'?'browse':'',i=order.indexOf(cur);
      $$('[data-nav]').forEach(b=>b.dataset.nav===cur?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
      ind.style.setProperty('--v2-i',String(Math.max(i,0)));ind.dataset.on=i<0?'0':'1';
    };
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-view']});sync();
  }

  // ---- 標題打字機（視覺層 aria-hidden，原文字完整留給螢幕閱讀器）＋說明文字逐行淡入 ----
  function intro(){
    if(!landing())return;
    const h1=$('#hero .hero-intro h1'),p=$('#hero .hero-intro p');
    if(p&&!p.dataset.v2){
      p.dataset.v2='1';
      const parts=p.textContent.trim().split(/(?<=；)/);p.textContent='';
      parts.forEach((t,i)=>{const s=el('span','v2-line',t);s.style.setProperty('--d',(.5+i*.2)+'s');p.append(s)});
    }
    if(!h1||h1.dataset.v2||still())return;
    h1.dataset.v2='1';
    const text=h1.textContent.trim(),chars=[...text];
    const sr=el('span','v2-sr',text),vis2=el('span','v2-tw'),a=el('span'),cur=el('i','v2-cur'),b=el('span','v2-rest',text);
    vis2.setAttribute('aria-hidden','true');vis2.append(a,cur,b);h1.textContent='';h1.append(sr,vis2);
    let i=0;
    const step=()=>{
      i++;a.textContent=chars.slice(0,i).join('');b.textContent=chars.slice(i).join('');
      if(i<chars.length)return setTimeout(step,75);
      cur.classList.add('is-done');setTimeout(()=>{h1.textContent=text},1000);// 游標閃完後還原成純文字
    };
    setTimeout(step,150);
  }

  // ---- 跨語言搜尋示範：同一張卡的中／英／日名稱，各自搜一次確認真的都找得到 ----
  const api=async q=>{const r=await fetch('/api/search?q='+encodeURIComponent(q));if(!r.ok)throw new Error(r.status);return(await r.json()).data||[]};
  const cid=c=>c.canonicalId||c.id;
  async function findDemo(){
    for(const seed of['Charizard','Luffy']){
      try{
        const rows=(await api(seed)).filter(c=>c.nameZh&&c.nameEn&&c.nameJa);
        const card=rows.find(c=>c.imageUrl)||rows[0];if(!card)continue;
        const words=[card.nameZh,card.nameEn,card.nameJa];
        const hits=await Promise.all(words.map(w=>api(w).then(r=>r.some(c=>cid(c)===cid(card)),()=>false)));
        if(!hits.every(Boolean))continue;
        const img=card.imageUrl?(typeof displayImageUrl==='function'?displayImageUrl(card.imageUrl):card.imageUrl):'';
        return{words,img};
      }catch{}
    }
    return null;
  }
  async function demo(){
    if(!landing())return;
    const intro=$('#hero .hero-intro');if(!intro||$('.v2-demo'))return;
    const d=await findDemo();if(!d||$('.v2-demo'))return;
    const btn=el('button','v2-demo'),input=el('span','v2-demo-input'),typed=el('span','v2-demo-typed'),caret=el('i','v2-cur'),chips=el('span','v2-demo-chips'),art=el('span','v2-demo-art');
    btn.type='button';btn.dataset.search=d.words[0];// 全站既有的 [data-search] 點擊處理會直接搜尋
    btn.setAttribute('aria-label',`跨語言搜尋示範：${d.words.join('、')}，都會找到同一張卡。按下會以示範中的關鍵字搜尋。`);
    input.setAttribute('aria-hidden','true');input.append(el('b',null,'⌕'),typed,caret);
    chips.setAttribute('aria-hidden','true');const cs=d.words.map(w=>chips.appendChild(el('span','v2-chip',w)));
    art.setAttribute('aria-hidden','true');
    if(d.img){const im=new Image();im.alt='';im.decoding='async';im.onerror=()=>{im.remove();btn.classList.add('no-img')};im.src=d.img;art.append(im)}else btn.classList.add('no-img');
    btn.append(input,chips,el('span','v2-demo-cap','都會找到同一張卡'),art);
    intro.after(btn);

    let stopped=false;
    const toStatic=()=>{stopped=true;btn.dataset.static='1';btn.dataset.found='1';btn.dataset.search=d.words[0];cs.forEach(c=>c.classList.add('is-on'));caret.hidden=true};
    if(still())return toStatic();
    new MutationObserver(()=>{if(still()&&!stopped)toStatic()}).observe(root,{attributes:true,attributeFilter:['data-cs-paused']});
    mq.addEventListener?.('change',()=>{if(still()&&!stopped)toStatic()});

    await wait(900);// 讓標題先打完
    for(let round=0;round<2;round++){
      if(round)cs.forEach(c=>c.classList.remove('is-on'));
      for(let w=0;w<3;w++){
        const chars=[...d.words[w]];
        for(let i=1;i<=chars.length;i++){if(stopped)return;typed.textContent=chars.slice(0,i).join('');await wait(w===1?65:90)}
        btn.dataset.search=d.words[w];btn.dataset.found='1';cs[w].classList.add('is-on');
        if(round===1&&w===2)break;// 第 2 輪打完停在最後狀態
        await wait(700);
        for(let i=chars.length-1;i>=0;i--){if(stopped)return;typed.textContent=chars.slice(0,i).join('');await wait(26)}
        await wait(120);
      }
    }
    caret.hidden=true;
  }

  // ---- 導覽：右下步驟卡（無遮罩），每步在目標外加金色描邊脈動一次 ----
  const STEPS=[
    {t:'先搜尋，再細看',b:'輸入卡名、卡號或系列；中、英、日文的名稱都能找到同一張卡。',el:()=>first('#homeSearch','.top .search')},
    {t:'選一個遊戲翻圖鑑',b:'從遊戲入口進去翻整個圖鑑，也能用版本縮小到日版、台版或美版。',el:()=>first('#mobileQuickGrid','#channels')},
    {t:'看最新發售的系列',b:'依發售日列出最新系列，點系列磚就能翻整個系列，也能切換各遊戲。',el:()=>first('#homeLatestRail','#homeLatest')},
    {t:'收進我的收藏',b:'喜歡的卡加進收藏，隨時從這裡打開；資料只存在這台裝置，可匯出備份。',el:()=>$$('[data-nav="collection"]').find(vis)||null}
  ];
  let tour=null;
  function startTour(){
    if(tour||!landing())return;
    const steps=STEPS.filter(s=>s.el());if(steps.length<3)return;
    const prev=document.activeElement,card=el('div','v2-tour'),ring=el('div','v2-ring');
    card.setAttribute('role','dialog');card.setAttribute('aria-modal','false');card.setAttribute('aria-label','網站導覽');card.tabIndex=-1;
    ring.setAttribute('aria-hidden','true');ring.hidden=true;
    const bar=el('div','v2-tour-bar'),fill=el('i'),n=el('p','v2-tour-n'),live=el('div'),h=el('h2'),b=el('p','v2-tour-b'),act=el('div','v2-tour-act'),skip=el('button',null,'略過'),next=el('button');
    bar.setAttribute('aria-hidden','true');bar.append(fill);live.setAttribute('aria-live','polite');live.append(h,b);
    skip.type=next.type='button';skip.dataset.v2='skip';next.dataset.v2='next';act.append(skip,next);
    card.append(bar,n,live,act);document.body.append(ring,card);
    let i=0,target=null,raf=0;
    const place=()=>{
      raf=0;
      if(!target||!vis(target)){ring.hidden=true;return}
      const r=target.getBoundingClientRect(),pad=6;
      ring.hidden=false;ring.style.width=r.width+pad*2+'px';ring.style.height=r.height+pad*2+'px';ring.style.translate=`${r.left-pad}px ${r.top-pad}px`;
    };
    const queue=()=>{if(!raf)raf=requestAnimationFrame(place)};
    const reveal=t=>{// 目標在頂欄／底欄時不捲動；其餘捲到頂欄下方
      if(!t||t.closest('.top,.bottom'))return;
      const gap=window.innerWidth>760?32:12;
      if(typeof scrollBelowHeader==='function'&&!still())scrollBelowHeader(t,gap);
      else{const top=$('.top'),pin=top&&getComputedStyle(top).position==='sticky'?top.getBoundingClientRect().height:0;scrollTo({top:Math.max(0,t.getBoundingClientRect().top+scrollY-pin-gap),behavior:'auto'})}
    };
    const show=k=>{
      i=k;const s=steps[k];target=s.el();
      n.textContent=`${k+1} / ${steps.length}`;h.textContent=s.t;b.textContent=s.b;
      fill.style.setProperty('--p',String((k+1)/steps.length));
      next.textContent=k===steps.length-1?'完成':'下一步';
      reveal(target);place();
      ring.classList.remove('is-pulse');void ring.offsetWidth;ring.classList.add('is-pulse');
      setTimeout(queue,350);// 捲動結束後再對一次位置
    };
    const close=()=>{
      removeEventListener('scroll',queue);removeEventListener('resize',queue);document.removeEventListener('keydown',onKey,true);document.removeEventListener('click',onClick,true);obs.disconnect();
      card.remove();ring.remove();tour=null;markDone();
      if(prev&&prev!==document.body&&document.contains(prev))prev.focus?.({preventScroll:true});
    };
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();close()}};
    // 使用者開始操作頁面（搜尋、進遊戲、開收藏）就自動收起
    const onClick=e=>{if(!card.contains(e.target)&&e.target.closest?.('[data-example],[data-search],[data-nav],.channel,.mqg-tile,#go,#heroGo'))close()};
    const obs=new MutationObserver(()=>{if(!landing())close()});obs.observe(document.body,{attributes:true,attributeFilter:['data-view']});
    addEventListener('scroll',queue,{passive:true});addEventListener('resize',queue);document.addEventListener('keydown',onKey,true);document.addEventListener('click',onClick,true);
    skip.addEventListener('click',close);
    next.addEventListener('click',()=>{i<steps.length-1?show(i+1):close()});
    tour={close};show(0);next.focus({preventScroll:true});
  }
  function replayEntry(){
    const hero=$('#hero'),latest=$('#homeLatest');if(!hero||$('.v2-replay'))return;
    const btn=el('button','v2-replay','↻ 重看導覽');btn.type='button';
    btn.addEventListener('click',()=>{if(tour)return;scrollTo({top:0,behavior:still()?'auto':'smooth'});startTour()});
    latest&&latest.parentNode===hero?latest.before(btn):hero.append(btn);
  }

  const boot=()=>{
    root.classList.add('v2-ready');// 放行 CSS 先藏起來的標題與說明
    safe('nav',navState);safe('intro',intro);safe('demo',demo);safe('replay',replayEntry);
    if(!done())setTimeout(()=>safe('tour',startTour),1300);
  };
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot,{once:true}):boot();
})();
