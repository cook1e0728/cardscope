// Text facts from the public pokemon-card.com card search (ADR 0007): set mark, card
// number, Japanese name and rarity icon. Images are never read or stored.

export const OFFICIAL_JP_ORIGIN = 'https://www.pokemon-card.com';

// Rarity codes the database already holds for pokemon; the official icon file is
// ic_rare_<code lower-case>.gif. Anything else is quarantined, never guessed.
export const OFFICIAL_JP_RARITY_CODES = new Set(['C', 'U', 'R', 'RR', 'RRR', 'AR', 'SR', 'SAR', 'UR', 'HR', 'S', 'SSR', 'K', 'ACE', 'MUR', 'BWR', 'CHR']);

export function officialJpListUrl(seriesCode, page) {
  const params = new URLSearchParams({ keyword: '', se_ta: '', regulation_sidebar_form: 'all', pg: seriesCode, illust: '', sm_and_keyword: 'true', page: String(page) });
  return `${OFFICIAL_JP_ORIGIN}/card-search/resultAPI.php?${params}`;
}

export function officialJpDetailUrl(cardId) {
  return `${OFFICIAL_JP_ORIGIN}/card-search/details.php/card/${encodeURIComponent(cardId)}/regu/all`;
}

export function parseOfficialJpList(body) {
  const json = typeof body === 'string' ? JSON.parse(body) : body;
  if (json?.result !== 1 || !Array.isArray(json.cardList)) throw new Error('OFFICIAL_LIST_UNEXPECTED');
  return { hitCount: Number(json.hitCnt), maxPage: Number(json.maxPage), cardIds: json.cardList.map(card => String(card.cardID)) };
}

const decodeText = text => String(text).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Parse one card detail page. The block looks like:
 *   <h1 class="Heading1 ...">NAME</h1> ... <div class="subtext ...">
 *   <img src=".../regulation_logo_1/SV8a.gif" class="img-regulation" alt="SV8a" /> &nbsp;103&nbsp;/&nbsp;187&nbsp;
 *   <img src="/assets/images/card/rarity/ic_rare_rr.gif" width="24" /></div>
 * Deck cards have no rarity image. Returns null fields rather than guessing.
 */
export function parseOfficialJpDetail(html) {
  const name = html.match(/<h1 class="Heading1[^"]*">([^<]*)<\/h1>/)?.[1];
  const subtext = html.match(/<div class="subtext[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? null;
  if (!subtext) return { nameJa: name ? decodeText(name) : null, setMark: null, number: null, total: null, rarityIcon: null };
  const setMark = subtext.match(/class="img-regulation"[^>]*alt="([^"]*)"/)?.[1] ?? subtext.match(/regulation_logo_\d+\/([^./"]+)\.gif/)?.[1] ?? null;
  const numbers = decodeText(subtext.replace(/<[^>]*>/g, ' ')).match(/^(\S+)\s*\/\s*(\S+)$/);
  const rarityIcon = subtext.match(/\/rarity\/(ic_rare_[a-z0-9_]+)\.(?:gif|png|svg)/i)?.[1]?.toLowerCase() ?? null;
  return { nameJa: name ? decodeText(name) : null, setMark, number: numbers?.[1] ?? null, total: numbers?.[2] ?? null, rarityIcon };
}

/**
 * Map a parsed rarity icon to { rarity } | { quarantine }. Icons may carry a `_c` suffix
 * (SV6a: u_c on cards the archive already lists as U, sr_c, ur_c); it is dropped. A page
 * without an icon is not proof of a card without a rarity mark: ACE SPEC cards (SV6a-063)
 * show none either, so it is quarantined as unknown.
 */
export function officialJpRarity(rarityIcon) {
  if (!rarityIcon) return { quarantine: 'OFFICIAL_NO_RARITY_ICON' };
  const code = rarityIcon.replace(/^ic_rare_/, '').replace(/_c$/, '').toUpperCase();
  return OFFICIAL_JP_RARITY_CODES.has(code) ? { rarity: code } : { quarantine: `UNKNOWN_RARITY_ICON:${rarityIcon}` };
}

const nfkc = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim();

/**
 * Decide one printing against one parsed official page (ADR 0007): the set mark and
 * card number must equal the printing's series code and number and the Japanese
 * names must agree after NFKC; otherwise quarantine.
 */
export function matchOfficialJpRarity(printing, detail) {
  if (!detail?.setMark || !detail.number) return { quarantine: 'OFFICIAL_IDENTITY_MISSING' };
  if (detail.setMark !== printing.code) return { quarantine: `SET_MISMATCH:${detail.setMark}` };
  if (detail.number !== printing.num) return { quarantine: `NUMBER_MISMATCH:${detail.number}` };
  if (nfkc(detail.nameJa) !== nfkc(printing.name_ja)) return { quarantine: `NAME_MISMATCH:${detail.nameJa}` };
  return officialJpRarity(detail.rarityIcon);
}
