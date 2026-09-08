-- Forward-only, additive repair for projects that may have received only part
-- of the historical catalog migrations. This migration never edits migration
-- history and never drops, renames, truncates or deletes application data.

alter table public.tcg_cards add column if not exists search_text text;

create extension if not exists pg_trgm with schema extensions;
create index if not exists tcg_cards_search_trgm_idx
  on public.tcg_cards using gin (search_text extensions.gin_trgm_ops);
create index if not exists tcg_cards_search_text_idx
  on public.tcg_cards using gin (to_tsvector('simple', coalesce(search_text,'')));

insert into public.tcg_product_categories
  (id, name_zh, name_en, sort_order, description_zh)
values
  ('singles', '單卡', 'Singles', 10, '可獨立查詢、收藏與比價的單張卡片。'),
  ('sealed', '密封商品', 'Sealed', 20, '未拆封的補充包、原盒、禮盒與組合包；不包含預組牌組。'),
  ('decks', '牌組／構築商品', 'Decks', 30, '起始牌組、預組套牌、補充牌組與其他可直接遊玩的構築商品。'),
  ('promo', '特典／贈品', 'Promos', 40, '隨活動、商品或合作企劃發行的特典卡與配布品。'),
  ('event-store', '賽事／商店限定', 'Event & Store Exclusives', 50, '賽事獎品、參加獎、商店限定與店鋪活動配布。'),
  ('accessories', '周邊道具', 'Accessories', 60, '卡套、牌盒、收納用品與其他遊戲周邊。'),
  ('other', '其他', 'Other', 70, '尚未能歸入上述類別的產品或資料。')
on conflict (id) do update set
  name_zh=excluded.name_zh,
  name_en=excluded.name_en,
  sort_order=excluded.sort_order,
  description_zh=excluded.description_zh,
  updated_at=now();

