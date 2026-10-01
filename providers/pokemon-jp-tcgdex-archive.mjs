import { POKEMON_JP_SOURCE_IDENTITY } from './pokemon-jp-manifest.mjs';

/**
 * Read TCGdex's open-source card database (github.com/tcgdex/cards-database)
 * as a stand-in for the TCGdex API when the API is unreachable. The API is
 * generated from these files, so a set read here yields the same snapshot
 * shape as API responses, pinned to one repository commit (ADR 0002).
 *
 * The data files are TypeScript modules. They are parsed as plain object
 * literals and never executed: anything beyond strings, numbers, booleans,
 * null, arrays, objects and bare identifier references is rejected.
 */

export const TCGDEX_ARCHIVE_REPOSITORY = 'tcgdex/cards-database';
export const TCGDEX_ARCHIVE_JA_ROOT = 'data-asia';

const COMMIT = /^[0-9a-f]{40}$/;
const PUNCTUATION = new Set(['{', '}', '[', ']', ':', ',']);
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\\': '\\', "'": "'", '"': '"' };

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      if (end === -1) throw new Error('TCGDEX_ARCHIVE_UNTERMINATED_COMMENT');
      index = end + 2;
      continue;
    }
    if (PUNCTUATION.has(char)) { tokens.push({ type: char }); index += 1; continue; }
    if (char === "'" || char === '"') {
      let value = '';
      index += 1;
      for (;;) {
        if (index >= text.length || text[index] === '\n') throw new Error('TCGDEX_ARCHIVE_UNTERMINATED_STRING');
        const current = text[index];
        if (current === char) { index += 1; break; }
        if (current === '\\') {
          const next = text[index + 1];
          if (next === 'u') {
            const hex = /^[0-9a-fA-F]{4}/.exec(text.slice(index + 2, index + 6));
            if (!hex) throw new Error('TCGDEX_ARCHIVE_INVALID_ESCAPE');
            value += String.fromCharCode(parseInt(hex[0], 16));
            index += 6;
          } else if (Object.hasOwn(ESCAPES, next)) {
            value += ESCAPES[next];
            index += 2;
          } else {
            throw new Error('TCGDEX_ARCHIVE_INVALID_ESCAPE');
          }
          continue;
        }
        value += current;
        index += 1;
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    NUMBER.lastIndex = index;
    const number = NUMBER.exec(text);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index = NUMBER.lastIndex; continue; }
    IDENTIFIER.lastIndex = index;
    const identifier = IDENTIFIER.exec(text);
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0] }); index = IDENTIFIER.lastIndex; continue; }
    throw new Error(`TCGDEX_ARCHIVE_UNSUPPORTED_SYNTAX:${JSON.stringify(text.slice(index, index + 20))}`);
  }
  return tokens;
}

function parseTokens(tokens) {
  let position = 0;
  const peek = () => tokens[position];
  const take = type => {
    const token = tokens[position];
    if (!token || (type && token.type !== type)) throw new Error(`TCGDEX_ARCHIVE_EXPECTED:${type}`);
    position += 1;
    return token;
  };
  const value = () => {
    const token = take();
    if (token.type === 'string' || token.type === 'number') return token.value;
    if (token.type === 'identifier') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null' || token.value === 'undefined') return null;
      return { $ref: token.value };
    }
    if (token.type === '[') {
      const items = [];
      while (peek()?.type !== ']') {
        items.push(value());
        if (peek()?.type !== ']') take(',');
      }
      take(']');
      return items;
    }
    if (token.type === '{') {
      const object = {};
      while (peek()?.type !== '}') {
        const key = take();
        if (key.type !== 'identifier' && key.type !== 'string') throw new Error('TCGDEX_ARCHIVE_INVALID_KEY');
        if (Object.hasOwn(object, key.value)) throw new Error(`TCGDEX_ARCHIVE_DUPLICATE_KEY:${key.value}`);
        take(':');
        object[key.value] = value();
        if (peek()?.type !== '}') take(',');
      }
      take('}');
      return object;
    }
    throw new Error(`TCGDEX_ARCHIVE_UNEXPECTED_TOKEN:${token.type}`);
  };
  const result = value();
  if (position !== tokens.length) throw new Error('TCGDEX_ARCHIVE_TRAILING_TOKENS');
  return result;
}

/**
 * Parse one TCGdex data module of the form
 *   import ... from '...'
 *   const name: Type = { ... }
 *   export default name
 * and return the object literal. Imports may only bind identifiers.
 */
