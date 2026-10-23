// 首頁預覽第 3 版「卡冊對照」：標題遮罩上滑、版本對照扇、兔子導遊、導覽列選中狀態。
// 資料只來自 /api/cards 與頁面既有 DOM；拿不到就不顯示對照扇。選定後與 previews/ 一起刪除。
(()=>{
  'use strict';
  const KEY='cs-tour-v3-done',root=document.documentElement,mq=matchMedia('(prefers-reduced-motion: reduce)');
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const still=()=>mq.matches||root.hasAttribute('data-cs-paused');
  const view=()=>document.body?.dataset.view;
  const seen=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
  const markSeen=()=>{try{localStorage.setItem(KEY,'1')}catch{}};
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
  const visible=n=>n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'?n:null;
  const warn=e=>console.warn('[preview-v3]',e),safe=fn=>(...a)=>{try{const r=fn(...a);return r&&r.catch?r.catch(warn):r}catch(e){warn(e)}};

  // ===== 1. 標題與介紹：同一段文字包進遮罩，播一次 =====
  const splitIntro=safe(()=>{
    const intro=$('.hero-intro'),h1=intro&&$('h1',intro),p=intro&&$('p',intro);
    if(!h1||h1.classList.contains('v3-ready'))return;
    const line=(cls,inner,t,d)=>{const w=el('span',cls),i=el('span',inner,t);i.style.setProperty('--d',d+'s');w.append(i);return w};
    const t=h1.textContent.trim();
    h1.replaceChildren(...(t.startsWith('跨版本')&&t.length>3?[t.slice(0,3),t.slice(3)]:[t]).map((s,i)=>line('v3-w','v3-wi',s,i*.12)));
    h1.classList.add('v3-ready');
    if(p){p.replaceChildren(...p.textContent.trim().split(/(?<=；)/).filter(Boolean).map((s,i)=>line('v3-pw','v3-pi',s,.32+i*.16)));p.classList.add('v3-ready')}
    setTimeout(()=>{h1.classList.add('v3-done');p?.classList.add('v3-done')},1800);
    // 重看導覽入口（手機縮成頭像圓鈕，文字留給螢幕閱讀器）
    if(!$('.v3-replay',intro)){
      const b=el('button','v3-replay');b.type='button';b.setAttribute('aria-label','重看導覽');
      const img=new Image();img.src='/assets/brand/web/rabbit-profile-96.webp';img.alt='';img.width=32;img.height=32;
      b.append(img,el('span',null,'重看導覽'));b.addEventListener('click',()=>startTour(b));intro.append(b);
    }
  });

  // ===== 2. 版本對照扇 =====
  const imgUrl=v=>{if(!v)return'';try{const u=new URL(v,location.origin);return /^asia-(tc|en)\.onepiece-cardgame\.com$/.test(u.hostname)&&u.pathname.startsWith('/images/cardlist/card/')?'/api/images/onepiece?url='+encodeURIComponent(u.href):u.href}catch{return''}};
  const usable=p=>p&&p.imageUrl&&!p.imageRehostRequired;
  const cardName=c=>c.nameZh||c.nameJa||c.nameEn||c.id;
  const cardImg=c=>c.imageUrl||(c.printings||[]).find(usable)?.imageUrl||'';
  const getJson=async url=>{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),6000);try{const r=await fetch(url,{signal:ac.signal});return r.ok?await r.json():null}catch{return null}finally{clearTimeout(t)}};
  const REG=[['JP','日版'],['TW','台版'],['US','美版']];

  async function pickFan(){
    const lists=await Promise.all(['pokemon','onepiece','yugioh'].map(g=>getJson(`/api/cards?game=${g}&limit=60`)));
    const cards=lists.flatMap(l=>Array.isArray(l?.data)?l.data:[]);
    for(const c of cards){ // 同一張卡：日／台／美版都有圖
      const ps=Array.isArray(c.printings)?c.printings:[],hit=REG.map(([r,l])=>[ps.find(p=>p.region===r&&usable(p)),l]);
      if(hit.every(h=>h[0]))return{ver:true,note:`同一張卡的日、台、美版 · ${cardName(c)}`,items:hit.map(([p,l])=>({url:imgUrl(p.imageUrl),label:l,alt:`${l} ${cardName(c)}`}))};
    }
    const withImg=cards.filter(cardImg),bySeries={};
    for(const c of withImg)(bySeries[c.seriesId||'']??=[]).push(c);
    const grp=Object.values(bySeries).find(g=>g.length>=3);
    if(grp)return{note:'同一系列的卡片',items:grp.slice(0,3).map(c=>({url:imgUrl(cardImg(c)),label:c.officialCardNumber||cardName(c),alt:cardName(c),name:cardName(c),num:c.officialCardNumber}))};
    if(cards.length>=3)return{note:'收錄中的卡片（卡圖待補）',items:cards.slice(0,3).map(c=>({url:'',label:c.officialCardNumber||cardName(c),alt:cardName(c),name:cardName(c),num:c.officialCardNumber}))};
    return null;
  }
  const face=it=>{const f=el('div','v3-face');f.append(el('b',null,it.num||''),el('span',null,it.name||it.alt));return f};

  const mountFan=safe(async()=>{
    const hero=$('#hero'),intro=hero&&$('.hero-intro',hero);if(!intro||$('.v3-fan'))return;
    const data=await pickFan();if(!data)return;
    const fan=el('aside','v3-fan'),stage=el('ol','v3-stage');
    fan.setAttribute('aria-label','版本對照');fan.classList.toggle('v3-ver',!!data.ver);
    data.items.forEach((it,i)=>{
      const li=el('li','v3-card'),fig=el('figure'),art=el('div','v3-art');li.dataset.slot=i;
      if(it.url){const img=new Image();img.alt=it.alt;img.decoding='async';img.onerror=()=>art.replaceChildren(face(it));img.src=it.url;art.append(img)}
      else{art.append(face(it));art.setAttribute('role','img');art.setAttribute('aria-label',it.alt)}
      fig.append(art,el('figcaption',null,it.label));li.append(fig);stage.append(li);
    });
    fan.append(stage,el('p','v3-fan-note',data.note));
    intro.after(fan);root.classList.add('v3-fan-on');
    setTimeout(()=>root.classList.add('v3-fan-seen'),1400);
    let n=0;const slots=$$('.v3-card',stage);
    const t=setInterval(()=>{
      if(still()||n>=3)return clearInterval(t);
      if(fan.matches(':hover'))return;
      slots.forEach(c=>c.dataset.slot=(+c.dataset.slot+1)%3);n++;
    },4000);
  });

  // ===== 3. 導覽列選中狀態（CSS 已依 body[data-view] 上色；這裡補 aria-current 給輔助科技） =====
  const syncNav=()=>{
    const cur={landing:'search',game:'browse'}[view()];
    $$('[data-nav]').forEach(b=>{if(b.dataset.nav===cur)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  };

  // ===== 4. 兔子導遊 =====
  const STEPS=[
    {find:()=>visible($('.v3-stage')),text:'CardScope 把同一張卡的日版、台版、美版並列，一眼就能對照。'},
    {find:()=>visible($('.home-search'))||visible($('.top .search')),text:'直接輸入卡名、卡號或系列，例如「噴火龍」或「SV6a 090」。'},
    {find:()=>visible($('#channels'))||visible($('#mobileQuickGrid')),text:'想慢慢翻？從這裡選一個遊戲，依系列與版本瀏覽整本圖鑑。'},
    {find:()=>visible($('#homeLatest')),els:()=>[$('#homeLatestTitle'),$('#homeLatestRail')],maxH:360,text:'最新發售的系列都收在這裡，點系列磚直接翻看卡表。'},
    {find:()=>$$('[data-nav="collection"]').find(visible),text:'喜歡的卡加進我的收藏冊，隨時回來查看。'}
  ];
  let tour=null;

  function startTour(opener){
    if(tour||view()!=='landing'||$('dialog[open]'))return;
    const queue=STEPS.filter(s=>s.find());if(!queue.length)return;
    const ring=el('div','v3-ring'),box=el('div','v3-tour');
    box.setAttribute('role','dialog');box.setAttribute('aria-label','兔子導覽');
    const av=new Image();av.className='v3-tour-av';av.src='/assets/brand/web/rabbit-profile-96.webp';av.alt='';av.width=av.height=48;
    const body=el('div','v3-tour-body'),text=el('p','v3-tour-text');text.setAttribute('aria-live','polite');
    const foot=el('div','v3-tour-foot'),count=el('span','v3-tour-n'),skip=el('button',null,'略過'),next=el('button','v3-next');
    skip.type=next.type='button';foot.append(count,skip,next);body.append(text,foot);box.append(av,body);
    document.body.append(ring,box);
    const prev=opener||document.activeElement;
    let i=-1,raf=0,cur=null;

    const rect=()=>{
      const els=(cur.els?cur.els():[cur.target]).filter(Boolean),rs=els.map(e=>e.getBoundingClientRect());
      const l=Math.min(...rs.map(r=>r.left)),t=Math.min(...rs.map(r=>r.top)),r=Math.max(...rs.map(r=>r.right)),b=Math.max(...rs.map(r=>r.bottom));
      return{left:l,top:t,width:r-l,height:Math.min(b-t,cur.maxH||1e5)};
    };
    const place=()=>{
      raf=0;if(!tour||!cur)return;
      if($('dialog[open]')||view()!=='landing')return end();
      const r=rect(),vw=innerWidth,vh=innerHeight,pad=6;
      Object.assign(ring.style,{left:r.left-pad+'px',top:r.top-pad+'px',width:r.width+pad*2+'px',height:r.height+pad*2+'px'});
      const bw=box.offsetWidth,bh=box.offsetHeight,gap=18,cx=r.left+r.width/2;
      const below=vh-(r.top+r.height+pad)-gap>=bh+12,above=r.top-pad-gap-bh>=70;
      const left=Math.max(12,Math.min(cx-bw/2,vw-bw-12));
      let top,mode;
      if(below){top=r.top+r.height+pad+gap;mode='is-below'}
      else if(above){top=r.top-pad-gap-bh;mode='is-above'}
      else{top=Math.max(70,vh-bh-76);mode='is-free'}
      box.classList.remove('is-below','is-above','is-free');box.classList.add(mode);
      box.style.left=left+'px';box.style.top=top+'px';
      box.style.setProperty('--ax',Math.max(28,Math.min(cx-left,bw-28))+'px');
    };
    const sched=()=>{if(!raf)raf=requestAnimationFrame(place)};
    const show=()=>{
      // 找下一個還看得到目標的步驟
      while(++i<queue.length){const t=queue[i].find();if(t){cur={...queue[i],target:t};break}cur=null}
      if(!cur||i>=queue.length)return end();
      text.textContent=cur.text;count.textContent=`${i+1} / ${queue.length}`;next.textContent=i===queue.length-1?'完成':'下一步';
      if(!cur.target.closest('.bottom,.top')){
        const r=rect();
        if(r.top<90||r.top+Math.min(r.height,300)>innerHeight-90)scrollTo({top:scrollY+r.top-110,behavior:'auto'});
      }
      ring.classList.add('on');box.classList.add('on');place();next.focus({preventScroll:true});
    };
    const end=()=>{
      if(!tour)return;tour=null;markSeen();
      removeEventListener('scroll',sched);removeEventListener('resize',sched);document.removeEventListener('keydown',onKey,true);document.removeEventListener('click',onClick,true);obs.disconnect();
      cancelAnimationFrame(raf);ring.remove();box.remove();
      if(prev&&prev.isConnected&&prev!==document.body)prev.focus({preventScroll:true});
    };
    const onKey=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end()}
      else if(e.key==='Tab'){const f=[skip,next],k=f.indexOf(document.activeElement);e.preventDefault();f[(k+(e.shiftKey?-1:1)+f.length)%f.length].focus()}
    };
    // 使用者去操作別的東西（開收藏、進遊戲、搜尋）就自動收起
    const onClick=e=>{if(!box.contains(e.target)&&e.target.closest('button,a,input,select,summary'))setTimeout(()=>{if($('dialog[open],.modal.open')||view()!=='landing')end()},80)};
    const obs=new MutationObserver(()=>{if(view()!=='landing')end()});obs.observe(document.body,{attributes:true,attributeFilter:['data-view']});
    next.addEventListener('click',show);skip.addEventListener('click',end);
    addEventListener('scroll',sched,{passive:true});addEventListener('resize',sched);document.addEventListener('keydown',onKey,true);document.addEventListener('click',onClick,true);
    tour={end};show();
  }

  // ===== 啟動 =====
  const init=()=>{
    splitIntro();syncNav();
    if(document.body&&typeof MutationObserver!=='undefined')new MutationObserver(syncNav).observe(document.body,{attributes:true,attributeFilter:['data-view']});
    // 等對照扇資料回來再開始導覽，第一步才找得到它
    Promise.resolve(mountFan()).then(()=>{if(!seen())setTimeout(safe(()=>startTour()),1500)});
  };
  const go=safe(init);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
  window.csPreview3={startTour:()=>startTour()};
})();
