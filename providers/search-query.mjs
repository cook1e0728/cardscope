// 自然語句與複合特徵搜尋（ADR 0044 Q6 ＋ 複合特徵擴充）：
// 把「30th皮卡丘」「30周年皮卡丘 SAR 日版」「M6a皮卡丘」「151 夢幻ex」「桃歹郎ex SAR」「魯夫 台版」
// 拆成「系列／周年特徵＋卡名／卡號＋稀有度＋版本」，不寫死單一卡片。
// 稀有度只認 data/rarity-rankings.json 的代碼與別名，系列代碼／名稱由 catalog.series 動態索引驗證。
import { readFileSync } from 'node:fs';
import { RARITY_RANKINGS } from './normalize.mjs';

const VERSION_WORDS = new Map([['日版', 'JP'], ['日文版', 'JP'], ['JP', 'JP'], ['台版', 'TW'], ['TW', 'TW'], ['美版', 'US'], ['US', 'US'], ['韓版', 'KR'], ['KR', 'KR']]);

// 單詞代碼只收 2–5 個大寫英文字母（單字母的 S/R/U/C/K/L/P 與一般字相撞，不收）；ACE 也是常見名字（Ace），不收。
const CODE_WORD = /^[A-Z]{2,5}$/, AMBIGUOUS_CODES = new Set(['ACE', 'NONE']);
// 常見卡名後綴與非系列英數詞：絕不誤拆成系列代碼。
const CARD_NAME_SUFFIXES = new Set([
  'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'VUNION', 'LV', 'LVX', 'SP', 'TAG', 'MEGA',
  'BREAK', 'LEGEND', 'PRIME', 'STAR', 'DELTA', 'PRISM', 'ACE', 'NONE', 'THE', 'AND', 'FOR', 'OF'
]);
// 泛用商品包裝詞：不作為獨立系列名比對，避免「補充包 皮卡丘」誤拆。
const GENERIC_SERIES_WORDS = new Set([
  '補充包', '擴充包', '強化擴充包', '高級擴充包', '特別補充包', '起始牌組', '預組牌組', '牌組', '特典', '推廣卡', '系列', '基礎系列',
  '拡張パック', '強化拡張パック', 'ハイクラスパック', 'コンセプトパック', 'スターターセット', 'デッキ', 'プロモ',
  'booster', 'boosterpack', 'starterdeck', 'deck', 'promo', 'collection', 'series', 'set', 'special', 'edition'
]);

// 少數跨語系官方命名不含數字周年字樣的系列慣用別名（資料驅動、不寫死單卡）。
const ANNIVERSARY_EXTRA_TERMS = {
  25: ['cel25', 'quarter century'],
  30: ['30th celebration', 'me55']
};

const MAX_SERIES_IDS = 50;

// 代碼 → 它在資料裡可能出現的小寫拼法（代碼本身＋所有遊戲的別名），給資料庫與 printing 比對。
const spellings = new Map(), aliasPhrases = [], codePhrases = [], aliasPairs = [];
const addSpelling = (code, value) => { const key = String(value).toLowerCase(); (spellings.get(code) || spellings.set(code, new Set([code.toLowerCase()])).get(code)).add(key) };
for (const system of Object.values(RARITY_RANKINGS.systems || {})) {
  for (const code of system.canonicalCodes || []) {
    addSpelling(code, code);
    if (/\s/.test(code)) codePhrases.push([code, code]);
  }
  for (const [code, aliases] of Object.entries(system.aliases || {})) {
    for (const alias of aliases) {
      addSpelling(code, alias);
      aliasPairs.push([code, alias]);
      if (/^[A-Za-z]+(?: [A-Za-z]+)+$/.test(alias)) aliasPhrases.push([alias, code]);
    }
  }
}
// 別名本身在另一個遊戲是正式代碼（Ultra Rare：寶可夢別名、遊戲王代碼）：代碼的拼法也收進這個別名所屬的代碼。
for (const [code, alias] of aliasPairs) if (spellings.has(alias)) addSpelling(alias, code);
// 同一個詞是正式代碼時，詞組對應到它自己（排在別名之後，覆蓋別名的對應）。
const phraseRules = [...new Map([...aliasPhrases, ...codePhrases].map(([phrase, code]) => [phrase.toLowerCase(), [phrase, code]])).values()]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([phrase, code]) => [new RegExp(`(?<![A-Za-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?![A-Za-z0-9])`, 'i'), code]);
const CODE_WORDS = new Set([...spellings.keys()].filter(code => CODE_WORD.test(code) && !AMBIGUOUS_CODES.has(code)));

