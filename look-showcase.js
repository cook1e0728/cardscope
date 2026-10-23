// 首頁「星圖手牌」（ADR 0051）：兔子卡居中的高稀有度手牌、標題進場、首次導覽、頂欄按鈕與底部 dock。樣式在 look-showcase.css。卡片只用 /api/cards 的真實回應，沒有圖就不顯示。
(()=>{
  const doc=document,root=doc.documentElement,$=s=>doc.querySelector(s);
  const DONE='cs-tour-done';
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

  /* ---------- 3. 卡片星軌：沿兔子的彗尾，由近到遠排成一道弧 ---------- */
  const GAME_NAME={pokemon:'寶可夢',onepiece:'航海王',yugioh:'遊戲王','weiss-schwarz':'芙莉蓮',haikyuu:'排球少年'};
  const imgOf=c=>{
    const u=c.imageUrl||c.printings?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl;if(!u)return'';
    try{const x=new URL(u,location.origin);if(['asia-tc.onepiece-cardgame.com','asia-en.onepiece-cardgame.com'].includes(x.hostname)&&x.pathname.startsWith('/images/cardlist/card/'))return'/api/images/onepiece?url='+encodeURIComponent(x.href)}catch{}
    return u;
  };
  // 航海王、Weiß Schwarz 官方圖本身印著 SAMPLE 浮水印，放在展示位不好看 → 不選
  const sampled=u=>/onepiece-cardgame\.com|ws-tcg\.com|\/api\/images\/onepiece/.test(u);
  const nameOf=c=>String(c.nameZh||c.nameJa||c.nameEn||c.name||'').replace(/\s*\[[^\]]*\]$/,'');
  const loads=src=>new Promise(res=>{const i=new Image(),t=setTimeout(()=>res(false),5000);i.onload=()=>{clearTimeout(t);res(i.naturalWidth>40)};i.onerror=()=>{clearTimeout(t);res(false)};i.src=src});
  // 航海王、芙莉蓮只有印著 SAMPLE 的官方圖，所以只從這三個 IP 選；排球少年同角色的各稀有度是同一張圖 → 最多一張
  const CAP={pokemon:3,yugioh:3,haikyuu:1};
  async function pickCards(){
    const lists=await Promise.all(Object.keys(CAP).map(g=>fetch(`/api/cards?game=${g}&limit=40&sort=rarity-desc`).then(r=>r.ok?r.json():null).then(j=>{
      // 同名（同角色、多半同一張圖）只留最高稀有度；稀有度沒出現過的排前面，避免兩張長得一樣的全金卡並排
      const names=new Set(),rars=new Set();
      const rows=(j?.data||[]).map(c=>({id:c.id,game:g,name:nameOf(c),rarity:String(c.rarity||'').trim(),src:imgOf(c)})).filter(c=>c.src&&!sampled(c.src)&&!names.has(c.name)&&names.add(c.name));
      const first=rows.filter(c=>!rars.has(c.rarity)&&rars.add(c.rarity));
      return [...first,...rows.filter(c=>!first.includes(c))].slice(0,CAP[g]+1);
    }).catch(()=>[])));
    const cand=[0,1,2,3].flatMap(k=>lists.map(l=>l[k]).filter(Boolean)),ok=await Promise.all(cand.map(c=>loads(c.src))),count={},out=[];
    cand.forEach((c,i)=>{if(ok[i]&&out.length<4&&(count[c.game]||0)<CAP[c.game]){count[c.game]=(count[c.game]||0)+1;out.push(c)}});
    return out;
  }
  // 580×380 的「手牌」區：兔子卡居中在最前，4 張卡像握在手上的牌往兩側展開（cx,cy 為卡片中心）
  const ZONE={w:580,h:380},RABBIT={cx:290,cy:190,w:210};
  const POS=[{cx:410,cy:196,w:150,r:9},{cx:170,cy:196,w:150,r:-9},{cx:504,cy:232,w:136,r:18},{cx:76,cy:232,w:136,r:-18}];
  const SPARKLE='M0-6L1.4-1.4 6 0 1.4 1.4 0 6-1.4 1.4-6 0-1.4-1.4Z';
  // 通過各點的平滑曲線（Catmull-Rom 轉三次貝茲）
  const smooth=pts=>pts.reduce((d,p,i)=>{
    if(!i)return`M${p[0]} ${p[1]}`;
    const a=pts[i-2]||pts[i-1],b=pts[i-1],c=p,e=pts[i+1]||p;
    return d+` C${b[0]+(c[0]-a[0])/6} ${b[1]+(c[1]-a[1])/6} ${c[0]-(e[0]-b[0])/6} ${c[1]-(e[1]-b[1])/6} ${c[0]} ${c[1]}`;
  },'');
  /* 兔子形象圖：進場跳進來、星星閃爍、偶爾一道流星、游標傾斜卡面與光澤（這是 CardScope 自己的插畫，不是卡圖） */
  const lively=()=>matchMedia('(prefers-reduced-motion:no-preference)').matches&&!root.hasAttribute('data-cs-paused');
  function runComet(comet){if(!comet||!lively())return;comet.classList.remove('go');void comet.offsetWidth;comet.classList.add('go')}
  function decorateRabbit(art){
    const img=art.querySelector('img');if(!img||art.querySelector('.cs1-tilt'))return;
    const tilt=el('span','cs1-tilt');img.before(tilt);tilt.append(img,el('span','cs1-sheen'));
    // 星點落在星空處，避開兔子本體
    [[18,14,0],[72,8,.9],[88,30,1.7],[10,46,2.4],[30,70,.5],[84,84,1.3],[16,90,3]].forEach(([x,y,d])=>{const t=el('span','cs1-twinkle');t.style.cssText=`left:${x}%;top:${y}%;--d:${d}s`;tilt.append(t)});
    tilt.append(el('span','cs1-shoot'));
    const fine=matchMedia('(hover:hover) and (pointer:fine)');let raf=0;
    art.addEventListener('pointermove',e=>{
      if(!fine.matches||!lively()||raf)return;
      raf=requestAnimationFrame(()=>{raf=0;const r=art.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
        tilt.style.setProperty('--tx',((x-.5)*12).toFixed(2)+'deg');tilt.style.setProperty('--ty',((.5-y)*10).toFixed(2)+'deg');tilt.style.setProperty('--sx',(x*100).toFixed(1)+'%');tilt.style.setProperty('--sy',(y*100).toFixed(1)+'%')});
    });
    art.addEventListener('pointerenter',()=>{if(fine.matches)runComet($('.cs1-comet'))});
    art.addEventListener('pointerleave',()=>{['--tx','--ty'].forEach(k=>tilt.style.setProperty(k,'0deg'))});
  }
  let lastCard=null;
  function openCard(c,btn){
    lastCard=btn;
    if(typeof window.openCard==='function')window.openCard(c.id);else location.href=`/?game=${encodeURIComponent(c.game)}&card=${encodeURIComponent(c.id)}`;
  }
  function cardBtn(c,i,pos){
    const b=el('button','cs1-card'),f=el('span','cs1-float'),im=el('img'),cap=el('span','cs1-cap',[GAME_NAME[c.game],c.rarity].filter(Boolean).join(' · '));
    b.type='button';b.setAttribute('aria-label',`開啟 ${c.name||'這張卡'}（${GAME_NAME[c.game]||''}${c.rarity?' '+c.rarity:''}）的卡片詳細資料`);b.style.setProperty('--i',i);
    if(pos){
      const h=pos.w*88/63;
      b.style.setProperty('--x',(pos.cx-pos.w/2)+'px');b.style.setProperty('--y',(pos.cy-h/2)+'px');b.style.setProperty('--w',pos.w+'px');b.style.setProperty('--r',pos.r+'deg');
      // 進場：從兔子卡背後收成一疊，再像發牌一樣往兩側攤開
      b.style.setProperty('--fx',(RABBIT.cx-pos.cx)+'px');b.style.setProperty('--fy',(RABBIT.cy-pos.cy)+'px');b.style.setProperty('--fr',(-pos.r)+'deg');
      b.style.zIndex=String(4-Math.floor(i/2));
    }
    cap.setAttribute('aria-hidden','true');
    im.src=c.src;im.alt='';im.decoding='async';f.append(im);b.append(f,cap);b.onclick=()=>openCard(c,b);return b;
  }
  function buildCards(cards){
    const hero=$('#hero'),intro=$('.hero-intro'),art=$('.hero-art');
    if(!hero||!intro||$('.cs1-fan'))return;
    const real=cards.length>=2;
    const NS='http://www.w3.org/2000/svg',fan=el('div','cs1-fan'),svg=doc.createElementNS(NS,'svg');
    if(real){fan.setAttribute('role','group');fan.setAttribute('aria-label','精選高稀有度卡片')}
    svg.setAttribute('viewBox',`0 0 ${ZONE.w} ${ZONE.h}`);svg.setAttribute('aria-hidden','true');
    // 一道星軌像皇冠一樣跨過整手牌的上緣，左右各收成一顆星
    const pts=[[8,128],[96,62],[200,24],[290,6],[380,24],[484,62],[572,128]];
    svg.innerHTML=`<defs><linearGradient id="cs1-trail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${ZONE.w}" y2="0"><stop offset="0" stop-color="#E7BA4C" stop-opacity=".1"/><stop offset=".5" stop-color="#E7BA4C" stop-opacity=".8"/><stop offset="1" stop-color="#E7BA4C" stop-opacity=".1"/></linearGradient></defs>`
      +`<path class="cs1-trail" d="${smooth(pts)}" pathLength="1"/>`
      +pts.map((p,i)=>`<path class="cs1-spark${i===3?' cs1-spark-end':''}" style="--i:${Math.abs(i-3)}" d="${SPARKLE}" transform="translate(${p[0]} ${p[1]}) scale(${i===3?1.5:1-Math.abs(i-3)*.15})"/>`).join('');
    const comet=el('span','cs1-comet');comet.style.offsetPath=`path("${smooth(pts)}")`;
    fan.append(svg,comet);
    if(real)cards.forEach((c,i)=>fan.append(cardBtn(c,i,POS[i])));
    hero.append(fan);
    // 兔子卡在寬螢幕時搬進手牌區當主角，窄一點就放回原位
    if(art){
      const home=art.parentElement,next=art.nextSibling,wide=matchMedia('(min-width:1200px)');
      const place=()=>{if(wide.matches){if(art.parentElement!==fan)fan.append(art)}else if(art.parentElement!==home)home.insertBefore(art,next)};
      place();wide.addEventListener('change',place);decorateRabbit(art);
    }
    if(root.classList.contains('cs1-play'))setTimeout(()=>runComet(comet),1700);
    if(!real)return;
    // 精確指標的桌面：游標移動時整手牌跟著輕微偏移（視差）
    const fine=matchMedia('(hover:hover) and (pointer:fine)');let raf=0;
    hero.addEventListener('pointermove',e=>{
      if(!fine.matches||!lively()||raf)return;
      raf=requestAnimationFrame(()=>{raf=0;const r=hero.getBoundingClientRect();fan.style.setProperty('--px',((e.clientX-r.left)/r.width*2-1).toFixed(3));fan.style.setProperty('--py',((e.clientY-r.top)/r.height*2-1).toFixed(3))});
    });
    hero.addEventListener('pointerleave',()=>{fan.style.setProperty('--px',0);fan.style.setProperty('--py',0)});
    const strip=el('div','cs1-strip');strip.setAttribute('role','group');strip.setAttribute('aria-label','精選高稀有度卡片');
    // 手機和桌面同一個構圖：兔子卡居中、兩側各一張
    const bunny=el('span','cs1-card cs1-strip-rabbit'),bf=el('span','cs1-float'),bi=el('img');
    bunny.setAttribute('aria-hidden','true');bunny.style.setProperty('--i',1);bi.src='/assets/brand/web/rabbit-explore.webp';bi.alt='';bf.append(bi);bunny.append(bf);
    strip.append(cardBtn(cards[0],0),bunny,cardBtn(cards[1],2));
    intro.append(strip,$('.cs1-replay-m')||'');
    // 關閉詳細頁後焦點回到被點的卡
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
