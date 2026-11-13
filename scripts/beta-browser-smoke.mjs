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
  'weiss-schwarz':'黑白雙翼',
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

// Phones (≤760px) keep the game list in the sidebar's bottom sheet (side-nav.js), opened from the bottom nav 圖鑑; wider screens show #channels on the landing page and the docked sidebar on game pages.
const IP_ENTRY='#channels .channel';
const isPhone=page=>page.viewportSize().width<=760;
async function waitForIpEntry(page,message){
  if(isPhone(page))await page.locator(IP_ENTRY).first().waitFor({state:'attached',timeout:8000}).catch(error=>{throw new Error(`${message}: ${error.message}`)});
  else await waitForVisible(page.locator(`${IP_ENTRY}:visible`).first(),message);
}
async function openSheet(page){
  if(await page.locator('#sideNav.open').count())return;
  await page.locator('nav.bottom [data-nav="browse"]').click();
  await waitForVisible(page.locator('#sideNav.open .channel').first(),'the phone sheet did not open');
}
async function closeSheet(page){
  if(!await page.locator('#sideNav.open').count())return;
  await page.locator('#sideClose').click();
  await page.locator('#sideNav.open').waitFor({state:'detached',timeout:5000});
}
async function clickIp(page,id){
  // Phones: the sheet is the only game list. It stays visible for a moment while closing, so never pick #channels there.
  if(isPhone(page)){await openSheet(page);await page.locator(`#sideNav .channel[data-ip="${id}"]`).click();await closeSheet(page);return;}
  const channel=page.locator(`${IP_ENTRY}[data-ip="${id}"]:visible`).first();
  if(await channel.count()){await channel.click();return;}
  const mobileSelect=page.locator('#mobileGameSelect:visible');
  if(await mobileSelect.count()){await mobileSelect.selectOption(id);return;}
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
    await waitForIpEntry(page,'IP navigation did not render');
    // Phones search from the header capsule (#q); the large landing form is desktop-only.
    try{await waitForVisible(page.locator('#homeSearch:visible, #q:visible').first(),'the landing search box did not render')}
    catch(error){throw new Error(`${error.message}; pageErrors=${pageErrors.join(' | ')}; cards=${await page.locator('#cards').innerText().catch(()=>'<unavailable>')}`,{cause:error})}
    assert.equal(new Set(await page.locator(IP_ENTRY).evaluateAll(items=>items.map(item=>item.dataset.ip).filter(id=>id&&id!=='all'))).size,6,`${viewport.name} should show six IP entry tiles`);
    assert.equal(await page.locator('.mobile-quick-grid').count(),0,`${viewport.name} the 2x5 quick grid is gone (the sidebar owns game navigation)`);
    assert.equal(await page.locator('#sideNav:visible').count(),0,`${viewport.name} the landing has no sidebar`);
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
    // 階段 3：工具列只有一套（顯示｜分組｜稀有度｜排序｜收藏狀態），手機也一樣，不再有底部篩選面板；選稀有度就直接選，改完立刻生效。
    const chooseRarity=async value=>{await rarityFilter.selectOption(String(value))};
    assert.equal(await page.locator('.filter-sheet-toggle, #filterSheet, .rarity-pills, .rarity-hud').count(),0,`${viewport.name} the old phone filter sheet and rarity quick-pick are gone`);
    await waitForVisible(rarityFilter,`${viewport.name} rarity filter missing`);
    assert.deepEqual(await page.locator('#cardControls').evaluate(row=>[...row.children].filter(item=>!item.hidden).map(item=>item.id||item.className.split(' ')[0])),['cardViewSwitch','cardGroupSwitch','filter-field','filter-field','collectionState'],`${viewport.name} toolbar order: display | grouping | rarity | sort | collection state`);
    assert.equal(await page.locator('#cardTools .filter-field:not([hidden])').count(),2,`${viewport.name} one rarity select and one sort select (the price filter only shows when verified prices exist), no second set`);
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

    // 收藏是一個動作：☆ 加 1 張、「− 數量 ＋」調整、減到 0 取消；只重畫那一張卡，其他卡的節點留著（B7）。
    const wallCards=page.locator('#cards .card');
    assert.ok(await wallCards.count()>=2,`${viewport.name} need two cards to check single-card repaint`);
    await page.evaluate(()=>{document.querySelectorAll('#cards .card').forEach((card,index)=>{card.dataset.smokeNode=String(index)})});
    const first=wallCards.nth(0),firstStar=first.locator('.favorite-toggle');
    assert.equal(await first.locator('.card-ctx').count(),0,`${viewport.name} a single series page keeps game, series and version labels off the cards`);
    const starBox=await firstStar.boundingBox();assert.ok(starBox.width>=44&&starBox.height>=44,`${viewport.name} the collect star is a 44px target`);
    await firstStar.click();
    await waitForVisible(first.locator('.watchlist-inline'),`${viewport.name} one press on ☆ should add the card`);
    assert.equal(await first.locator('.watch-quantity').innerText(),'1');
    assert.match(await first.locator('.watchlist-inline').getAttribute('aria-label'),/已收藏 1 張/);
    await first.locator('[data-watch-increment]').click();
    assert.equal(await first.locator('.watch-quantity').innerText(),'2');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#cards .card')].map(card=>card.dataset.smokeNode).join()),await wallCards.evaluateAll(cards=>cards.map((_,index)=>String(index)).join()),`${viewport.name} collecting must not rebuild the wall`);
    await first.locator('[data-watch-decrement]').click();
    await first.locator('[data-watch-decrement]').click();
    await waitForVisible(first.locator('.favorite-toggle'),`${viewport.name} going to 0 should cancel the collection`);
    assert.equal(await first.locator('.watchlist-inline').count(),0);

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
    // 階段 4：沒有分頁。價格區塊一直在資訊下面；行情服務失敗只讓價格區塊說明讀不到（整頁仍可用），按頂端的「價格」跳到那裡。
    await page.waitForFunction(()=>{const body=document.querySelector('#modal.open [data-price-body]');return body&&body.getAttribute('aria-busy')!=='true'},undefined,{timeout:8000});
    assert.equal(await page.locator('#modal.open [data-detail-tab], #modal.open [role="tablist"]').count(),0,`${viewport.name} the detail has no tabs any more`);
    await page.locator('#modal.open [data-detail-jump]').click();
    await page.waitForFunction(()=>document.activeElement?.id==='detailPriceTitle',undefined,{timeout:5000});
    // 平滑捲動要幾百毫秒；捲完後標題在頂端列（sticky）下面、視窗內，沒有被蓋住
    await page.waitForFunction(()=>{const box=document.getElementById('detailPriceTitle').getBoundingClientRect(),bar=document.querySelector('#modal .detail-bar').getBoundingClientRect();return box.top>=bar.bottom-1&&box.top<innerHeight},undefined,{timeout:5000}).catch(()=>{throw new Error(`${viewport.name} the price title is not on screen (below the sticky bar) after the jump`)});
    // 走勢區塊捲進視窗才請求（IntersectionObserver）；請求失敗時價格區塊說明讀不到，不影響其餘內容。
    await page.waitForFunction(()=>{const slot=document.querySelector('#modal.open [data-price-trend]');return slot?.dataset.loaded==='1'&&slot.textContent.trim()&&!slot.textContent.includes('正在讀取價格紀錄')},undefined,{timeout:8000});
    assert.match(await page.locator('#modal.open [data-price-body]').innerText(),/行情服務暫時無法回應|沒有可靠|市場|不可用|待補|暫時無法讀取/);
    await page.locator('#close').click();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('card'));

    // Keyboard: the detail takes focus when it opens; the full-screen page (under 1000px) keeps Tab inside, the desktop side panel lets Tab go on to the wall; Escape hands focus back to the card.
    const opener=page.locator('#cards .card-open-hit[data-card-open]').first();
    const openerId=await opener.getAttribute('data-card-open');
    await opener.focus();
    await page.keyboard.press('Enter');
    await waitForVisible(page.locator('#modal.open .detail'),`${viewport.name} keyboard Enter did not open the detail`);
    await page.waitForFunction(()=>document.activeElement?.id==='close',undefined,{timeout:5000});
    const panelMode=viewport.width>=1000;
    for(let press=0;press<14;press+=1)await page.keyboard.press('Shift+Tab');
    const stillInside=await page.evaluate(()=>document.getElementById('modal').contains(document.activeElement));
    if(panelMode)assert.equal(stillInside,false,`${viewport.name} the side panel traps Tab: Shift+Tab never reached the wall`);
    else assert.ok(stillInside,`${viewport.name} Shift+Tab left the full-screen detail`);
    // 回到卡牆之後 Escape 仍然只關側板（焦點不在輸入元件），焦點回到打開它的那張卡
    if(panelMode)await opener.focus();
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
    assert.ok(state.optionalServiceFailures>=1,`${viewport.name} detail did not exercise the optional market service failure`);
    return {viewport:viewport.name,switches:20,cardRequests:state.cardRequests.length,detailRequests:state.detailRequests.length,optionalServiceFailures:state.optionalServiceFailures};
  }finally{
    await page.close();
  }
}

