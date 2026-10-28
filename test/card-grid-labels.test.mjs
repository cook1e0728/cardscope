import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const ui=await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8');
const start=ui.indexOf('let seriesIndex=null'),end=ui.indexOf('function cardMarkup(card)');

// The label helpers read C.series, browse, activeSearch, rn and setCodeText from the page; stub just those.
function labels({series=[],browse={seriesId:''},activeSearch=null}={}){
  const context=vm.createContext({C:{series},browse,activeSearch,e:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    rn:(region,game)=>region==='TW'&&game==='onepiece'?'亞洲日文版':({JP:'日版',TW:'台版',US:'美版'}[region]||region||'版本待補'),
    setCodeText:value=>/^unspecified$/i.test(String(value||'').trim())?'':String(value||'')});
  vm.runInContext(ui.slice(start,end),context);
  return context;
}

test('the card grid names the series on one line, from the catalog, and falls back to the printing set code',()=>{
  const ctx=labels({series:[{id:'s1',nameZh:'變幻假面',officialCode:'SV6'},{id:'s2',nameEn:'Base Set',officialCode:'BS'},{id:'s3',officialCode:'SV7'}]});
  assert.match(ctx.cardSeriesLabel({seriesId:'s1'}),/class="card-series" title="SV6・變幻假面">變幻假面</);
  assert.match(ctx.cardSeriesLabel({seriesId:'s2'}),/>Base Set</);
  assert.match(ctx.cardSeriesLabel({seriesId:'s3'}),/>SV7</,'no name: the code stands in');
  assert.match(ctx.cardSeriesLabel({seriesId:'unknown',printings:[{localSetCode:'base1'}]}),/>base1</,'catalog miss: the printing set code');
  assert.equal(ctx.cardSeriesLabel({seriesId:'unknown',printings:[{localSetCode:'unspecified'}]}),'','"unspecified" is not shown');
});

test('a series page does not repeat its series on every card, but a search inside it still shows it',()=>{
  const series=[{id:'s1',nameZh:'變幻假面'}];
  assert.equal(labels({series,browse:{seriesId:'s1'}}).cardSeriesLabel({seriesId:'s1'}),'');
  assert.match(labels({series,browse:{seriesId:'s1'},activeSearch:{q:'x'}}).cardSeriesLabel({seriesId:'s1'}),/變幻假面/);
});

test('one version keeps the plain badge; several versions become 日 台 chips with the full names read out once',()=>{
  const ctx=labels();
  assert.equal(ctx.cardVersionBadges({game:'pokemon',region:'JP',printings:[{region:'JP'}]}),'<span class="badge">日版</span>');
  const multi=ctx.cardVersionBadges({game:'pokemon',region:'TW',printings:[{region:'TW'},{region:'JP'}]});
  assert.match(multi,/aria-label="收錄版本：日版、台版"/,'fixed order, full names for assistive tech');
  assert.deepEqual([...multi.matchAll(/region-chip" aria-hidden="true">([^<]+)</g)].map(m=>m[1]),['日','台']);
  const onepiece=ctx.cardVersionBadges({game:'onepiece',region:'TW',printings:[{region:'TW'},{region:'JP'}]});
  assert.match(onepiece,/aria-label="收錄版本：日版、亞洲日文版"/,'One Piece Taiwan is shown as the Asian Japanese edition');
});