// 與資料庫 tcg_search_fold 同一個折疊（小寫、NFKC、去空白／中點／連字號等），伺服器的 normalizeSearch 也是這個規則。
export const foldSearch = value => String(value ?? '').toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-<>\[\]​-‍⁠﻿]/g, '');

// PostgREST / LIKE 查詢字詞清理：移除萬用字元與 PostgREST 語法字元。
export const postgrestLike = value => String(value ?? '').replace(/[\\%_*(),.]/g, '').trim();
// SQL LIKE 字面跳脫（若需保留原始符號比對時使用）。
export const escapeLike = value => String(value ?? '').replace(/[\\%_]/g, '\\$&');

// 中文數字（1–99）與阿拉伯數字互轉。
const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_CHARS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function chineseNumber(text) {
  const t = String(text ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!m || (!m[2] && (!m[1] || m[3]))) return null;
  return m[2] ? (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[3] ? CN_DIGITS[m[3]] : 0) : CN_DIGITS[m[1]];
}
export function toChineseNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 99) return null;
  if (num < 10) return CN_CHARS[num];
  const tens = Math.floor(num / 10), ones = num % 10;
  return `${tens === 1 ? '' : CN_CHARS[tens]}十${ones ? CN_CHARS[ones] : ''}`;
}
export function ordinalEn(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return '';
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  const suffix = num % 10 === 1 ? 'st' : num % 10 === 2 ? 'nd' : num % 10 === 3 ? 'rd' : 'th';
  return `${num}${suffix}`;
}

function buildAnniversaryFeature(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  const ord = ordinalEn(n), cn = toChineseNumber(n);
  const terms = [ord, `${n}周年`, `${n}週年`, ...(cn ? [`${cn}周年`, `${cn}週年`] : []), ...(ANNIVERSARY_EXTRA_TERMS[n] || [])];
  return { kind: 'anniversary', number: n, label: ord, terms: [...new Set(terms)] };
}

// 整串皆為周年表達式（30th、30周年、30周年記念、三十週年、30th Anniversary、30th Celebration）。
const STANDALONE_ANNIVERSARY_RE = /^(\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:(?:st|nd|rd|th)(?:\s*(?:anniversary|celebration|アニバーサリー))?|(?:周年|週年)(?:記念|紀念)?|\s*anniversary)$/i;
export function parseAnniversaryToken(term) {
  const normalized = String(term ?? '').normalize('NFKC').trim();
  if (!normalized) return null;
  const m = normalized.match(STANDALONE_ANNIVERSARY_RE);
  if (!m) return null;
  const n = chineseNumber(m[1]);
  if (!n || n < 1 || n > 99) return null;
  // 1st/2nd/3rd 沒有搭配 anniversary/celebration/周年 時不單獨視為周年（避免 1st edition）。
  if (/^\d{1,2}(?:st|nd|rd)$/i.test(normalized)) return null;
  return buildAnniversaryFeature(n);
}

// 單搜周年詞時展開同義詞（不含原詞本身），供 server.mjs searchQueryTerms 與單搜系列共用。
export function anniversaryTerms(term) {
  const feature = parseAnniversaryToken(term);
  if (!feature) return [];
  const original = String(term ?? '').trim().toLowerCase();
  return feature.terms.filter(v => v.toLowerCase() !== original);
}

