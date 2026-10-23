// 首頁預覽第 1 版「星圖」：兔子左邊的卡片星座、標題逐字進場、聚光燈導覽、頂欄／dock 的目前頁標記。
// 只動 DOM 與 previews/home-v1.css；不碰原本程式。卡片只用 /api/cards 的真實回應，沒有圖就不顯示。
(()=>{
  const doc=document,root=doc.documentElement,$=s=>doc.querySelector(s);
  const DONE='cs-tour-v1-done';
  const landing=()=>doc.body?.dataset.view==='landing';
  const vis=e=>!!e&&e.getClientRects().length>0;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
  const ready=f=>doc.readyState==='loading'?doc.addEventListener('DOMContentLoaded',f,{once:true}):f();

  /* ---------- 1. 標題逐字：每字 aria-hidden 視覺層，h1 以 aria-label 保留完整文字 ---------- */
  function splitTitle(){
    const h=$('.hero-intro h1');
    if(h&&!h.dataset.cs1){
      const text=h.textContent.trim(),vis=el('span');
      h.dataset.cs1='1';h.setAttribute('aria-label',text);vis.setAttribute('aria-hidden','true');
      [...text].forEach((c,i)=>{if(c===' ')return vis.append(' ');const s=el('span','cs1-ch',c);s.style.setProperty('--i',i);vis.append(s)});
      h.textContent='';h.append(vis);
    }
    root.classList.add('cs1-play');
  }

  /* ---------- 2. 目前頁標記（頂欄與 dock）：landing＝搜尋、game＝圖鑑 ---------- */
  function syncNav(){
    const cur={landing:'search',game:'browse'}[doc.body.dataset.view];
    doc.querySelectorAll('[data-nav]').forEach(b=>b.dataset.nav===cur?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  }

  /* ---------- 3. 卡片星座 ---------- */
  const imgOf=c=>{
    const u=c.imageUrl||c.printings?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl;if(!u)return'';
    try{const x=new URL(u,location.origin);if(['asia-tc.onepiece-cardgame.com','asia-en.onepiece-cardgame.com'].includes(x.hostname)&&x.pathname.startsWith('/images/cardlist/card/'))return'/api/images/onepiece?url='+encodeURIComponent(x.href)}catch{}
    return u;
  };
  const nameOf=c=>String(c.nameZh||c.nameJa||c.nameEn||c.name||'').replace(/\s*\[[^\]]*\]$/,'');
  const loads=src=>new Promise(res=>{const i=new Image(),t=setTimeout(()=>res(false),5000);i.onload=()=>{clearTimeout(t);res(true)};i.onerror=()=>{clearTimeout(t);res(false)};i.src=src});
  async function pickCards(){
    const rows=await Promise.all(['pokemon','onepiece','yugioh','weiss-schwarz','haikyuu'].map(g=>fetch(`/api/cards?game=${g}&limit=12`).then(r=>r.ok?r.json():null).then(j=>(j?.data||[]).filter(c=>imgOf(c)).slice(0,2).map(c=>({id:c.id,game:g,name:nameOf(c),src:imgOf(c)}))).catch(()=>[])));
    const cand=[0,1].flatMap(k=>rows.map(r=>r[k]).filter(Boolean)).slice(0,8),ok=await Promise.all(cand.map(c=>loads(c.src)));
    return cand.filter((c,i)=>ok[i]).slice(0,5);
  }
  // 桌面扇形座標（300×400 的星座區，沿兔子的彗尾往左下，避開搜尋框）；連線兩兩相接
  const POS=[{x:190,y:0,w:100,r:5},{x:96,y:96,w:92,r:-4},{x:40,y:196,w:84,r:6},{x:140,y:282,w:78,r:-5},{x:232,y:236,w:62,r:4}];
  const LINKS=[[0,1],[1,2],[1,3],[3,4],[0,4]];
  let lastCard=null;
  function openCard(c,btn){
    lastCard=btn;
    if(typeof window.openCard==='function')window.openCard(c.id);else location.href=`/?game=${encodeURIComponent(c.game)}&card=${encodeURIComponent(c.id)}`;
  }
  function cardBtn(c,i,pos){
    const b=el('button','cs1-card'),im=el('img');
    b.type='button';b.setAttribute('aria-label',`開啟${c.name||'這張卡'}的卡片詳細資料`);b.style.setProperty('--i',i);
    if(pos){b.style.setProperty('--x',pos.x+'px');b.style.setProperty('--y',pos.y+'px');b.style.setProperty('--w',pos.w+'px');b.style.setProperty('--r',pos.r+'deg')}
    else b.style.setProperty('--r',[-5,3,-3][i]+'deg');
    im.src=c.src;im.alt='';im.decoding='async';b.append(im);b.onclick=()=>openCard(c,b);return b;
  }
  function buildCards(cards){
    const hero=$('#hero'),intro=$('.hero-intro');
    if(!hero||!intro||$('.cs1-fan'))return;
    const real=cards.length>=3,n=real?cards.length:POS.length; // 沒有足夠真實卡圖時只畫星點與星座線
    const NS='http://www.w3.org/2000/svg',fan=el('div','cs1-fan'),svg=doc.createElementNS(NS,'svg');
    if(real){fan.setAttribute('role','group');fan.setAttribute('aria-label','精選卡片')}else fan.setAttribute('aria-hidden','true');
    svg.setAttribute('viewBox','0 0 300 400');svg.setAttribute('aria-hidden','true');
    const mid=i=>[POS[i].x+POS[i].w/2,POS[i].y+POS[i].w*88/63/2];
    LINKS.filter(([a,b])=>a<n&&b<n).forEach(([a,b])=>{
      const[x1,y1]=mid(a),[x2,y2]=mid(b),l=doc.createElementNS(NS,'line'),d=doc.createElementNS(NS,'circle');
      l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);
      d.setAttribute('cx',(x1+x2)/2);d.setAttribute('cy',(y1+y2)/2);d.setAttribute('r',2.4);svg.append(l,d);
    });
    if(!real)POS.forEach((_,i)=>{
      const[x,y]=mid(i),h=doc.createElementNS(NS,'circle'),s=doc.createElementNS(NS,'circle');
      h.setAttribute('class','cs1-halo');h.setAttribute('r',9);s.setAttribute('r',3.4);[h,s].forEach(c=>{c.setAttribute('cx',x);c.setAttribute('cy',y);svg.append(c)});
    });
    fan.append(svg);if(real)cards.forEach((c,i)=>fan.append(cardBtn(c,i,POS[i])));hero.append(fan);
    if(!real)return;
    const strip=el('div','cs1-strip');strip.setAttribute('role','group');strip.setAttribute('aria-label','精選卡片');
    cards.slice(0,3).forEach((c,i)=>strip.append(cardBtn(c,i)));
    intro.append(strip,$('.cs1-replay-m')||'');
    // 關閉詳細頁後焦點回到被點的星座卡
    const m=$('#modal');
    if(m)new MutationObserver(()=>{if(!m.classList.contains('open')&&lastCard&&doc.activeElement===doc.body){lastCard.focus({preventScroll:true});lastCard=null}}).observe(m,{attributes:true,attributeFilter:['class']});
  }

  /* ---------- 4. 聚光燈導覽 ---------- */
  let tour=null;
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const firstVis=sel=>[...doc.querySelectorAll(sel)].find(vis);
  const union=sels=>{
    let r=null;
    sels.forEach(s=>{const e=firstVis(s);if(!e)return;const b=e.getBoundingClientRect();if(!b.width||!b.height)return;
      r=r?{l:Math.min(r.l,b.left),t:Math.min(r.t,b.top),r:Math.max(r.r,b.right),b:Math.max(r.b,b.bottom)}:{l:b.left,t:b.top,r:b.right,b:b.bottom}});
    return r;
  };
  const stepDefs=()=>[
    {t:['#homeSearch','.top .search'],h:'先從這裡找卡',p:'輸入卡名、卡號或系列；也可以點旁邊的範例直接試試。'},
    {t:[mobile()?'#mobileQuickGrid':'#channels'],h:'挑一個遊戲開始翻閱',p:'選一個作品，直接進入它的圖鑑。'},
    {t:['#homeLatest h2','#homeLatest .home-latest-tabs','#homeLatest .series-band-rail'],h:'最新系列放在這裡',p:'可依遊戲切換分頁，點系列磚就能看完整卡表。'},
    {t:['nav.bottom [data-nav="collection"]'],h:'我的收藏',p:'卡片上的收藏鈕加入的卡，都會集中在這裡；這條列也能快速切換搜尋與圖鑑。'}
  ].filter(s=>union(s.t));

  function closeTour(mark){
    if(!tour)return;
    const t=tour;tour=null;
    doc.removeEventListener('keydown',t.key,true);removeEventListener('resize',t.place);removeEventListener('scroll',t.place,true);t.mo.disconnect();t.ov.remove();
    if(mark){try{localStorage.setItem(DONE,'1')}catch{}}
    (t.back&&t.back.isConnected&&t.back!==doc.body?t.back:$('#main'))?.focus({preventScroll:true});
  }
  function startTour(){
    if(tour||!landing())return;
    const steps=stepDefs();if(steps.length<3)return;
    let i=0,raf=0;
    const ov=el('div','cs1-tour'),spot=el('div','cs1-tour-spot'),card=el('div','cs1-tour-card'),head=el('div','cs1-tour-head'),av=el('img'),stepEl=el('p','cs1-tour-step');
    const body=el('div'),title=el('h2','cs1-tour-title'),text=el('p','cs1-tour-text'),foot=el('div','cs1-tour-foot'),dots=el('div','cs1-dots'),btns=el('div','cs1-tour-btns'),skip=el('button','cs1-skip','略過'),next=el('button','cs1-next');
    av.src='/assets/brand/web/rabbit-profile-96.webp';av.alt='';av.width=av.height=44;
    title.id='cs1TourTitle';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','cs1TourTitle');card.tabIndex=-1;
    body.setAttribute('aria-live','polite');body.append(title,text);dots.setAttribute('aria-hidden','true');steps.forEach(()=>dots.append(el('i')));
    skip.type=next.type='button';btns.append(skip,next);head.append(av,stepEl);foot.append(dots,btns);card.append(head,body,foot);
    const shade=el('div','cs1-tour-shade');ov.append(shade,spot,card);doc.body.append(ov);
    const place=()=>{
      cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{
        const r=union(steps[i].t);if(!r)return;
        const vw=innerWidth,vh=innerHeight,pad=8,L=Math.max(4,r.l-pad),T=Math.max(4,r.t-pad),R=Math.min(vw-4,r.r+pad),B=Math.min(vh-4,r.b+pad);
        Object.assign(spot.style,{left:L+'px',top:T+'px',width:Math.max(0,R-L)+'px',height:Math.max(0,B-T)+'px'});
        const cw=card.offsetWidth,ch=card.offsetHeight;
        let top=B+14;if(top+ch>vh-12)top=T-14-ch;if(top<12)top=vh-ch-12;
        card.style.top=top+'px';card.style.left=Math.min(Math.max(12,(L+R)/2-cw/2),vw-cw-12)+'px';
      });
    };
    const show=n=>{
      i=n;const s=steps[i],r=union(s.t);
      if(r&&(r.t<80||r.b>innerHeight-90))firstVis(s.t[0])?.scrollIntoView({block:'center',behavior:'instant'});
      stepEl.textContent=`第 ${i+1}／${steps.length} 步`;title.textContent=s.h;text.textContent=s.p;
      next.textContent=i===steps.length-1?'開始探索':'下一步';
      [...dots.children].forEach((d,k)=>d.classList.toggle('on',k===i));
      place();
    };
    next.onclick=()=>i<steps.length-1?show(i+1):closeTour(true);
    skip.onclick=()=>closeTour(true);
    const key=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();return closeTour(true)}
      if(e.key==='Tab'){const f=[skip,next],k=f.indexOf(doc.activeElement);e.preventDefault();f[(k+(e.shiftKey?-1:1)+f.length)%f.length].focus();return}
      if(/^(Arrow(Left|Right)|\d|r|R)$/.test(e.key)&&!e.metaKey&&!e.ctrlKey&&!e.altKey)e.stopPropagation(); // 不讓預覽切換器的快捷鍵在導覽中誤觸
    };
    // 使用者離開首頁（點進遊戲、搜尋）就自動收起
    const mo=new MutationObserver(()=>{if(!landing())closeTour(true)});mo.observe(doc.body,{attributes:true,attributeFilter:['data-view']});
    tour={ov,key,place,mo,back:doc.activeElement};
    doc.addEventListener('keydown',key,true);addEventListener('resize',place);addEventListener('scroll',place,true);
    show(0);next.focus({preventScroll:true});
  }

  function maybeAutoStart(){
    let done=false;try{done=!!localStorage.getItem(DONE)}catch{}
    if(done||!landing())return;
    setTimeout(()=>{
      const t0=Date.now(),tick=()=>{
        if(tour||!landing()||$('#modal.open'))return;
        if(!firstVis('#channels .channel,#mobileQuickGrid .mqg-tile')&&Date.now()-t0<3000)return setTimeout(tick,150);
        startTour();
      };tick();
    },1400);
  }

  function init(){
    splitTitle();syncNav();
    // 重看導覽：桌面在「版本」那一列，手機在標題小卡內
    const mk=(cls)=>{const b=el('button',cls,'✦ 重看導覽');b.type='button';b.classList.add('cs1-replay');b.onclick=()=>startTour();return b};
    $('.browse-regions')?.append(mk(''));
    $('.hero-intro')?.append(mk('cs1-replay-m'));
    new MutationObserver(syncNav).observe(doc.body,{attributes:true,attributeFilter:['data-view']});
    pickCards().then(buildCards).catch(()=>{});
    maybeAutoStart();
  }
  ready(()=>{try{init()}catch(e){}});
  window.csPreview1={startTour,closeTour};
})();
