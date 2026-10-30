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
  // 純函式：API 回應 → 可選的線。重複走勢併成一個選項；已停更的來源（例如只記到某天的 TCGplayer）在有其他線時不列。
  function model(history,market,options={}){
    const records=Array.isArray(market?.records)?market.records:[],find=(item,type)=>records.find(r=>r.priceType===type&&r.market===SOURCES[item.provider]?.market&&(r.variant||'')===(item.variant||'')&&(!r.cardId||r.cardId===item.cardId));
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
    for(let time=points[0].time;time<=points.at(-1).time;time+=DAY_MS){while(at+1<points.length&&points[at+1].time<=time)at++;days.push({time,twd:points[at].twd,fresh:points[at].time===time,from:points[at].time,observedAt:points[at].observedAt||null})}
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

  const motionOff=()=>{if(root.matchMedia?.('(prefers-reduced-motion:reduce)').matches)return true;try{return /^(1|true)$/.test(root.localStorage.getItem('cardscope-motion-paused')||'')}catch{return false}};
  const PLAY='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z" fill="currentColor"/></svg>',PAUSE='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h4v14H5zM11 3h4v14h-4z" fill="currentColor"/></svg>';

  function mount(slot,lines,options){
    const off=motionOff(),notes=options.shared?'<div class="ptl-warn">這張卡的價格和其他卡共用同一筆商品資料，可能不是這張卡自己的價格。</div>':'';
    let line=lines[0],start=0,shownStart=0,index=0,shown=0,timer=0,tween=0,rest=0,dragging=false,zoom=0;
    slot.innerHTML=`<div class="ptl-head">${options.image?`<img class="ptl-mini" src="${esc(options.image)}" alt="">`:''}<div class="ptl-readout"><div class="ptl-when" data-r="when"></div><div class="ptl-big" data-r="big"></div><div class="ptl-say" data-r="say" aria-live="polite"></div><div class="ptl-held" data-r="held"></div></div></div>${lines.length>1?`<div class="ptl-row" data-r="lines" role="group" aria-label="選擇版本">${lines.map((item,i)=>`<button type="button" class="ptl-chip${i?'':' on'}" data-line="${i}" aria-pressed="${!i}">${esc(item.label)}</button>`).join('')}</div>`:''}<div data-r="trend"><div class="ptl-chart" data-r="chart"><svg data-r="svg" aria-hidden="true"></svg></div><div class="ptl-controls"><button type="button" class="ptl-play" data-r="play"></button><input data-r="range" type="range" aria-label="拖動時間軸選日期"></div><div class="ptl-ends"><span data-r="endA"></span><span data-r="endZ"></span></div><div class="ptl-row" data-r="ranges"></div><div class="ptl-row" data-r="jumps"></div><div class="ptl-events" data-r="events"></div></div><div data-r="short" class="ptl-short" hidden>才剛開始記錄這張卡的價格，還看不出漲跌。</div><div data-r="low"></div>${notes}<p class="ptl-plain" data-r="plain"></p>`;
    const $=name=>slot.querySelector(`[data-r="${name}"]`),cards=[...(options.cards||[]),slot.querySelector('.ptl-mini')].filter(Boolean),pad={l:66,r:14,t:32,b:26},events=options.events||[];
    const last=()=>line.days.length-1;
    const geometry=()=>{const W=$('chart').clientWidth||500,H=$('svg').clientHeight||200,values=line.days.slice(start).map(d=>d.twd),lo=Math.min(...values),hi=Math.max(...values),margin=(hi-lo||hi*.1)*.12;return {W,H,lo,hi,x:i=>pad.l+(W-pad.l-pad.r)*(i-shownStart)/Math.max(last()-shownStart,1),y:v=>pad.t+(H-pad.t-pad.b)*(1-(v-(lo-margin))/((hi+margin)-(lo-margin)))}};
    const path=(g,from,to)=>{let d='';for(let i=from;i<=to;i++){const x=g.x(i).toFixed(1),y=g.y(line.days[i].twd).toFixed(1);d+=i===from?`M${x} ${y}`:`L${x} ${g.y(line.days[i-1].twd).toFixed(1)}L${x} ${y}`}return d};
    function draw(){
      if(line.days.length<2)return;
      const g=geometry(),from=Math.max(0,Math.floor(shownStart)),whole=path(g,from,last()),base=g.H-pad.b,day=line.days[index],gx=g.x(index),label=`${md(day.time)}  ${ntd(day.twd)}`,bw=label.length*7.6+16,bx=Math.max(pad.l,Math.min(g.W-pad.r-bw,gx-bw/2)),yTicks=g.hi===g.lo?[g.hi]:[g.hi,(g.hi+g.lo)/2,g.lo],grid=yTicks.map(v=>`<line class="ptl-grid" x1="${pad.l}" x2="${g.W-pad.r}" y1="${g.y(v).toFixed(1)}" y2="${g.y(v).toFixed(1)}"/><text class="ptl-axis" x="${pad.l-6}" y="${(g.y(v)+4).toFixed(1)}" text-anchor="end">${esc(ntd(v))}</text>`).join(''),xTicks=dateTicks(Math.max(from,Math.ceil(shownStart)),last(),g.W<420?3:5).map((i,n,all)=>`<text class="ptl-axis" x="${g.x(i).toFixed(1)}" y="${g.H-6}" text-anchor="${n?n===all.length-1?'end':'middle':'start'}">${md(line.days[i].time)}</text>`).join(''),flags=eventsIn(events,line.days,from).filter(event=>event.index>=0).map(event=>{const x=g.x(event.index).toFixed(1);return `<line class="ptl-event-line" x1="${x}" x2="${x}" y1="${pad.t}" y2="${base}"/><path class="ptl-event" d="M${x} ${base-7}l6 7l-6 7l-6-7z"/>`}).join(''),dots=line.days.map((d,i)=>d.fresh&&i>=from?`<circle class="ptl-rec" cx="${g.x(i).toFixed(1)}" cy="${g.y(d.twd).toFixed(1)}" r="3"/>`:'').join('');
      $('svg').innerHTML=`${grid}${xTicks}<path class="ptl-area" d="${whole}L${g.x(last()).toFixed(1)} ${base}L${g.x(from).toFixed(1)} ${base}Z"/><path class="ptl-line" d="${whole}"/><path class="ptl-past" d="${path(g,from,Math.max(from,index))}"/>${dots}${flags}<line class="ptl-guide" x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="26" y2="${base}"/><circle class="ptl-dot" cx="${g.x(index).toFixed(1)}" cy="${g.y(line.days[index].twd).toFixed(1)}" r="8"/><rect class="ptl-tip" x="${bx.toFixed(1)}" y="2" width="${bw.toFixed(1)}" height="24" rx="4"/><text class="ptl-tip-text" x="${(bx+bw/2).toFixed(1)}" y="19" text-anchor="middle">${esc(label)}</text>`;
    }
    function setNumber(value,animate){root.cancelAnimationFrame(tween);if(!animate||off){shown=value;$('big').textContent=ntd(value);return}const from=shown,t0=root.performance.now();const step=t=>{const k=Math.min((t-t0)/260,1);shown=from+(value-from)*(1-(1-k)**3);$('big').textContent=ntd(shown);if(k<1)tween=root.requestAnimationFrame(step)};tween=root.requestAnimationFrame(step)}
    function select(i,animate=false){
      index=Math.max(start,Math.min(last(),i));const day=line.days[index],compare=compareText(line.days[start],day);
      $('when').textContent=`${dayText(day.time)}${index===last()?'（最新）':''}`;setNumber(day.twd,animate);
      $('say').className=`ptl-say ${compare.tone}`;$('say').textContent=line.days.length>1?compare.text:'';const updated=sourceTime(day.observedAt);$('held').textContent=day.fresh?(updated?`來源更新 ${updated}（台北時間）`:''):`這天沒有新紀錄，沿用 ${md(day.from)} 的價格`;for(const item of $('events').querySelectorAll('[data-i]'))item.classList.toggle('on',Number(item.dataset.i)===index);$('range').value=index;
      // 動的時候卡片跟著轉一點點，停下就回正，卡面才清楚
      if(!off&&line.days.length>1){const turn=((index-start)/Math.max(last()-start,1)-.5)*8;for(const card of cards)card.style.transform=`perspective(900px) rotateY(${turn}deg)`;root.clearTimeout(rest);rest=root.setTimeout(()=>{for(const card of cards)card.style.transform=''},500)}
      draw();
    }
    function stop(){root.clearInterval(timer);timer=0;$('play').innerHTML=PLAY;$('play').setAttribute('aria-label','播放價格變化')}
    function play(){if(timer)return stop();if(index>=last())select(start);$('play').innerHTML=PAUSE;$('play').setAttribute('aria-label','暫停');timer=root.setInterval(()=>{if(!slot.isConnected||index>=last())return stop();select(index+1,true)},Math.max(120,Math.min(420,5000/line.days.length)))}
    function jumps(){$('jumps').innerHTML=highlights(line.days,start).map(item=>`<button type="button" class="ptl-chip ptl-jump" data-i="${item.index}">${esc(item.text)}</button>`).join('')}
    function listEvents(){const items=eventsIn(events,line.days,start);$('events').innerHTML=items.length?`<h4>同期時事</h4><ul>${items.map(item=>`<li>${item.index>=0?`<button type="button" class="ptl-event-day" data-i="${item.index}">${esc(item.date.slice(5))}</button>`:`<span class="ptl-event-day soon">${esc(item.date.slice(5))} 即將</span>`}<span>${esc(item.title)}</span><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a></li>`).join('')}</ul><p>整個遊戲或系列的消息，不是這張卡專屬，也不代表造成圖上的漲跌。</p>`:''}
    function setRange(days){stop();const target=days?Math.max(0,last()-days):0;start=target;$('range').min=start;$('endA').textContent=md(line.days[start].time);jumps();listEvents();root.cancelAnimationFrame(zoom);const from=shownStart,t0=root.performance.now();const anim=t=>{const k=off?1:Math.min((t-t0)/320,1);shownStart=from+(target-from)*(1-(1-k)**3);select(index);if(k<1)zoom=root.requestAnimationFrame(anim)};zoom=root.requestAnimationFrame(anim)}
    function setLine(next){
      stop();line=next;start=0;shownStart=0;const hasTrend=line.days.length>1;$('trend').hidden=!hasTrend;$('short').hidden=hasTrend;
      const source=SOURCES[line.provider]||{seller:'',plain:line.provider};
      const latest=line.days.at(-1).twd,now=[['最新參考價',latest],['近 7 天平均',line.avg7],['近 30 天平均',line.avg30],[`${source.seller}賣家最低賣`,line.low]].filter(item=>item[1]!=null),versus=versusAverage(latest,line.avg30);
      $('low').innerHTML=`<div class="ptl-now"><h4>現在行情</h4><dl>${now.map(item=>`<div><dt>${esc(item[0])}</dt><dd>${esc(ntd(item[1]))}</dd></div>`).join('')}</dl>${versus?`<p>${esc(versus)}</p>`:''}${line.avg30?'<small>平均是 Cardmarket 提供的數字，它沒有公開是否只算成交。</small>':''}</div>`+(line.gap?`<div class="ptl-warn">最低賣價和參考價差約 ${line.gap} 倍，這個數字可能不太準，兩個一起看。</div>`:'');
      $('plain').textContent=`這是${source.plain}的價格換算，不是台灣賣場價，也不是實際成交價。`;
      $('range').min=0;$('range').max=last();$('endA').textContent=md(line.days[0].time);$('endZ').textContent=md(line.days.at(-1).time);
      const ranges=rangeOptions(line.days.length);$('ranges').innerHTML=ranges.map((item,i)=>`<button type="button" class="ptl-chip${i===ranges.length-1?' on':''}" data-days="${item.days}">${esc(item.label)}</button>`).join('');
      jumps();listEvents();select(last());
    }
    function fromPointer(event){const rect=$('chart').getBoundingClientRect(),g=geometry();select(Math.round(shownStart+(event.clientX-rect.left-pad.l)/(g.W-pad.l-pad.r)*(last()-shownStart)))}
    const chart=$('chart');
    chart.addEventListener('pointerdown',event=>{stop();dragging=true;chart.setPointerCapture?.(event.pointerId);fromPointer(event)});
    chart.addEventListener('pointermove',event=>{if(dragging||(event.pointerType==='mouse'&&!timer))fromPointer(event)});
    for(const type of ['pointerup','pointercancel'])chart.addEventListener(type,()=>{dragging=false});
    $('range').addEventListener('input',event=>{stop();select(Number(event.target.value))});
    // 方向鍵在時間軸上是換日期，不能冒泡到詳細頁變成換卡
    $('range').addEventListener('keydown',event=>{if(/^Arrow|^Home$|^End$/.test(event.key))event.stopPropagation()});
    $('play').addEventListener('click',play);
    $('ranges').addEventListener('click',event=>{const button=event.target.closest('[data-days]');if(!button)return;for(const chip of $('ranges').children)chip.classList.toggle('on',chip===button);setRange(Number(button.dataset.days))});
    $('jumps').addEventListener('click',event=>{const button=event.target.closest('[data-i]');if(button){stop();select(Number(button.dataset.i),true)}});
    $('events').addEventListener('click',event=>{const button=event.target.closest('[data-i]');if(button){stop();select(Number(button.dataset.i),true)}});
    $('lines')?.addEventListener('click',event=>{const button=event.target.closest('[data-line]');if(!button)return;for(const chip of $('lines').children){const on=chip===button;chip.classList.toggle('on',on);chip.setAttribute('aria-pressed',String(on))}setLine(lines[Number(button.dataset.line)])});
    if(typeof root.ResizeObserver==='function')new root.ResizeObserver(draw).observe(chart);
    setLine(line);
    // 進場從起點播到最新；關閉動態時直接停在最新
    if(!off&&line.days.length>1){select(start);root.setTimeout(()=>{if(slot.isConnected&&!dragging&&index===start)play()},400)}
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
    mount(slot,lines,{...options,events:history.meta?.events});
  }

  root.PriceTimeline={versusAverage,model,expand,compareText,highlights,rangeOptions,eventsIn,dateTicks,dayText,sourceTime,load};
})(typeof window!=='undefined'?window:globalThis);
