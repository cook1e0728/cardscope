// 參考價走勢（ADR 0042）：把 /api/cards/:id/price-history 畫成新台幣階梯折線（內嵌 SVG，不用外部圖表函式庫）。
// 只畫平台參考價（標題列出實際有紀錄的來源），不是成交價或台灣行情；每條線只屬於一張實體卡＋來源＋版本，不合併。
// 狀態不只靠顏色：每條線有不同線型與標記形狀，並附圖例與文字摘要表。沒有持續動畫。
(root=>{
  const MAX_LINES=3,DAY_MS=86400000;
  const REGIONS={JP:'日版',TW:'台版',US:'美版',KR:'韓版',CN:'陸版',ASIA:'亞洲英文版'};
  const SOURCES={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
  const DASHES=['','7 4','2 4'],SHAPES=['circle','square','triangle'];
  // 來源名稱依資料實際有的列出（TCGdex 已不再回 TCGplayer，不寫死兩個平台）。
  const sourceNames=series=>[...new Set((Array.isArray(series)?series:[]).map(item=>SOURCES[item?.provider]).filter(Boolean))];
  const titleFor=series=>{const names=sourceNames(series);return `參考價走勢（${names.length?names.join('／')+'，':''}換算新台幣）`};
  const TITLE=titleFor([]);
  const NOTE='平台參考價，不是成交價或台灣行情；新台幣以今日匯率換算，歷史點位不代表當時匯率。階梯線代表價格維持到下一筆紀錄；只在價格變動約 2% 以上或滿 7 天時才新增紀錄。';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const dateMs=value=>{const text=String(value||''),match=/^(\d{4})-(\d{2})-(\d{2})/.exec(text);return match?Date.UTC(+match[1],+match[2]-1,+match[3]):NaN};
  const dateText=ms=>new Date(ms).toISOString().slice(0,10);
  const money=value=>`NT$ ${Math.round(Number(value)).toLocaleString('en-US')}`;
  const original=(amount,currency)=>`${esc(currency)} ${Number(amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // 一條線至少要有 2 個可換算的點才畫；點依日期排序、同日取最後一筆。
  function cleanSeries(series){
    const lines=[];
    for(const item of Array.isArray(series)?series:[]){
      const byDate=new Map();
      for(const point of Array.isArray(item?.points)?item.points:[]){const ms=dateMs(point?.date),twd=Number(point?.amountTwd);if(Number.isFinite(ms)&&point?.amountTwd!=null&&Number.isFinite(twd)&&twd>0)byDate.set(ms,{ms,twd,amount:point.amount})}
      const points=[...byDate.values()].sort((a,b)=>a.ms-b.ms);
      lines.push({cardId:item?.cardId,region:item?.region,provider:item?.provider,variant:item?.variant,currency:item?.currency,points});
    }
    return lines;
  }
  function lineLabel(line,options){
    const region=options.regionLabel?options.regionLabel(line.region):(REGIONS[line.region]||line.region||''),variant=line.variant?(options.variantLabel?options.variantLabel(line.variant):line.variant):'';
    return [region,SOURCES[line.provider]||line.provider,variant].filter(Boolean).join(' · ')||'參考價';
  }
  // 圖上最多 3 條（伺服器已把目前這張卡排在前面、點數多的在前）；同名標籤補上卡片 ID，避免不同卡被看成同一條。
  function plan(history,options={}){
    const all=cleanSeries(history?.series),drawable=all.filter(line=>line.points.length>=2),lines=drawable.slice(0,MAX_LINES);
    const labels=lines.map(line=>lineLabel(line,options));
    lines.forEach((line,index)=>{line.label=labels.filter(x=>x===labels[index]).length>1?`${labels[index]}（${line.cardId}）`:labels[index]});
    const first=all.flatMap(line=>line.points.map(p=>p.ms)).sort((a,b)=>a-b)[0];
    return {lines,omitted:drawable.length-lines.length,sparse:all.filter(line=>line.points.length===1).length,recorded:all.some(line=>line.points.length),firstDate:Number.isFinite(first)?dateText(first):null};
  }

  function niceStep(raw){const exponent=Math.floor(Math.log10(raw)),base=raw/10**exponent;return (base<=1?1:base<=2?2:base<=2.5?2.5:base<=5?5:10)*10**exponent}
  function yScale(values){
    let min=Math.min(...values),max=Math.max(...values);
    if(min===max){const pad=Math.max(1,min*.1);min-=pad;max+=pad}
    const step=niceStep((max-min)/4),lo=Math.max(0,Math.floor(min/step)*step),hi=Math.ceil(max/step)*step,ticks=[];
    for(let tick=lo;tick<=hi+step/2;tick+=step)ticks.push(Math.round(tick*100)/100);
    return {lo,hi:ticks.at(-1),ticks};
  }
  function markerSvg(shape,x,y,title){
    const r=4,tip=title?`<title>${esc(title)}</title>`:'';
    if(shape==='square')return `<rect class="pt-mark" x="${(x-r).toFixed(1)}" y="${(y-r).toFixed(1)}" width="${r*2}" height="${r*2}">${tip}</rect>`;
    if(shape==='triangle')return `<polygon class="pt-mark" points="${x.toFixed(1)},${(y-r-1).toFixed(1)} ${(x+r+1).toFixed(1)},${(y+r).toFixed(1)} ${(x-r-1).toFixed(1)},${(y+r).toFixed(1)}">${tip}</polygon>`;
    return `<circle class="pt-mark" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}">${tip}</circle>`;
  }
  // 圖例用的線型＋標記小圖。
  function keySvg(index){return `<svg class="pt-key pt-s${index+1}" width="34" height="14" viewBox="0 0 34 14" aria-hidden="true" focusable="false"><line class="pt-line pt-d${index}" x1="1" y1="7" x2="33" y2="7"${DASHES[index]?` stroke-dasharray="${DASHES[index]}"`:''}/>${markerSvg(SHAPES[index],17,7)}</svg>`}

  function summaryText(lines){return lines.map(line=>{const a=line.points[0],b=line.points.at(-1);return `${line.label}：${dateText(a.ms)} ${money(a.twd)}，${dateText(b.ms)} ${money(b.twd)}`}).join('；')}
  // 純函式：輸入 plan().lines，輸出 SVG 字串。width 隨容器（以 px 計），字級固定 12px，所以手機上仍可讀。
  function chartSvg(lines,options={}){
    if(!Array.isArray(lines)||!lines.length)return '';
    const width=Math.min(760,Math.max(260,Math.round(Number(options.width)||600))),height=width<420?250:300,id=esc(options.id||'pt'),
      times=lines.flatMap(line=>line.points.map(p=>p.ms)),t0=Math.min(...times),t1=Math.max(...times),y=yScale(lines.flatMap(line=>line.points.map(p=>p.twd))),
      yLabels=y.ticks.map(money),left=Math.min(96,Math.max(54,Math.max(...yLabels.map(t=>t.length))*7+12)),right=14,top=12,bottom=32,plotW=width-left-right,plotH=height-top-bottom,
      px=ms=>left+(t1===t0?0:(ms-t0)/(t1-t0)*plotW),py=v=>top+(y.hi===y.lo?plotH/2:(y.hi-v)/(y.hi-y.lo)*plotH),
      grid=y.ticks.map((tick,i)=>`<line class="pt-grid" x1="${left}" y1="${py(tick).toFixed(1)}" x2="${width-right}" y2="${py(tick).toFixed(1)}"/><text class="pt-axis" x="${left-8}" y="${(py(tick)+4).toFixed(1)}" text-anchor="end">${esc(yLabels[i])}</text>`).join(''),
      xTicks=width>=420&&t1-t0>=2*DAY_MS?[[t0,'start'],[Math.round((t0+(t1-t0)/2)/DAY_MS)*DAY_MS,'middle'],[t1,'end']]:[[t0,'start'],[t1,'end']],
      xAxis=xTicks.map(([ms,anchor])=>`<text class="pt-axis" x="${px(ms).toFixed(1)}" y="${height-10}" text-anchor="${anchor}">${dateText(ms)}</text>`).join(''),
      title=`參考價走勢圖（新台幣階梯折線${sourceNames(lines).length?'，'+sourceNames(lines).join('／'):''}）`,desc=`新台幣，${dateText(t0)} 至 ${dateText(t1)}。${summaryText(lines)}。`,
      paths=lines.map((line,index)=>{
        const pts=line.points,d=pts.map((p,i)=>i===0?`M${px(p.ms).toFixed(1)} ${py(p.twd).toFixed(1)}`:`H${px(p.ms).toFixed(1)}V${py(p.twd).toFixed(1)}`).join('');
        return `<g class="pt-s${index+1}"><path class="pt-line pt-d${index}" d="${d}"${DASHES[index]?` stroke-dasharray="${DASHES[index]}"`:''}/>${pts.map(p=>markerSvg(SHAPES[index],px(p.ms),py(p.twd),`${line.label}｜${dateText(p.ms)}｜${money(p.twd)}`)).join('')}</g>`}).join('');
    return `<svg class="pt-chart" role="img" aria-label="${esc(title)}" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${grid}${xAxis}${paths}</svg>`;
  }
  function legendHtml(lines){return `<ul class="pt-legend" aria-label="圖例">${lines.map((line,index)=>`<li>${keySvg(index)}<span>${esc(line.label)}</span></li>`).join('')}</ul>`}
  function tableHtml(lines,title=TITLE){
    return `<div class="pt-table-wrap"><table class="pt-table"><caption class="pt-sr">${esc(title)}文字摘要</caption><thead><tr><th scope="col">線條</th><th scope="col">最舊紀錄</th><th scope="col">最新紀錄</th><th scope="col">最新原幣</th></tr></thead><tbody>${lines.map(line=>{const a=line.points[0],b=line.points.at(-1);return `<tr><th scope="row">${esc(line.label)}</th><td>${dateText(a.ms)}<br><b>${money(a.twd)}</b></td><td>${dateText(b.ms)}<br><b>${money(b.twd)}</b></td><td>${b.amount==null?'—':original(b.amount,line.currency)}</td></tr>`}).join('')}</tbody></table></div>`;
  }
  // 純函式：整個小節的 HTML。history 是 API 回應（{series,meta}）或 null（讀取失敗）。
  function sectionHtml(history,options={}){
    const title=titleFor(history?.series),head=`<h3>${esc(title)}</h3><p class="meta">${esc(NOTE)}</p>`;
    if(!history||history.meta?.unavailable)return `${head}<div class="state" role="status">參考價走勢暫時無法讀取，不影響其他資料；重新開啟這個分頁會再試一次。</div>`;
    const p=plan(history,options);
    if(!p.lines.length){
      return head+(p.recorded?`<div class="state">已開始記錄（自 ${esc(p.firstDate)}），累積兩筆以上才畫走勢。</div>`:(options.noSource?'<div class="state">這個遊戲目前尚未接入價格來源，沒有走勢可看。</div>':'<div class="state">尚未有參考價紀錄。</div>'));
    }
    const extra=[p.omitted?`另有 ${p.omitted} 條線未畫出（圖上最多 3 條，不同卡片、來源、版本不合併）。`:'',p.sparse?`另有 ${p.sparse} 條線只有一筆紀錄，累積兩筆以上才畫走勢。`:''].filter(Boolean);
    return `${head}${legendHtml(p.lines)}<div class="pt-chart-wrap">${chartSvg(p.lines,options)}</div>${tableHtml(p.lines,title)}${extra.length?`<p class="meta">${extra.map(esc).join('<br>')}</p>`:''}`;
  }

  // 瀏覽器端：打開市場分頁時才請求；失敗時下次再點會重試；寬度隨容器重畫（不做動畫）。
  async function load(slot,options={}){
    if(!slot||slot.dataset.ptState==='loading'||slot.dataset.ptState==='done')return;
    const cardId=slot.dataset.priceTrend,fetchFn=options.fetchFn||root.fetch.bind(root),alive=()=>slot.isConnected&&slot.dataset.priceTrend===cardId;
    slot.dataset.ptState='loading';slot.innerHTML=`<h3>${esc(TITLE)}</h3><div class="state" role="status">正在讀取參考價紀錄…</div>`;
    let history=null;
    try{const response=await fetchFn(`/api/cards/${encodeURIComponent(cardId)}/price-history`);if(response.ok)history=await response.json()}catch{history=null}
    if(!alive())return;
    if(history&&!history.meta?.unavailable&&Array.isArray(history.series))slot.dataset.ptState='done';else{slot.dataset.ptState='';history=null}
    const draw=()=>{if(!alive())return;const width=slot.clientWidth||600;slot.dataset.ptWidth=String(width);slot.innerHTML=sectionHtml(history,{...options,width:Math.min(width,760),id:`pt-${String(cardId).replace(/[^a-z0-9]/gi,'')}`})};
    draw();
    if(history&&typeof root.ResizeObserver==='function'){let timer=0;new root.ResizeObserver(()=>{if(Math.abs((slot.clientWidth||0)-Number(slot.dataset.ptWidth||0))<8)return;root.clearTimeout(timer);timer=root.setTimeout(draw,120)}).observe(slot)}
  }

  root.PriceTrend={TITLE,titleFor,NOTE,MAX_LINES,esc,plan,chartSvg,sectionHtml,load};
})(typeof window!=='undefined'?window:globalThis);