// Left sidebar (side-nav.js): docked on desktop, drawer at tablet width, bottom sheet on phones. Pokemon is avoided on purpose: its first browse request is a fixture failure.
async function runSidebarChecks(browser){
  const open=async(width,height,{init,url='/?game=onepiece'}={})=>{
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
    if(init)await page.addInitScript(init);
    await installFixtures(page,makeFixtureState(fixtureCatalog()));
    await page.goto(baseUrl+url,{waitUntil:'domcontentloaded'});
    await waitForGame(page,new URL(baseUrl+url).searchParams.get('game'));
    return page;
  };
  const current=page=>page.evaluate(()=>[...document.querySelectorAll('#sideNav .channel[aria-current="true"]')].map(item=>item.dataset.ip));
  const inside=page=>page.evaluate(()=>document.getElementById('sideNav').contains(document.activeElement));
  // Desktop: docked, selected state, real clicks keep the URL and Back working, collapse survives a reload, keyboard reaches and activates items.
  let page=await open(1440,900);
  try{
    await waitForVisible(page.locator('#sideNav'),'desktop: the sidebar is not visible on a game page');
    assert.deepEqual(await current(page),['onepiece'],'desktop: the open game carries aria-current in the sidebar');
    const box=await page.locator('#sideNav').boundingBox();
    assert.ok(box.x===0&&box.width>=240&&box.width<=264,`desktop: sidebar width ${box.width}`);
    const toggle=page.locator('#sideToggle');
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await toggle.getAttribute('aria-controls'),'sideBody');
    assert.equal(await page.locator('#sideBody').count(),1,'desktop: aria-controls points at a real element');
    assert.equal(await page.locator('#sideNav [data-region], #sideNav .band-tile').count()>0,true,'desktop: the version and series controls live in the sidebar');
    assert.equal(await page.locator('#channels').count(),1,'desktop: one copy of the game list');
    assert.equal(await page.locator('a.skip-link[href="#main"]').count(),1,'desktop: the skip link still targets the main region');
    await page.locator('#sideNav .channel[data-ip="yugioh"]').click();
    await waitForGame(page,'yugioh');
    assert.equal(new URL(page.url()).searchParams.get('game'),'yugioh','desktop: a sidebar click updates the URL');
    assert.deepEqual(await current(page),['yugioh']);
    await page.goBack({waitUntil:'domcontentloaded'});
    await waitForGame(page,'onepiece');
    assert.equal(new URL(page.url()).searchParams.get('game'),'onepiece','desktop: Back restores the previous game');
    assert.deepEqual(await current(page),['onepiece']);
    await page.locator('#sideNav .channel[data-ip="haikyuu"]').focus();
    await page.keyboard.press('Enter');
    await waitForGame(page,'haikyuu');
    const toggleNow=page.locator('#sideToggle');
    await toggleNow.click();
    assert.equal(await toggleNow.getAttribute('aria-expanded'),'false');
    assert.equal((await page.locator('#sideNav').boundingBox()).width<=64,true,'desktop: collapsed to a rail');
    assert.equal(await page.evaluate(()=>localStorage.getItem('cardscope-side-collapsed')),'1','desktop: the collapsed flag is stored');
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForGame(page,'haikyuu');
    assert.equal(await page.locator('#sideToggle').getAttribute('aria-expanded'),'false','desktop: collapsed state survives a reload');
    await page.locator('#sideToggle').click();
    assert.equal(await page.locator('#sideToggle').getAttribute('aria-expanded'),'true');
    assert.deepEqual(page.errors,[],`desktop page errors: ${page.errors.join('; ')}`);
  }finally{await page.close()}
  // Blocked storage must not break the sidebar.
  page=await open(1440,900,{init:()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked')}})}});
  try{
    await waitForVisible(page.locator('#sideNav'),'blocked storage: the sidebar did not render');
    await page.locator('#sideToggle').click();
    assert.equal(await page.locator('#sideToggle').getAttribute('aria-expanded'),'false','blocked storage: the toggle still works');
    assert.deepEqual(page.errors,[],`blocked storage page errors: ${page.errors.join('; ')}`);
  }finally{await page.close()}
  // Tablet: hidden until 目錄 is pressed; Escape closes it and focus returns to the button.
  page=await open(900,900);
  try{
    assert.equal(await page.locator('#sideNav:visible').count(),0,'tablet: the sidebar starts hidden');
    const menu=page.locator('#sideMenuBtn');
    await menu.click();
    await waitForVisible(page.locator('#sideNav.open'),'tablet: the drawer did not open');
    assert.equal(await menu.getAttribute('aria-expanded'),'true');
    assert.ok(await inside(page),'tablet: focus moves into the drawer');
    await page.keyboard.press('Escape');
    await page.locator('#sideNav.open').waitFor({state:'detached',timeout:5000});
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'sideMenuBtn','tablet: focus returns to the opener');
    assert.deepEqual(page.errors,[],`tablet page errors: ${page.errors.join('; ')}`);
  }finally{await page.close()}
  // Phone: bottom sheet from the bottom nav and from 選系列; focus is trapped, Escape and the scrim close it, focus returns.
  page=await open(390,844);
  try{
    const sheetButton=page.locator('#sideSheetBtn');
    await waitForVisible(sheetButton,'phone: the 選系列 button is missing on a game page');
    await sheetButton.click();
    await waitForVisible(page.locator('#sideNav.open'),'phone: the sheet did not open');
    assert.ok(await inside(page),'phone: focus moves into the sheet');
    for(let index=0;index<40;index+=1){await page.keyboard.press('Tab');if(!await inside(page))assert.fail('phone: Tab left the sheet')}
    await page.keyboard.press('Escape');
    await page.locator('#sideNav.open').waitFor({state:'detached',timeout:5000});
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'sideSheetBtn','phone: focus returns to 選系列');
    await page.locator('nav.bottom [data-nav="browse"]').click();
    await waitForVisible(page.locator('#sideNav.open'),'phone: the bottom nav 圖鑑 did not open the sheet');
    await page.mouse.click(195,60);
    await page.locator('#sideNav.open').waitFor({state:'detached',timeout:5000});
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.nav),'browse','phone: focus returns to the bottom nav button');
    await clickIp(page,'yugioh');
    await waitForGame(page,'yugioh');
    await page.goBack({waitUntil:'domcontentloaded'});
    await waitForGame(page,'onepiece');
    assert.equal(new URL(page.url()).searchParams.get('game'),'onepiece','phone: Back after a sheet selection restores the previous game');
    assert.equal(await page.locator('#sideNav.open').count(),0,'phone: Back leaves the sheet closed');
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForGame(page,'onepiece');
    assert.equal(await page.locator('#sideNav.open').count(),0,'phone: a reload does not reopen the sheet');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone: no sideways scroll');
    assert.deepEqual(page.errors,[],`phone page errors: ${page.errors.join('; ')}`);
  }finally{await page.close()}
  return {viewport:'sidebar',checks:['selected','url','back','collapse','blocked-storage','drawer','sheet-focus']};
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
    // 首頁「最新系列」只列有發售日的系列；桌機沒有它時導覽只剩兩個目標（底部導覽列只在手機），不會自動開啟。只在這一頁給日期：其他頁的「首次瀏覽失敗」計數不能被最新系列的請求先用掉。
    const visitorCatalog=fixtureCatalog();visitorCatalog.series.forEach(row=>{row.releaseDate='2026-09-01'});
    await installFixtures(visitor,makeFixtureState(visitorCatalog),{returning:false});
    await visitor.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForVisible(visitor.locator('.cs1-tour'),'first visit: the guided tour did not open');
    await visitor.keyboard.press('Escape');
    await visitor.locator('.cs1-tour').waitFor({state:'detached',timeout:5000});
    assert.equal(await visitor.evaluate(()=>localStorage.getItem('cs-tour-done')),'1','closing the tour should remember it');
  }finally{await visitor.close()}
  return {viewport:'phase-two',checks:['share','recent','slow-network','reduced-motion','first-visit-tour']};
}

