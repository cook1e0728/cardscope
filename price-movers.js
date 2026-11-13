// 參考價漲跌榜：把 /api/price-movers 畫進首頁（以及寶可夢遊戲頁）原本的 #trendsSection（遊々亭買取漲幅已停用，空出這個位置）。
// 只是 Cardmarket 平台參考價的變動，不是成交價、買取價或價差；文字標示 ↑／↓ 與正負號，不只靠顏色。點卡片開本站詳細頁看完整走勢。
(root=>{
  const BIG=200,esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const twd=value=>value==null?'':`NT$ ${Math.round(Number(value)).toLocaleString('en-US')}`;
  const eur=value=>`€${Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const md=date=>String(date||'').slice(5).replace('-','/');
  const fallback='<span class="image-fallback unified-image-fallback"%H><b>圖片待補</b><small>圖片來源尚未收錄</small></span>';
  // 卡圖標記（含載入失敗時的退回）；首頁的最夯／最熱（home-rails.js）共用。
  function image(url,alt){
    const src=url&&(typeof root.displayImageUrl==='function'?root.displayImageUrl(url):url);
    return src?`<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" data-img-error="swap-hidden">${fallback.replace('%H',' hidden')}`:fallback.replace('%H','');
  }
  function card(row,up){
    const pct=Number(row.changePercent),label=`${up?'↑ +':'↓ '}${pct.toLocaleString('en-US',{maximumFractionDigits:1})}%`;
    const price=`${twd(row.from.amountTwd)} → ${twd(row.to.amountTwd)}`;
    return `<button type="button" class="trend-card${up?'':' trend-fall'}" data-do="openCard" data-arg="${esc(row.cardId)}"><div class="trend-image">${image(row.imageUrl,row.name)}</div>`+
      `<div class="trend-card-head"><b>${esc(row.name)}</b><span class="trend-rise">${esc(label)}</span></div>`+
      `<span class="trend-card-number">${esc([row.seriesCode,row.cardNumber].filter(Boolean).join(' · '))}</span><strong>${esc(price)}</strong>`+
      `<small>${esc(eur(row.from.amount))} → ${esc(eur(row.to.amount))}<br>${esc(md(row.from.date))} → ${esc(md(row.to.date))}</small></button>`;
  }
  const rail=(rows,up,title)=>`<h3 class="movers-head">${title}</h3><div class="trend-rail">${rows.length?rows.map(row=>card(row,up)).join(''):'<div class="trend-empty"><b>目前沒有符合條件的卡</b></div>'}</div>`;
  let pending=null;
  // 部署後第一個請求常因冷快取逾時（502）：隔 3 秒再試一次；仍失敗就清掉，下次進頁再試
  const get=()=>fetch('/api/price-movers').then(r=>r.ok?r.json():Promise.reject(new Error(String(r.status))));
  const request=()=>pending=pending||get().catch(()=>new Promise(done=>setTimeout(done,3000)).then(get)).catch(()=>{pending=null;return null});
  // 標題旁的 ⓘ：來源與連結、前後觀測時間、適用範圍（PRODUCT_PLAN 第 6 節）；漲跌榜與首頁的最夯用同一份。
  function info(up,down,meta){
    const rows=[...up,...down],from=rows.map(row=>row.from?.date).filter(Boolean).sort()[0],to=rows.map(row=>row.to?.date).filter(Boolean).sort().at(-1);
    return root.infoTip('參考價漲跌榜的來源與範圍',
      `<p><b>來源</b>歐洲 Cardmarket 平台參考價（歐元，<a href="https://www.cardmarket.com/" target="_blank" rel="noopener">cardmarket.com</a>）。其他來源見<a href="/?view=privacy#sources" data-spa>資料來源</a>。</p>`+
      `<p><b>觀測時間</b>${from&&to?`本榜涵蓋 ${esc(md(from))} → ${esc(md(to))}（近 ${esc(meta.windowDays||14)} 天）；`:''}每張卡下方標出它自己前後兩次的觀測日。</p>`+
      `<p><b>適用範圍</b>只含寶可夢；共 ${rows.length} 張上榜（漲 ${up.length}、跌 ${down.length}）；已排除 €${esc(meta.minAmount||5)} 以下的低價卡與單日異常跳動。${rows.some(row=>Math.abs(Number(row.changePercent))>=BIG)?'漲跌超過 200% 的卡，多半是成交稀少、少數高價刊登拉動，請先點進去看走勢。':''}</p>`+
      `<p>${esc(meta.note||'')}</p>`);
  }
  root.priceMoversShared={request,card,image,info};
  root.renderPriceMovers=section=>{
    return request().then(body=>{
      const up=body?.data?.up||[],down=body?.data?.down||[],meta=body?.meta||{};
      if(!up.length&&!down.length){section.hidden=true;section.innerHTML='';pending=null;return}
      section.hidden=false;section.classList.add('price-movers');
      // 標題下只留一句「不是成交價」；其餘都收進 ⓘ。
      const info=root.priceMoversShared.info(up,down,meta);
      section.innerHTML=`<div class="title"><div><h2>近 ${esc(meta.windowDays||14)} 天參考價漲跌（寶可夢）</h2><div class="title-note"><span class="meta">歐洲平台參考價，不是成交價</span>${info}</div></div></div>`+
        rail(up,true,'漲幅')+rail(down,false,'跌幅');
    });
  };
})(window);
