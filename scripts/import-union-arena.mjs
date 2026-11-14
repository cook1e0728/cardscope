#!/usr/bin/env node
// docs/UA_SECOND_DB_PLAN.md 第 3 段：UNION ARENA 官方卡表 → 第二個 Supabase 專案（cardscope-ip2）。
// 同 ADR 0034 的規則：只收文字事實與官方圖片網址（外連，不轉存）；每個請求間隔至少 1 秒。
//   node scripts/import-union-arena.mjs plan  <plan.json>   抓官方卡表、產生計畫檔（不寫資料庫）
//   node scripts/import-union-arena.mjs apply <plan.json>   把計畫檔寫進第二庫（需 SUPABASE2_URL、SUPABASE2_SERVICE_KEY）
// 寫入只新增（ignore-duplicates），既有列不改；重跑安全。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const UA_SOURCE = 'union-arena-official';
export const UA_ORIGIN = 'https://www.unionarena-tcg.com';
export const UA_LIST = `${UA_ORIGIN}/jp/cardlist/index.php?search=true`;
export const UA_RARITIES = ['SR', 'R', 'U', 'C', 'PcSR', 'PcR', 'PcC', 'UR', 'SP', 'PR', 'OBC'];
const DELAY_MS = 1100, UA = 'CardScope/1.0 (catalog import; low rate)';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const lower = value => String(value || '').toLowerCase();
const decode = text => String(text).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** 卡表首頁的商品下拉選單 → [{ value, label, code }]；code 是【】內的商品代號（NEW CARD SELECTION 等沒有代號的為 null）。 */
export function parseUaSeries(html) {
  const select = html.slice(html.indexOf('name="series"'));
  return [...select.slice(0, select.indexOf('</select>')).matchAll(/<option value="(\d+)"[^>]*>([^<]*)/g)]
    .map(([, value, label]) => ({ value, label: decode(label), code: decode(label).match(/【([A-Z0-9]+)】/)?.[1] || null }));
}

