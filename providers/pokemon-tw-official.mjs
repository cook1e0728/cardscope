// Text facts from the public Taiwanese card search at asia.pokemon-card.com/tw (ADR 0010).
// The detail page has no rarity; rarity comes from which rarity filter lists a card.
// Images are never read or stored.

export const OFFICIAL_TW_ORIGIN = 'https://asia.pokemon-card.com';

// rarity[] filter values offered by the search form, mapped to database codes.
// 無標記 becomes NONE (No rarity mark). Labels without a database code are quarantined.
export const OFFICIAL_TW_RARITY_FILTERS = {
  1: 'C', 2: 'U', 3: 'R', 4: 'RR', 5: 'RRR', 6: 'PR', 7: 'TR', 8: 'SR', 9: 'HR', 10: 'UR', 11: '無標記',
  12: 'K', 13: 'A', 14: 'AR', 15: 'SAR', 16: 'S', 17: 'SSR', 18: 'ACE', 19: 'BWR', 20: 'MUR', 21: 'MA', 22: 'FUR'
};
const DATABASE_CODES = new Set(['C', 'U', 'R', 'RR', 'RRR', 'SR', 'HR', 'UR', 'K', 'AR', 'SAR', 'S', 'SSR', 'ACE', 'BWR', 'MUR']);

export function officialTwRarityCode(label) {
  if (label === '無標記') return { rarity: 'NONE' };
  return DATABASE_CODES.has(label) ? { rarity: label } : { quarantine: `UNMAPPED_TW_RARITY:${label}` };
}

export function officialTwListUrl({ seriesCode = '', rarityValue = null, page = 1 } = {}) {
  const params = new URLSearchParams();
  if (seriesCode) params.set('expansionCodes', seriesCode);
  if (rarityValue != null) params.append('rarity[]', String(rarityValue));
  params.set('pageNo', String(page));
  return `${OFFICIAL_TW_ORIGIN}/tw/card-search/list/?${params}`;
}

export function officialTwDetailUrl(detailId) {
  return `${OFFICIAL_TW_ORIGIN}/tw/card-search/detail/${encodeURIComponent(detailId)}/`;
}

export function parseOfficialTwList(html) {
  const detailIds = [...new Set([...html.matchAll(/\/tw\/card-search\/detail\/(\d+)\//g)].map(match => match[1]))];
  const totalPages = Number(html.match(/resultTotalPages">\s*\/\s*共\s*(\d+)\s*頁/)?.[1] ?? (detailIds.length ? 1 : 0));
  return { detailIds, totalPages };
}

const stripTags = text => String(text).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/**
 * <h1 class="pageHeader cardDetail"> <span class="evolveMarker"> 基礎 </span> 電電蟲 </h1>
 * <span class="expansionSymbol"> <img src=".../mark/SV6a_F.png"> </span> <span class="alpha"> H </span>
 * <span class="collectorNumber"> 001/064 </span>
 */
export function parseOfficialTwDetail(html) {
  const header = html.match(/<h1 class="pageHeader cardDetail">([\s\S]*?)<\/h1>/)?.[1];
  const nameZh = header == null ? null : stripTags(header.replace(/<span class="evolveMarker">[\s\S]*?<\/span>/g, ''));
  const setMark = html.match(/class="expansionSymbol">\s*<img src="[^"]*\/mark\/([^"/]+?)(?:_[A-Z])?\.png"/)?.[1] ?? null;
  const numbers = stripTags(html.match(/<span class="collectorNumber">([\s\S]*?)<\/span>/)?.[1] ?? '').match(/^(\S+)\s*\/\s*(\S+)$/);
  return { nameZh: nameZh || null, setMark, number: numbers?.[1] ?? null, total: numbers?.[2] ?? null };
}

// The official series filter (expansionCodes) decides which set a card belongs to. The set
// mark image name is only a consistency check, and it is written inconsistently
// (SV6a_F, sv1a_f, "SV2a F@4x", exp_sv4K, twhk_sv4a_exp, SV9aF_exp): it must contain the
// series code as its own token (an F suffix glued to it is allowed), case-insensitively, so
// SV4 never matches SV4a.
export function twSetMarkMatches(mark, code) {
  const escaped = String(code ?? '').replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return Boolean(code) && new RegExp(`(?:^|[^a-z0-9])${escaped}f?(?:[^a-z0-9]|$)`, 'i').test(String(mark ?? ''));
}

// Compare names after dropping Source name markup (<火箭隊的>, trailing [支援者], zero-width
// characters) and spaces; nothing else is forgiven.
export function twNameKey(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/<([^<>]+)>/g, '$1')
    .replace(/\[[^\[\]]*[㐀-鿿][^\[\]]*\]$/, '')
    .replace(/\s+/g, '');
}

// As on the Japanese page (ADR 0007), the official title may drop one bracketed note
// printed on the card: 妮莫（過去） is titled 妮莫.
export function sameTwName(databaseName, officialName) {
  const stored = twNameKey(databaseName), official = twNameKey(officialName);
  if (!official) return false;
  return stored === official || (stored.startsWith(official) && /^\([^()]+\)$/.test(stored.slice(official.length)));
}

/**
 * Decide one TW printing { code, num, name_zh } against the official entries for that set and
 * number: [{ detailId, setMark, number, nameZh, rarityLabels: [...] }]. Every entry must carry
 * exactly one rarity label and all must agree.
 */
export function matchOfficialTwRarity(printing, entries) {
  const same = entries.filter(entry => entry.listCode === printing.code && entry.number === printing.num);
  if (!same.length) return { quarantine: 'OFFICIAL_ENTRY_NOT_FOUND' };
  if (same.some(entry => !twSetMarkMatches(entry.setMark, printing.code))) return { quarantine: `SET_MARK_MISMATCH:${same.map(entry => entry.setMark).join('|')}` };
  if (same.some(entry => !sameTwName(printing.name_zh, entry.nameZh))) return { quarantine: `NAME_MISMATCH:${same.map(entry => entry.nameZh).join('|')}` };
  const labels = new Set(same.flatMap(entry => entry.rarityLabels || []));
  if (same.some(entry => (entry.rarityLabels || []).length !== 1) || labels.size !== 1) return { quarantine: `RARITY_AMBIGUOUS:${[...labels].join('|') || 'none'}` };
  return { ...officialTwRarityCode([...labels][0]), detailIds: same.map(entry => entry.detailId) };
}
