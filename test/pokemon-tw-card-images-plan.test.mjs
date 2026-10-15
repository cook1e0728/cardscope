import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTwCardImageSql, officialTwImageUrl, planTwOfficialCardImages, twCardImageBatches } from '../providers/pokemon-tw-card-images-plan.mjs';

const detail = (number, nameZh, setMark = 'S10P', total = '067') => ({ number, nameZh, setMark, total });
const cache = {
  seriesLists: {
    S10P: { complete: true, pages: { 1: ['6344', '6345', '6400', '6401'] } },
    SV11B: { complete: true, pages: { 1: ['10', '11'] } },
    'SV-P': { complete: true, pages: { 1: ['20', '21', '22', '23'] } }
  },
  details: {
    6344: detail('045', '達克萊伊'), 6345: detail('046', '耿鬼'), 6400: detail(null, '基本超能量'), 6401: detail(null, '基本火能量'),
    10: detail('001', '藤藤蛇', 'SV11BF_exp', '086'), 11: detail('001', '藤藤蛇', 'SV11BF_exp', '086'),
    20: detail(null, '基本草能量', 'PROMO.MARK', null), 21: detail(null, '勝利之證', 'PROMO.MARK', null), 22: detail(null, '勝利之證', 'PROMO.MARK', null), 23: detail('001', '皮卡丘', 'PROMO.MARK', 'SV-P')
  }
};
const card = (card_id, code, num, name_zh, ids = null) => ({ card_id, code, num, name_zh, ids });
const everyCard = list => list.map(({ card_id, code, name_zh }) => ({ card_id, code, name_zh }));

test('image URL pads the detail ID to eight digits', () => {
  assert.equal(officialTwImageUrl('6344'), 'https://asia.pokemon-card.com/tw/card-img/tw00006344.png');
});

test('a card with no ID takes the one series entry with its number, set mark and name', () => {
  const cards = [card('pokemon-tcgdex-tw-s10p-045', 'S10P', '045', '達克萊伊'), card('pokemon-tcgdex-tw-s10p-046', 'S10P', '046', '別的名字')];
  const { matched, unmatched } = planTwOfficialCardImages({ cards, allCards: everyCard(cards), cache });
  assert.deepEqual(matched.map(m => [m.cardId, m.detailId, m.group]), [['pokemon-tcgdex-tw-s10p-045', '6344', 'c']]);
  assert.match(unmatched[0].reason, /^NAME_OR_SET_MISMATCH:6345/);
});

test('same-number versions are never written, whether the printing lists the IDs or not', () => {
  const cards = [card('pokemon-official-tw-sv11b-001', 'SV11B', '001', '藤藤蛇', ['10', '11']), card('pokemon-tcgdex-tw-sv11b-001', 'SV11B', '001', '藤藤蛇')];
  const { matched, unmatched } = planTwOfficialCardImages({ cards, allCards: everyCard(cards), cache });
  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched.map(u => u.reason.split(':')[0]), ['MULTIPLE_OFFICIAL_VERSIONS', 'SAME_NUMBER_VERSIONS']);
});

test('one metadata ID is checked against the cached detail page', () => {
  const ok = card('pokemon-official-tw-s10p-045', 'S10P', '045', '達克萊伊', ['6344']);
  const wrong = card('pokemon-official-tw-s10p-046', 'S10P', '046', '達克萊伊', ['6345']);
  const { matched, unmatched } = planTwOfficialCardImages({ cards: [ok, wrong], allCards: everyCard([ok, wrong]), cache });
  assert.deepEqual(matched.map(m => m.detailId), ['6344']);
  assert.match(unmatched[0].reason, /^METADATA_ID_DISAGREES_WITH_DETAIL:6345/);
});

test('numberless entries match only when unique in the series and in the database', () => {
  const energy = card('pokemon-tcgdex-tw-s10p-fir', 'S10P', 'FIR', '基本火能量');
  const twoOfName = [card('pokemon-tcgdex-tw-s10p-psy', 'S10P', 'PSY', '基本超能量'), card('pokemon-tcgdex-tw-s10p-psy2', 'S10P', 'PSY2', '基本超能量')];
  const victory = card('pokemon-tcgdex-tw-sv-p-no1', 'SV-P', 'no1', '勝利之證(冠軍)');
  const grass = card('pokemon-tcgdex-tw-sv-p-gra', 'SV-P', 'GRA', '基本草能量');
  const cards = [energy, ...twoOfName, victory, grass];
  const { matched, unmatched } = planTwOfficialCardImages({ cards, allCards: everyCard(cards), cache });
  assert.deepEqual(matched.map(m => [m.cardId, m.detailId]), [['pokemon-tcgdex-tw-s10p-fir', '6401'], ['pokemon-tcgdex-tw-sv-p-gra', '20']]);
  assert.deepEqual(unmatched.map(u => u.reason.split(':')[0]).sort(), ['DATABASE_NAME_NOT_UNIQUE_IN_SERIES', 'DATABASE_NAME_NOT_UNIQUE_IN_SERIES', 'NUMBERLESS_NAME_AMBIGUOUS']);
});

test('a detail ID claimed by two cards drops both', () => {
  const a = card('pokemon-official-tw-s10p-045', 'S10P', '045', '達克萊伊', ['6344']);
  const b = card('pokemon-tcgdex-tw-s10p-045', 'S10P', '045', '達克萊伊');
  const { matched, unmatched } = planTwOfficialCardImages({ cards: [a, b], allCards: everyCard([a, b]), cache });
  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched.map(u => u.reason), ['DETAIL_ID_CLASH:6344', 'DETAIL_ID_CLASH:6344']);
});

test('an uncached series is reported, not guessed', () => {
  const c = card('pokemon-tcgdex-tw-xx-001', 'XX', '001', '皮卡丘');
  const { matched, unmatched } = planTwOfficialCardImages({ cards: [c], allCards: everyCard([c]), cache });
  assert.deepEqual(matched, []);
  assert.equal(unmatched[0].reason, 'OFFICIAL_SERIES_LIST_NOT_CACHED');
});

test('SQL: the write asserts exact counts, the test always rolls back, the replay inserts nothing', () => {
  const rows = [{ cardId: 'pokemon-tcgdex-tw-s10p-045', detailId: '6344' }, { cardId: 'pokemon-tcgdex-tw-s10p-046', detailId: '6345' }];
  const sql = buildTwCardImageSql(rows, 'batch-01');
  assert.match(sql.dry, /^with plan/);
  assert.match(sql.test, /raise exception 'ROLLBACK_TEST_OK batch-01 inserted=%'/);
  assert.match(sql.write, /if n <> 2 then raise exception 'INSERT_COUNT_MISMATCH/);
  assert.match(sql.write, /'not-provided', 'ADR 0031'/);
  assert.match(sql.write, /lpad\(t\.detail_id, 8, '0'\)/);
  assert.match(sql.write, /not exists \(select 1 from card_images ci where ci\.card_id = p\.card_id\)/);
  assert.match(sql.replay, /if n <> 0 then raise exception 'ELIGIBLE_COUNT_MISMATCH/);
  assert.doesNotMatch(sql.replay, /insert into card_images/);
  assert.throws(() => buildTwCardImageSql([{ cardId: "x'; drop table card_images; --", detailId: '1' }], 'b'), /UNSAFE_SQL_VALUE/);
});

test('batches hold at most the batch size', () => {
  assert.deepEqual(twCardImageBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
