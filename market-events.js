// 卡牌時事：把 /api/market-events 畫進首頁與遊戲頁。近期排前面，即將發生的標「即將」；只是發售日與官方消息，不代表會影響價格。
(root=>{
  const LIMIT=8,GAMES={pokemon:'寶可夢',yugioh:'遊戲王',onepiece:'航海王',haikyuu:'排球少年','weiss-schwarz':'芙莉蓮','dragonball-fw':'七龍珠超'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // 純函式：即將發生的由近到遠排最前，接著已發生的由新到舊，只取前幾筆。
  function arrange(events,today,limit=LIMIT){const list=Array.isArray(events)?events:[],soon=list.filter(e=>e.date>today).sort((a,b)=>a.date<b.date?-1:1),past=list.filter(e=>e.date<=today).sort((a,b)=>a.date<b.date?1:-1);return [...soon,...past].slice(0,limit)}
  const item=(event,today,showGame)=>`<li><time datetime="${esc(event.date)}">${esc(event.date.slice(5))}${event.date>today?'<span class="soon">即將</span>':''}</time><div>${showGame?`<span class="game">${esc(GAMES[event.game]||event.game)}</span>`:''}<b>${esc(event.title)}</b>${/^https:\/\//.test(event.url)?`<a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">來源：${esc(event.source)}</a>`:''}</div></li>`;
  let pending=null;
  function render(){
    const section=root.document?.getElementById('eventsSection');if(!section)return;
    const view=root.document.body?.dataset||{},game=view.game&&view.game!=='all'?view.game:null;
    if(view.view==='about'){section.hidden=true;return}
    pending=pending||root.fetch('/api/market-events').then(r=>r.ok?r.json():null).catch(()=>null);
    pending.then(body=>{
      if(!body)pending=null;
      const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),rows=arrange((body?.data||[]).filter(e=>!game||e.game===game),today);
      section.hidden=!rows.length;
      section.innerHTML=rows.length?`<div class="title"><div><h2>卡牌時事</h2><span class="meta">${esc(body.meta?.note||'')}</span></div></div><ul>${rows.map(e=>item(e,today,!game)).join('')}</ul>`:'';
    });
  }
  root.renderMarketEvents=render;root.MarketEvents={arrange};
  render();
})(typeof window!=='undefined'?window:globalThis);