// 階段 5：收藏頁（?view=collection）與行情頁（?view=market）。收藏只存在這台裝置；壞檔匯入不動既有收藏；上一頁回到原本那頁。
// 舊的「我的收藏」對話框已拿掉：這裡取代它，用同一個入口（頂欄／底部導覽的「我的收藏」）走到頁面。
async function runCollectionChecks(browser,viewport){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},acceptDownloads:true});
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const label=`${viewport.name} collection page`;
  try{
    await installFixtures(page,makeFixtureState(fixtureCatalog()));
    const mover=(id,name,percent,from,to)=>({cardId:id,name,seriesCode:'SV',cardNumber:'001',imageUrl:null,changePercent:percent,from:{amountTwd:from*35,amount:from,date:'2026-10-30'},to:{amountTwd:to*35,amount:to,date:'2026-11-12'}});
    await page.route('**/api/price-movers',route=>responseBody(route,{data:{up:[mover('u1','皮卡丘 ex',42.5,20,28.5)],down:[mover('d1','水箭龜 ex',-22,30,23.4)]},meta:{windowDays:14,minAmount:5,note:''}}));
    await page.route('**/api/market-events',route=>responseBody(route,{data:[{date:'2026-11-20',game:'pokemon',title:'新彈發售',url:null,source:'官方'}],meta:{note:'發售日與官方消息'}}));
    const view=()=>page.evaluate(()=>document.body.dataset.view);
    const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    const entry=()=>page.locator('[data-nav="collection"]:visible').first();
    const goHome=async()=>{await page.goto(baseUrl,{waitUntil:'domcontentloaded'});await waitForVisible(page.locator('[data-nav="collection"]:visible').first(),`${label}: the 我的收藏 entry did not render`)};
    const openCollection=async()=>{await entry().click();await page.waitForFunction(()=>document.body.dataset.view==='collection',undefined,{timeout:8000})};
    const addCards=async(game,count)=>{
      await page.goto(`${baseUrl}/?game=${game}`,{waitUntil:'domcontentloaded'});
      const retry=page.locator('button.notice-retry, #notice button, .cards-state button').filter({hasText:/重試|再試/}).first();
      await Promise.race([page.locator('#cards .card').first().waitFor({timeout:8000}),retry.waitFor({timeout:8000})]).catch(()=>{});
      if(await retry.count()&&await retry.isVisible())await retry.click();
      await waitForVisible(page.locator('#cards .card').first(),`${label}: ${game} wall did not load`);
      for(let index=0;index<count;index+=1){const card=page.locator('#cards .card').nth(index);await card.locator('.favorite-toggle').click();await waitForVisible(card.locator('.watchlist-inline'),`${label}: ☆ should collect ${game} card ${index}`)}
    };
    const stored=()=>page.evaluate(()=>localStorage.getItem('cardscope-watchlist')+'|'+localStorage.getItem('cardscope-watchlist-meta'));

    // 空的收藏：兔子、一句話、一顆主要按鈕；上一頁回到原本那頁（首頁）。
    await goHome();
    await openCollection();
    assert.equal(new URL(page.url()).searchParams.get('view'),'collection',`${label}: the entry should push ?view=collection`);
    assert.equal(await page.title(),'我的收藏｜CardScope');
    assert.equal(await page.locator('[data-coll-explore]').count(),1,`${label}: the empty state has one button to the catalog`);
    assert.match(await page.locator('#cards').innerText(),/還沒有收藏/);
    assert.ok(await overflow()<=0,`${label}: empty collection overflows sideways`);
    await page.goBack();
    await page.waitForFunction(()=>document.body.dataset.view!=='collection',undefined,{timeout:5000});
    assert.equal(new URL(page.url()).search,'',`${label}: back returns to the page before`);

    // 收藏三張，回首頁再進收藏頁：卡牆混排帶遊戲／系列／版本，側欄（桌機）只列有收藏的遊戲。
    await addCards('pokemon',2);
    await addCards('onepiece',1);
    await goHome();
    await openCollection();
    await waitForVisible(page.locator('#cards .card').first(),`${label}: the wall did not render`);
    assert.equal(await page.locator('#cards .card').count(),3);
    assert.ok(await page.locator('#cards .card-ctx').count()>=3,`${label}: a mixed wall labels each card with game, series and version`);
    assert.ok(await overflow()<=0,`${label}: collection page overflows sideways`);
    if(viewport.width>760){
      assert.equal(await page.locator('#sideColl [data-coll-game]').count(),2,`${label}: the side list holds only games with collected cards`);
      await page.locator('#sideColl [data-coll-game="onepiece"]').click();
      await page.waitForFunction(()=>document.querySelectorAll('#cards .card').length===1,undefined,{timeout:5000});
      await page.locator('#sideColl .coll-side-btn').first().click();
      await page.waitForFunction(()=>document.querySelectorAll('#cards .card').length===3,undefined,{timeout:5000});
    }

    // 管理選單：四個動作、44px、Esc 只關選單。
    await page.locator('#collManageBtn').click();
    await waitForVisible(page.locator('#collMenu'),`${label}: the 管理 menu did not open`);
    assert.equal(await page.locator('#collManageBtn').getAttribute('aria-expanded'),'true');
    assert.deepEqual((await page.locator('#collMenu [role^="menuitem"]').allInnerTexts()).map(text=>text.trim()),['匯出備份','匯入備份','下載 CSV','各系列進度']);
    assert.deepEqual(await page.locator('#collMenu [role^="menuitem"]').evaluateAll(items=>items.filter(item=>item.getBoundingClientRect().height<44).map(item=>item.textContent)),[],`${label}: menu items are 44px targets`);
    await page.keyboard.press('Escape');
    await page.locator('#collMenu').waitFor({state:'hidden',timeout:3000});
    assert.equal(await view(),'collection',`${label}: Escape closes the menu, not the page`);

    // 側板的收藏欄位：改品況與備註，重新整理後還在。
    await page.locator('#cards .card-open-hit[data-card-open]').first().click();
    await waitForVisible(page.locator('#modal.open .coll-edit'),`${label}: the side panel has no collection editor`);
    assert.match(await page.evaluate(()=>location.search),/view=collection&card=/,`${label}: the card opens on top of the collection page`);
    await page.locator('#modal.open [data-coll-field="condition"]').selectOption('LP');
    await page.locator('#modal.open [data-coll-field="note"]').fill('冒煙測試備註');
    await page.waitForTimeout(300);
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForVisible(page.locator('#modal.open .coll-edit'),`${label}: the card did not reopen after reload`);
    assert.equal(await page.locator('#modal.open [data-coll-field="condition"]').inputValue(),'LP');
    assert.equal(await page.locator('#modal.open [data-coll-field="note"]').inputValue(),'冒煙測試備註');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#modal.open')&&new URL(location.href).searchParams.get('view')==='collection'&&!new URL(location.href).searchParams.get('card'),undefined,{timeout:5000});

    // 匯出、CSV。
    await page.locator('#collManageBtn').click();
    const [backup]=await Promise.all([page.waitForEvent('download'),page.locator('#collMenu [data-coll-export]').click()]);
    assert.match(backup.suggestedFilename(),/^cardscope-collection-\d{4}-\d{2}-\d{2}\.json$/);
    const {readFile}=await import('node:fs/promises');
    const backupText=await readFile(await backup.path(),'utf8');
    assert.equal(JSON.parse(backupText).items.length,3);
    assert.match(await page.locator('#collStatus').innerText(),/已匯出 3 款、3 張/);
    await page.locator('#collManageBtn').click();
    const [csv]=await Promise.all([page.waitForEvent('download'),page.locator('#collectionCsv').click()]);
    assert.equal(csv.suggestedFilename(),'cardscope-watchlist.csv');
    assert.match(await readFile(await csv.path(),'utf8'),/輕微使用痕跡 LP.*冒煙測試備註/);

    // 壞檔匯入：說明原因、既有收藏一個字都沒動。
    const before=await stored();
    await page.setInputFiles('#collFile',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"nope":')});
    await page.waitForFunction(()=>/沒有匯入/.test(document.getElementById('collStatus')?.textContent||''),undefined,{timeout:5000});
    assert.match(await page.locator('#collStatus').innerText(),/既有收藏沒有變動/);
    assert.equal(await stored(),before,`${label}: a refused file must not touch the collection`);

    // 清空後匯入備份：先預覽，按「確認匯入」才寫入，品況與備註跟著回來。
    await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(/watchlist|collection/i.test(key))localStorage.removeItem(key)});
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForVisible(page.locator('[data-coll-explore]'),`${label}: an emptied collection shows the empty state`);
    await page.setInputFiles('#collFile',{name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backupText)});
    await waitForVisible(page.locator('#collImport'),`${label}: the import preview did not appear`);
    assert.equal(await page.locator('#cards .card').count(),0,`${label}: nothing is written before 確認匯入`);
    await page.locator('[data-coll-import-confirm]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#cards .card').length===3,undefined,{timeout:8000});
    assert.match(await page.locator('#collStatus').innerText(),/已匯入：新增 3 筆/);
    assert.ok((await stored()).includes('LP')&&(await stored()).includes('冒煙測試備註'),`${label}: condition and note came back with the import`);

    // 上一頁：從首頁進收藏頁再按上一頁，回到首頁。
    await goHome();
    await openCollection();
    await page.goBack();
    await page.waitForFunction(()=>document.body.dataset.view!=='collection',undefined,{timeout:5000});
    assert.equal(await view(),'landing',`${label}: back returns to the home page`);

    // 行情頁：首頁最夯 → 看參考價漲跌 → 上一頁。
    await page.locator('[data-rails-tab="trending"]').click();
    const more=page.locator('.rails-more a[data-spa]').first();
    await waitForVisible(more,`${label}: home 最夯 has no 看參考價漲跌 link`);
    await more.click();
    await page.waitForFunction(()=>document.body.dataset.view==='market',undefined,{timeout:8000});
    assert.equal(new URL(page.url()).searchParams.get('view'),'market');
    assert.equal(await page.title(),'卡牌參考價漲跌與時事｜CardScope');
    assert.equal((await page.locator('#marketTitle').innerText()).trim(),'行情');
    await waitForVisible(page.locator('#trendsSection .trend-card').first(),`${label}: the market page lacks the price movers`);
    assert.match(await page.locator('#trendsSection').innerText(),/歐洲平台參考價，不是成交價/);
    await waitForVisible(page.locator('#eventsSection li').first(),`${label}: the market page lacks the card events`);
    assert.equal(await page.locator('#hero:visible, #homeRails:visible').count(),0,`${label}: the home hero and rails stay off the market page`);
    assert.equal(await page.locator('[data-nav]:visible').count(),3,`${label}: the top bar keeps three buttons`);
    assert.ok(await overflow()<=0,`${label}: market page overflows sideways`);
    await page.goBack();
    await page.waitForFunction(()=>document.body.dataset.view==='landing',undefined,{timeout:5000});
    assert.deepEqual(pageErrors,[],`${label}: page errors`);
  }finally{await context.close()}
  return {viewport:viewport.name,checks:['collection-page','manage-menu','panel-edit','export-import','market-page']};
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
  results.push(await runSidebarChecks(browser));
  for(const viewport of [viewports[0],viewports[2]])results.push(await runCollectionChecks(browser,viewport));
  // 200% zoom on a 1280x800 screen: the header scrolls away and nothing overflows sideways.
  const zoomed=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1});
  try{
    await installFixtures(zoomed,makeFixtureState(fixtureCatalog()));
    await zoomed.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await waitForIpEntry(zoomed,'200% zoom: IP navigation did not render');
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
    // 開卡有 View Transition（look-effects.js）：轉場期間 elementFromPoint 只拿到 <html>，所以等最多 3 秒讓它結束再量。
    const closeHit=await zoomed.waitForFunction(()=>{const box=document.getElementById('close').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight&&document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('#close')!==null},null,{timeout:3000}).then(()=>true,()=>false);
    assert.ok(closeHit,'200% zoom: the detail close button is off screen or covered');
    results.push({viewport:'zoom-200',header:layout.header});
  }finally{await zoomed.close()}
  console.log(`Beta browser smoke passed: ${JSON.stringify(results)}`);
}finally{
  await browser.close();
}
