(function cardScopeGameTaxonomy(scope){
  'use strict';

  // Keep a synchronous fallback so the existing index can render before the
  // optional JSON refresh completes. The JSON file is the editable source for
  // future systems and works; this fallback preserves first paint and tests.
  const fallbackTaxonomy={
    schemaVersion:1,
    defaultSystemId:'all',
    assetPolicy:{defaultVisualKind:'cardscope-category-visual',officialAssets:[],officialPermissionRequired:true},
    systems:[
      {id:'all',kind:'card-game-system-picker',status:'active',nameZh:'全部遊戲',nameOriginal:'All games',languages:['多語'],categoryVisual:{path:'/assets/brand/cardscope-rabbit-mark.png',kind:'cardscope-brand-mark',official:false,usage:'global-game-picker'},franchises:[]},
      {id:'pokemon',kind:'card-game-system',status:'active',nameZh:'寶可夢',nameOriginal:'Pokémon Trading Card Game',languages:['日文','繁體中文','英文'],regions:['JP','TW','US','CN','KR','ASIA'],categoryVisual:{path:'/assets/ip-pokemon.svg',kind:'cardscope-category-visual',official:false,usage:'game-navigation'},franchises:[{id:'pokemon',nameZh:'寶可夢',nameOriginal:'Pokémon',aliases:['ポケモン','Pokemon','Pokémon'],status:'active',scope:{mode:'system',gameId:'pokemon'}}]},
      {id:'onepiece',kind:'card-game-system',status:'active',nameZh:'航海王',nameOriginal:'ONE PIECE Card Game',languages:['日文','亞洲英文'],regions:['JP','TW','ASIA'],categoryVisual:{path:'/assets/ip-onepiece.svg',kind:'cardscope-category-visual',official:false,usage:'game-navigation'},franchises:[{id:'onepiece',nameZh:'航海王',nameOriginal:'ONE PIECE',aliases:['ONE PIECE','ワンピース','海賊王'],status:'active',scope:{mode:'system',gameId:'onepiece'}}]},
      {id:'yugioh',kind:'card-game-system',status:'active',nameZh:'遊戲王',nameOriginal:'Yu-Gi-Oh! OCG',languages:['日文','繁體中文','英文'],regions:['JP','TW','US','CN','KR'],categoryVisual:{path:'/assets/ip-yugioh.svg',kind:'cardscope-category-visual',official:false,usage:'game-navigation'},franchises:[{id:'yugioh',nameZh:'遊戲王',nameOriginal:'Yu-Gi-Oh!',aliases:['遊戯王','Yu-Gi-Oh','YGO'],status:'active',scope:{mode:'system',gameId:'yugioh'}}]},
      {id:'weiss-schwarz',kind:'card-game-system',status:'active',nameZh:'Weiß Schwarz',nameOriginal:'Weiß Schwarz',languages:['日文'],regions:['JP'],categoryVisual:null,franchises:[{id:'frieren',nameZh:'葬送的芙莉蓮',nameOriginal:'葬送のフリーレン',nameEn:"Frieren: Beyond Journey's End",aliases:['芙莉蓮','Frieren','葬送のフリーレン'],status:'active',seriesCodes:['S108','S108-TD','S128','S136'],categoryVisual:{path:'/assets/ip-frieren.svg',kind:'cardscope-category-visual',official:false,usage:'franchise-navigation'},scope:{mode:'series',gameId:'weiss-schwarz',seriesCodes:['S108','S108-TD','S128','S136']}},{id:'rezero',nameZh:'Re:從零開始的異世界生活',nameOriginal:'Re:ゼロから始める異世界生活',nameEn:'Re:ZERO -Starting Life in Another World-',aliases:['Re:Zero','Re：從零開始的異世界生活','Re:ゼロ'],status:'planned',seriesCodes:[],categoryVisual:null,scope:{mode:'series',gameId:'weiss-schwarz',seriesCodes:[]}}]},
      {id:'haikyuu',kind:'card-game-system',status:'active',nameZh:'排球少年',nameOriginal:'バボカ!! BREAK',nameEn:'Haikyuu!! Volleyball Card Game BREAK',productLine:'バボカ!! BREAK',languages:['日文'],regions:['JP'],categoryVisual:{path:'/assets/ip-haikyuu.svg',kind:'cardscope-category-visual',official:false,usage:'game-navigation'},franchises:[{id:'haikyuu',nameZh:'排球少年',nameOriginal:'ハイキュー!!',nameEn:'Haikyu!!',aliases:['ハイキュー','Haikyuu','Vobaca','バボカ'],status:'active',scope:{mode:'system',gameId:'haikyuu'}}]},
      {id:'union-arena',kind:'card-game-system',status:'planned',enabled:false,nameZh:'Union Arena',nameOriginal:'UNION ARENA',languages:['日文'],regions:['JP'],categoryVisual:null,franchises:[]}
    ]
  };

  const isTaxonomy=value=>Boolean(value&&Array.isArray(value.systems)&&value.systems.some(system=>system?.id==='all'));
  const visualPath=visual=>typeof visual==='string'?visual:visual?.path||null;
  const displayLanguage=languages=>Array.isArray(languages)?languages.join('／'):String(languages||'多語');
  const clone=value=>JSON.parse(JSON.stringify(value));
  const activeSystems=taxonomy=>taxonomy.systems.filter(system=>system?.id==='all'||system?.enabled!==false);
  const makeChoices=taxonomy=>activeSystems(taxonomy).map(system=>{const activeFranchises=(system.franchises||[]).filter(franchise=>franchise.status!=='planned'),singleWork=activeFranchises.length===1?activeFranchises[0]:null;return ({
    id:system.id,
    name:singleWork?.nameZh||system.nameZh||system.nameOriginal||system.id,
    shortName:system.nameOriginal||system.nameZh||system.id,
    language:displayLanguage(system.languages),
    query:system.defaultSearch||'',
    categoryVisual:system.categoryVisual||singleWork?.categoryVisual||null,
    visualPolicy:system.categoryVisual?.kind||taxonomy.assetPolicy?.defaultVisualKind||'cardscope-category-visual',
    systemId:system.id,
    systemNameZh:system.nameZh||system.nameOriginal||system.id,
    systemNameOriginal:system.nameOriginal||null,
    productLine:system.productLine||null,
    regions:Array.isArray(system.regions)?[...system.regions]:[],
    franchises:Array.isArray(system.franchises)?clone(system.franchises):[],
    franchiseIds:Array.isArray(system.franchises)?system.franchises.filter(franchise=>franchise.status!=='planned').map(franchise=>franchise.id):[]
  })});

  let taxonomy=clone(fallbackTaxonomy);
  let gameChoices=makeChoices(taxonomy);
  const expose=()=>{
    scope.CARD_SCOPE_TAXONOMY=taxonomy;
    scope.CARD_GAMES=gameChoices;
    // Explicit helper names let future UI/backend adapters query work scope
    // without changing the established choose(gameId) API.
    scope.cardScopeGameTaxonomy=taxonomy;
    scope.cardScopeGameChoices=gameChoices;
    scope.gameChoices=gameChoices;
  };
  const findSystem=gameId=>taxonomy.systems.find(system=>system.id===gameId)||null;
  const findFranchise=(gameId,franchiseId)=>findSystem(gameId)?.franchises?.find(franchise=>franchise.id===franchiseId)||null;
  scope.getCardScopeSystem=findSystem;
  scope.getCardScopeFranchise=findFranchise;
  scope.getCardScopeScope=(gameId,franchiseId)=>{
    const system=findSystem(gameId),franchise=franchiseId?findFranchise(gameId,franchiseId):null;
    if(!system)return null;
    const scopeData=franchise?.scope||{mode:'system',gameId:system.id};
    return {gameId:system.id,franchiseId:franchise?.id||null,seriesCodes:[...(scopeData.seriesCodes||franchise?.seriesCodes||[])],mode:scopeData.mode||'system'};
  };
  const applyTaxonomy=next=>{
    if(!isTaxonomy(next))return false;
    taxonomy=clone(next);
    gameChoices=makeChoices(taxonomy);
    expose();
    // The index owns rendering; notify it when the optional JSON is ready.
    scope.onCardScopeTaxonomyReady?.(taxonomy,gameChoices);
    scope.channels?.();
    return true;
  };
  expose();

  const style=document.createElement('style');
  style.textContent=`.game-switch{border:2px solid #111;background:#fff;border-radius:12px;padding:8px 12px;font-weight:850;cursor:pointer;white-space:nowrap}.game-switch:after{content:'⌄';margin-left:9px}.game-picker{position:fixed;inset:0;background:#1119;z-index:20;display:none;padding:20px}.game-picker.open{display:grid;place-items:center}.game-picker-box{background:#fff;border-radius:22px;width:min(860px,100%);max-height:88vh;overflow:auto;padding:24px}.game-picker-head{display:flex;justify-content:space-between;align-items:center}.game-picker-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:16px}.game-pick{border:2px solid #e5e5e5;background:#fff;border-radius:14px;padding:10px;text-align:left;cursor:pointer;display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center}.game-pick:hover,.game-pick.active{border-color:#111;background:#fffbe0}.game-pick-art{height:72px;border-radius:10px;background:linear-gradient(135deg,#ffe76b,#71d9d0);overflow:hidden;display:grid;place-items:center}.game-pick-art img{width:100%;height:100%;object-fit:contain}.game-pick b{display:block;font-size:16px}.game-pick small{color:#777}.game-pick .game-work{display:block;margin-top:4px;color:#555;font-size:12px}.game-lang{display:inline-block;margin-top:7px;background:#111;color:#fff;border-radius:5px;padding:2px 6px;font-size:11px}.game-picker-note{margin:0;color:#777;font-size:13px}@media(max-width:760px){.game-switch{order:2;margin-left:auto;max-width:55%;overflow:hidden;text-overflow:ellipsis}.game-picker-grid{grid-template-columns:1fr}.game-pick{grid-template-columns:76px 1fr}.game-pick-art{height:58px}}`;
  document.head.append(style);

  const brand=document.querySelector('.brand');
  if(!brand)return;
  const switchButton=document.createElement('button');
  switchButton.className='game-switch';
  switchButton.type='button';
  switchButton.textContent='全部遊戲';
  brand.after(switchButton);
  const picker=document.createElement('div');
  picker.className='game-picker';
  picker.innerHTML='<div class="game-picker-box"><div class="game-picker-head"><div><h2 style="margin:0">選擇卡牌遊戲</h2><p class="game-picker-note">先選卡牌遊戲系統，再依作品、版本與系列瀏覽；不同作品不會合併。</p></div><button class="close" type="button" aria-label="關閉">×</button></div><div class="game-picker-grid"></div></div>';
  document.body.append(picker);
  const grid=picker.querySelector('.game-picker-grid');
  const close=()=>picker.classList.remove('open');
  const originalChoose=scope.choose;
  const currentGame=()=>{try{return game}catch{return 'all'}};
  const workSummary=system=>{
    const works=(system.franchises||[]).filter(franchise=>franchise.status!=='planned');
    if(!works.length)return system.id==='all'?'跨 IP 搜尋':'作品資料待補';
    return `作品：${works.map(franchise=>franchise.nameZh||franchise.nameOriginal).join('、')}`;
  };
  function draw(active='all'){
    grid.innerHTML=gameChoices.map(choice=>{
      const system=findSystem(choice.id)||{};
      const visual=visualPath(choice.categoryVisual);
      const alt=`${choice.name}的 CardScope 非官方分類圖`;
      return `<button type="button" class="game-pick ${choice.id===active?'active':''}" data-id="${choice.id}"><span class="game-pick-art">${visual?`<img src="${visual}" alt="${alt}" loading="lazy">`:`<span class="ip-wordmark">${choice.shortName||choice.name}</span>`}</span><span><b>${choice.name}</b><small>卡牌遊戲系統 · ${choice.language}</small><span class="game-work">${workSummary(system)}</span>${choice.id==='all'?'':'<span class="game-lang">依版本與系列分開</span>'}</span></button>`;
    }).join('');
  }
  function selectGame(id){
    const choice=gameChoices.find(candidate=>candidate.id===id)||gameChoices[0];
    switchButton.textContent=choice.name;
    close();
    originalChoose?.(choice.id);
  }
  switchButton.onclick=()=>{draw(currentGame());picker.classList.add('open')};
  picker.querySelector('.close').onclick=close;
  picker.onclick=event=>{if(event.target===picker)close()};
  grid.onclick=event=>{const button=event.target.closest('[data-id]');if(button)selectGame(button.dataset.id)};
  scope.choose=selectGame;
  // Keep legacy visual adapters pointed at the explicitly classified local
  // category asset. No property claims that a local SVG is an official logo.
  scope.gameNavImage=id=>visualPath(gameChoices.find(choice=>choice.id===id)?.categoryVisual);

  if(typeof fetch==='function')fetch('/data/game-taxonomy.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(next=>{if(next)applyTaxonomy(next)}).catch(()=>{});
})(window);
