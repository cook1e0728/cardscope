// 遊戲王中文搜尋別名：資料檔格式、規劃（對應英文卡名）、SQL 只附加 search_text 與 metadata，不碰 name_zh／aliases。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applySql, planAliases, termsOf, validate } from '../scripts/apply-yugioh-zh-aliases.mjs';

const file = JSON.parse(await readFile(new URL('../data/yugioh-zh-aliases.json', import.meta.url), 'utf8'));

test('資料檔開頭聲明非官方中文名，每筆都有卡名與含中文的別名', () => {
  assert.match(Object.values(file)[0], /非官方中文名，只作搜尋別名/);
  const entries = validate(file);
  assert.ok(entries.length >= 100);
  for (const e of entries) for (const a of e.aliases) assert.match(a, /[㐀-鿿]/, `${e.nameEn}: ${a}`);
});

test('validate 擋下重複卡名、空別名與 LIKE 萬用字元', () => {
  const base = { ...file, entries: [] };
  assert.throws(() => validate({ ...base, entries: [{ nameEn: 'A', aliases: ['甲'] }, { nameEn: 'a', aliases: ['乙'] }] }), /DUPLICATE_ENTRY/);
  assert.throws(() => validate({ ...base, entries: [{ nameEn: 'A', aliases: [] }] }), /ALIASES_INVALID/);
  assert.throws(() => validate({ ...base, entries: [{ nameEn: 'A', aliases: ['5%'] }] }), /ALIASES_INVALID/);
  assert.throws(() => validate({ ...base, source: 'official' }), /ALIAS_FILE_HEADER_INVALID/);
});

test('termsOf 同時收原寫法與折疊寫法（去空白、連字號、大小寫）', () => {
  assert.deepEqual(termsOf(['人造人-念力衝擊者', '青眼']), ['人造人-念力衝擊者', '人造人念力衝擊者', '青眼']);
  assert.deepEqual(termsOf(['No.39 希望皇 霍普']), ['No.39 希望皇 霍普', 'no39希望皇霍普']);
});

test('planAliases 依英文卡名（不分大小寫）或 passcode 對應，合併同卡別名並回報找不到的', () => {
  const rows = [{ id: 'yugioh-ygoprodeck-1', name_en: 'Dark Magician', provider_id: '1' }, { id: 'yugioh-ygoprodeck-2', name_en: 'Gaia The Fierce Knight', provider_id: '2' }];
  const { plan, unmatched } = planAliases([
    { nameEn: 'dark magician', aliases: ['黑魔術師'] }, { passcode: '1', aliases: ['黑魔導', '黑魔術師'] },
    { nameEn: 'Gaia the Fierce Knight', aliases: ['蓋亞'] }, { nameEn: 'Nonexistent', aliases: ['無'] }], rows);
  assert.deepEqual(unmatched, ['Nonexistent']);
  assert.deepEqual(plan.map(p => [p.id, p.aliases]), [['yugioh-ygoprodeck-1', ['黑魔術師', '黑魔導']], ['yugioh-ygoprodeck-2', ['蓋亞']]]);
});

test('寫入 SQL 只附加 search_text 與 metadata，不寫 name_zh／aliases，且已含的詞不重複附加', () => {
  const sql = applySql([{ id: 'yugioh-ygoprodeck-1', terms: ['黑魔術師'], aliases: ['黑魔術師'] }]);
  const set = sql.match(/update public\.tcg_cards c set([\s\S]*?)\n  from p/)[1];
  assert.deepEqual([...set.matchAll(/^\s{4}(\w+) =/gm)].map(m => m[1]), ['search_text', 'metadata']);
  assert.match(set, /zhAliasSource', 'cardscope-curated'/);
  assert.match(sql, /c\.game_id = 'yugioh' and c\.source = 'ygoprodeck'/);
  assert.match(sql, /position\(t in coalesce\(c\.search_text, ''\)\) = 0/);
  assert.doesNotMatch(set, /name_zh|aliases =/);
});