create table if not exists public.catalog_source_policies (
  id text primary key,
  runtime_provider text unique,
  kind text not null,
  game_id text references public.tcg_games(id) on update cascade on delete restrict,
  region text,
  source_name text not null,
  source_url text not null,
  access_method text not null,
  metadata_policy text not null,
  image_policy text not null,
  collection_enabled boolean not null default false,
  attribution_required boolean not null default true,
  refresh_hours integer check (refresh_hours is null or refresh_hours > 0),
  evidence_url text,
  reviewed_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalog_source_policies add column if not exists runtime_provider text;
alter table public.catalog_source_policies add column if not exists kind text;
alter table public.catalog_source_policies add column if not exists game_id text references public.tcg_games(id) on update cascade on delete restrict;
alter table public.catalog_source_policies add column if not exists region text;
alter table public.catalog_source_policies add column if not exists source_name text;
alter table public.catalog_source_policies add column if not exists source_url text;
alter table public.catalog_source_policies add column if not exists access_method text;
alter table public.catalog_source_policies add column if not exists metadata_policy text;
alter table public.catalog_source_policies add column if not exists image_policy text;
alter table public.catalog_source_policies add column if not exists collection_enabled boolean not null default false;
alter table public.catalog_source_policies add column if not exists attribution_required boolean not null default true;
alter table public.catalog_source_policies add column if not exists refresh_hours integer;
alter table public.catalog_source_policies add column if not exists evidence_url text;
alter table public.catalog_source_policies add column if not exists reviewed_at date;
alter table public.catalog_source_policies add column if not exists notes text;
alter table public.catalog_source_policies add column if not exists created_at timestamptz not null default now();
alter table public.catalog_source_policies add column if not exists updated_at timestamptz not null default now();

create unique index if not exists catalog_source_policies_runtime_provider_uidx
  on public.catalog_source_policies(runtime_provider) where runtime_provider is not null;
create index if not exists catalog_source_policies_game_id_idx
  on public.catalog_source_policies(game_id);
alter table public.catalog_source_policies enable row level security;
revoke all on table public.catalog_source_policies from anon, authenticated;
grant select, insert, update, delete on table public.catalog_source_policies to service_role;

insert into public.catalog_source_policies
  (id,runtime_provider,kind,game_id,region,source_name,source_url,access_method,metadata_policy,image_policy,collection_enabled,attribution_required,refresh_hours,evidence_url,reviewed_at,notes)
values
  ('pokemontcg','pokemon','catalog-api','pokemon','US','Pokémon TCG API','https://docs.pokemontcg.io/','public-api','approved-api','rights-review-required',true,false,72,'https://dev.pokemontcg.io/terms','2026-09-08','Card-art display rights remain unclassified.'),
  ('tcgdex-zh-tw','pokemonZhTw','catalog-api','pokemon','TW','TCGdex API','https://tcgdex.dev/','public-api','approved-api','rights-review-required',true,false,72,'https://github.com/tcgdex/documentation','2026-09-08','Used for metadata and Traditional Chinese matching.'),
  ('tcgdex-ja','pokemonJp','catalog-api','pokemon','JP','TCGdex API Japanese','https://tcgdex.dev/','public-api','approved-api','rights-review-required',true,true,72,'https://github.com/tcgdex/cards-database','2026-09-09','Japanese-first metadata source. Card-art rights remain unclassified and are never marked licensed.'),
  ('ygoprodeck','yugioh','catalog-api','yugioh','GLOBAL','YGOPRODeck API','https://api.ygoprodeck.com/api-guide/','public-api','approved-api','rights-review-required',true,true,72,'https://api.ygoprodeck.com/api-guide/','2026-09-08','Rehosting guidance is not treated as a copyright licence.'),
  ('onepiece-official-runtime','onepiece','official-page','onepiece','JP/TW','ONE PIECE CARD GAME card lists','https://www.onepiece-cardgame.com/cardlist/','official-page','permission-pending','not-collected',false,true,null,'https://www.onepiece-cardgame.com/','2026-09-08','Automatic collection disabled pending terms or permission.'),
  ('yuyutei','yuyutei','market-page',null,'JP','遊々亭買取','https://yuyu-tei.jp/buy/','manual-admin-only','permission-pending','not-collected',false,true,24,'https://yuyu-tei.jp/','2026-09-08','Automatic collection disabled pending terms or permission.'),
  ('ebay','ebay','market-api',null,'GLOBAL','eBay Browse API','https://developer.ebay.com/api-docs/buy/browse/overview.html','authenticated-api','approved-api','remote-listing-only',true,true,24,'https://developer.ebay.com/join/api-license-agreement','2026-09-08','Listing media remains attached to its source listing.'),
  ('frankfurter','frankfurter','exchange-rate-api',null,'GLOBAL','Frankfurter','https://frankfurter.dev/','public-api','approved-api','not-applicable',true,true,24,'https://frankfurter.dev/','2026-09-08','Exchange rates only.')
on conflict (id) do update set
  runtime_provider=excluded.runtime_provider,
  kind=excluded.kind,
  game_id=excluded.game_id,
  region=excluded.region,
  source_name=excluded.source_name,
  source_url=excluded.source_url,
  access_method=excluded.access_method,
  metadata_policy=excluded.metadata_policy,
  image_policy=excluded.image_policy,
  collection_enabled=excluded.collection_enabled,
  attribution_required=excluded.attribution_required,
  refresh_hours=excluded.refresh_hours,
  evidence_url=excluded.evidence_url,
  reviewed_at=excluded.reviewed_at,
  notes=excluded.notes,
  updated_at=now();

do $$
declare
  search_type text;
  policy_id_type text;
begin
  select data_type into search_type
  from information_schema.columns
  where table_schema='public' and table_name='tcg_cards' and column_name='search_text';
  if search_type is distinct from 'text' then
    raise exception 'public.tcg_cards.search_text must be text, found %', search_type;
  end if;

  select data_type into policy_id_type
  from information_schema.columns
  where table_schema='public' and table_name='catalog_source_policies' and column_name='id';
  if policy_id_type is distinct from 'text' then
    raise exception 'public.catalog_source_policies.id must be text, found %', policy_id_type;
  end if;
end
$$;
