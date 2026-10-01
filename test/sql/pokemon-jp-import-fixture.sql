-- Minimal replica of the production catalog tables touched by
-- private.import_pokemon_jp_metadata. Columns, defaults, keys, foreign keys and
-- the canonical trigger were copied from the live schema on 2026-10-01; the
-- repo's historical migrations cannot be replayed onto an empty database.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create table public.tcg_games (
  id text primary key,
  name_zh text, name_ja text, name_en text not null, name_ko text,
  product_line text, catalog_status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tcg_rarities (
  game_id text not null references public.tcg_games(id) on delete cascade,
  rarity_code text not null, rarity_label text, rarity_tier smallint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (game_id, rarity_code)
);

create table public.tcg_series (
  id text primary key,
  game_id text not null references public.tcg_games(id) on delete cascade,
  official_code text not null,
  name_zh text, name_ja text, name_en text, region text, release_date date,
  aliases text[] not null default '{}', source_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  name_ko text, language text, image_url text, image_kind text, source text, provider_id text,
  metadata jsonb not null default '{}'::jsonb, product_category_id text not null default 'singles', source_locale text,
  unique (game_id, official_code, region)
);
create unique index tcg_series_source_provider_uidx on public.tcg_series(source, provider_id) where provider_id is not null;

create table public.tcg_canonical_cards (
  id text primary key,
  game_id text not null references public.tcg_games(id) on delete cascade,
  name_zh text, name_ja text, name_en text, name_ko text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tcg_cards (
  id text primary key,
  canonical_id text not null references public.tcg_canonical_cards(id) on update cascade on delete restrict,
  game_id text not null references public.tcg_games(id) on delete cascade,
  series_id text references public.tcg_series(id) on delete set null,
  official_card_number text not null, rarity text,
  name_zh text, name_ja text, name_en text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  name_ko text, source text, provider_id text, search_text text,
  metadata jsonb not null default '{}'::jsonb, rarity_tier smallint,
  data_status text not null default 'verified' check (data_status in ('verified', 'pending', 'incomplete'))
);
create unique index tcg_cards_source_provider_uidx on public.tcg_cards(source, provider_id) where provider_id is not null;

create table public.tcg_printings (
  id bigint generated always as identity primary key,
  card_id text not null references public.tcg_cards(id) on delete cascade,
  region text not null, language text not null, local_set_code text, local_card_number text,
  image_url text, source_url text, release_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  series_id text references public.tcg_series(id) on delete set null,
  rarity text, source text, provider_id text,
  image_rehost_required boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  rarity_code text, rarity_label text,
  image_rights_status text not null default 'not-provided'
    check (image_rights_status in ('licensed', 'partner-provided', 'user-provided', 'not-provided', 'not-displayable')),
  image_license_expires_at timestamptz, source_locale text,
  data_status text not null default 'incomplete' check (data_status in ('verified', 'pending', 'incomplete')),
  rights_note text,
  unique (card_id, region, language, local_set_code, local_card_number),
  constraint tcg_printings_source_provider_key unique (source, provider_id)
);

create or replace function public.sync_tcg_canonical_from_card()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.tcg_canonical_cards (
    id, game_id, name_zh, name_ja, name_en, name_ko, aliases, updated_at
  ) values (
    new.canonical_id, new.game_id, new.name_zh, new.name_ja, new.name_en, new.name_ko,
    array_remove(
      coalesce(new.aliases, '{}'::text[])
      || array_remove(array[new.name_zh, new.name_ja, new.name_en, new.name_ko], null),
      ''
    ),
    now()
  )
  on conflict (id) do update set
    game_id = excluded.game_id,
    name_zh = coalesce(public.tcg_canonical_cards.name_zh, excluded.name_zh),
    name_ja = coalesce(public.tcg_canonical_cards.name_ja, excluded.name_ja),
    name_en = coalesce(public.tcg_canonical_cards.name_en, excluded.name_en),
    name_ko = coalesce(public.tcg_canonical_cards.name_ko, excluded.name_ko),
    aliases = (
      select array_agg(distinct value order by value)
      from unnest(coalesce(public.tcg_canonical_cards.aliases, '{}'::text[]) || coalesce(excluded.aliases, '{}'::text[])) as value
      where btrim(value) <> ''
    ),
    updated_at = now();
  return new;
end;
$function$;

create trigger sync_tcg_canonical_from_card_trigger
before insert or update of canonical_id, game_id, name_zh, name_ja, name_en, name_ko, aliases
on public.tcg_cards
for each row execute function public.sync_tcg_canonical_from_card();

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

insert into public.tcg_games (id, name_en) values ('pokemon', 'Pokémon');
insert into public.tcg_rarities (game_id, rarity_code, rarity_label, rarity_tier) values
  ('pokemon', 'C', 'C', 24), ('pokemon', 'U', 'U', 23), ('pokemon', 'RR', 'RR', 12);

-- The live hand-written SV4a seed and one TW row that must never change.
insert into public.tcg_series (id, game_id, official_code, name_zh, name_ja, region, release_date)
values ('pokemon-sv4a-jp', 'pokemon', 'SV4a', '閃色寶藏 ex', 'シャイニートレジャーex', 'JP', '2023-12-01'),
       ('pokemon-tcgdex-tw-svln', 'pokemon', 'SVLN', '測試台版', null, 'TW', null);
insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, name_zh, name_ja, name_en)
values ('pokemon-mew-ex-sv4a-347-jp', 'pokemon-mew-ex', 'pokemon', 'pokemon-sv4a-jp', '347/190', 'SSR', '夢幻ex', 'ミュウex', 'Mew ex');
insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, name_zh, source, provider_id, data_status)
values ('pokemon-tcgdex-tw-svln-001', 'pokemon-tcgdex-tw-svln-001', 'pokemon', 'pokemon-tcgdex-tw-svln', '001', '台版卡', 'tcgdex-zh-tw', 'SVLN-001', 'verified');
insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, data_status)
values ('pokemon-mew-ex-sv4a-347-jp', 'JP', 'ja-JP', 'SV4a', '347/190', 'incomplete');
insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, source, provider_id, data_status, series_id)
values ('pokemon-tcgdex-tw-svln-001', 'TW', 'zh-Hant-TW', 'SVLN', '001', 'tcgdex-zh-tw', 'SVLN-001', 'verified', 'pokemon-tcgdex-tw-svln');
