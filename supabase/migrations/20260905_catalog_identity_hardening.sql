-- CardScope: canonical identity, localized printing data, and rights-aware images.
-- Apply only through a reviewed Supabase migration workflow.

alter table public.tcg_games
  add column if not exists product_line text,
  add column if not exists catalog_status text not null default 'active'
    check (catalog_status in ('active', 'catalog-only', 'planned'));

alter table public.tcg_series
  add column if not exists product_category_id text not null default 'singles',
  add column if not exists source_locale text;

alter table public.tcg_cards
  add column if not exists rarity_tier smallint,
  add column if not exists data_status text not null default 'verified'
    check (data_status in ('verified', 'pending', 'incomplete'));

alter table public.tcg_printings
  add column if not exists rarity_code text,
  add column if not exists rarity_label text,
  add column if not exists image_rights_status text not null default 'not-provided'
    check (image_rights_status in ('licensed', 'partner-provided', 'user-provided', 'not-provided', 'not-displayable')),
  add column if not exists image_license_expires_at timestamptz,
  add column if not exists source_locale text,
  add column if not exists data_status text not null default 'incomplete'
    check (data_status in ('verified', 'pending', 'incomplete'));

create table if not exists public.tcg_card_names (
  id bigint generated always as identity primary key,
  card_id text not null references public.tcg_cards(id) on delete cascade,
  locale text not null,
  name text not null,
  name_type text not null default 'official'
    check (name_type in ('official', 'alias', 'romanized', 'search-alias')),
  source_url text,
  data_status text not null default 'verified'
    check (data_status in ('verified', 'pending', 'incomplete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(card_id, locale, name, name_type)
);

create table if not exists public.tcg_rarities (
  game_id text not null references public.tcg_games(id) on delete cascade,
  rarity_code text not null,
  rarity_label text,
  rarity_tier smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(game_id, rarity_code)
);

create table if not exists public.tcg_product_categories (
  id text primary key,
  name_zh text not null,
  name_en text,
  sort_order smallint not null,
  description_zh text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcg_card_names_lookup_idx
  on public.tcg_card_names(card_id, locale, name_type);
create index if not exists tcg_card_names_search_idx
  on public.tcg_card_names(locale, name);
create index if not exists tcg_printings_visibility_idx
  on public.tcg_printings(card_id, image_rights_status, region, language);
create index if not exists tcg_series_category_idx
  on public.tcg_series(game_id, product_category_id, region, release_date desc);

alter table public.tcg_card_names enable row level security;
alter table public.tcg_rarities enable row level security;
alter table public.tcg_product_categories enable row level security;

comment on column public.tcg_printings.image_rights_status is
  'Only licensed, partner-provided, or approved user-provided images may be displayed publicly.';
comment on table public.tcg_card_names is
  'Official localized names and search aliases; keep aliases separate from the canonical card identity.';
