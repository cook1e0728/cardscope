// Phase 1 browser acceptance fixture for the public beta.
//
// The page is served by the real local CardScope server, while API and image
// responses are intercepted in this browser only. The fixture never writes to
// the catalog or a database. Phase 2 URL/back assertions remain intentionally
// out of scope for this baseline.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.PLAYWRIGHT_MODULE||resolve(process.cwd(),'node_modules','playwright','index.mjs');
const moduleHref=String(modulePath).startsWith('file:')?String(modulePath):pathToFileURL(modulePath).href;
const {chromium}=await import(moduleHref);

const baseUrl=process.env.CARDSCOPE_URL||'http://127.0.0.1:4202';
const requestedChannel=process.env.PLAYWRIGHT_CHANNEL||'';
const viewports=[
  {name:'mobile-390',width:390,height:844},
  {name:'mobile-430',width:430,height:932},
  {name:'desktop',width:1440,height:1000}
];
const gameIds=['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','dragonball-fw'];
const gameLabels={
  pokemon:'寶可夢',
  onepiece:'航海王',
  yugioh:'遊戲王',
  haikyuu:'排球少年',
  'weiss-schwarz':'葬送的芙莉蓮',
  'dragonball-fw':'七龍珠超'
};
const gameCodes={pokemon:'SV',onepiece:'OP',yugioh:'YS',haikyuu:'HV','weiss-schwarz':'S','dragonball-fw':'DB'};
const healthySvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><rect width="500" height="700" rx="24" fill="#fff"/><rect x="14" y="14" width="472" height="672" rx="18" fill="#7edbd2" stroke="#171717" stroke-width="12"/><rect x="45" y="58" width="410" height="505" fill="#ffe46c"/><text x="250" y="630" text-anchor="middle" font-size="30" font-family="sans-serif">BETA FIXTURE</text></svg>';

const sleep=milliseconds=>new Promise(resolveSleep=>setTimeout(resolveSleep,milliseconds));
const responseBody=(route,body,status=200)=>route.fulfill({
  status,
  contentType:'application/json; charset=utf-8',
  body:JSON.stringify(body)
});

function gameDefinition(id){
  return {id,nameZh:gameLabels[id],nameEn:id==='pokemon'?'Pokémon':id==='onepiece'?'ONE PIECE':id==='yugioh'?'Yu-Gi-Oh!':id==='haikyuu'?'Haikyuu!!':id==='dragonball-fw'?'Dragon Ball Super Card Game Fusion World':'Weiß Schwarz'};
}

function makeCard(game,index,rarity,nameSuffix,imageState='ok'){
  const code=gameCodes[game],id=`${game}-fixture-${index}`;
  const imageUrl=`${baseUrl}/fixture-images/${id}.svg`;
  const brokenImageUrl=`${baseUrl}/fixture-images/${id}-broken.svg`;
  const printing={
    id:`${id}-jp`,cardId:id,seriesId:`${game}-fixture-series`,region:'JP',language:'ja-JP',
    localSetCode:`${code}-FIX`,localCardNumber:`${code}-FIX ${String(index).padStart(2,'0')}`,
    rarity,imageUrl:imageState==='broken'?brokenImageUrl:imageUrl
  };
  return {
    id,canonicalId:id,game,seriesId:`${game}-fixture-series`,officialCardNumber:printing.localCardNumber,
    rarity,nameZh:`${gameLabels[game]} ${nameSuffix}`,nameEn:`${game} ${nameSuffix}`,
    imageUrl:imageState==='broken'?brokenImageUrl:imageUrl,printings:[printing]
  };
}

function cardsForGame(game){
  const cards=[
    makeCard(game,1,'SR','SR 測試卡'),
    makeCard(game,2,'C','C 測試卡')
  ];
  if(game==='pokemon')cards.push(makeCard(game,3,'C','故障圖測試卡','broken'));
  return cards;
}

function fixtureCatalog(){
  const games=gameIds.map(gameDefinition);
  const series=gameIds.map(game=>({
    id:`${game}-fixture-series`,game,officialCode:`${gameCodes[game]}-FIX`,
    nameZh:`${gameLabels[game]} Fixture 系列`,nameEn:`${game} Fixture Series`,region:'JP',language:'ja-JP'
  }));
  return {version:3,updatedAt:'2026-09-16T00:00:00.000Z',source:'beta-browser-fixture',games,series,cards:gameIds.flatMap(cardsForGame)};
}

