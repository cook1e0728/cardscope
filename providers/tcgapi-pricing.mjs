// TCG API（tcgapi.dev）轉來的 TCGplayer 美元市價，補 Cardmarket 沒有價格的寶可夢日版系列（例如 M6a），2026-11-03。
// 免費方案：非商業、每天 100 次請求（UTC 午夜重置）；一次請求回一個系列最多 100 張卡，每張卡附 market_price。
// 每天一輪：讀一次系列清單（約 5 次請求），再照 price_tcgapi_targets 的順序（最久沒補的先）逐系列抓卡表，用完當天額度就停，明天接著補。
// 對應規則（寧可不補也不配錯）：系列名稱以「我們的系列代號:」開頭且只有一個；卡號取斜線前的數字，同一個卡號只能有一列且有市價。
// 寫入 price_snapshots：provider 'tcgplayer'、currency 'USD'、variant 'tcgapi-<printing>'；price_reference_best 只在卡沒有 Cardmarket 價時才用它。
export const TCGAPI_BASE = 'https://api.tcgapi.dev/v1';
export const TCGAPI_GAME = 'pokemon-japan';
export const TCGAPI_DAILY_REQUESTS = 70;      // 免費 100 次，留 30 次餘裕
export const TCGAPI_PAGE_SIZE = 100;
export const TCGAPI_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TCGAPI_INITIAL_DELAY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 20000, REQUEST_GAP_MS = 1200;

const leadingNumber = value => { const m = String(value ?? '').trim().match(/^0*(\d+)/); return m ? m[1] : null; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 系列代號 → TCG API 的 set id；同一個代號對到多個系列（例如 MF 有兩副牌組）就不對應。
export function mapSetsByCode(sets) {
  const byCode = new Map(), dup = new Set();
  for (const set of sets || []) {
    const code = String(set?.name ?? '').match(/^([^:]+):/)?.[1]?.trim().toLowerCase();
    if (!code || !Number.isInteger(set.id)) continue;
    if (byCode.has(code)) dup.add(code); else byCode.set(code, set.id);
  }
  for (const code of dup) byCode.delete(code);
  return byCode;
}

// 我們的卡 [{id, number}] 對 TCG API 的卡列；回傳 [{cardId, amount, printing, asOf}]。
export function matchSetPrices(cards, rows) {
  const byNumber = new Map();
  for (const row of rows || []) {
    if (row?.product_type && row.product_type !== 'Cards') continue;
    const n = leadingNumber(row?.number);
    if (!n) continue;
    byNumber.set(n, byNumber.has(n) ? null : row);
  }
  const out = [], ours = new Map();
  for (const card of cards || []) { const n = leadingNumber(card?.number); if (n) ours.set(n, ours.has(n) ? null : card); }
  for (const [n, card] of ours) {
    const row = byNumber.get(n), amount = Number(row?.market_price);
    if (!card || !row || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ cardId: card.id, amount: Math.round(amount * 100) / 100, printing: String(row.printing || 'normal').toLowerCase().replace(/[^a-z0-9]+/g, '-'), asOf: row.market_price_as_of || null });
  }
  return out;
}

export function createTcgapiPricing({ apiKey, db, fetchFn = fetch, now = () => new Date(), dailyRequests = TCGAPI_DAILY_REQUESTS, gapMs = REQUEST_GAP_MS, log = console } = {}) {
  let timer = null, running = false, last = null;
  async function get(path, budget) {
    if (budget.used >= dailyRequests) throw Object.assign(new Error('TCGAPI_BUDGET'), { code: 'TCGAPI_BUDGET' });
    if (budget.used) await sleep(gapMs);
    budget.used++;
    const response = await fetchFn(`${TCGAPI_BASE}/${path}`, { headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 429) throw Object.assign(new Error('TCGAPI_RATE_LIMIT'), { code: 'TCGAPI_BUDGET' });
    if (!response.ok) throw new Error(`TCGAPI_HTTP_${response.status}`);
    const body = await response.json();
    if (Number(body?.rate_limit?.daily_remaining) <= 100 - dailyRequests) budget.used = dailyRequests;
    return body;
  }
  async function pages(path, budget) {
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const body = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=${TCGAPI_PAGE_SIZE}&page=${page}`, budget);
      rows.push(...(Array.isArray(body?.data) ? body.data : []));
      if (!body?.meta?.has_more) break;
    }
    return rows;
  }
  async function runOnce() {
    if (!apiKey || running) return { skipped: !apiKey ? 'not-configured' : 'running' };
    running = true;
    const budget = { used: 0 }, today = now().toISOString().slice(0, 10), result = { series: 0, written: 0, unmapped: 0, requests: 0, stoppedBy: null };
    try {
      const targets = await db('/rpc/price_tcgapi_targets', { method: 'POST', body: JSON.stringify({ p_limit: 300 }) });
      if (!Array.isArray(targets) || !targets.length) return result;
      const setIds = mapSetsByCode(await pages(`sets?game=${TCGAPI_GAME}`, budget));
      for (const target of targets) {
        const setId = setIds.get(String(target.official_code || '').toLowerCase());
        if (!setId) { result.unmapped++; continue; }
        const matched = matchSetPrices(target.cards, await pages(`sets/${setId}/cards?type=Cards`, budget));
        result.series++;
        if (!matched.length) continue;
        const rows = matched.map(m => ({ card_id: m.cardId, provider: 'tcgplayer', variant: `tcgapi-${m.printing}`, currency: 'USD', snapshot_date: today, amount: m.amount, observed_at: m.asOf ? `${m.asOf}T00:00:00Z` : null }));
        await db('/price_snapshots?on_conflict=card_id,provider,variant,snapshot_date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
        result.written += rows.length;
      }
    } catch (error) {
      if (error.code !== 'TCGAPI_BUDGET') { result.stoppedBy = error.message; log.error('tcgapi pricing failed', error.message); }
      else result.stoppedBy = 'daily-budget';
    } finally { running = false; result.requests = budget.used; last = { at: now().toISOString(), ...result }; }
    log.log('tcgapi pricing', JSON.stringify(result));
    return result;
  }
  return {
    runOnce,
    status: () => ({ configured: Boolean(apiKey), running, last }),
    start() { if (!apiKey || timer) return; const tick = () => { runOnce().catch(() => {}); timer = setTimeout(tick, TCGAPI_INTERVAL_MS); timer.unref?.(); }; timer = setTimeout(tick, TCGAPI_INITIAL_DELAY_MS); timer.unref?.(); }
  };
}
