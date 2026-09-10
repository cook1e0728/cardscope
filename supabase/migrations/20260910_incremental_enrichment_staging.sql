-- CardScope changed-only catalog enrichment and price observation staging.
-- Candidates stay private until a reviewed promotion writes to formal tables.

create table if not exists public.catalog_enrichment_candidates (
  id bigint generated always as identity primary key,
  source text not null,
  source_record_id text not null,
  source_url text,
  game_id text not null references public.tcg_games(id) on delete cascade,
  target_card_id text references public.tcg_cards(id) on delete cascade,
  target_canonical_id text references public.tcg_canonical_cards(id) on delete cascade,
  target_printing_id bigint references public.tcg_printings(id) on delete cascade,
  field_name text not null check (field_name in (
    'name_zh', 'name_ja', 'name_en', 'alias',
    'rarity_code', 'rarity_label', 'image_url'
  )),
  locale text,
  proposed_value jsonb not null,
  current_value jsonb,
  matching_method text not null check (matching_method in (
    'provider-id', 'official-id', 'provider-crosswalk', 'unmatched', 'ambiguous'
  )),
  payload_hash text not null,
  observed_at timestamptz not null default now(),
  status text not null default 'candidate' check (status in (
    'candidate', 'review', 'approved', 'rejected', 'promoted'
  )),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_record_id, field_name, payload_hash)
);

create index if not exists catalog_enrichment_candidates_review_idx
  on public.catalog_enrichment_candidates(status, game_id, observed_at desc);
create index if not exists catalog_enrichment_candidates_card_idx
  on public.catalog_enrichment_candidates(target_card_id, field_name);
create index if not exists catalog_enrichment_candidates_canonical_idx
  on public.catalog_enrichment_candidates(target_canonical_id, field_name);

alter table public.catalog_enrichment_candidates enable row level security;
revoke all on table public.catalog_enrichment_candidates from anon, authenticated;
grant select, insert, update, delete on table public.catalog_enrichment_candidates to service_role;
grant usage, select on sequence public.catalog_enrichment_candidates_id_seq to service_role;

comment on table public.catalog_enrichment_candidates is
  'Private changed-only candidate queue. Formal catalog coverage excludes these rows until reviewed promotion.';

create table if not exists public.price_observations (
  id bigint generated always as identity primary key,
  history_version smallint not null default 1,
  observation_key text not null unique,
  source text not null,
  provider text not null,
  source_observation_id text,
  source_url text,
  card_id text references public.tcg_cards(id) on delete cascade,
  provider_card_id text,
  card_identity text not null,
  comparison_key text not null,
  price_type text not null check (price_type in ('buyback', 'listing', 'sale')),
  currency text not null check (currency = upper(currency) and length(currency) = 3),
  amount numeric(18,4) not null check (amount >= 0),
  observed_at timestamptz not null,
  previous_observation_key text,
  change_amount numeric(18,4),
  change_percent numeric(18,4),
  change_direction text check (change_direction in ('up', 'down', 'unchanged')),
  market text,
  language text,
  condition text,
  set_code text,
  card_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists price_observations_history_idx
  on public.price_observations(comparison_key, observed_at desc);
create index if not exists price_observations_card_idx
  on public.price_observations(card_id, source, price_type, condition, observed_at desc);

alter table public.price_observations enable row level security;
revoke all on table public.price_observations from anon, authenticated;
grant select, insert, update, delete on table public.price_observations to service_role;
grant usage, select on sequence public.price_observations_id_seq to service_role;

comment on table public.price_observations is
  'Private append-only source observations. Trends require at least two comparable observations and do not imply completed sales.';