function fixtureProducts(){
  return gameIds.map(game=>({
    id:`${game}-fixture-product`,game,region:'JP',language:'ja-JP',catalogCategory:'sealed',
    officialCode:`${gameCodes[game]}-FIX-BOX`,nameZh:`${gameLabels[game]} Fixture 商品`,
    nameEn:`${game} Fixture Product`,releaseDate:'2026-09-01',seriesId:`${game}-fixture-series`,
    imageUrl:`${baseUrl}/fixture-images/${game}-product.svg`,imageKind:'sealed-product',productType:'原盒'
  }));
}

function coveragePayload(catalog){
  const games=Object.fromEntries(gameIds.map(game=>({
    [game]:{cards:catalog.cards.filter(card=>card.game===game).length,chineseNames:catalog.cards.filter(card=>card.game===game&&card.nameZh).length,rarities:catalog.cards.filter(card=>card.game===game&&card.rarity).length,displayableImages:catalog.cards.filter(card=>card.game===game).length,expectedTotal:null,scope:'beta fixture',status:'partial'}
  })));
  return {totalCards:catalog.cards.length,source:'beta-browser-fixture',updatedAt:catalog.updatedAt,games};
}

function makeFixtureState(catalog){
  return {
    catalog,
    products:fixtureProducts(),
    cardAttempts:new Map(),
    cardRequests:[],
    searchAttempts:new Map(),
    detailRequests:[],
    optionalServiceFailures:0
  };
}

async function installFixtures(page,state,{returning=true}={}){
  // The first-visit tour (look-showcase.js) would cover the page; these flows act as a returning visitor.
  if(returning)await page.addInitScript(()=>{try{localStorage.setItem('cs-tour-done','1')}catch{}});
  await page.route('**/api/**',async route=>{
    const requestUrl=new URL(route.request().url());
    const pathname=requestUrl.pathname;
    if(pathname==='/api/catalog')return responseBody(route,{data:state.catalog});
    if(pathname==='/api/products')return responseBody(route,{data:state.products,series:state.catalog.series});
    if(pathname==='/api/catalog/coverage')return responseBody(route,{data:coveragePayload(state.catalog)});
    if(pathname==='/api/catalog/health')return responseBody(route,{data:{...coveragePayload(state.catalog),policy:{version:'fixture',reviewedAt:'2026-09-16',unverifiedImageDisplayEnabled:false}}});
    if(pathname==='/api/buyback-prices')return responseBody(route,{data:[]});
    if(pathname==='/api/reports'){
      state.optionalServiceFailures+=1;
      return responseBody(route,{error:'fixture optional report service unavailable'},503);
    }
    if(pathname==='/api/search'){
      const query=(requestUrl.searchParams.get('q')||'').trim().toLocaleLowerCase();
      const attempt=(state.searchAttempts.get(query)||0)+1;
      state.searchAttempts.set(query,attempt);
      if(query==='zero'||query==='no-such-card')return responseBody(route,{data:[],meta:{source:'beta-browser-fixture',match:'none'}});
      const rows=query.includes('luffy')?[makeCard('onepiece',4,'SR','魯夫 Fixture 卡')]:[];
      return responseBody(route,{data:rows,meta:{source:'beta-browser-fixture',match:rows.length?'fixture':'none'}});
    }
    if(pathname==='/api/cards'){
      const game=requestUrl.searchParams.get('game')||'';
      // The landing showcase (look-showcase.js) samples each IP's rarest cards; keep it out of the browse-failure bookkeeping.
      if(requestUrl.searchParams.get('sort')==='rarity-desc'&&!requestUrl.searchParams.has('series'))return responseBody(route,{data:cardsForGame(game),meta:{source:'beta-browser-fixture'}});
      const attempt=(state.cardAttempts.get(game)||0)+1;
      state.cardAttempts.set(game,attempt);
      state.cardRequests.push({game,attempt,offset:requestUrl.searchParams.get('offset')||'0',rarity:requestUrl.searchParams.get('rarity')||'all'});
      // The first real browse request fails once; the page must expose a
      // user-visible retry action and then recover on the next click.
      if(game==='pokemon'&&attempt===1)return responseBody(route,{error:'fixture transient browse failure',code:'FIXTURE_TRANSIENT'},503);
      const requestNumber=state.cardRequests.length;
      const delay=requestNumber%4===0?260:requestNumber%3===0?80:15;
      await sleep(delay);
      const rarity=requestUrl.searchParams.get('rarity')||'all';
      const allRows=cardsForGame(game);
      const rows=rarity==='all'?allRows:allRows.filter(card=>card.rarity===rarity);
      const facets={rarity:Object.fromEntries([...new Set(allRows.map(card=>card.rarity))].map(value=>[value,allRows.filter(card=>card.rarity===value).length]))};
      return responseBody(route,{data:rows,meta:{source:'beta-browser-fixture',game,limit:100,offset:Number(requestUrl.searchParams.get('offset')||0),hasMore:false,total:rows.length,facets}});
    }
    if(pathname.startsWith('/api/cards/')&&pathname.endsWith('/market')){
      state.optionalServiceFailures+=1;
      return responseBody(route,{error:'fixture optional market service unavailable'},503);
    }
    if(pathname.startsWith('/api/cards/')){
      const id=decodeURIComponent(pathname.slice('/api/cards/'.length));
      const card=state.catalog.cards.find(row=>row.id===id);
      state.detailRequests.push(id);
      if(!card)return responseBody(route,{error:'fixture card not found'},404);
      return responseBody(route,{data:{...card,game:gameDefinition(card.game),series:state.catalog.series.find(row=>row.id===card.seriesId)||null},meta:{source:'beta-browser-fixture'}});
    }
    return route.continue();
  });
  await page.route('**/fixture-images/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.endsWith('-broken.svg'))return route.abort('failed');
    return route.fulfill({status:200,contentType:'image/svg+xml',body:healthySvg});
  });
}