/** 卡表結果頁 → [{ key, number, parallel, name, image }]；key 是官方 card_no（平行卡帶 _p1、_p2）。 */
export function parseUaCards(html) {
  return [...html.matchAll(/detail_iframe\.php\?card_no=([^"]+)"[^>]*>\s*<img[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"/g)].map(([, key, image, alt]) => {
    key = decode(key);
    const number = key.replace(/_p\d+$/, ''), parallel = Number(key.match(/_p(\d+)$/)?.[1] || 0);
    return { key, number, parallel, name: decode(alt).slice(number.length).trim() || null, image: new URL(decode(image), UA_ORIGIN).href };
  });
}

/** 商品一覽頁 → 補充包 [{ name, date, precious }]（只看 ./boosters/ 的連結；預組與周邊沒有發售日需求）。 */
export function parseUaBoosters(html) {
  return [...html.matchAll(/<a href="\.\/boosters\/[^"]+\.php">(?:(?!<\/li>)[\s\S])*?js_productsTit">([\s\S]*?)<\/span>(?:(?!<\/li>)[\s\S])*?productsDate"><span[^>]*>[^<]*<\/span><br>(\d{4})\.(\d{2})\.(\d{2})/g)]
    .map(([, title, y, m, d]) => { const name = decode(title.replace(/<br\s*\/?>/g, ' ')); return { name: name.replace(/^(?:プレシャス)?ブースターパック\s*/, ''), date: `${y}-${m}-${d}`, precious: name.startsWith('プレシャス') }; });
}
// 商品名比對用：全形半形、括號樣式、空白都不算差異。
const sameName = text => String(text).normalize('NFKC').replace(/[「｢]/g, '「').replace(/[」｣]/g, '」').replace(/\s+/g, '');
// shortcut: 只補 BT（補充包）的發售日，名稱要和商品頁完全對上；對不上的維持 null（本彈大獎就不會選它），新商品名稱寫法變了再調整。
export function boosterDate(entry, boosters = []) {
  if (!/BT$/.test(entry.code || '')) return null;
  const name = sameName(entry.label.replace(/\s*【[A-Z0-9]+】\s*$/, '')), precious = entry.code.startsWith('PC');
  return boosters.find(b => b.precious === precious && sameName(b.name) === name)?.date || null;
}

const slug = text => lower(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const uaSeriesId = series => `union-arena-${series.code ? lower(series.code) : series.value}`;
export const uaCardId = card => `union-arena-${slug(card.number)}${card.parallel ? `-p${card.parallel}` : ''}`;

/** 抓到的原始資料 → 系列、卡片、版本列。同一張卡（含平行）出現在多個商品時，算在第一個列出它的商品。 */
export function buildUaRows({ series, cardsBySeries, rarityByKey, rarityLabelByKey = {}, boosters = [] }) {
  const seriesRows = [], cards = new Map(), printings = [], missingRarity = [];
  for (const entry of series) {
    const list = cardsBySeries[entry.value] || [];
    if (!list.length) continue;
    const seriesId = uaSeriesId(entry);
    seriesRows.push({ id: seriesId, game_id: 'union-arena', official_code: entry.code || entry.value, name_ja: entry.label.replace(/\s*【[A-Z0-9]+】\s*$/, ''), name_zh: null, name_en: null, name_ko: null,
      region: 'JP', language: 'ja-JP', release_date: boosterDate(entry, boosters), aliases: [entry.code, entry.label].filter(Boolean), source_url: `${UA_ORIGIN}/jp/cardlist/`, image_url: null, image_kind: null,
      source: UA_SOURCE, provider_id: entry.value, metadata: { officialSeriesId: entry.value, cardsCount: list.length } });
    for (const item of list) {
      if (cards.has(item.key)) continue;
      const id = uaCardId(item), rarity = rarityLabelByKey[item.key] || rarityByKey[item.key] || null, setCode = item.number.split('/')[0];
      if (!rarity) missingRarity.push(item.key);
      cards.set(item.key, { id, canonical_id: `union-arena-${slug(item.number)}`, game_id: 'union-arena', series_id: seriesId, official_card_number: item.number,
        rarity, name_ja: item.name, name_zh: null, name_en: null, name_ko: null, aliases: [item.name, item.number].filter(Boolean),
        source: UA_SOURCE, provider_id: item.key, search_text: [item.name, item.number, entry.code].filter(Boolean).join(' '),
        metadata: { parallel: item.parallel || null, officialSeriesId: entry.value }, data_status: 'verified' });
      printings.push({ card_id: id, series_id: seriesId, region: 'JP', language: 'ja-JP', local_set_code: setCode, local_card_number: item.number,
        rarity, image_url: item.image, source_url: `${UA_ORIGIN}/jp/cardlist/detail.php?card_no=${encodeURIComponent(item.key)}`,
        source: UA_SOURCE, provider_id: item.key, image_rehost_required: false, image_rights_status: 'not-provided', metadata: {}, data_status: 'incomplete' });
    }
  }
  return { series: seriesRows, cards: [...cards.values()], printings, missingRarity };
}

async function officialText(url, body = null) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body, signal: AbortSignal.timeout(60000) });
    if (response.ok) return response.text();
    if (attempt === 3 || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`UA_${response.status}:${url}`);
    await pause(attempt * 1500);
  }
}

export async function collectUa({ fetchText = officialText, delay = DELAY_MS, log = () => {} } = {}) {
  const series = parseUaSeries(await fetchText(`${UA_ORIGIN}/jp/cardlist/`));
  if (series.length < 100) throw new Error(`UA_SERIES_TOO_FEW:${series.length}`);
  const cardsBySeries = {}, rarityByKey = {};
  for (const entry of series) {
    await pause(delay);
    cardsBySeries[entry.value] = parseUaCards(await fetchText(UA_LIST, new URLSearchParams({ series: entry.value }).toString()));
    log(`${entry.value} ${cardsBySeries[entry.value].length} ${entry.label}`);
  }
  const ask = async form => { await pause(delay); return parseUaCards(await fetchText(UA_LIST, new URLSearchParams(form).toString())); };
  for (const rarity of UA_RARITIES) {
    // 全站查詢結果太多時官方回 0 筆（2026-11-14 的 R、U、C）：改成逐商品查。
    let list = await ask({ 'rare[]': rarity });
    if (!list.length) for (const entry of series) if (cardsBySeries[entry.value].length) list = list.concat(await ask({ series: entry.value, 'rare[]': rarity }));
    for (const card of list) rarityByKey[card.key] = rarityByKey[card.key] && rarityByKey[card.key] !== rarity ? `${rarityByKey[card.key]}|${rarity}` : rarity;
    log(`rarity ${rarity} ${list.length}`);
  }
  // 平行卡的星數（SR★、SR★★★…）只在詳細頁，且和 _p 編號不一一對應（_p2 也可能是 ★★★）：逐張讀。
  const rarityLabelByKey = {}, parallels = Object.values(cardsBySeries).flat().filter(card => card.parallel);
  for (const [index, card] of parallels.entries()) {
    await pause(delay);
    const label = (await fetchText(`${UA_ORIGIN}/jp/cardlist/detail_iframe.php?card_no=${encodeURIComponent(card.key)}`)).match(/class="rareData">([^<]+)</)?.[1];
    if (label) rarityLabelByKey[card.key] = decode(label);
    if (index % 200 === 0) log(`parallel ${index}/${parallels.length}`);
  }
  await pause(delay);
  const boosters = parseUaBoosters(await fetchText(`${UA_ORIGIN}/jp/products/`));
  return { fetchedAt: new Date().toISOString(), series, cardsBySeries, rarityByKey, rarityLabelByKey, boosters };
}

async function insertOnly(path, rows, onConflict) {
  const base = process.env.SUPABASE2_URL, key = process.env.SUPABASE2_SERVICE_KEY;
  if (!base || !key) throw new Error('SUPABASE2_URL / SUPABASE2_SERVICE_KEY 沒有設定');
  for (let index = 0; index < rows.length; index += 500) {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1${path}?on_conflict=${onConflict}`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(index, index + 500)) });
    if (!response.ok) throw new Error(`${path} ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return rows.length;
}

export const UA_GAME_ROW = { id: 'union-arena', name_ja: 'UNION ARENA', name_en: 'UNION ARENA', name_zh: 'UNION ARENA', name_ko: null, catalog_status: 'active' };
export const PRODUCT_CATEGORY_ROW = { id: 'singles', name_en: 'Singles', name_zh: '單卡', sort_order: 10, description_zh: '可獨立查詢、收藏與比價的單張卡片。' };

async function main([mode, file]) {
  if (mode === 'plan' && file) {
    const raw = await collectUa({ log: line => console.error(line) });
    const rows = buildUaRows(raw);
    fs.writeFileSync(file, JSON.stringify({ ...rows, raw }, null, 1));
    console.log(`series ${rows.series.length}, cards ${rows.cards.length}, printings ${rows.printings.length}, missing rarity ${rows.missingRarity.length}`);
  } else if (mode === 'apply' && file) {
    const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    await insertOnly('/tcg_product_categories', [PRODUCT_CATEGORY_ROW], 'id');
    await insertOnly('/tcg_games', [UA_GAME_ROW], 'id');
    console.log('series', await insertOnly('/tcg_series', plan.series, 'id'));
    console.log('cards', await insertOnly('/tcg_cards', plan.cards, 'id'));
    console.log('printings', await insertOnly('/tcg_printings', plan.printings, 'source,provider_id'));
    console.log('寫入完成；接著在第二庫執行 select public.browse_refresh_keys(); 重建瀏覽鍵。');
  } else {
    console.error('用法：node scripts/import-union-arena.mjs plan|apply <plan.json>');
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