export function parseTcgdexDataModule(source) {
  if (typeof source !== 'string') throw new Error('TCGDEX_ARCHIVE_SOURCE_REQUIRED');
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const declaration = /^const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$]*)?\s*=\s*/m.exec(text);
  if (!declaration) throw new Error('TCGDEX_ARCHIVE_DECLARATION_NOT_FOUND');
  const header = text.slice(0, declaration.index);
  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!/^import\s+(?:\{\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\}|[A-Za-z_$][\w$]*)\s+from\s+(['"])[./\w-]+\1;?$/.test(trimmed)) {
      throw new Error('TCGDEX_ARCHIVE_UNSUPPORTED_HEADER');
    }
  }
  const footer = new RegExp(`\\n\\s*export\\s+default\\s+${declaration[1]}\\s*;?\\s*$`).exec(text);
  if (!footer) throw new Error('TCGDEX_ARCHIVE_EXPORT_NOT_FOUND');
  const body = text.slice(declaration.index + declaration[0].length, footer.index).replace(/;\s*$/, '');
  const literal = parseTokens(tokenize(body));
  if (literal == null || typeof literal !== 'object' || Array.isArray(literal)) throw new Error('TCGDEX_ARCHIVE_OBJECT_REQUIRED');
  return literal;
}

function japaneseText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && typeof value.ja === 'string') return value.ja.trim() || null;
  return null;
}

/**
 * Build a manifest snapshot (see docs/JP_METADATA_PREFLIGHT.md) for one set
 * from its archive files. Card rows mirror the API fields the manifest reads
 * (`id`, `localId`, `name`, `rarity`, `set`) plus `sourceFile`, so the source
 * hash binds every row to the exact repository path.
 */
export function buildPokemonJpArchiveSnapshot({ commit, seriesGroup, setId, setSource, cardSources, observedAt, existingJpRows }) {
  if (!COMMIT.test(String(commit))) throw new Error('TCGDEX_ARCHIVE_COMMIT_REQUIRED');
  if (!/^[A-Za-z0-9]+$/.test(String(seriesGroup))) throw new Error('TCGDEX_ARCHIVE_SERIES_GROUP_REQUIRED');
  if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/.test(String(setId))) throw new Error('TCGDEX_ARCHIVE_SET_ID_REQUIRED');
  if (!Array.isArray(cardSources) || cardSources.length === 0) throw new Error('TCGDEX_ARCHIVE_CARDS_REQUIRED');

  const setPath = `${TCGDEX_ARCHIVE_JA_ROOT}/${seriesGroup}/${setId}.ts`;
  const set = parseTcgdexDataModule(setSource);
  if (set.id !== setId) throw new Error(`TCGDEX_ARCHIVE_SET_ID_MISMATCH:${set.id}`);
  const setName = japaneseText(set.name);
  const releaseDate = japaneseText(set.releaseDate);
  const official = Number.isInteger(set.cardCount?.official) ? set.cardCount.official : null;
  const cardCount = { official, total: cardSources.length };

  const errors = [];
  const cards = cardSources.map(({ file, source }) => {
    const match = /^([A-Za-z0-9]+)\.ts$/.exec(String(file));
    if (!match) throw new Error(`TCGDEX_ARCHIVE_INVALID_CARD_FILE:${file}`);
    const localId = match[1];
    const card = parseTcgdexDataModule(source);
    if (card.set?.$ref == null) errors.push(`${localId}:set-reference`);
    const name = japaneseText(card.name);
    if (!name) errors.push(`${localId}:missing-ja-name`);
    return {
      id: `${setId}-${localId}`,
      localId,
      name,
      category: typeof card.category === 'string' ? card.category : null,
      rarity: typeof card.rarity === 'string' ? card.rarity : null,
      set: { id: setId, name: setName, cardCount },
      sourceFile: `${TCGDEX_ARCHIVE_JA_ROOT}/${seriesGroup}/${setId}/${file}`
    };
  });
  if (errors.length > 0) throw new Error(`TCGDEX_ARCHIVE_INVALID_CARDS:${errors.join(',')}`);

  return {
    observedAt,
    sourceIdentity: { ...POKEMON_JP_SOURCE_IDENTITY },
    sourceArchive: { repository: TCGDEX_ARCHIVE_REPOSITORY, commit, setFile: setPath },
    sets: [{ id: setId, name: setName, releaseDate, region: 'JP', locale: 'ja-JP' }],
    cards,
    existingJpRows
  };
}
