// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
// Fixtures are intercepted in this test browser only; no catalog data is written.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const products=Array.from({length:10},(_,i)=>({id:`smoke-${i}`,game:'pokemon',region:'JP',catalogCategory:'原盒',officialCode:`M${6-i%3}`,nameZh:`測試商品 ${i}`,releaseDate:'2026-08-01',imageUrl:'/assets/brand/cardscope-rabbit-mark.png'}));
 await page.route('**/api/products',route=>route.fulfill({json:{data:products,series:[]}}));
 await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('cardscope-recent-series','["smoke-0"]')});
 await page.goto(process.env.CARDSCOPE_URL||'http://localhost:4173');
 await page.locator('#cards .card').first().waitFor();
 await page.locator('.active-series-block').waitFor();
 assert.equal(await page.locator('.recent-series-details').getAttribute('open'),null);
 const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,series:document.querySelector('.active-series-block').getBoundingClientRect().x,cards:document.querySelector('#cards').getBoundingClientRect().y}));
 assert.ok(layout.series>=0&&layout.series<80,JSON.stringify(layout));
 assert.ok(layout.cards<900,JSON.stringify(layout));
 assert.ok(layout.scroll<=layout.width,JSON.stringify(layout));
 await page.locator('[data-favorite-id]').first().click();
 await page.locator('[data-watch-increment]').first().click();
 assert.match(await page.locator('#watchlistSummary').innerText(),/1 張、1 件/);
 await page.locator('#favoritesOnly').click();
 assert.equal(await page.locator('#cards .card').count(),1);
 await page.locator('#favoritesOnly').click();
 await page.locator('[data-view="rarity"]').click();
 assert.ok(await page.locator('.rarity-group').count()>0);
 await page.locator('[data-view="grid"]').click();
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
 assert.deepEqual(errors,[]);
 console.log('Browser smoke passed: desktop/recent rail, favorites, quantities, rarity groups, mobile overflow, zero JavaScript exceptions.');
}finally{await browser.close()}