// 複合查詢內的周年片段：允許無空白黏在卡名前後（30th皮卡丘、皮卡丘30th、30周年記念ピカチュウ、30thPikachu、三十周年皮卡丘）。
// 規則：
// - 不前接數字（避免 2030th 誤切 30th）
// - 英文序數若沒帶 anniversary/celebration，僅收 >= 5 的 Nth（如 10th/15th/20th/25th/30th），且後不接小寫英文字母（避免 30the，但允許 30thPikachu）
// - 1st/2nd/3rd 必須搭配 anniversary / celebration / アニバーサリー
// - 中文「周年／週年（記念／紀念）」1–99 皆收
const EMBEDDED_ANNIVERSARY_RE = /(?<!\d)(?:(\d{1,2})\s*(?:(?:st|nd|rd|th)\s*(?:anniversary|celebration|アニバーサリー)|th|\s+anniversary(?![a-z]))|(\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:周年|週年)(?:記念|紀念)?)/i;

function extractAnniversary(text) {
  const m = EMBEDDED_ANNIVERSARY_RE.exec(text);
  if (!m) return null;
  const rawNum = m[1] ?? m[2];
  const n = chineseNumber(rawNum);
  if (!n || n < 1 || n > 99) return null;
  const before = text.slice(0, m.index), after = text.slice(m.index + m[0].length);
  // 純英文 Nth（不含 anniversary/celebration/周年）僅收 >= 5，並排除 30the/30ths 等 1–2 字母小寫續字（但允許 30thPikachu / 30thpikachu）。
  if (m[1] && /^\d{1,2}\s*th$/i.test(m[0])) {
    if (n < 5) return null;
    if (/^[a-z]{1,2}(?=\s|$)/.test(after)) return null;
  }
  // 若前面直接黏著中文字數字（如「一百三十周年」），跳過。
  if (m.index > 0 && /[一二三四五六七八九十百千]/.test(text[m.index - 1]) && /^[一二三四五六七八九十]/.test(rawNum)) return null;
  const rest = `${before} ${after}`.replace(/\s+/g, ' ').trim();
  if (!rest) return null;
  const feature = buildAnniversaryFeature(n);
  return feature ? { feature, rest, matched: m[0].trim() } : null;
}

