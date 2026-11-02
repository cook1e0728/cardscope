// 價格分頁的互動時間軸（ADR 0042 的讀取端）：把 /api/cards/:id/price-history 與 market 回應畫成「可拖動日期、數字跟著變」的走勢。
// 只是平台參考價，不是成交價或台灣行情。每條線只屬於一張實體卡＋來源＋版本，不合併；走勢完全相同的版本才併成一個選項。
// 快照只在價格變動時才寫，沒紀錄的日子沿用前一筆並照實標示，所以線是階梯，不是推測的斜線。
(root=>{
  const DAY_MS=86400000,STALE_DAYS=7,MIN_LOW=0.1,GAP_RATIO=3;
  const SOURCES={cardmarket:{market:'Cardmarket',seller:'歐洲',plain:'歐洲 Cardmarket'},tcgplayer:{market:'TCGplayer',seller:'美國',plain:'美國 TCGplayer'}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const ms=date=>{const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(date||''));return match?Date.UTC(+match[1],+match[2]-1,+match[3]):NaN};
  const iso=time=>new Date(time).toISOString().slice(0,10),md=time=>iso(time).slice(5);
  const ntd=value=>`NT$ ${Math.round(Number(value)).toLocaleString('en-US')}`;
  const dayText=time=>`${iso(time)}（${'日一二三四五六'[new Date(time).getUTCDay()]}）`;
  // 來源標的更新時間，固定用台北時間；封存的舊紀錄沒有時間就不顯示
  const sourceTime=value=>{const time=new Date(value||NaN);if(Number.isNaN(time.getTime()))return '';const taipei=new Date(time.getTime()+8*3600000).toISOString();return `${taipei.slice(5,10)} ${taipei.slice(11,16)}`};

  // 純函式：一條線的紀錄（依日期排序、同日取最後一筆，並接上比快照新的即時價）。
  function linePoints(item,live){
    const byDate=new Map();
    for(const point of Array.isArray(item?.points)?item.points:[]){const time=ms(point?.date),twd=Number(point?.amountTwd);if(Number.isFinite(time)&&point?.amountTwd!=null&&Number.isFinite(twd)&&twd>0)byDate.set(time,{time,twd,amount:Number(point.amount),observedAt:point.observedAt||null})}
    // 即時價的日期算台北時間，才會和畫面上的來源更新時間同一天
    const observed=new Date(live?.observedAt||NaN).getTime(),liveTime=Number.isNaN(observed)?NaN:ms(new Date(observed+8*3600000).toISOString()),liveTwd=Number(live?.priceTwd);
    if(live&&Number.isFinite(liveTime)&&Number.isFinite(liveTwd)&&liveTwd>0&&!(Math.max(0,...byDate.keys())>liveTime))byDate.set(liveTime,{time:liveTime,twd:liveTwd,amount:Number(live.amount),observedAt:live.observedAt});
    return [...byDate.values()].sort((a,b)=>a.time-b.time);
  }
  const findRecord=(records,item,type)=>records.find(r=>r.priceType===type&&r.market===SOURCES[item.provider]?.market&&(r.variant||'')===(item.variant||'')&&(!r.cardId||r.cardId===item.cardId));
  // 純函式：API 回應 → 可選的線。重複走勢併成一個選項；已停更的來源（例如只記到某天的 TCGplayer）在有其他線時不列。
  function model(history,market,options={}){
    const records=Array.isArray(market?.records)?market.records:[],find=(item,type)=>findRecord(records,item,type);
    let lines=(Array.isArray(history?.series)?history.series:[]).map(item=>{
      const current=find(item,'market'),low=find(item,'listing'),points=linePoints(item,current),amount=Number(points.at(-1)?.amount),lowAmount=Number(low?.amount);
      const rate=Number(current?.priceTwd)/Number(current?.amount),average=value=>Number(value)>=MIN_LOW&&rate>0?Math.round(Number(value)*rate):null;
      return {avg7:average(current?.avg7),avg30:average(current?.avg30),cardId:item.cardId,region:item.region,provider:item.provider,variants:[item.variant||''],points,low:low&&lowAmount>=MIN_LOW&&low.priceTwd!=null?Number(low.priceTwd):null,gap:low&&lowAmount>=MIN_LOW&&amount/lowAmount>=GAP_RATIO?Math.round(amount/lowAmount):0,currency:item.currency,observedAt:current?.observedAt||null};
    }).filter(line=>line.points.length);
    if(lines.some(line=>line.points.length>=2))lines=lines.filter(line=>line.points.length>=2);
    const newest=Math.max(...lines.map(line=>line.points.at(-1).time),0);
    lines=lines.filter(line=>newest-line.points.at(-1).time<STALE_DAYS*DAY_MS);
    const merged=new Map();
    for(const line of lines){const key=JSON.stringify([line.cardId,line.provider,line.points.map(p=>[p.time,p.twd])]),same=merged.get(key);if(same)same.variants.push(...line.variants);else merged.set(key,line)}
    const out=[...merged.values()],regions=new Set(out.map(line=>line.region)),sources=new Set(out.map(line=>line.provider));
    for(const line of out){
      const variant=line.variants.map(v=>v&&(options.variantLabel?options.variantLabel(v):v)).filter(Boolean).join('／');
      line.label=[regions.size>1&&(options.regionLabel?options.regionLabel(line.region):line.region),sources.size>1&&SOURCES[line.provider]?.market,variant].filter(Boolean).join(' · ')||'參考價';
      line.days=expand(line.points);
    }
    return out;
  }
  // 純函式：每天一個點，沒紀錄的日子沿用前一筆。
  function expand(points){
    const days=[];let at=0;
    for(let time=points[0].time;time<=points.at(-1).time;time+=DAY_MS){while(at+1<points.length&&points[at+1].time<=time)at++;days.push({time,twd:points[at].twd,fresh:points[at].time===time,from:points[at].time,observedAt:points[at].observedAt||null,amount:points[at].amount})}
    return days;
  }
  // 純函式：和範圍起點相比的白話句。
  function compareText(start,current){
    const diff=current.twd-start.twd,pct=Math.round(Math.abs(diff)/start.twd*100),label=md(start.time);
    if(current.time===start.time)return {tone:'flat',text:`這是 ${label} 的起點`};
    if(!diff)return {tone:'flat',text:`和 ${label} 一樣`};
    return diff<0?{tone:'down',text:`比 ${label} 便宜 ${ntd(-diff)}（↓ ${pct}%）`}:{tone:'up',text:`比 ${label} 貴 ${ntd(diff)}（↑ ${pct}%）`};
  }
  // 純函式：這段範圍的重點日。
  function highlights(days,start){
    let worst=-1,hi=start,lo=start;
    for(let i=start;i<days.length;i++){if(days[i].twd>days[hi].twd)hi=i;if(days[i].twd<days[lo].twd)lo=i;if(i>start&&days[i].twd<days[i-1].twd&&(worst<0||days[i].twd-days[i-1].twd<days[worst].twd-days[worst-1].twd))worst=i}
    return [worst>=0&&{index:worst,text:`跌最多的一天 ${md(days[worst].time)}（−${ntd(days[worst-1].twd-days[worst].twd)}）`},days[hi].twd!==days[lo].twd&&{index:hi,text:`最高 ${ntd(days[hi].twd)}`},days[hi].twd!==days[lo].twd&&{index:lo,text:`最低 ${ntd(days[lo].twd)}`}].filter(Boolean);
  }
  // 純函式：範圍選項（資料夠長才出現）。
  const rangeOptions=count=>[count>8&&{days:7,label:'近 7 天'},count>31&&{days:30,label:'近 30 天'},count>8&&{days:0,label:'全部'}].filter(Boolean);

  // 純函式：最新價和近 30 天平均相比的白話句；差不到 5% 算差不多。
  function versusAverage(twd,avg30){if(!avg30)return '';const pct=Math.round((twd-avg30)/avg30*100);return Math.abs(pct)<5?'和近 30 天平均差不多':pct>0?`比近 30 天平均貴 ${pct}%，可能剛被拉高，別只看這個數字`:`比近 30 天平均便宜 ${-pct}%`}
  // 純函式：事件分成圖上範圍內（可跳過去）和最新一天之後（即將發生）。
  function eventsIn(events,days,start){const items=[];for(const event of Array.isArray(events)?events:[]){const time=ms(event?.date);if(!Number.isFinite(time)||!/^https:\/\//.test(String(event.url||'')))continue;const index=days.findIndex(day=>day.time===time);if(index>=start)items.push({...event,index});else if(time>days.at(-1).time)items.push({...event,index:-1})}return items}
  // 純函式：X 軸日期刻度的位置，頭尾都有、不重複。
  const dateTicks=(from,to,count)=>[...new Set(Array.from({length:count},(_,i)=>Math.round(from+(to-from)*i/(count-1))))];

  // 純函式：播放一段要多久。進場只掃過一次，要短，才不會擋住要看的數字；按播放才慢慢看。
  const sweepMs=(steps,quick)=>quick?Math.max(700,Math.min(1600,steps*60)):Math.max(1800,Math.min(6000,steps*240));

  const SYMBOLS={EUR:'€',USD:'$'},MIN_BARS={week:2,month:3};
  const original=(amount,currency)=>Number.isFinite(Number(amount))?`${SYMBOLS[currency]||`${currency} `}${Number(amount).toFixed(2)}`:'';
  const signed=(diff,base)=>`${diff>=0?'+':'−'}${ntd(Math.abs(diff))}（${diff>=0?'+':'−'}${Math.round(Math.abs(diff)/base*100)}%）`;
  // 純函式：每週（週一起算）或每月一根，由每日參考價算出，不是真實成交。
  function periodBars(days,kind){
    const bars=[];
    for(const day of days){
      const key=kind==='month'?iso(day.time).slice(0,7):iso(day.time-((new Date(day.time).getUTCDay()+6)%7)*DAY_MS);
      let bar=bars.at(-1);
      if(!bar||bar.key!==key){bar={key,first:day.time,last:day.time,open:day.twd,high:day.twd,low:day.twd,close:day.twd};bars.push(bar)}
      bar.last=day.time;bar.high=Math.max(bar.high,day.twd);bar.low=Math.min(bar.low,day.twd);bar.close=day.twd;
    }
    return bars;
  }
  // 純函式：近 n 天平均，天數不夠的位置是 null。
  const movingAverage=(days,n)=>days.map((_,i)=>i+1<n?null:days.slice(i+1-n,i+1).reduce((sum,day)=>sum+day.twd,0)/n);
  // 純函式：相鄰兩筆紀錄差 3 倍以上的最大一次跳動，通常代表成交稀少。
  function biggestJump(points){
    let best=null;
    for(let i=1;i<points.length;i++){const ratio=Math.max(points[i].twd/points[i-1].twd,points[i-1].twd/points[i].twd);if(ratio>=3&&(!best||ratio>best.ratio))best={ratio,time:points[i].time,from:points[i-1].twd,to:points[i].twd}}
    return best;
  }
  // 純函式：每筆紀錄，新的在前。
  const recordRows=(points,currency)=>points.map((point,i)=>({date:dayText(point.time),twd:ntd(point.twd),original:original(point.amount,currency),change:i?signed(point.twd-points[i-1].twd,points[i-1].twd):'第一筆',observed:sourceTime(point.observedAt)})).reverse();
  // 純函式：各平台現況。太久沒更新的價格分開列，不和近期價格放在一起比。
  function platformSummary(history,options={}){
    const records=Array.isArray(options.market?.records)?options.market.records:[],series=(Array.isArray(history?.series)?history.series:[]).map(item=>{const points=linePoints(item,findRecord(records,item,'market'));return {item,last:points.at(-1)}}).filter(row=>row.last&&SOURCES[row.item.provider]);
    const newest=Math.max(...series.map(row=>row.last.time),0),regions=new Set(series.map(row=>row.item.region));
    const rows=series.map(({item,last})=>({provider:item.provider,market:SOURCES[item.provider].market,label:[regions.size>1&&(options.regionLabel?options.regionLabel(item.region):item.region),item.variant?(options.variantLabel?options.variantLabel(item.variant):item.variant):'版本未標示'].filter(Boolean).join(' · '),twd:ntd(last.twd),original:original(last.amount,item.currency),time:last.time,recent:newest-last.time<STALE_DAYS*DAY_MS}));
    const recent=rows.filter(row=>row.recent),stale=rows.filter(row=>!row.recent),names=[...new Set(recent.map(row=>row.market))],stopped=[...new Set(stale.map(row=>row.market))].filter(name=>!names.includes(name));
    const lastOf=name=>md(Math.max(...stale.filter(row=>row.market===name).map(row=>row.time)));
    const text=stopped.length?`目前只有 ${names.join('、')} 是近期價格，${stopped.map(name=>`${name} 停在 ${lastOf(name)}`).join('、')}，不能直接比。`:names.length>1?`${names.join(' 和 ')} 都有近期價格，但市場不同，只能當參考。`:`目前只有 ${names[0]||'一個平台'} 有近期價格。`;
    return {text,recent,stale};
  }
  // 平台搜尋頁，不是該卡的精確商品頁，所以文字要寫「搜尋」。
  const searchUrl=(provider,name)=>provider==='cardmarket'?`https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`:`https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(name)}`;

  const motionOff=()=>{if(root.matchMedia?.('(prefers-reduced-motion:reduce)').matches)return true;try{return /^(1|true)$/.test(root.localStorage.getItem('cardscope-motion-paused')||'')}catch{return false}};
  const PLAY='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z" fill="currentColor"/></svg>',PAUSE='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h4v14H5zM11 3h4v14h-4z" fill="currentColor"/></svg>';

  function mount(slot,lines,options){
    const off=motionOff(),notes=options.shared?'<div class="ptl-warn">這張卡的價格和其他卡共用同一筆商品資料，可能不是這張卡自己的價格。</div>':'';
    let line=lines[0],start=0,shownStart=0,shownLo=0,shownHi=0,index=0,pos=0,dotY=null,pin=null,shown=0,timer=0,tween=0,rest=0,dragging=false,zoom=0,period='day',bars=[],barAt=0;const avgOn={5:true,20:false};
    slot.innerHTML=`<div class="ptl-head">${options.image?`<img class="ptl-mini" src="${esc(options.image)}" alt="">`:''}<div class="ptl-readout"><div class="ptl-when" data-r="when"></div><div class="ptl-big" data-r="big"></div><div class="ptl-say" data-r="say" aria-live="polite"></div><div class="ptl-held" data-r="prev"></div><div class="ptl-held" data-r="held"></div></div></div><p class="ptl-plain" data-r="plain"></p><div data-r="jump"></div>${lines.length>1?`<div class="ptl-row" data-r="lines" role="group" aria-label="選擇版本">${lines.map((item,i)=>`<button type="button" class="ptl-chip${i?'':' on'}" data-line="${i}" aria-pressed="${!i}">${esc(item.label)}</button>`).join('')}</div>`:''}<div data-r="trend"><div class="ptl-row" data-r="period" role="group" aria-label="圖表範圍"><button type="button" class="ptl-chip on" data-period="day" aria-pressed="true">每天</button><button type="button" class="ptl-chip" data-period="week" aria-pressed="false">每週</button><button type="button" class="ptl-chip" data-period="month" aria-pressed="false">每月</button></div><div class="ptl-short" data-r="barNote" hidden></div><div data-r="chartArea"><div class="ptl-chart" data-r="chart"><svg data-r="svg" aria-hidden="true"><g data-r="base"></g><rect class="ptl-band" data-r="band"/><line class="ptl-pin" data-r="pinLine"/><path class="ptl-past" data-r="past"/><line class="ptl-guide" data-r="guide"/><circle class="ptl-ring" data-r="ring" r="8"/><circle class="ptl-dot" data-r="dot" r="8"/><rect class="ptl-tip" data-r="tip" y="2" height="24" rx="4"/><text class="ptl-tip-text" data-r="tipText" y="19" text-anchor="middle"></text></svg></div><div class="ptl-controls"><button type="button" class="ptl-play" data-r="play"></button><input data-r="range" type="range" aria-label="拖動時間軸選日期"></div><div class="ptl-ends"><span data-r="endA"></span><span data-r="endZ"></span></div><p class="ptl-caption" data-r="caption"></p><details class="ptl-bar-detail" data-r="barOnly" hidden><summary>看這段的最高和最低</summary><p data-r="barText"></p></details></div><div data-r="dayOnly"><div class="ptl-row"><button type="button" class="ptl-chip" data-r="pin" aria-pressed="false"></button></div><div class="ptl-row" data-r="avgs" role="group" aria-label="平均線"></div><div class="ptl-row" data-r="ranges"></div><div class="ptl-row" data-r="jumps"></div></div><div class="ptl-events" data-r="events"></div></div><div data-r="short" class="ptl-short" hidden>才剛開始記錄這張卡的價格，還看不出漲跌。</div><div data-r="low"></div>${notes}<div data-r="platforms"></div><div data-r="records"></div>`;
    const $=name=>slot.querySelector(`[data-r="${name}"]`),cards=[...(options.cards||[]),slot.querySelector('.ptl-mini')].filter(Boolean),pad={l:66,r:14,t:32,b:26},events=options.events||[];
    const last=()=>line.days.length-1;
    const domain=()=>{const values=line.days.slice(start).map(d=>d.twd);return [Math.min(...values),Math.max(...values)]};
    const geometry=()=>{const W=$('chart').clientWidth||500,H=$('svg').clientHeight||200,lo=shownLo,hi=shownHi,margin=(hi-lo||hi*.1)*.12;return {W,H,lo,hi,x:i=>pad.l+(W-pad.l-pad.r)*(i-shownStart)/Math.max(last()-shownStart,1),y:v=>pad.t+(H-pad.t-pad.b)*(1-(v-(lo-margin))/((hi+margin)-(lo-margin)))}};
    const attrs=(node,values)=>{for(const key in values)node.setAttribute(key,values[key])};
    const path=(g,from,to)=>{let d='';for(let i=from;i<=to;i++){const x=g.x(i).toFixed(1),y=g.y(line.days[i].twd).toFixed(1);d+=i===from?`M${x} ${y}`:`L${x} ${g.y(line.days[i-1].twd).toFixed(1)}L${x} ${y}`}return d};
    // 底圖（軸、線、紀錄點）只在範圍或尺寸變動時重畫；播放時每格只動讀數頭，手機才跑得順。
    function drawBase(){
      if(line.days.length<2)return;
      if(period!=='day')return drawBars();
      const g=geometry(),from=Math.max(0,Math.ceil(shownStart)),whole=path(g,from,last()),base=g.H-pad.b,yTicks=Math.round(g.hi)===Math.round(g.lo)?[g.hi]:[g.hi,(g.hi+g.lo)/2,g.lo],grid=yTicks.map(v=>`<line class="ptl-grid" x1="${pad.l}" x2="${g.W-pad.r}" y1="${g.y(v).toFixed(1)}" y2="${g.y(v).toFixed(1)}"/><text class="ptl-axis" x="${pad.l-6}" y="${(g.y(v)+4).toFixed(1)}" text-anchor="end">${esc(ntd(v))}</text>`).join(''),xTicks=dateTicks(Math.max(from,Math.ceil(shownStart)),last(),g.W<420?4:g.W<640?6:9).map((i,n,all)=>`<text class="ptl-axis" x="${g.x(i).toFixed(1)}" y="${g.H-6}" text-anchor="${n?n===all.length-1?'end':'middle':'start'}">${md(line.days[i].time)}</text>`).join(''),flags=eventsIn(events,line.days,from).filter(event=>event.index>=0).map(event=>{const x=g.x(event.index).toFixed(1);return `<line class="ptl-event-line" x1="${x}" x2="${x}" y1="${pad.t}" y2="${base}"/><path class="ptl-event" d="M${x} ${base-7}l6 7l-6 7l-6-7z"/>`}).join(''),averages=[5,20].filter(n=>avgOn[n]).map(n=>{let d='';movingAverage(line.days,n).forEach((value,i)=>{if(value!=null&&i>=from)d+=`${d?'L':'M'}${g.x(i).toFixed(1)} ${g.y(value).toFixed(1)}`});return d?`<path class="ptl-ma ptl-ma${n}" d="${d}"/>`:''}).join(''),dots=line.days.map((d,i)=>d.fresh&&i>=from?`<circle class="ptl-rec" cx="${g.x(i).toFixed(1)}" cy="${g.y(d.twd).toFixed(1)}" r="3"/>`:'').join('');
      $('base').innerHTML=`${grid}${xTicks}<path class="ptl-area" d="${whole}L${g.x(last()).toFixed(1)} ${base}L${g.x(from).toFixed(1)} ${base}Z"/><path class="ptl-line" d="${whole}"/>${averages}${dots}${flags}`;
    }
    function drawHead(){
      if(line.days.length<2)return;
      if(period!=='day')return drawBarHead();
      const g=geometry(),from=Math.max(0,Math.ceil(shownStart)),base=g.H-pad.b,at=Math.max(from,Math.min(last(),Math.floor(pos))),x=g.x(Math.max(pos,from)),y=g.y(line.days[at].twd),day=line.days[index],label=`${md(day.time)}  ${ntd(day.twd)}`,bw=label.length*7.6+16,bx=Math.max(pad.l,Math.min(g.W-pad.r-bw,x-bw/2));
      // 播放時圓點追著價格滑過去，線本身仍是階梯；拖動時不延遲，手指到哪就到哪
      dotY=dotY==null||!timer?y:dotY+(y-dotY)*.3;
      attrs($('past'),{d:`${path(g,from,Math.max(from,at))}L${x.toFixed(1)} ${y.toFixed(1)}`});
      attrs($('guide'),{x1:x.toFixed(1),x2:x.toFixed(1),y1:26,y2:base});
      for(const name of ['dot','ring'])attrs($(name),{cx:x.toFixed(1),cy:dotY.toFixed(1)});
      attrs($('tip'),{x:bx.toFixed(1),width:bw.toFixed(1)});attrs($('tipText'),{x:(bx+bw/2).toFixed(1)});$('tipText').textContent=label;
      const pinned=pin!=null&&pin>=from;$('band').style.display=$('pinLine').style.display=pinned?'':'none';
      if(pinned){const px=g.x(pin),diff=day.twd-line.days[pin].twd;attrs($('band'),{x:Math.min(px,x).toFixed(1),width:Math.abs(px-x).toFixed(1),y:pad.t,height:base-pad.t,class:`ptl-band${diff<0?' down':''}`});attrs($('pinLine'),{x1:px.toFixed(1),x2:px.toFixed(1),y1:pad.t,y2:base})}
    }
    const barGeometry=()=>{const W=$('chart').clientWidth||500,H=$('svg').clientHeight||200,lo=Math.min(...bars.map(bar=>bar.low)),hi=Math.max(...bars.map(bar=>bar.high)),margin=(hi-lo||hi*.1)*.12,step=(W-pad.l-pad.r)/bars.length;return {W,H,lo,hi,step,x:i=>pad.l+(i+.5)*step,y:v=>pad.t+(H-pad.t-pad.b)*(1-(v-(lo-margin))/((hi+margin)-(lo-margin)))}};
    function drawBars(){
      if(!bars.length)return;
      const g=barGeometry(),width=Math.min(g.step*.5,44),every=Math.ceil(bars.length/(g.W<420?4:7)),grid=(Math.round(g.hi)===Math.round(g.lo)?[g.hi]:[g.hi,(g.hi+g.lo)/2,g.lo]).map(v=>`<line class="ptl-grid" x1="${pad.l}" x2="${g.W-pad.r}" y1="${g.y(v).toFixed(1)}" y2="${g.y(v).toFixed(1)}"/><text class="ptl-axis" x="${pad.l-6}" y="${(g.y(v)+4).toFixed(1)}" text-anchor="end">${esc(ntd(v))}</text>`).join('');
      $('base').innerHTML=grid+bars.map((bar,i)=>{const x=g.x(i),top=g.y(Math.max(bar.open,bar.close)),bottom=g.y(Math.min(bar.open,bar.close)),tone=bar.close>bar.open?'up':bar.close<bar.open?'down':'flat';return `<line class="ptl-wick ${tone}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${g.y(bar.high).toFixed(1)}" y2="${g.y(bar.low).toFixed(1)}"/><rect class="ptl-body ${tone}" x="${(x-width/2).toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${Math.max(bottom-top,2).toFixed(1)}" rx="2"/>${i%every===0?`<text class="ptl-axis" x="${x.toFixed(1)}" y="${g.H-6}" text-anchor="middle">${esc(period==='month'?`${bar.key.slice(5)} 月`:md(bar.first))}</text>`:''}`}).join('');
    }
    function drawBarHead(){
      const bar=bars[barAt];if(!bar)return;
      const g=barGeometry(),x=g.x(barAt),y=g.y(bar.close),label=`${md(bar.first)}  ${ntd(bar.close)}`,bw=label.length*7.6+16,bx=Math.max(pad.l,Math.min(g.W-pad.r-bw,x-bw/2));
      attrs($('past'),{d:''});$('band').style.display=$('pinLine').style.display='none';
      attrs($('guide'),{x1:x.toFixed(1),x2:x.toFixed(1),y1:26,y2:g.H-pad.b});
      for(const name of ['dot','ring'])attrs($(name),{cx:x.toFixed(1),cy:y.toFixed(1)});
      attrs($('tip'),{x:bx.toFixed(1),width:bw.toFixed(1)});attrs($('tipText'),{x:(bx+bw/2).toFixed(1)});$('tipText').textContent=label;
    }
    function selectBar(i){
      barAt=Math.max(0,Math.min(bars.length-1,i));const bar=bars[barAt],compare=compareText({time:bar.first,twd:bar.open},{time:bar.last,twd:bar.close});
      $('when').textContent=`${period==='month'?'這個月':'這週'} ${md(bar.first)} 到 ${md(bar.last)}`;setNumber(bar.close,true);
      $('say').className=`ptl-say ${compare.tone}`;$('say').textContent=bar.first===bar.last?'這段只有一天':compare.text;$('prev').textContent='';$('held').textContent='由每日參考價算出，不是真實成交紀錄';
      $('barText').textContent=`開頭 ${ntd(bar.open)} · 最高 ${ntd(bar.high)} · 最低 ${ntd(bar.low)} · 結尾 ${ntd(bar.close)}`;$('range').value=barAt;drawBarHead();
    }
    function setPeriod(next){
      stop();period=next;
      for(const chip of $('period').children){const on=chip.dataset.period===next;chip.classList.toggle('on',on);chip.setAttribute('aria-pressed',String(on))}
      const isDay=next==='day';bars=isDay?[]:periodBars(line.days,next);const enough=isDay||bars.length>=MIN_BARS[next];
      $('dayOnly').hidden=!isDay;$('barOnly').hidden=isDay;$('play').hidden=!isDay;$('chartArea').hidden=!enough;$('barNote').hidden=enough;
      if(!enough){$('barNote').textContent=next==='month'?`每月的資料還不夠：目前只有 ${bars.length} 個月，累積到 ${MIN_BARS.month} 個月才會顯示。`:'每週的資料還不夠：目前還不到兩週。';period='day';bars=[];select(last());period=next;return}
      if(isDay){$('caption').textContent='圓點是當天有新紀錄，其他天沿用前一筆。藍線是平均：實線近 5 天，虛線近 20 天。';$('range').min=start;$('range').max=last();$('endA').textContent=md(line.days[start].time);$('endZ').textContent=md(line.days.at(-1).time);select(last());draw();return}
      $('caption').textContent=`每根代表${next==='month'?'一個月':'一週'}：粗的部分是頭尾價格，細線是最高和最低，紅色漲、綠色跌。頭尾兩根可能不滿${next==='month'?'一個月':'一週'}。`;
      $('range').min=0;$('range').max=bars.length-1;$('endA').textContent=md(bars[0].first);$('endZ').textContent=md(bars.at(-1).last);selectBar(bars.length-1);drawBars();
    }
    const draw=()=>{drawBase();drawHead()};
    // 價格變動的那天讓圓點擴散一圈，看得出「這裡動了」；關閉動態時不做
    const pulse=()=>{if(!off)$('ring').animate?.([{transform:'scale(1)',opacity:.6},{transform:'scale(2.6)',opacity:0}],{duration:420,easing:'cubic-bezier(0.23, 1, 0.32, 1)'})};
    function setNumber(value,animate){root.cancelAnimationFrame(tween);if(!animate||off){shown=value;$('big').textContent=ntd(value);return}const from=shown,t0=root.performance.now();const step=t=>{const k=Math.min((t-t0)/260,1);shown=from+(value-from)*(1-(1-k)**3);$('big').textContent=ntd(shown);if(k<1)tween=root.requestAnimationFrame(step)};tween=root.requestAnimationFrame(step)}
    function select(i,animate=false,gliding=false){
      index=Math.max(start,Math.min(last(),i));if(!gliding)pos=index;const day=line.days[index],compare=compareText(line.days[pin??start],day),event=events.find(item=>ms(item?.date)===day.time&&/^https:\/\//.test(String(item.url||'')));
      $('when').textContent=`${dayText(day.time)}${index===last()?'（最新）':''}`;setNumber(day.twd,animate);
      $('say').className=`ptl-say ${compare.tone}`;$('say').textContent=line.days.length>1?compare.text:'';const updated=sourceTime(day.observedAt);$('held').textContent=[day.fresh?(updated?`來源更新 ${updated}（台北時間）`:''):`這天沒有新紀錄，沿用 ${md(day.from)} 的價格`,!day.fresh&&updated?`來源更新 ${updated}（台北時間）`:'',original(day.amount,line.currency),event?`當天：${event.title}`:''].filter(Boolean).join(' · ');const before=index>0?line.days[index-1]:null;$('prev').textContent=before?(day.twd===before.twd?'和前一天一樣':`比前一天 ${signed(day.twd-before.twd,before.twd)}`):'';$('pin').textContent=pin==null?'從這天開始比較':`取消比較（從 ${md(line.days[pin].time)}）`;$('pin').setAttribute('aria-pressed',String(pin!=null));for(const item of $('events').querySelectorAll('[data-i]'))item.classList.toggle('on',Number(item.dataset.i)===index);$('range').value=index;
      // 動的時候卡片跟著轉一點點，停下就回正，卡面才清楚
      if(!off&&line.days.length>1){const turn=((index-start)/Math.max(last()-start,1)-.5)*8;for(const card of cards)card.style.transform=`perspective(900px) rotateY(${turn}deg)`;root.clearTimeout(rest);rest=root.setTimeout(()=>{for(const card of cards)card.style.transform=''},500)}
      drawHead();
    }
    function stop(){root.cancelAnimationFrame(timer);timer=0;$('play').innerHTML=PLAY;$('play').setAttribute('aria-label','播放價格變化')}
    function play(quick=false){
      if(timer){stop();drawHead();return}
      if(quick||index>=last())select(start);
      $('play').innerHTML=PAUSE;$('play').setAttribute('aria-label','暫停');
      const from=index,to=last(),total=sweepMs(to-from,quick),t0=root.performance.now();
      // 位置隨時間連續前進，跨過一天才換讀數；關閉動態時一天一格
      const tick=now=>{
        if(!slot.isConnected)return stop();
        const k=Math.max(0,Math.min((now-t0)/total,1)),exact=from+(to-from)*k,day=Math.floor(exact+1e-6);
        pos=off?day:exact;
        if(day!==index){const moved=line.days[day].twd!==line.days[index].twd;select(day,true,true);if(moved)pulse()}else drawHead();
        if(k<1)timer=root.requestAnimationFrame(tick);else{stop();drawHead()}
      };
      timer=root.requestAnimationFrame(tick);
    }
    function jumps(){$('jumps').innerHTML=highlights(line.days,start).map(item=>`<button type="button" class="ptl-chip ptl-jump" data-i="${item.index}">${esc(item.text)}</button>`).join('')}
    function listEvents(){const items=eventsIn(events,line.days,start);$('events').innerHTML=items.length?`<h4>同期時事</h4><ul>${items.map(item=>`<li>${item.index>=0?`<button type="button" class="ptl-event-day" data-i="${item.index}">${esc(item.date.slice(5))}</button>`:`<span class="ptl-event-day soon">${esc(item.date.slice(5))} 即將</span>`}<span>${esc(item.title)}</span><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a></li>`).join('')}</ul><p>整個遊戲或系列的消息，不是這張卡專屬，也不代表造成圖上的漲跌。</p>`:''}
    // 範圍或版本一換，時間與價格兩個軸一起滑到新位置，看得出是同一條線被放大。
    function moveView(target){root.cancelAnimationFrame(zoom);const [lo,hi]=domain(),fromStart=shownStart,fromLo=shownLo,fromHi=shownHi,t0=root.performance.now();const anim=t=>{if(!slot.isConnected)return;const k=off?1:Math.max(0,Math.min((t-t0)/260,1)),eased=1-(1-k)**3;shownStart=fromStart+(target-fromStart)*eased;shownLo=fromLo+(lo-fromLo)*eased;shownHi=fromHi+(hi-fromHi)*eased;draw();if(k<1)zoom=root.requestAnimationFrame(anim)};zoom=root.requestAnimationFrame(anim)}
    function setRange(days){stop();start=days?Math.max(0,last()-days):0;if(pin!=null&&pin<start)pin=null;$('range').min=start;$('endA').textContent=md(line.days[start].time);jumps();listEvents();select(index);moveView(start)}
    function setLine(next){
      const first=!shownHi;stop();line=next;start=0;shownStart=0;pin=null;period='day';bars=[];if(first)[shownLo,shownHi]=domain();const hasTrend=line.days.length>1;$('trend').hidden=!hasTrend;$('short').hidden=hasTrend;
      const source=SOURCES[line.provider]||{seller:'',plain:line.provider};
      const latest=line.days.at(-1).twd,now=[['最新參考價',latest],['近 7 天平均',line.avg7],['近 30 天平均',line.avg30],[`${source.seller}賣家最低賣`,line.low]].filter(item=>item[1]!=null),versus=versusAverage(latest,line.avg30);
      $('low').innerHTML=`<div class="ptl-now"><h4>現在行情</h4><dl>${now.map(item=>`<div><dt>${esc(item[0])}</dt><dd>${esc(ntd(item[1]))}</dd></div>`).join('')}</dl>${versus?`<p>${esc(versus)}</p>`:''}${line.avg30?'<small>平均是 Cardmarket 提供的數字，它沒有公開是否只算成交。</small>':''}</div>`+(line.gap?`<div class="ptl-warn">最低賣價和參考價差約 ${line.gap} 倍，這個數字可能不太準，兩個一起看。</div>`:'');
      $('plain').textContent=`這是${source.plain} 的價格換算，未分卡況，不是台灣賣場價，也不是實際成交價。`;
      const jump=biggestJump(line.points);$('jump').innerHTML=jump?`<div class="ptl-warn">${esc(md(jump.time))} 這筆從 ${esc(ntd(jump.from))} ${jump.to>jump.from?'跳到':'掉到'} ${esc(ntd(jump.to))}，可能是成交稀少，不代表買賣得到這個價。</div>`:'';
      const avgChip=n=>{const missing=n-line.days.length;if(missing>0)avgOn[n]=false;return `<button type="button" class="ptl-chip ptl-avg${n}${avgOn[n]?' on':''}" data-avg="${n}" aria-pressed="${avgOn[n]}"${missing>0?' disabled':''}>近 ${n} 天平均${missing>0?`：還差 ${missing} 天`:''}</button>`};$('avgs').innerHTML=avgChip(5)+avgChip(20);
      $('records').innerHTML=`<div class="ptl-now"><h4>每筆價格紀錄</h4><small>共 ${line.points.length} 筆，沒列出的日子沒有新紀錄。紀錄日和來源更新可能差一天，時間都是台北時間。</small><div class="ptl-table" role="region" aria-label="每筆價格紀錄，可捲動" tabindex="0"><table><thead><tr><th scope="col">紀錄日</th><th scope="col">新台幣</th><th scope="col">原幣</th><th scope="col">比上一筆</th><th scope="col">來源更新</th></tr></thead><tbody>${recordRows(line.points,line.currency).map(row=>`<tr><td>${esc(row.date)}</td><td><b>${esc(row.twd)}</b></td><td>${esc(row.original||'—')}</td><td>${esc(row.change)}</td><td>${esc(row.observed||'—')}</td></tr>`).join('')}</tbody></table></div></div>`;
      $('range').min=0;$('range').max=last();$('endA').textContent=md(line.days[0].time);$('endZ').textContent=md(line.days.at(-1).time);
      const ranges=rangeOptions(line.days.length);$('ranges').innerHTML=ranges.map((item,i)=>`<button type="button" class="ptl-chip${i===ranges.length-1?' on':''}" data-days="${item.days}">${esc(item.label)}</button>`).join('');
      setPeriod('day');jumps();listEvents();if(first)draw();else moveView(0);
    }
    function fromPointer(event){const rect=$('chart').getBoundingClientRect();if(period!=='day')return selectBar(Math.floor((event.clientX-rect.left-pad.l)/barGeometry().step));const g=geometry();select(Math.round(shownStart+(event.clientX-rect.left-pad.l)/(g.W-pad.l-pad.r)*(last()-shownStart)))}
    const chart=$('chart');
    chart.addEventListener('pointerdown',event=>{stop();dragging=true;chart.setPointerCapture?.(event.pointerId);fromPointer(event)});
    chart.addEventListener('pointermove',event=>{if(dragging||(event.pointerType==='mouse'&&!timer))fromPointer(event)});
    for(const type of ['pointerup','pointercancel'])chart.addEventListener(type,()=>{dragging=false});
    $('range').addEventListener('input',event=>{stop();if(period!=='day')selectBar(Number(event.target.value));else select(Number(event.target.value))});
    // 方向鍵在時間軸上是換日期，不能冒泡到詳細頁變成換卡
    $('range').addEventListener('keydown',event=>{if(/^Arrow|^Home$|^End$/.test(event.key))event.stopPropagation()});
    $('play').addEventListener('click',()=>play());
    $('ranges').addEventListener('click',event=>{const button=event.target.closest('[data-days]');if(!button)return;for(const chip of $('ranges').children)chip.classList.toggle('on',chip===button);setRange(Number(button.dataset.days))});
    $('jumps').addEventListener('click',event=>{const button=event.target.closest('[data-i]');if(button){stop();select(Number(button.dataset.i),true)}});
    $('events').addEventListener('click',event=>{const button=event.target.closest('[data-i]');if(button){if(period!=='day')setPeriod('day');stop();select(Number(button.dataset.i),true)}});
    $('period').addEventListener('click',event=>{const button=event.target.closest('[data-period]');if(button)setPeriod(button.dataset.period)});
    $('avgs').addEventListener('click',event=>{const button=event.target.closest('[data-avg]');if(!button)return;const n=button.dataset.avg;avgOn[n]=!avgOn[n];button.classList.toggle('on',avgOn[n]);button.setAttribute('aria-pressed',String(avgOn[n]));drawBase()});
    $('lines')?.addEventListener('click',event=>{const button=event.target.closest('[data-line]');if(!button)return;for(const chip of $('lines').children){const on=chip===button;chip.classList.toggle('on',on);chip.setAttribute('aria-pressed',String(on))}setLine(lines[Number(button.dataset.line)]);if(!off&&line.days.length>1)play(true)});
    $('pin').addEventListener('click',()=>{stop();pin=pin==null?index:null;select(index)});
    if(typeof root.ResizeObserver==='function')new root.ResizeObserver(draw).observe(chart);
    if(options.platforms?.recent.length){const {text,recent,stale}=options.platforms,link=row=>options.searchName?`<br><a href="${esc(searchUrl(row.provider,options.searchName))}" target="_blank" rel="noopener noreferrer">到 ${esc(row.market)} 搜尋這張</a>`:'';$('platforms').innerHTML=`<div class="ptl-now"><h4>各平台比價</h4><p>${esc(text)}</p><div class="ptl-table" role="region" aria-label="各平台比價，可捲動" tabindex="0"><table><thead><tr><th scope="col">平台與版本</th><th scope="col">新台幣</th><th scope="col">原幣</th><th scope="col">紀錄日</th></tr></thead><tbody>${recent.map(row=>`<tr><td><b>${esc(row.market)}</b> ${esc(row.label)}${link(row)}</td><td><b>${esc(row.twd)}</b></td><td>${esc(row.original||'—')}</td><td>${esc(md(row.time))}</td></tr>`).join('')}</tbody></table></div>${stale.length?`<h4>過期的舊紀錄，僅供參考</h4><ul class="ptl-stale">${stale.map(row=>`<li>${esc(row.market)} ${esc(row.label)}：${esc(row.twd)}${row.original?`（${esc(row.original)}）`:''}，${esc(md(row.time))} 的紀錄</li>`).join('')}</ul>${[...new Map(stale.map(row=>[row.provider,row])).values()].map(row=>options.searchName?`<a href="${esc(searchUrl(row.provider,options.searchName))}" target="_blank" rel="noopener noreferrer">到 ${esc(row.market)} 搜尋這張</a>`:'').join(' ')}`:''}<small>沒有成交量，也沒有台灣行情和鑑定卡價格；不是買賣建議。</small></div>`}
    setLine(line);
    // 進場很快掃過一次，停在最新；關閉動態時直接停在最新
    if(!off&&line.days.length>1){select(start);root.setTimeout(()=>{if(slot.isConnected&&!dragging&&!timer&&period==='day'&&index===start)play(true)},300)}
  }

  // 瀏覽器端：打開價格分頁時才請求；失敗時下次再點會重試。
  async function load(slot,options={}){
    if(!slot||slot.dataset.ptState==='loading'||slot.dataset.ptState==='done')return;
    const cardId=slot.dataset.priceTrend,fetchFn=options.fetchFn||root.fetch.bind(root),alive=()=>slot.isConnected&&slot.dataset.priceTrend===cardId,details=options.details;
    slot.dataset.ptState='loading';slot.innerHTML='<div class="state" role="status">正在讀取價格紀錄…</div>';
    let history=null;
    try{const response=await fetchFn(`/api/cards/${encodeURIComponent(cardId)}/price-history`);if(response.ok)history=await response.json()}catch{history=null}
    if(!alive())return;
    if(!history||history.meta?.unavailable||!Array.isArray(history.series)){slot.dataset.ptState='';slot.innerHTML='<div class="state" role="status">價格走勢暫時無法讀取，不影響其他資料；重新開啟這個分頁會再試一次。</div>';if(details)details.open=true;return}
    slot.dataset.ptState='done';
    const lines=model(history,options.market,options);
    // 沒有紀錄（例如還沒接價格來源的遊戲）時直接展開明細，由明細說明原因
    if(!lines.length){slot.innerHTML='';if(details)details.open=true;return}
    mount(slot,lines,{...options,events:history.meta?.events,platforms:platformSummary(history,options),searchName:(Array.isArray(options.market?.records)?options.market.records:[]).find(record=>record.cardName)?.cardName||''});
  }

  root.PriceTimeline={versusAverage,model,expand,compareText,highlights,rangeOptions,eventsIn,dateTicks,sweepMs,periodBars,movingAverage,biggestJump,recordRows,platformSummary,searchUrl,dayText,sourceTime,load};
})(typeof window!=='undefined'?window:globalThis);
