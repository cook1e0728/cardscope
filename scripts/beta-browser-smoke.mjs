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
const gameIds=['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz'];
const gameLabels={
  pokemon:'寶可夢',
  onepiece:'航海王',
  yugioh:'遊戲王',
  haikyuu:'排球少年',
  'weiss-schwarz':'葬送的芙莉蓮'
};
const gameCodes={pokemon:'SV',onepiece:'OP',yugioh:'YS',haikyuu:'HV','weiss-schwarz':'S'};
const healthySvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><rect width="500" height="700" rx="24" fill="#fff"/><rect x="14" y="14" width="472" height="672" rx="18" fill="#7edbd2" stroke="#171717" stroke-width="12"/><rect x="45" y="58" width="410" height="505" fill="#ffe46c"/><text x="250" y="630" text-anchor="middle" font-size="30" font-family="sans-serif">BETA FIXTURE</text></svg>';

const sleep=milliseconds=>new Promise(resolveSleep=>setTimeout(resolveSleep,milliseconds));
const responseBody=(route,body,status=200)=>route.fulfill({
  status,
  contentType:'application/json; charset=utf-8',
  body:JSON.stringify(body)
});

function gameDefinition(id){
  return {id,nameZh:gameLabels[id],nameEn:id==='pokemon'?'Pokémon':id==='onepiece'?'ONE PIECE':id==='yugioh'?'Yu-Gi-Oh!':id==='haikyuu'?'Haikyuu!!':'Weiß Schwarz'};
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

async function installFixtures(page,state){
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

async function clickIp(page,id){
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
    const context=document.querySelector('#gameContext')?.textContent||'';
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

async function runViewport(browser,viewport){
  const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1});
  const catalog=fixtureCatalog(),state=makeFixtureState(catalog),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await installFixtures(page,state);
  try{
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(page.locator('#channels .channel').first(),'IP navigation did not render');
    assert.equal(await page.locator('#cards .game-entry').count(),5,`${viewport.name} should show five IP landing entries`);
    const channelIds=[];
    const channels=page.locator('#channels .channel');
    for(let index=0;index<await channels.count();index+=1){
      const onclick=await channels.nth(index).getAttribute('onclick');
      const match=onclick?.match(/'([^']+)'/);
      if(match)channelIds.push(match[1]);
    }
    for(const id of gameIds)assert.ok(channelIds.includes(id)||await page.locator(`.game-pick[data-id="${id}"]`).count(),`${viewport.name} missing ${id} switch control`);

    // First switch intentionally fails, then recovers through the visible UI retry.
    await clickIp(page,'pokemon');
    await retryBrowse(page);
    await waitForGame(page,'pokemon');

    const rarityFilter=page.locator('#rarityFilter');
    await waitForVisible(rarityFilter,`${viewport.name} rarity filter missing`);
    const srValue=await rarityFilter.locator('option').evaluateAll(options=>options.find(option=>option.value==='SR'||/^SR(?:\b|（)/.test(option.textContent||''))?.value);
    assert.ok(srValue,`${viewport.name} fixture should expose an SR rarity option`);
    await rarityFilter.selectOption(String(srValue));
    try{
      await page.waitForFunction(()=>{const text=document.querySelector('#cards')?.textContent||'';return /SR 測試卡/.test(text)&&!/C 測試卡/.test(text)},undefined,{timeout:8000});
    }catch(error){
      const snapshot=await page.locator('#cards').innerText().catch(()=>'<cards unavailable>');
      throw new Error(`${viewport.name} rarity filter did not settle: ${snapshot}; requests=${JSON.stringify(state.cardRequests)}`,{cause:error});
    }
    assert.equal(await page.locator('#cards .card').count(),1,`${viewport.name} rarity filter should leave one card`);
    await rarityFilter.selectOption('all');
    await waitForGame(page,'pokemon');

    // Open the deliberately broken-image card. Market and reports are both
    // unavailable, but the detail surface must remain usable and disclose the
    // missing image/optional service rather than throwing a page exception.
    const brokenCard=page.locator('#cards .card').filter({hasText:'故障圖測試卡'}).first();
    await waitForVisible(brokenCard,`${viewport.name} broken-image fixture card missing`);
    await brokenCard.click();
    await waitForVisible(page.locator('#modal.open .detail'),'card detail did not open after a real card click');
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
    await page.locator('#q').fill('no-such-card');
    await page.locator('#go').click();
    await waitForVisible(page.locator('#notice'),'zero-result search did not update its notice');
    await page.waitForFunction(()=>/找不到結果/.test(document.querySelector('#notice')?.textContent||''),undefined,{timeout:8000});
    assert.match(await page.locator('#notice').innerText(),/找不到結果/);
    assert.equal(await page.locator('#cards .card').count(),0,`${viewport.name} zero-result search rendered cards`);
    assert.equal(pageErrors.length,0,`${viewport.name} page errors: ${pageErrors.join('; ')}`);
    assert.ok(state.optionalServiceFailures>=2,`${viewport.name} detail did not exercise both optional service failures`);
    return {viewport:viewport.name,switches:20,cardRequests:state.cardRequests.length,detailRequests:state.detailRequests.length,optionalServiceFailures:state.optionalServiceFailures};
  }finally{
    await page.close();
  }
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
  console.log(`Beta browser smoke passed: ${JSON.stringify(results)}`);
}finally{
  await browser.close();
}