async function waitForVisible(locator,message){
  await locator.waitFor({state:'visible',timeout:8000}).catch(error=>{
    throw new Error(`${message}: ${error.message}`);
  });
}

// Phones (≤760px) show the 2×5 quick grid instead of #channels on the landing page (look-clean.css).
const IP_ENTRY='#channels .channel:visible, .mobile-quick-grid .mqg-tile:visible';
async function clickIp(page,id){
  const tile=page.locator(`.mobile-quick-grid .mqg-tile[data-ip="${id}"]:not([data-mqg-action]):visible`).first();
  if(await tile.count()){await tile.click();return;}
  const channels=page.locator('#channels .channel');
  for(let index=0;index<await channels.count();index+=1){
    const onclick=await channels.nth(index).getAttribute('onclick');
    if(onclick?.includes(`'${id}'`)){await channels.nth(index).click();return;}
  }
  const switchButton=page.locator('.game-switch');
  if(await switchButton.count()){
    await switchButton.click();
    const pick=page.locator(`.game-pick[data-id="${id}"]`);
    await waitForVisible(pick,`IP picker control missing for ${id}`);
    await pick.click();
    return;
  }
  throw new Error(`No UI IP control found for ${id}`);
}

async function waitForGame(page,id){
  await page.waitForFunction(expected=>{
    const context=document.querySelector('#channels .channel.on')?.textContent||'';
    const cards=[...document.querySelectorAll('#cards .card')];
    return context.includes(expected.label)&&cards.length>0;
  },{label:gameLabels[id]},{timeout:8000});
  const text=await page.locator('#cards').innerText();
  assert.match(text,new RegExp(gameLabels[id]),`${id} cards should be visible after the switch`);
}

async function retryBrowse(page){
  const retry=page.locator('button.notice-retry, #notice button, .cards-state button').filter({hasText:/重試|再試|Retry|retry/i}).first();
  await waitForVisible(retry,'transient API failure did not expose a retry control');
  await retry.click();
}

