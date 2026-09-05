-- Durable catalog ingestion for sealed products, sets and provider-backed cards.
-- This migration is additive and intentionally grants access only to service_role.

create table if not exists public.tcg_products (
  id text primary key,
  game_id text not null references public.tcg_games(id) on delete cascade,
  series_id text references public.tcg_series(id) on delete set null,
  official_code text,
  product_type text not null,
  name_zh text,
  name_ja text,
  name_en text,
  name_ko text,
  aliases text[] not null default '{}',
  region text not null,
  language text not null,
  release_date date,
  image_url text,
  image_kind text not null check (image_kind in ('sealed-product','series-logo')),
  source text not null,
  source_url text,
  provider_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_sync_runs (
  id bigint generated always as identity primary key,
  provider text not null,
  scope text not null,
  status text not null check (status in ('running','completed','failed','skipped')),
  cursor text,
  rows_seen integer not null default 0,
  rows_written integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.tcg_series add column if not exists language text;
alter table public.tcg_series add column if not exists image_url text;
alter table public.tcg_series add column if not exists image_kind text;
alter table public.tcg_series add column if not exists source text;
alter table public.tcg_series add column if not exists provider_id text;
alter table public.tcg_series add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tcg_cards add column if not exists source text;
alter table public.tcg_cards add column if not exists provider_id text;
alter table public.tcg_cards add column if not exists search_text text;
alter table public.tcg_cards add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tcg_printings add column if not exists series_id text references public.tcg_series(id) on delete set null;
alter table public.tcg_printings add column if not exists rarity text;
alter table public.tcg_printings add column if not exists source text;
alter table public.tcg_printings add column if not exists provider_id text;
alter table public.tcg_printings add column if not exists image_rehost_required boolean not null default false;
alter table public.tcg_printings add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists tcg_products_source_provider_uidx
  on public.tcg_products(source, provider_id) where provider_id is not null;
create index if not exists tcg_products_game_release_idx
  on public.tcg_products(game_id, release_date desc);
create index if not exists tcg_products_series_idx on public.tcg_products(series_id);
create index if not exists catalog_sync_runs_provider_idx
  on public.catalog_sync_runs(provider, scope, started_at desc);
create unique index if not exists tcg_series_source_provider_uidx
  on public.tcg_series(source, provider_id) where provider_id is not null;
create unique index if not exists tcg_cards_source_provider_uidx
  on public.tcg_cards(source, provider_id) where provider_id is not null;
create index if not exists tcg_cards_search_text_idx on public.tcg_cards using gin (to_tsvector('simple', coalesce(search_text,'')));
create index if not exists tcg_printings_series_idx on public.tcg_printings(series_id);
create unique index if not exists tcg_printings_source_provider_uidx
  on public.tcg_printings(source, provider_id) where provider_id is not null;

alter table public.tcg_products enable row level security;
alter table public.catalog_sync_runs enable row level security;

revoke all on public.tcg_products from anon, authenticated;
revoke all on public.catalog_sync_runs from anon, authenticated;
grant select, insert, update, delete on public.tcg_products to service_role;
grant select, insert, update, delete on public.catalog_sync_runs to service_role;
grant usage, select on sequence public.catalog_sync_runs_id_seq to service_role;

comment on table public.tcg_products is 'Sealed products and set artwork only. Individual cards must never be inserted here.';
comment on table public.catalog_sync_runs is 'Audit trail and cursor state for repeatable public catalog synchronization.';
comment on column public.tcg_printings.image_rehost_required is 'True when provider terms require CardScope to store a local copy before displaying the image.';
