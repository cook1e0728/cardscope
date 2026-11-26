import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOfficialJpImages, runOfficialJpImages } from '../providers/pokemon-jp-official-images.mjs';

const thumb = (id, slug) => ({ cardID: id, cardThumbFile: `/assets/images/card_images/large/M6a/0${id}_P_${slug}.jpg`, cardNameViewText: '' });
const list = [
  { ...thumb('50614', 'ARORANASSHI'), cardNameViewText: 'アローラ ナッシー' },
  { ...thumb('50700', 'ARORANASSHI'), cardNameViewText: 'アローラ ナッシー' },
  { ...thumb('50730', 'MYUUTSUEX'), cardNameViewText: 'ミュウツーex' },
  { ...thumb('50731', 'MYUUEX'), cardNameViewText: 'ミュウex' },
  { ...thumb('50732', 'MYUUEX'), cardNameViewText: 'ミュウex' }
];
const details = new Map([['50614', { number: '002' }], ['50700', { number: '104' }], ['50730', { number: '134' }], ['50731', { number: '135' }], ['50732', { number: '135' }]]);
const cards = [
  { id: 'ja-104', canonicalId: 'c-104', number: '104', nameJa: 'アローラ ナッシー' },
  { id: 'ja-134', canonicalId: 'c-134', number: '134', nameJa: 'ミュウツーex' },
  { id: 'ja-135', canonicalId: 'c-135', number: '135', nameJa: 'ミュウex' },
  { id: 'ja-b', canonicalId: 'c-b', number: 'B', nameJa: 'ミュウ' }
];

test('official JP images: name and number must both match one official card', () => {
  const rows = matchOfficialJpImages(cards, list, details);
  assert.deepEqual(rows.map(r => [r.card_id, r.image_url.split('/').pop()]), [['ja-104', '050700_P_ARORANASSHI.jpg'], ['ja-134', '050730_P_MYUUTSUEX.jpg']], '同名不同號挑對號；同號兩張官方卡（ミュウex）不寫；無卡號對不到不寫');
  assert.equal(rows[0].source, 'pokemon-card-official-jp');
  assert.equal(rows[0].rights_note, 'ADR 0031');
  assert.equal(rows[0].canonical_id, 'c-104');
  assert.equal(rows[1].source_url, 'https://www.pokemon-card.com/card-search/details.php/card/50730/regu/all');
  assert.equal(rows[0].image_url, 'https://www.pokemon-card.com/assets/images/card_images/large/M6a/050700_P_ARORANASSHI.jpg');
});

test('official JP images: one official card is never given to two of our cards', () => {
  const twins = [{ id: 'a', number: '134', nameJa: 'ミュウツーex' }, { id: 'b', number: '134', nameJa: 'ミュウツーex' }];
  assert.deepEqual(matchOfficialJpImages(twins, list, details), []);
});

test('official JP images: run fetches the list, only name-matching detail pages, then writes', async () => {
  const urls = [], writes = [];
  const db = async (path, init) => {
    if (path.startsWith('/rpc/')) return [{ series_id: 's', official_code: 'M6a', cards: cards.slice(0, 2) }];
    writes.push(JSON.parse(init.body)); return null;
  };
  const detailHtml = n => `<h1 class="Heading1 mt-20">x</h1><div class="subtext Text-fjalla"><img class="img-regulation" alt="M6a" /> &nbsp;${n}&nbsp;/&nbsp;103&nbsp;</div>`;
  const fetchFn = async url => {
    urls.push(url);
    if (url.includes('resultAPI')) return new Response(JSON.stringify({ result: 1, maxPage: 1, cardList: list }));
    const id = url.match(/card\/(\d+)/)[1];
    return new Response(detailHtml(details.get(id).number));
  };
  const result = await runOfficialJpImages({ db, fetchFn, gapMs: 0, log: { log() {}, error() {} } });
  assert.equal(result.images, 2);
  assert.equal(urls.filter(u => u.includes('details.php')).length, 3, 'ミュウex 不在這次的缺圖卡裡，不開它的詳細頁');
  assert.deepEqual(writes[0].map(r => r.card_id), ['ja-104', 'ja-134']);
});

test('official JP images: stops at the request budget without failing', async () => {
  const db = async () => [{ official_code: 'M6a', cards }];
  const fetchFn = async () => new Response(JSON.stringify({ result: 1, maxPage: 1, cardList: list }));
  const result = await runOfficialJpImages({ db, fetchFn, gapMs: 0, maxRequests: 1, log: { log() {}, error() {} } });
  assert.equal(result.stoppedBy, 'request-budget');
  assert.equal(result.status, undefined);
});
