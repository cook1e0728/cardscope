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
      {id:'all',kind:'card-game-system-picker',status:'active',nameZh:'全部遊戲',nameOriginal:'All games',languages:['多語'],categoryVisual:{path:'/assets/brand/web/cardscope-rabbit-mark-256.webp',kind:'cardscope-brand-mark',official:false,usage:'global-game-picker'},franchises:[]},
      {id:'pokemon',kind:'card-game-system',status:'active',nameZh:'寶可夢',nameOriginal:'Pokémon Trading Card Game',languages:['日文','繁體中文','英文'],regions:['JP','TW','US','CN','KR','ASIA'],categoryVisual:{path:'/assets/ip-logos/pokemon.svg',kind:'official-logo',official:true,usage:'game-navigation',source:'https://www.pokemon-card.com/assets/images/logo_b.svg'},franchises:[{id:'pokemon',nameZh:'寶可夢',nameOriginal:'Pokémon',aliases:['ポケモン','Pokemon','Pokémon'],status:'active',scope:{mode:'system',gameId:'pokemon'}}]},
      {id:'onepiece',kind:'card-game-system',status:'active',nameZh:'航海王',nameOriginal:'ONE PIECE Card Game',languages:['日文','亞洲英文'],regions:['JP','TW','ASIA'],categoryVisual:{path:'/assets/ip-logos/onepiece.png',kind:'official-logo',official:true,usage:'game-navigation',source:'https://www.onepiece-cardgame.com/renewal/images/common/logo_op.png'},franchises:[{id:'onepiece',nameZh:'航海王',nameOriginal:'ONE PIECE',aliases:['ONE PIECE','ワンピース','海賊王'],status:'active',scope:{mode:'system',gameId:'onepiece'}}]},
      {id:'yugioh',kind:'card-game-system',status:'active',nameZh:'遊戲王',nameOriginal:'Yu-Gi-Oh! OCG',languages:['日文','繁體中文','英文'],regions:['JP','TW','US','CN','KR'],categoryVisual:{path:'/assets/ip-logos/yugioh.png',kind:'official-logo',official:true,usage:'game-navigation',source:'https://www.yugioh-card.com/japan/assets/images/logo-ocg.png'},franchises:[{id:'yugioh',nameZh:'遊戲王',nameOriginal:'Yu-Gi-Oh!',aliases:['遊戯王','Yu-Gi-Oh','YGO'],status:'active',scope:{mode:'system',gameId:'yugioh'}}]},
      {id:'weiss-schwarz',kind:'card-game-system',status:'active',nameZh:'Weiß Schwarz',nameOriginal:'Weiß Schwarz',languages:['日文'],regions:['JP'],categoryVisual:null,franchises:[{id:'frieren',nameZh:'葬送的芙莉蓮',nameOriginal:'葬送のフリーレン',nameEn:"Frieren: Beyond Journey's End",aliases:['芙莉蓮','Frieren','葬送のフリーレン'],status:'active',seriesCodes:['S108','S108-TD','S128','S136'],categoryVisual:{path:'/assets/ip-logos/weiss-schwarz.png',kind:'official-logo',official:true,usage:'franchise-navigation',source:'https://ws-tcg.com/wordpress/wp-content/themes/ws-tcg_re/assets/img/common/logo.png'},scope:{mode:'series',gameId:'weiss-schwarz',seriesCodes:['S108','S108-TD','S128','S136']}},{id:'rezero',nameZh:'Re:從零開始的異世界生活',nameOriginal:'Re:ゼロから始める異世界生活',nameEn:'Re:ZERO -Starting Life in Another World-',aliases:['Re:Zero','Re：從零開始的異世界生活','Re:ゼロ'],status:'planned',seriesCodes:[],categoryVisual:null,scope:{mode:'series',gameId:'weiss-schwarz',seriesCodes:[]}}]},
      {id:'haikyuu',kind:'card-game-system',status:'active',nameZh:'排球少年',nameOriginal:'バボカ!! BREAK',nameEn:'Haikyuu!! Volleyball Card Game BREAK',productLine:'バボカ!! BREAK',languages:['日文'],regions:['JP'],categoryVisual:{path:'/assets/ip-logos/haikyuu.svg',kind:'official-logo',official:true,usage:'game-navigation',source:'https://www.takaratomy.co.jp/products/haikyuvobacabreak/assets/img/logo.svg'},franchises:[{id:'haikyuu',nameZh:'排球少年',nameOriginal:'ハイキュー!!',nameEn:'Haikyu!!',aliases:['ハイキュー','Haikyuu','Vobaca','バボカ'],status:'active',scope:{mode:'system',gameId:'haikyuu'}}]},
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

  // The logo tiles / tabs in #channels are the one game chooser (ADR 0044 Q5); the header drop-down and its dialog duplicated them and are gone.
  // Primary navigation, in the header on wide screens and the bottom bar on phones (ADR 0044 Q8): 搜尋 focuses the search box, 圖鑑 goes to the
  // game tiles, 我的收藏 opens the favourites.
  const visible=node=>Boolean(node&&node.getClientRects().length);
  const behavior=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  const navigate={
    search(){
      const box=[document.getElementById('heroQ'),document.getElementById('q')].find(visible);
      scrollTo({top:0,behavior:behavior()});box?.focus({preventScroll:true});box?.select?.();
    },
    browse(){
      const tabs=document.getElementById('channels');if(!tabs)return;
      scope.scrollBelowHeader?.(tabs,8);(tabs.querySelector('.channel.on')||tabs.querySelector('.channel'))?.focus({preventScroll:true});
    },
    // ui-enhancements.js owns the favourites; it should expose window.openCollection(). Until it does, open the same list through its page controls:
    // a game page's "只看收藏" filter and 我的收藏 summary (a game is chosen first when none is open).
    async collection(){
      if(typeof scope.openCollection==='function')return scope.openCollection();
      const summary=()=>document.getElementById('watchlistSummary');
      if(!visible(summary())){
        const known=typeof watchlistMeta==='object'?Object.values(watchlistMeta).find(card=>card?.game)?.game:'',target=known||currentGame();
        await scope.choose?.(target==='all'?'pokemon':target);
      }
      const toggle=document.getElementById('favoritesOnly');
      if(toggle?.getAttribute('aria-pressed')==='false')toggle.click();
      scope.scrollBelowHeader?.(summary()||toggle,8);toggle?.focus({preventScroll:true});
    }
  };
  const currentGame=()=>{try{return game}catch{return 'all'}};
  document.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>navigate[button.dataset.nav]?.()));
  // Keep legacy visual adapters pointed at the classified local asset for each game.
  scope.gameNavImage=id=>visualPath(gameChoices.find(choice=>choice.id===id)?.categoryVisual);

  if(typeof fetch==='function')fetch('/data/game-taxonomy.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(next=>{if(next)applyTaxonomy(next)}).catch(()=>{});
})(window);