// 卡號格式檢查（與 server.mjs cardNumberTerms 同一條件：SV6a 090、SV6a-090、OP-17-118、BETB EN060）。
export function isCardNumberQuery(term) {
  const text = String(term ?? '').normalize('NFKC').trim();
  const tokens = text.split(/[\s\-‐-―]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;
  const head = tokens.slice(0, -1).join(''), last = tokens.at(-1) || '';
  return tokens.every(t => /^[a-z0-9]+$/i.test(t)) && /^[a-z]{1,5}\d{0,3}[a-z]?$/i.test(head) && /^[a-z]{0,3}\d{1,4}$/i.test(last);
}

// 拆出系列核心名（剝除常見商品包裝前綴與括號，供文字系列名比對）。
const PACKAGING_PREFIX_RE = /^(?:強化擴充包|高級擴充包|擴充包|補充包|特別補充包|起始牌組|預組牌組|試玩牌組|強化拡張パック|拡張パック|ハイクラスパック|コンセプトパック|プレミアムデッキセット|スターターセット|ポケットモンスターカードゲーム|寶可夢卡牌|ポケモンカード|pokemon\s*card|booster\s*pack|expansion\s*pack)[\s「『【(（・:：｜|]*/i;
function extractCoreSeriesNames(series) {
  const rawNames = [series?.nameZh, series?.nameJa, series?.nameEn, series?.nameKo, ...(series?.aliases || [])];
  const cores = new Set();
  for (const raw of rawNames) {
    let text = String(raw ?? '').normalize('NFKC').trim();
    if (!text) continue;
    // 剝除層層包裝前綴，如「コンセプトパック「ポケットモンスターカードゲーム 拡張パック 20th Anniversary」」
    for (let i = 0; i < 4; i++) {
      const next = text.replace(PACKAGING_PREFIX_RE, '').replace(/^[「『【(（]+|[」』】)）]+$/g, '').trim();
      if (next === text) break;
      text = next;
    }
    const folded = foldSearch(text);
    if (folded.length >= 3 && !GENERIC_SERIES_WORDS.has(folded) && !/^\d+$/.test(folded)) {
      cores.add(text);
      // 像「閃色寶藏 ex」也收去掉尾綴 ex 的簡稱「閃色寶藏」
      const noEx = text.replace(/\s*ex$/i, '').trim();
      const noExFold = foldSearch(noEx);
      if (noEx !== text && noExFold.length >= 3 && !GENERIC_SERIES_WORDS.has(noExFold)) cores.add(noEx);
    }
  }
  return [...cores];
}

// 從 catalog.series 建立記憶體索引（建一次、供同份 catalog 快取重用）。
export function buildSeriesIndex(seriesList = []) {
  const entries = [], byCode = new Map(), byNumber = new Map(), byCoreName = new Map();
  const pushMap = (map, key, entry) => {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.includes(entry)) list.push(entry);
    map.set(key, list);
  };
  const sorted = [...(seriesList || [])].filter(s => s && s.id).sort((a, b) =>
    String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')) || String(a.id).localeCompare(String(b.id))
  );
  for (const s of sorted) {
    const code = String(s.officialCode || '').trim();
    const codeFold = foldSearch(code);
    const texts = [code, s.nameZh, s.nameJa, s.nameEn, s.nameKo, ...(s.aliases || [])].filter(Boolean).map(v => String(v).normalize('NFKC').trim());
    const foldedTexts = [...new Set(texts.map(foldSearch).filter(Boolean))];
    const coreNames = extractCoreSeriesNames(s);
    const entry = {
      id: String(s.id),
      game: s.game || null,
      region: s.region ? String(s.region).toUpperCase() : null,
      releaseDate: s.releaseDate || '',
      officialCode: code,
      codeFold,
      texts,
      foldedTexts,
      coreNames
    };
    entries.push(entry);

    // 系列代碼索引（排除單字元、純 1–2 位數字、稀有度代碼、卡名後綴、版本詞）
    const registerCode = candidate => {
      const clean = String(candidate || '').normalize('NFKC').trim();
      const upper = clean.toUpperCase();
      const folded = foldSearch(clean);
      if (folded.length < 2 || folded.length > 10) return;
      if (/^\d{1,2}$/.test(folded)) return;
      if (CODE_WORDS.has(upper) || CARD_NAME_SUFFIXES.has(upper) || VERSION_WORDS.has(upper) || VERSION_WORDS.has(clean)) return;
      if (!/^[a-z0-9-]+$/i.test(clean)) return;
      pushMap(byCode, folded, entry);
    };
    if (code) registerCode(code);
    for (const alias of s.aliases || []) {
      if (/^[A-Za-z][A-Za-z0-9-]{1,9}$/.test(String(alias || '').trim())) registerCode(alias);
    }

    // 3 位數系列號（如 151：nameEn="151"、nameJa="ポケモンカード151"、nameZh="寶可夢卡牌151"），排除年份與周年數。
    for (const text of texts) {
      for (const m of text.matchAll(/(?:^|[^\dA-Za-z])([1-9]\d{2})(?![\dA-Za-z]|年|周年|週年)/g)) {
        const num = m[1];
        pushMap(byNumber, num, entry);
      }
    }

    // 核心系列名稱索引
    for (const core of coreNames) {
      const key = foldSearch(core);
      if (key.length >= 3 && !GENERIC_SERIES_WORDS.has(key)) pushMap(byCoreName, key, entry);
    }
  }
  // 供無空白前/後綴最長匹配用（依長度由長到短）
  const longCoreNames = [...byCoreName.entries()]
    .filter(([key]) => (/[^\x00-\x7F]/.test(key) ? key.length >= 4 : key.length >= 6))
    .sort((a, b) => b[0].length - a[0].length);
  return { entries, byCode, byNumber, byCoreName, longCoreNames };
}

function seriesMatchesTerm(entry, term) {
  const foldedTerm = foldSearch(term);
  if (!foldedTerm) return false;
  // 若詞以數字開頭（30th、30周年、25th），確認不會誤命中較長數字尾碼（例如 10th 不中 110th）。
  if (/^\d/.test(foldedTerm)) {
    const escaped = foldedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<!\\d)${escaped}`, 'i');
    return entry.foldedTexts.some(t => re.test(t));
  }
  return entry.foldedTexts.some(t => t.includes(foldedTerm));
}

// 依拆出的系列特徵在 seriesIndex 中找出符合的 seriesId 清單（跨地區與指定地區各保留一份）。
export function matchSeriesIndex(feature, seriesIndex, { region = 'ALL' } = {}) {
  if (!feature || !seriesIndex?.entries?.length) return { ids: [], allIds: [], matched: [] };
  let candidates = [];
  if (feature.kind === 'code') {
    candidates = seriesIndex.byCode.get(foldSearch(feature.code || feature.label)) || [];
  } else if (feature.kind === 'number') {
    candidates = seriesIndex.byNumber.get(String(feature.label || '')) || [];
  } else if (feature.kind === 'name') {
    const key = foldSearch(feature.label || '');
    const exact = seriesIndex.byCoreName.get(key) || [];
    candidates = exact.length ? exact : seriesIndex.entries.filter(entry => entry.foldedTexts.some(t => t.includes(key)));
  } else if (feature.kind === 'anniversary') {
    candidates = seriesIndex.entries.filter(entry => (feature.terms || []).some(term => seriesMatchesTerm(entry, term)));
  }
  const unique = [];
  const seen = new Set();
  for (const entry of candidates) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    unique.push(entry);
  }
  const allIds = unique.slice(0, MAX_SERIES_IDS).map(e => e.id);
  const reg = String(region || 'ALL').toUpperCase();
  const scoped = reg !== 'ALL' ? unique.filter(e => !e.region || e.region === reg) : unique;
  const matched = scoped.slice(0, MAX_SERIES_IDS);
  const ids = matched.map(e => e.id);
  return { ids, allIds, matched };
}

// 針對已去稀有度與版本詞的剩餘字串，嘗試對照 catalog.series 拆出系列代碼／3位數系列號／核心系列名。
function extractCatalogSeries(name, seriesIndex) {
  if (!name || !seriesIndex?.entries?.length) return null;
  if (isCardNumberQuery(name)) return null;
  const tokens = name.split(/\s+/).filter(Boolean);

  // 1) 多詞查詢：檢查任一獨立 token 是否為系列代碼或 3 位數系列號（如「M6a 皮卡丘」「皮卡丘 SV2a」「151 皮卡丘」）
  if (tokens.length >= 2) {
    // 優先檢查頭尾 token
    const positions = [0, tokens.length - 1, ...Array.from({ length: Math.max(0, tokens.length - 2) }, (_, i) => i + 1)];
    for (const idx of positions) {
      const token = tokens[idx];
      const rest = tokens.filter((_, i) => i !== idx).join(' ').trim();
      if (!rest) continue;
      if (/^[1-9]\d{2}$/.test(token) && seriesIndex.byNumber.has(token)) {
        return { feature: { kind: 'number', label: token, terms: [token] }, name: rest };
      }
      const codeKey = foldSearch(token);
      if (seriesIndex.byCode.has(codeKey)) {
        const canonicalCode = seriesIndex.byCode.get(codeKey)[0]?.officialCode || token;
        return { feature: { kind: 'code', code: canonicalCode, label: canonicalCode, terms: [...new Set([canonicalCode, token])] }, name: rest };
      }
    }
    // 2) 多詞查詢：前綴或後綴 1–3 個 token 精準符合核心系列名（如「閃色寶藏 夢幻」「新時代的主角 魯夫」）
    const maxSpan = Math.min(3, tokens.length - 1);
    for (let span = maxSpan; span >= 1; span--) {
      const head = tokens.slice(0, span).join(' '), headRest = tokens.slice(span).join(' ').trim();
      const headKey = foldSearch(head);
      if (headRest && seriesIndex.byCoreName.has(headKey)) {
        return { feature: { kind: 'name', label: head, terms: [head] }, name: headRest };
      }
      const tail = tokens.slice(tokens.length - span).join(' '), tailRest = tokens.slice(0, tokens.length - span).join(' ').trim();
      const tailKey = foldSearch(tail);
      if (tailRest && seriesIndex.byCoreName.has(tailKey)) {
        return { feature: { kind: 'name', label: tail, terms: [tail] }, name: tailRest };
      }
    }
    return null;
  }

  // 3) 無空白單詞查詢：中英數邊界切分（M6a皮卡丘、S8a-G皮卡丘、SV2a超夢、OP05魯夫、151皮卡丘、皮卡丘151、閃色寶藏夢幻）
  const single = tokens[0];
  // 3a) 前綴／後綴 3 位數系列號（151皮卡丘、皮卡丘151）
  const numLead = single.match(/^([1-9]\d{2})([^\x00-\x7F].+)$/);
  if (numLead && seriesIndex.byNumber.has(numLead[1])) {
    return { feature: { kind: 'number', label: numLead[1], terms: [numLead[1]] }, name: numLead[2].trim() };
  }
  const numTrail = single.match(/^([^\x00-\x7F].+?)([1-9]\d{2})$/);
  if (numTrail && seriesIndex.byNumber.has(numTrail[2])) {
    return { feature: { kind: 'number', label: numTrail[2], terms: [numTrail[2]] }, name: numTrail[1].trim() };
  }
  // 3b) 前綴／後綴系列代碼（無空白時要求代碼含數字或長度 ≥ 3，避免誤切兩字母詞與卡名後綴）
  const codeLead = single.match(/^([A-Za-z][A-Za-z0-9-]{1,9})([^\x00-\x7F].+)$/);
  if (codeLead) {
    const rawCode = codeLead[1], codeKey = foldSearch(rawCode);
    if ((/\d/.test(rawCode) || codeKey.length >= 3) && seriesIndex.byCode.has(codeKey)) {
      const canonicalCode = seriesIndex.byCode.get(codeKey)[0]?.officialCode || rawCode;
      return { feature: { kind: 'code', code: canonicalCode, label: canonicalCode, terms: [...new Set([canonicalCode, rawCode])] }, name: codeLead[2].trim() };
    }
  }
  const codeTrail = single.match(/^([^\x00-\x7F].+?)([A-Za-z][A-Za-z0-9-]{1,9})$/);
  if (codeTrail) {
    const rawCode = codeTrail[2], codeKey = foldSearch(rawCode);
    if ((/\d/.test(rawCode) || codeKey.length >= 3) && seriesIndex.byCode.has(codeKey)) {
      const canonicalCode = seriesIndex.byCode.get(codeKey)[0]?.officialCode || rawCode;
      return { feature: { kind: 'code', code: canonicalCode, label: canonicalCode, terms: [...new Set([canonicalCode, rawCode])] }, name: codeTrail[1].trim() };
    }
  }
  // 3c) 無空白長系列核心名（前綴或後綴最長匹配，CJK ≥ 4 字 / ASCII ≥ 6 字，且剩餘 ≥ 2 字）
  const singleFold = foldSearch(single);
  if (singleFold.length >= 6) {
    for (const [coreKey, list] of seriesIndex.longCoreNames) {
      if (singleFold.length - coreKey.length < 2) continue;
      if (singleFold.startsWith(coreKey) || singleFold.endsWith(coreKey)) {
        const span = foldedSpan(single, coreKey);
        if (!span) continue;
        const rest = (singleFold.startsWith(coreKey) ? single.slice(single.indexOf(span) + span.length) : single.slice(0, single.lastIndexOf(span))).trim();
        if (foldSearch(rest).length >= 2) {
          const label = list[0]?.coreNames?.find(n => foldSearch(n) === coreKey) || span;
          return { feature: { kind: 'name', label, terms: [...new Set([label, span])] }, name: rest };
        }
      }
    }
  }
  return null;
}

// 拆出稀有度與版本詞的純函式（供原始字串與抽離周年後的字串共用）。
function extractRarityAndRegion(text) {
  const rarities = [];
  // 「阿爾宙斯UR」「ピカチュウSAR」與黏連版本詞「皮卡丘台版」「台版皮卡丘」也拆開（EX、GX、VSTAR 等卡名字尾不是代碼，不受影響）
  let rest = String(text ?? '').normalize('NFKC')
    .replace(/([^\x00-\x7F])([A-Za-z]{2,5})(?=\s|$)/g, (match, before, code) => CODE_WORDS.has(code.toUpperCase()) ? `${before} ${code}` : match)
    .replace(/(^|\s)(日文版|日版|台版|美版|韓版)(?=[^\s])/g, '$1$2 ')
    .replace(/([^\s])(日文版|日版|台版|美版|韓版)(?=\s|$)/g, '$1 $2');
  for (const [pattern, code] of phraseRules) if (pattern.test(rest)) { rest = rest.replace(pattern, ' '); rarities.push(code) }
  let region = null;
  const kept = [];
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const upper = token.toUpperCase();
    if (CODE_WORDS.has(upper)) rarities.push(upper);
    else if (VERSION_WORDS.has(token) || VERSION_WORDS.has(upper)) region ||= VERSION_WORDS.get(token) || VERSION_WORDS.get(upper);
    else kept.push(token);
  }
  return { name: kept.join(' '), rarities: [...new Set(rarities)], region };
}

// 回傳 {q, name, rarities, region}（以及有需要時附帶 rarityOnly:true 與／或 series:{kind, label, terms, ...}）；
// 沒有拆出任何條件時，原樣當一般查詢（name＝原查詢），與既有契約完全相容。
// 整串只有稀有度代碼（可再加版本詞，例如「SAR」「UR 日版」）時回傳 {name:'', rarities, region, rarityOnly:true}。
export function parseSearchQuery(query, options = {}) {
  const q = String(query ?? '').trim(), plain = { q, name: q, rarities: [], region: null };
  if (!q) return plain;

  const seriesIndex = options?.seriesIndex || null;
  const regionFilter = options?.region || 'ALL';
  const normalized = q.normalize('NFKC');

  // 1) 先嘗試抽離複合查詢中的周年特徵（例如「30th皮卡丘」「皮卡丘30th台版」「30周年皮卡丘 SAR」）
  let seriesFeature = null;
  let working = normalized;
  const ann = extractAnniversary(normalized);
  if (ann) {
    const afterAnn = extractRarityAndRegion(ann.rest);
    // 只有扣除周年、稀有度、版本詞後仍有非空卡名／卡號時，才視為複合系列＋卡片搜尋；
    // 若剩餘為空（例如單搜「30th 日版」「30th SAR」），退回不拆周年，讓 30th 維持當系列查詢。
    if (afterAnn.name) {
      seriesFeature = ann.feature;
      working = ann.rest;
    }
  }

  // 2) 拆稀有度與版本詞
  let { name, rarities, region } = extractRarityAndRegion(working);

  // 3) 若尚未拆出周年特徵且有提供 seriesIndex，嘗試依 catalog.series 拆出系列代碼／系列號／核心系列名
  if (!seriesFeature && seriesIndex && name) {
    const catSeries = extractCatalogSeries(name, seriesIndex);
    if (catSeries && catSeries.name) {
      // 拆掉系列後，對剩餘文字再補一次尾部黏連稀有度／版本檢查（例如「M6a皮卡丘SAR」已在步驟 2 拆過，此處處理「皮卡丘台版M6a」等）
      const refined = extractRarityAndRegion(catSeries.name);
      if (refined.name) {
        seriesFeature = catSeries.feature;
        name = refined.name;
        if (refined.rarities.length) rarities = [...new Set([...rarities, ...refined.rarities])];
        if (!region && refined.region) region = refined.region;
      }
    }
  }

  // 4) 若有 seriesIndex，把系列特徵解析成實際 series IDs（供 server.mjs 送給資料庫交集）
  if (seriesFeature && seriesIndex) {
    const resolved = matchSeriesIndex(seriesFeature, seriesIndex, { region: regionFilter !== 'ALL' ? regionFilter : (region || 'ALL') });
    seriesFeature = { ...seriesFeature, ids: resolved.ids, allIds: resolved.allIds };
  }

  if (!seriesFeature && !rarities.length && (!name || !region)) return plain;
  if (!seriesFeature && !name) return { q, name: '', rarities, region, rarityOnly: true };
  return seriesFeature ? { q, name, rarities, region, series: seriesFeature } : { q, name, rarities, region };
}

// 稀有度代碼陣列 → 小寫拼法陣列（傳給 search_cards_ranked 的 p_rarities；空陣列表示不篩）。
export const rarityMatchValues = codes => [...new Set((codes || []).flatMap(code => [...(spellings.get(code) || [String(code).toLowerCase()])]))];
// printing 的 rarity 或 rarityCode 是否在拼法陣列內（與資料庫端的比對一致）。
export const printingMatchesRarity = (printing, values) => !values.length || [printing?.rarityCode, printing?.rarity].some(v => v && values.includes(String(v).toLowerCase()));

// 稀有度代碼單獨搜尋時給的範例查詢：代碼所屬的第一個遊戲（寶可夢、航海王、遊戲王）配一個該遊戲的常見卡名；其他遊戲不給範例。
const EXAMPLE_NAMES = { pokemon: '皮卡丘', onepiece: '魯夫', yugioh: '黑魔導女孩' };
export function rarityOnlyExample(rarities) {
  const code = (rarities || [])[0];
  if (!code) return null;
  for (const [game, name] of Object.entries(EXAMPLE_NAMES)) {
    const system = RARITY_RANKINGS.systems?.[game];
    if (system && ((system.canonicalCodes || []).includes(code) || (system.aliases || {})[code])) return `${name} ${code}`;
  }
  return null;
}

// 資料庫卡名 name 折疊後含有 folded 時，回傳 name 裡對應的原文片段（保留裡面的空白與中點）；沒有則 null。
export function foldedSpan(name, folded) {
  const chars = [...String(name ?? '')], owner = [];
  let text = '';
  chars.forEach((char, index) => { const part = foldSearch(char); for (let i = 0; i < part.length; i++) owner.push(index); text += part });
  const at = folded ? text.indexOf(folded) : -1;
  return at < 0 ? null : chars.slice(owner[at], owner[at + folded.length - 1] + 1).join('');
}

// 搜尋詞等於某個 IP（作品）名稱或別名時回傳它所屬的遊戲，給前端導向該遊戲；只收 status=active 且有範圍的項目（planned 沒有資料）。
const TAXONOMY = JSON.parse(readFileSync(new URL('../data/game-taxonomy.json', import.meta.url), 'utf8'));
const hintIndex = new Map();
for (const system of TAXONOMY.systems || []) {
  if (system.id === 'all' || system.status !== 'active') continue;
  for (const name of [system.nameZh, system.nameOriginal, system.nameEn]) if (foldSearch(name)) hintIndex.set(foldSearch(name), { gameId: system.id, franchiseId: null });
}
for (const system of TAXONOMY.systems || []) {
  for (const franchise of system.franchises || []) {
    if (franchise.status !== 'active' || !franchise.scope?.gameId) continue;
    for (const name of [franchise.nameZh, franchise.nameOriginal, ...(franchise.aliases || [])]) if (foldSearch(name)) hintIndex.set(foldSearch(name), { gameId: franchise.scope.gameId, franchiseId: franchise.id });
  }
}
export const gameHintFor = query => hintIndex.get(foldSearch(query)) || null;
