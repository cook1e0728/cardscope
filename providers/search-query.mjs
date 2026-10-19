// 自然語句搜尋（ADR 0044 Q6）：把「桃歹郎ex SAR」「魯夫 台版」拆成卡名＋稀有度＋版本。
// 只認獨立的詞（以空白分隔），只認 data/rarity-rankings.json 的稀有度代碼與別名和下列版本詞；其餘一律當卡名，不猜。
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

// 回傳 {q, name, rarities, region}；沒有拆出任何條件，或拆完沒有卡名時，原樣當一般查詢（name＝原查詢）。
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
  if (!name || (!rarities.length && !region)) return plain;
  return { q, name, rarities: [...new Set(rarities)], region };
}

// 稀有度代碼陣列 → 小寫拼法陣列（傳給 search_cards_ranked 的 p_rarities；空陣列表示不篩）。
export const rarityMatchValues = codes => [...new Set((codes || []).flatMap(code => [...(spellings.get(code) || [String(code).toLowerCase()])]))];
// printing 的 rarity 或 rarityCode 是否在拼法陣列內（與資料庫端的比對一致）。
export const printingMatchesRarity = (printing, values) => !values.length || [printing?.rarityCode, printing?.rarity].some(v => v && values.includes(String(v).toLowerCase()));