// Tab through the page: every stop is visible and a solid focus outline reaches 3:1 against what is behind it (WCAG 2.4.7, 1.4.11).
// shortcut: compares against the nearest opaque ancestor background, so rings drawn over images or gradients are not measured.
async function assertFocusRings(page,label,stops=45){
  const failures=[];
  for(let index=0;index<stops;index+=1){
    await page.keyboard.press('Tab');
    const issue=await page.evaluate(()=>{
      const element=document.activeElement;
      if(!element||element===document.body)return null;
      const style=getComputedStyle(element),box=element.getBoundingClientRect();
      const name=`${element.tagName}${element.id?'#'+element.id:''}.${String(element.className).split(' ')[0]}`;
      if(!box.width||!box.height||style.visibility==='hidden')return `${name} is focused but invisible`;
      if(style.outlineStyle==='none'||style.outlineStyle==='auto'||!parseFloat(style.outlineWidth))return null;
      const rgb=value=>(String(value).match(/[\d.]+/g)||[]).map(Number);
      const luminance=([r,g,b])=>[r,g,b].map(channel=>{channel/=255;return channel<=0.03928?channel/12.92:((channel+0.055)/1.055)**2.4}).reduce((sum,channel,i)=>sum+channel*[0.2126,0.7152,0.0722][i],0);
      let node=parseFloat(style.outlineOffset)<0?element:element.parentElement,background=[255,255,255];
      for(;node;node=node.parentElement){const color=rgb(getComputedStyle(node).backgroundColor);if(color.length&&(color[3]===undefined||color[3]>0.5)){background=color;break}}
      const [high,low]=[luminance(rgb(style.outlineColor)),luminance(background)].sort((a,b)=>b-a);
      const ratio=(high+0.05)/(low+0.05);
      return ratio<3?`${name} focus ring ${ratio.toFixed(2)}:1`:null;
    });
    if(issue&&!failures.includes(issue))failures.push(issue);
  }
  assert.deepEqual(failures,[],`${label} keyboard focus is hard to see`);
}

