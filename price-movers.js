// 參考價漲跌榜：把 /api/price-movers 畫進首頁（以及寶可夢遊戲頁）原本的 #trendsSection（遊々亭買取漲幅已停用，空出這個位置）。
// 只是 Cardmarket 平台參考價的變動，不是成交價、買取價或價差；文字標示 ↑／↓ 與正負號，不只靠顏色。點卡片開本站詳細頁看完整走勢。
(root=>{
  const BIG=200,esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const twd=value=>value==null?'':`NT$ ${Math.round(Number(value)).toLocaleString('en-US')}`;
  const eur=value=>`€${Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fallback='<span class="image-fallback unified-image-fallback"%H><b>圖片待補</b><small>圖片來源尚未收錄</small></span>';
  function card(row,up){
    const pct=Number(row.changePercent),label=`${up?'↑ +':'↓ '}${pct.toLocaleString('en-US',{maximumFractionDigits:1})}%`;
    const src=row.imageUrl&&(typeof root.displayImageUrl==='function'?root.displayImageUrl(row.imageUrl):row.imageUrl);
    const image=src?`<img src="${esc(src)}" alt="${esc(row.name)}" loading="lazy" data-img-error="swap-hidden">${fallback.replace('%H',' hidden')}`:fallback.replace('%H','');
    const price=`${twd(row.from.amountTwd)} → ${twd(row.to.amountTwd)}`;
    return `<button type="button" class="trend-card${up?'':' trend-fall'}" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${image}</div>`+
      `<div class="trend-card-head"><b>${esc(row.name)}</b><span class="trend-rise">${esc(label)}</span></div>`+
      `<span class="trend-card-number">${esc([row.seriesCode,row.cardNumber].filter(Boolean).join(' · '))}</span><strong>${esc(price)}</strong>`+
      `<small>${esc(eur(row.from.amount))} → ${esc(eur(row.to.amount))}<br>${esc(row.from.date)} → ${esc(row.to.date)}</small>`+
      (Math.abs(pct)>=BIG?'<small class="trend-warn">變動很大：多半是成交稀少、少數高價刊登拉動，先看詳細頁走勢</small>':'')+'</button>';
  }
  const rail=(rows,up,title)=>`<h3 class="movers-head">${title}</h3><div class="trend-rail">${rows.length?rows.map(row=>card(row,up)).join(''):'<div class="trend-empty"><b>目前沒有符合條件的卡</b></div>'}</div>`;
  let pending=null;
  root.renderPriceMovers=section=>{
    pending=pending||fetch('/api/price-movers').then(r=>r.ok?r.json():null).catch(()=>null);
    return pending.then(body=>{
      const up=body?.data?.up||[],down=body?.data?.down||[],meta=body?.meta||{};
      if(!up.length&&!down.length){section.hidden=true;section.innerHTML='';pending=null;return}
      section.hidden=false;section.classList.add('price-movers');
      section.innerHTML=`<div class="title"><div><h2>近 ${esc(meta.windowDays||14)} 天參考價漲跌（寶可夢）</h2><span class="meta">Cardmarket 平台參考價，兩端都在 €${esc(meta.minAmount||5)} 以上、連續兩筆紀錄同方向才列入</span></div></div>`+
        `<p class="trend-scope-note">${esc(meta.note||'')}沒有計入運費、手續費與關稅，不是買賣建議。</p>`+
        rail(up,true,'漲幅')+rail(down,false,'跌幅');
    });
  };
})(window);
