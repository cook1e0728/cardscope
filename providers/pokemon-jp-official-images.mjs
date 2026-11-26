// 寶可夢日版缺圖卡從日本官方卡片搜尋補外連卡圖（ADR 0031：只存官方網址，不下載圖檔）。
// 對法：系列清單（resultAPI）先依日文名找候選，再開候選的詳細頁核對卡號；名稱＋卡號都唯一相符才寫。
// 新彈由每小時的目錄同步（TCGdex）先進來，這個工作每週跑一次把官方圖補上。
import { OFFICIAL_JP_ORIGIN, officialJpDetailUrl, officialJpListUrl, parseOfficialJpDetail, sameOfficialName } from './pokemon-jp-official.mjs';

const USER_AGENT = 'CardScope/1.0 (card image link check; low rate)';
const MAX_LIST_PAGES = 20;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sameNumber = (a, b) => {
  const x = String(a ?? '').trim(), y = String(b ?? '').trim();
  if (!x || !y) return false;
  return /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) === Number(y) : x.toUpperCase() === y.toUpperCase();
};

// cards：[{id, canonicalId, number, nameJa}]；list：[{cardID, cardThumbFile, cardNameViewText}]；details：Map(cardID → {nameJa, number})。
// 回傳 card_images 列。同一張官方卡只能給一張我們的卡；一張卡對到多張官方卡也不寫。
export function matchOfficialJpImages(cards, list, details) {
  const hits = new Map(), used = new Map();
  for (const card of cards || []) {
    const found = (list || []).filter(o => sameOfficialName(card.nameJa, o.cardNameViewText) && /^\/assets\/images\/card_images\//.test(String(o.cardThumbFile || '')) && sameNumber(card.number, details.get(String(o.cardID))?.number));
    if (found.length !== 1) continue;
    const id = String(found[0].cardID);
    hits.set(card.id, { card, official: found[0] });
    used.set(id, (used.get(id) || 0) + 1);
  }
  return [...hits.values()].filter(h => used.get(String(h.official.cardID)) === 1).map(({ card, official }) => ({
    card_id: card.id, canonical_id: card.canonicalId || card.id, language: 'ja-JP', source: 'pokemon-card-official-jp',
    image_url: `${OFFICIAL_JP_ORIGIN}${official.cardThumbFile}`, source_url: officialJpDetailUrl(official.cardID),
    is_primary: true, image_rights_status: 'not-provided', rights_note: 'ADR 0031'
  }));
}

// 資料庫冷的時候（久沒人查）找缺圖卡會撞 statement timeout（57014）；第一次已把資料讀進快取，等一下重試通常 1 秒內就回來。
const DB_STATEMENT_TIMEOUT = /57014|statement timeout/i;

export async function runOfficialJpImages({ db, fetchFn = fetch, gapMs = 1500, maxRequests = 400, dbRetries = 3, dbRetryMs = 30 * 1000, log = console } = {}) {
  const result = { series: 0, images: 0, requests: 0, stoppedBy: null };
  let last = 0;
  const get = async url => {
    if (result.requests >= maxRequests) throw Object.assign(new Error('REQUEST_BUDGET'), { code: 'REQUEST_BUDGET' });
    const wait = last + gapMs - Date.now(); if (wait > 0) await sleep(wait);
    result.requests++; last = Date.now();
    const response = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`OFFICIAL_JP_HTTP_${response.status}`);
    return response.text();
  };
  try {
    let targets;
    for (let attempt = 1; ; attempt++) {
      try { targets = await db('/rpc/image_official_jp_targets', { method: 'POST', body: JSON.stringify({ p_limit: 300 }) }); break; }
      catch (error) {
        if (attempt > dbRetries || !DB_STATEMENT_TIMEOUT.test(String(error?.message || error))) throw error;
        log.warn?.('official jp image targets timed out, retrying', attempt);
        await sleep(dbRetryMs * attempt);
      }
    }
    for (const target of targets || []) {
      const list = [];
      for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const json = JSON.parse(await get(officialJpListUrl(target.official_code, page)));
        if (json?.result !== 1 || !Array.isArray(json.cardList)) break;
        list.push(...json.cardList);
        if (page >= Number(json.maxPage || 1)) break;
      }
      result.series++;
      // 只開名稱對得上的候選詳細頁（卡號只在詳細頁上）
      const candidates = new Set(list.filter(o => target.cards.some(c => sameOfficialName(c.nameJa, o.cardNameViewText))).map(o => String(o.cardID)));
      const details = new Map();
      for (const id of candidates) details.set(id, parseOfficialJpDetail(await get(officialJpDetailUrl(id))));
      const rows = matchOfficialJpImages(target.cards, list, details);
      if (!rows.length) continue;
      await db('/card_images', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
      result.images += rows.length;
      log.log('official jp images', target.official_code, rows.length);
    }
  } catch (error) {
    if (error.code === 'REQUEST_BUDGET') result.stoppedBy = 'request-budget';
    else { result.stoppedBy = error.message; result.status = 'failed'; log.error('official jp images failed', error.message); }
  }
  return result;
}