async function runViewport(browser,viewport){
  const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1});
  const catalog=fixtureCatalog(),state=makeFixtureState(catalog),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await installFixtures(page,state);
  try{
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(page.locator(IP_ENTRY).first(),'IP navigation did not render');
    // Phones search from the header capsule (#q); the large landing form is desktop-only.
    try{await waitForVisible(page.locator('#homeSearch:visible, #q:visible').first(),'the landing search box did not render')}
    catch(error){throw new Error(`${error.message}; pageErrors=${pageErrors.join(' | ')}; cards=${await page.locator('#cards').innerText().catch(()=>'<unavailable>')}`,{cause:error})}
    assert.equal(new Set(await page.locator(IP_ENTRY).evaluateAll(items=>items.map(item=>item.dataset.ip).filter(id=>id&&id!=='all'))).size,6,`${viewport.name} should show six IP entry tiles`);
    assert.equal(await page.locator('#cards .game-entry').count(),0,`${viewport.name} the landing keeps only one game chooser`);
    assert.equal(await page.locator('.home-examples [data-example]').count()>=3,true,`${viewport.name} should show search examples`);
    const channelIds=[];
    const channels=page.locator('#channels .channel');
    for(let index=0;index<await channels.count();index+=1){
      const onclick=await channels.nth(index).getAttribute('onclick');
      const match=onclick?.match(/'([^']+)'/);
      if(match)channelIds.push(match[1]);
    }
    channelIds.push(...await page.locator(IP_ENTRY).evaluateAll(items=>items.map(item=>item.dataset.ip).filter(Boolean)));
    for(const id of gameIds)assert.ok(channelIds.includes(id)||await page.locator(`.game-pick[data-id="${id}"]`).count(),`${viewport.name} missing ${id} switch control`);
    await assertFocusRings(page,`${viewport.name} landing`);
    await page.evaluate(()=>document.activeElement?.blur());

    // First switch intentionally fails, then recovers through the visible UI retry.
    await clickIp(page,'pokemon');
    await retryBrowse(page);
    await waitForGame(page,'pokemon');

    const rarityFilter=page.locator('#rarityFilter');
    // Phones keep the selects in a bottom sheet: open it, choose, then 套用.
    const phone=viewport.width<=760;
    const chooseRarity=async value=>{
      if(phone){await page.locator('.filter-sheet-toggle').click();await waitForVisible(page.locator('#filterSheet.open'),`${viewport.name} filter sheet did not open`)}
      await rarityFilter.selectOption(String(value));
      if(phone)await page.locator('#filterSheet .filter-sheet-apply').click();
    };
    if(phone){await page.locator('.filter-sheet-toggle').click();await waitForVisible(rarityFilter,`${viewport.name} rarity filter missing`);await page.locator('#filterSheet .filter-sheet-close').click()}
    else await waitForVisible(rarityFilter,`${viewport.name} rarity filter missing`);
    const srValue=await rarityFilter.locator('option').evaluateAll(options=>options.find(option=>option.value==='SR'||/^SR(?:\b|（)/.test(option.textContent||''))?.value);
    assert.ok(srValue,`${viewport.name} fixture should expose an SR rarity option`);
    await chooseRarity(srValue);
    try{
      await page.waitForFunction(()=>{const text=document.querySelector('#cards')?.textContent||'';return /SR 測試卡/.test(text)&&!/C 測試卡/.test(text)},undefined,{timeout:8000});
    }catch(error){
      const snapshot=await page.locator('#cards').innerText().catch(()=>'<cards unavailable>');
      throw new Error(`${viewport.name} rarity filter did not settle: ${snapshot}; requests=${JSON.stringify(state.cardRequests)}`,{cause:error});
    }
    assert.equal(await page.locator('#cards .card').count(),1,`${viewport.name} rarity filter should leave one card`);
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('rarity')==='SR');
    assert.equal(new URL(page.url()).searchParams.get('game'),'pokemon');
    await chooseRarity('all');
    await waitForGame(page,'pokemon');

    // Open the deliberately broken-image card. Market and reports are both
    // unavailable, but the detail surface must remain usable and disclose the
    // missing image/optional service rather than throwing a page exception.
    const brokenCard=page.locator('#cards .card').filter({hasText:'故障圖測試卡'}).first();
    await waitForVisible(brokenCard,`${viewport.name} broken-image fixture card missing`);
    await brokenCard.click();
    await waitForVisible(page.locator('#modal.open .detail'),'card detail did not open after a real card click');
    await page.waitForFunction(()=>Boolean(new URL(location.href).searchParams.get('card')));
    await waitForVisible(page.locator('#modal.open .detail-art .unified-image-fallback'),'broken card image did not expose its fallback');
    const detailText=await page.locator('#modal.open').innerText();
    assert.match(detailText,/故障圖測試卡/);
    assert.match(detailText,/圖片待補|圖片來源待補|尚未收錄可公開顯示的圖片/);
    const marketTab=page.locator('#modal.open [data-detail-tab="market"]');
    if(await marketTab.count()){
      await marketTab.click();
      await waitForVisible(page.locator('#modal.open [data-detail-panel="market"]'),'optional market panel did not open');
      assert.match(await page.locator('#modal.open [data-detail-panel="market"]').innerText(),/沒有可靠|市場|不可用|待補/);
    }
    await page.locator('#close').click();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('card'));

    // Keyboard: the detail dialog takes focus, keeps Tab inside, and Escape hands focus back to the card.
    const opener=page.locator('#cards .card-open-hit[data-card-open]').first();
    const openerId=await opener.getAttribute('data-card-open');
    await opener.focus();
    await page.keyboard.press('Enter');
    await waitForVisible(page.locator('#modal.open .detail'),`${viewport.name} keyboard Enter did not open the detail`);
    await page.waitForFunction(()=>document.activeElement?.id==='close',undefined,{timeout:5000});
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(()=>document.getElementById('modal').contains(document.activeElement)),`${viewport.name} Shift+Tab left the detail dialog`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(id=>!document.getElementById('modal').classList.contains('open')&&document.activeElement?.dataset?.cardOpen===id,openerId,{timeout:5000});

    // Every visible control is at least 44x44 CSS px (links inside running text are exempt).
    const smallTargets=await page.evaluate(()=>[...document.querySelectorAll('button,select,input,summary')].filter(item=>item.getClientRects().length&&getComputedStyle(item).visibility!=='hidden'&&!item.closest('details:not([open])')).filter(item=>{const box=item.getBoundingClientRect();return box.width<43.5||box.height<43.5}).map(item=>item.id||String(item.className)||item.textContent.trim().slice(0,12)));
    assert.deepEqual(smallTargets,[],`${viewport.name} controls under 44px`);

    if(viewport.width<=760){
      await page.locator('nav.bottom [data-nav="search"]').click();
      await page.waitForFunction(()=>document.activeElement?.id==='q',undefined,{timeout:5000});
    }

    // Nineteen more real clicks make twenty IP switches in this viewport.
    // Every fourth fixture response is held back so an older selection returns
    // after a newer one; the final screen must still belong to the last click.
    const switchSequence=['onepiece','yugioh','haikyuu','weiss-schwarz','pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','pokemon','onepiece','yugioh','haikyuu','weiss-schwarz'];
    assert.equal(switchSequence.length+1,20);
    for(const id of switchSequence){await clickIp(page,id);await page.waitForTimeout(12);}
    const finalId=switchSequence.at(-1);
    await page.waitForTimeout(700);
    await waitForGame(page,finalId);
    const finalCardsText=await page.locator('#cards').innerText();
    assert.ok(!gameIds.filter(id=>id!==finalId).some(id=>finalCardsText.includes(gameLabels[id])),`${viewport.name} stale IP response repainted the final card grid`);
    assert.ok(state.cardRequests.length>=20,`${viewport.name} did not issue the expected browse requests`);

    // Cross-IP search remains available from the all-games landing state and
    // must show an honest zero result without fixture/demo cards.
    await clickIp(page,'all');
    const heroSearch=await page.locator('#heroQ').isVisible();
    await page.locator(heroSearch?'#heroQ':'#q').fill('no-such-card');
    await page.locator(heroSearch?'#heroGo':'#go').click();
    await waitForVisible(page.locator('#cards .search-empty'),'zero-result search did not show its empty state');
    assert.match(await page.locator('#cards .search-empty').innerText(),/找不到/);
    assert.equal(await page.locator('#cards .card').count(),0,`${viewport.name} zero-result search rendered cards`);
    assert.equal(new URL(page.url()).searchParams.get('q'),'no-such-card');
    if(viewport.name==='desktop'){
      await page.reload({waitUntil:'domcontentloaded'});
      await waitForVisible(page.locator('#cards .search-empty'),'reload did not restore the zero-result state');
      assert.equal(new URL(page.url()).searchParams.get('q'),'no-such-card','reload should preserve the search URL');
      await page.goBack({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.body.dataset.view==='landing',null,{timeout:8000}).catch(error=>{throw new Error(`browser Back did not restore the all-game landing: ${error.message}`)});
      assert.equal(await page.locator('#cardsSection.has-results').count(),0,'Back to the landing should clear the results');
      await page.goForward({waitUntil:'domcontentloaded'});
      await waitForVisible(page.locator('#cards .search-empty'),'reload did not restore the zero-result state');
    }
    assert.equal(pageErrors.length,0,`${viewport.name} page errors: ${pageErrors.join('; ')}`);
    assert.ok(state.optionalServiceFailures>=2,`${viewport.name} detail did not exercise both optional service failures`);
    return {viewport:viewport.name,switches:20,cardRequests:state.cardRequests.length,detailRequests:state.detailRequests.length,optionalServiceFailures:state.optionalServiceFailures};
  }finally{
    await page.close();
  }
}

