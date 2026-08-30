create table if not exists public.tcg_games (
  id text primary key,
  name_zh text,
  name_ja text,
  name_en text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcg_series (
  id text primary key,
  game_id text not null references public.tcg_games(id) on delete cascade,
  official_code text not null,
  name_zh text,
  name_ja text,
  name_en text,
  region text,
  release_date date,
  aliases text[] not null default '{}',
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id, official_code, region)
);

create table if not exists public.tcg_cards (
  id text primary key,
  canonical_id text not null,
  game_id text not null references public.tcg_games(id) on delete cascade,
  series_id text references public.tcg_series(id) on delete set null,
  official_card_number text not null,
  rarity text,
  name_zh text,
  name_ja text,
  name_en text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcg_printings (
  id bigint generated always as identity primary key,
  card_id text not null references public.tcg_cards(id) on delete cascade,
  region text not null,
  language text not null,
  local_set_code text,
  local_card_number text,
  image_url text,
  source_url text,
  release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(card_id, region, language, local_set_code, local_card_number)
);

create index if not exists tcg_series_game_idx on public.tcg_series(game_id, release_date desc);
create index if not exists tcg_cards_game_series_idx on public.tcg_cards(game_id, series_id);
create index if not exists tcg_cards_number_idx on public.tcg_cards(official_card_number);
create index if not exists tcg_cards_canonical_idx on public.tcg_cards(canonical_id);
create index if not exists tcg_printings_card_region_idx on public.tcg_printings(card_id, region);

alter table public.tcg_games enable row level security;
alter table public.tcg_series enable row level security;
alter table public.tcg_cards enable row level security;
alter table public.tcg_printings enable row level security;

comment on table public.tcg_cards is 'Canonical card identity and multilingual names. Market prices should reference this identity instead of matching names directly.';
comment on table public.tcg_printings is 'Region/language-specific printings such as TW, JP and US/EN.';
