// 自然語句搜尋（ADR 0044 Q6）：把「桃歹郎ex SAR」「魯夫 台版」拆成卡名＋稀有度＋版本。
// 只認獨立的詞（以空白分隔），只認 data/rarity-rankings.json 的稀有度代碼與別名和下列版本詞；其餘一律當卡名，不猜。
import { readFileSync } from 'node:fs';
import { RARITY_RANKINGS } from './normalize.mjs';

const VERSION_WORDS = new Map([['日版', 'JP'], ['日文版', 'JP'], ['JP', 'JP'], ['台版', 'TW'], ['TW', 'TW'], ['美版', 'US'], ['US', 'US'], ['韓版', 'KR'], ['KR', 'KR']]);

// 單詞代碼只收 2–5 個大寫英文字母（單字母的 S/R/U/C/K/L/P 與一般字相撞，不收）；ACE 也是常見名字（Ace），不收。
const CODE_WORD = /^[A-Z]{2,5}$/, AMBIGUOUS_CODES = new Set(['ACE', 'NONE']);
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

// 回傳 {q, name, rarities, region}；沒有拆出任何條件時，原樣當一般查詢（name＝原查詢）。
// 整串只有稀有度代碼（可再加版本詞，例如「SAR」「UR 日版」）時回傳 {name:'', rarities, region, rarityOnly:true}：沒有卡名無法判斷是哪一張，不拿代碼去比對卡名。
export function parseSearchQuery(query) {
  const q = String(query ?? '').trim(), plain = { q, name: q, rarities: [], region: null };
  if (!q) return plain;
  const rarities = [];
  let rest = q.normalize('NFKC');
  for (const [pattern, code] of phraseRules) if (pattern.test(rest)) { rest = rest.replace(pattern, ' '); rarities.push(code) }
  let region = null;
  const kept = [];
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const upper = token.toUpperCase();
    if (CODE_WORDS.has(upper)) rarities.push(upper);
    else if (VERSION_WORDS.has(token) || VERSION_WORDS.has(upper)) region ||= VERSION_WORDS.get(token) || VERSION_WORDS.get(upper);
    else kept.push(token);
  }
  const name = kept.join(' ');
  if (!rarities.length && (!name || !region)) return plain;
  if (!name) return { q, name: '', rarities: [...new Set(rarities)], region, rarityOnly: true };
  return { q, name, rarities: [...new Set(rarities)], region };
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

// 與資料庫 tcg_search_fold 同一個折疊（小寫、NFKC、去空白／中點／連字號等），伺服器的 normalizeSearch 也是這個規則。
export const foldSearch = value => String(value ?? '').toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-<>\[\]​-‍⁠﻿]/g,'');
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