// Release-gate items the viewport pass does not reach: share, recently viewed series, a slow network and reduced motion.
async function runPhaseTwoChecks(browser){
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const state=makeFixtureState(fixtureCatalog()),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await installFixtures(page,state);
  try{
    // Share copies the permanent card URL.
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:baseUrl});
    const cardId=state.catalog.cards.find(card=>card.game==='onepiece').id;
    await page.goto(`${baseUrl}/?game=onepiece&card=${encodeURIComponent(cardId)}`,{waitUntil:'domcontentloaded'});
    const share=page.locator('#modal.open [data-share-card]');
    await waitForVisible(share,'share button missing on a permanent card URL');
    // Test the clipboard path: Edge (local runs) has the system share sheet, CI's Chromium does not.
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:undefined,configurable:true}));
    await share.click();
    await page.waitForFunction(()=>document.querySelector('[data-share-card]')?.textContent==='已複製分享網址',undefined,{timeout:5000});
    const copied=new URL(await page.evaluate(()=>navigator.clipboard.readText()));
    assert.equal(copied.searchParams.get('card'),cardId,'shared URL should point at the open card');
    await page.keyboard.press('Escape');

    // Recently viewed: opening a series is remembered across a reload.
    await clickIp(page,'pokemon');
    await retryBrowse(page);
    await waitForGame(page,'pokemon');
    const seriesCard=page.locator('#seriesBand .band-tile:not(.band-tile-new)').first();
    await waitForVisible(seriesCard,'series navigation did not render a series card');
    await seriesCard.click();
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForVisible(page.locator('#seriesBand [data-band-tab="recent"]'),'recently viewed series did not survive a reload');

    // Slow network: a 2.5 s browse response shows a loading state, then the cards.
    await page.route('**/api/cards?*',async route=>{await sleep(2500);await route.fallback()});
    await clickIp(page,'onepiece');
    await waitForVisible(page.locator('#notice[data-state="loading"]'),'slow browse showed no loading state');
    await waitForGame(page,'onepiece');
    await page.waitForFunction(()=>document.querySelector('#notice')?.dataset.state!=='loading',undefined,{timeout:5000});
    assert.equal(pageErrors.length,0,`phase-two page errors: ${pageErrors.join('; ')}`);
  }finally{await page.close()}

  // Reduced motion removes transitions.
  const calm=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try{
    await installFixtures(calm,makeFixtureState(fixtureCatalog()));
    await calm.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(calm.locator('#channels .channel').first(),'reduced motion: IP navigation did not render');
    // The channel row is re-rendered after data loads; a detached element reports an empty style (NaN), so wait and query fresh.
    await calm.waitForLoadState('networkidle');
    const durations=await calm.evaluate(()=>getComputedStyle(document.querySelector('#channels .channel')).transitionDuration.split(',').map(value=>parseFloat(value)*(value.trim().endsWith('ms')?1:1000)));
    assert.ok(durations.every(ms=>ms<=1),`reduced motion: channel transitions still run (${durations.join(', ')} ms)`);
    // Nothing keeps moving: the hero mascot float, card fade-ins and skeleton pulses all stop.
    await calm.waitForTimeout(300);
    const running=await calm.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').map(animation=>`${animation.animationName||animation.transitionProperty}@${animation.effect?.target?.className||''}`));
    assert.deepEqual(running,[],'reduced motion: animations still running');
  }finally{await calm.close()}

  // First visit: the guided tour opens on its own, Escape closes it and it stays closed.
  const visitor=await browser.newPage({viewport:{width:1440,height:1000}});
  try{
    await installFixtures(visitor,makeFixtureState(fixtureCatalog()),{returning:false});
    await visitor.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(visitor.locator('.cs1-tour'),'first visit: the guided tour did not open');
    await visitor.keyboard.press('Escape');
    await visitor.locator('.cs1-tour').waitFor({state:'detached',timeout:5000});
    assert.equal(await visitor.evaluate(()=>localStorage.getItem('cs-tour-done')),'1','closing the tour should remember it');
  }finally{await visitor.close()}
  return {viewport:'phase-two',checks:['share','recent','slow-network','reduced-motion','first-visit-tour']};
}

