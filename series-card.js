// 首頁「最新系列」卡片的資料邏輯（只有純函式，畫面在 series-band.js）：顯示名稱、對應大獎縮圖、卡片上的小資訊。
// 名稱用目錄原有的欄位（nameZh 來自 data/series-zh.json 與 localizeProductName）；縮圖來自 /api/series-hits；沒有的欄位就不顯示，不補空格。
(root=>{
  const CJK=/[㐀-鿿豈-﫿]/,fold=value=>String(value||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
  // 去掉「寶可夢系列｜」「官方尚未有中文名稱｜」這類前綴，以及結尾與系列代號重複的【EB-05】／[EB-05]（代號另外顯示）。
  const tidy=(value,code)=>{
    let text=String(value||'').replace(/^.*?系列｜/,'').replace(/^官方尚未有中文名稱｜/,'').trim();
    const tag=text.match(/\s*[【\[]([^】\]]+)[】\]]$/);
    if(tag&&code&&fold(tag[1])===fold(code))text=text.slice(0,tag.index).trim();
    return text;
  };
  // 標題優先用中文（nameZh 去前綴後還有中文字）；沒有就用日文、英文原名。原名另外留成次要文字，標題已經是原名時不重複。
  function names(item){
    const code=item?.officialCode||'',zh=tidy(item?.nameZh,code),ja=tidy(item?.nameJa,code),en=tidy(item?.nameEn,code);
    const title=(CJK.test(zh)?zh:'')||ja||en||zh||code||'名稱待補';
    const original=[ja,en].find(name=>name&&fold(name)!==fold(title))||'';
    return {title,original:title===zh?original:''};
  }
  // 這張卡片對應的大獎資料：先比系列 id（同一彈各版本都在 seriesIds），再比遊戲＋系列代號。
  function setFor(item,sets){
    const code=String(item?.officialCode||'').toUpperCase();
    return (Array.isArray(sets)?sets:[]).find(set=>set?.game===item?.game&&(set.seriesIds?.includes(item.id)||(code&&String(set.code||'').toUpperCase()===code)))||null;
  }
  // 最多 3 張有圖的縮圖（伺服器已依稀有度排好）；沒有就回空陣列，畫面只放系列圖。
  const hitsOf=(set,count=3)=>(Array.isArray(set?.hits)?set.hits:[]).filter(hit=>hit?.cardId&&hit.imageUrl).slice(0,count);
  const cardCount=item=>[item?.metadata?.cardsCount,item?.metadata?.total,item?.metadata?.printedTotal].map(Number).find(value=>value>0)||0;
  // 卡片下方一行小資訊：發售日（或即將發售）、收錄張數、最高稀有度；知道才寫。
  function facts(item,hits,today){
    const out=[],date=item?.releaseDate;
    if(date)out.push(date>today?'即將發售':date.replace(/-/g,'/'));
    const count=cardCount(item);if(count)out.push(`${count} 張`);
    if(hits?.[0]?.rarity)out.push(`最高 ${hits[0].rarity}`);
    return out;
  }
  root.homeSeriesCard={names,setFor,hitsOf,facts,cardCount};
})(typeof window!=='undefined'?window:globalThis);
