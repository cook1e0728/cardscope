-- Non-destructive catalog expansion: keep physical cards/printings intact while
-- introducing an explicit canonical identity layer and Korean source names.

alter table public.tcg_games add column if not exists name_ko text;
alter table public.tcg_series add column if not exists name_ko text;
alter table public.tcg_cards add column if not exists name_ko text;

create table if not exists public.tcg_canonical_cards (
  id text primary key,
  game_id text not null references public.tcg_games(id) on delete cascade,
  name_zh text,
  name_ja text,
  name_en text,
  name_ko text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcg_canonical_cards_game_idx on public.tcg_canonical_cards(game_id);
alter table public.tcg_canonical_cards enable row level security;
comment on table public.tcg_canonical_cards is 'Language-neutral card identities. Physical set/card-number variants remain in tcg_cards and tcg_printings.';

insert into public.tcg_series (id,game_id,official_code,name_zh,name_ja,name_en,region,release_date,aliases,source_url)
values ('pokemon-base1-us','pokemon','BS','基礎系列','拡張パック 第1弾','Base Set','US','1999-01-09',array['基礎系列','基本系列','base set','第一彈'],'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/base1/')
on conflict (id) do update set name_zh=excluded.name_zh,name_ja=excluded.name_ja,name_en=excluded.name_en,region=excluded.region,release_date=excluded.release_date,aliases=excluded.aliases,source_url=excluded.source_url,updated_at=now();

insert into public.tcg_cards (id,canonical_id,game_id,series_id,official_card_number,rarity,name_zh,name_ja,name_en,name_ko,aliases)
values
  ('pokemon-charizard-base1-4-us','pokemon-charizard-base-set-4','pokemon','pokemon-base1-us','4/102','Rare Holo','噴火龍','リザードン','Charizard','리자몽',array['噴火龍','喷火龙','charizard','リザードン','리자몽']),
  ('pokemon-mewtwo-base1-10-us','pokemon-mewtwo-base-set-10','pokemon','pokemon-base1-us','10/102','Rare Holo','超夢','ミュウツー','Mewtwo','뮤츠',array['超夢','超梦','mewtwo','ミュウツー','뮤츠'])
on conflict (id) do update set canonical_id=excluded.canonical_id,game_id=excluded.game_id,series_id=excluded.series_id,official_card_number=excluded.official_card_number,rarity=excluded.rarity,name_zh=excluded.name_zh,name_ja=excluded.name_ja,name_en=excluded.name_en,name_ko=excluded.name_ko,aliases=excluded.aliases,updated_at=now();

update public.tcg_cards set name_ko='뮤 ex',aliases=array['夢幻','梦幻','mew','ミュウ','뮤','夢幻 ex','mewex','ミュウ ex'],updated_at=now() where id='pokemon-mew-ex-sv4a-347-jp';
update public.tcg_cards set name_ko='몽키 D. 루피',aliases=array['魯夫','路飛','路飞','luffy','ルフィ','루피','monkey d luffy','蒙其d魯夫'],updated_at=now() where id='onepiece-luffy-op05-119-jp';
update public.tcg_cards set name_ko='블랙 매지션 걸',aliases=array['黑魔導女孩','黑魔導少女','黑魔法少女','dark magician girl','ブラックマジシャンガール','블랙 매지션 걸','DMG'],updated_at=now() where id='yugioh-dark-magician-girl-qccu-jp002-jp';

insert into public.tcg_printings (card_id,region,language,local_set_code,local_card_number,image_url,source_url,release_date)
values
  ('pokemon-charizard-base1-4-us','US','en-US','BS','4/102','https://images.pokemontcg.io/base1/4_hires.png','https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/base1/4/','1999-01-09'),
  ('pokemon-mewtwo-base1-10-us','US','en-US','BS','10/102','https://images.pokemontcg.io/base1/10_hires.png','https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/base1/10/','1999-01-09')
on conflict (card_id,region,language,local_set_code,local_card_number) do update set image_url=excluded.image_url,source_url=excluded.source_url,release_date=excluded.release_date,updated_at=now();

update public.tcg_printings set image_url='https://assets.tcgdex.net/ja/SV/SV4a/347/high.webp',source_url='https://www.pokemon-card.com/card-search/details.php/card/44513/',updated_at=now() where card_id='pokemon-mew-ex-sv4a-347-jp';
update public.tcg_printings set image_url='https://optcg-api.arjunbansal-ai.workers.dev/images/OP05-119',source_url='https://asia-en.onepiece-cardgame.com/cardlist/',updated_at=now() where card_id='onepiece-luffy-op05-119-jp';
update public.tcg_printings set image_url='https://images.ygoprodeck.com/images/cards/38033121.jpg',source_url='https://db.ygoprodeck.com/card/?search=Dark%20Magician%20Girl',updated_at=now() where card_id='yugioh-dark-magician-girl-qccu-jp002-jp';

insert into public.tcg_canonical_cards (id,game_id,name_zh,name_ja,name_en,name_ko,aliases)
select distinct on (canonical_id) canonical_id,game_id,name_zh,name_ja,name_en,name_ko,aliases from public.tcg_cards order by canonical_id,updated_at desc
on conflict (id) do update set game_id=excluded.game_id,name_zh=excluded.name_zh,name_ja=excluded.name_ja,name_en=excluded.name_en,name_ko=excluded.name_ko,aliases=excluded.aliases,updated_at=now();

insert into public.card_images (card_id,language,source,image_url,source_url,is_primary)
select card_id,language,
  case when card_id like 'pokemon-%base1%' then 'pokemontcg' when card_id='pokemon-mew-ex-sv4a-347-jp' then 'tcgdex' when card_id like 'onepiece-%' then 'optcg-api' else 'ygoprodeck' end,
  image_url,source_url,true
from public.tcg_printings
where card_id in ('pokemon-charizard-base1-4-us','pokemon-mewtwo-base1-10-us','pokemon-mew-ex-sv4a-347-jp','onepiece-luffy-op05-119-jp','yugioh-dark-magician-girl-qccu-jp002-jp') and image_url is not null
on conflict (card_id,source,image_url) do update set language=excluded.language,source_url=excluded.source_url,is_primary=true,fetched_at=now();