const launchOptions={headless:true};
if(requestedChannel)launchOptions.channel=requestedChannel;
let browser;
try{
  browser=await chromium.launch(launchOptions);
}catch(error){
  if(requestedChannel||process.env.CI)throw error;
  // The bundled Windows runtime commonly has Edge but not a downloaded
  // Chromium. Keep local validation reproducible while CI pins Chromium.
  browser=await chromium.launch({headless:true,channel:'msedge'});
}
try{
  const results=[];
  for(const viewport of viewports)results.push(await runViewport(browser,viewport));
  results.push(await runPhaseTwoChecks(browser));
  // 200% zoom on a 1280x800 screen: the header scrolls away and nothing overflows sideways.
  const zoomed=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1});
  try{
    await installFixtures(zoomed,makeFixtureState(fixtureCatalog()));
    await zoomed.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(zoomed.locator(IP_ENTRY).first(),'200% zoom: IP navigation did not render');
    const layout=await zoomed.evaluate(()=>({header:getComputedStyle(document.querySelector('.top')).position,overflow:document.documentElement.scrollWidth-innerWidth}));
    assert.equal(layout.header,'static','200% zoom: the header should not stay pinned');
    assert.ok(layout.overflow<=0,`200% zoom: page overflows sideways by ${layout.overflow}px`);
    // The game page and the card detail also fit, and the detail's close button is not covered.
    await clickIp(zoomed,'pokemon');
    await retryBrowse(zoomed);
    await waitForGame(zoomed,'pokemon');
    assert.ok(await zoomed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom: game page overflows sideways');
    await zoomed.locator('#cards .card-open-hit[data-card-open]').first().click();
    await waitForVisible(zoomed.locator('#modal.open .detail'),'200% zoom: card detail did not open');
    const closeHit=await zoomed.evaluate(()=>{const box=document.getElementById('close').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight&&document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('#close')!==null});
    assert.ok(closeHit,'200% zoom: the detail close button is off screen or covered');
    results.push({viewport:'zoom-200',header:layout.header});
  }finally{await zoomed.close()}
  console.log(`Beta browser smoke passed: ${JSON.stringify(results)}`);
}finally{
  await browser.close();
}
