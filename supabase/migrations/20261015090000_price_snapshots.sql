-- ADR 0042: daily reference-price snapshots (TCGdex relays Cardmarket trend / TCGplayer marketPrice), changed values only.
-- Narrow on purpose: the empty public.price_observations has too many columns for this volume (free plan, 500 MB).
-- The primary key (card_id, provider, variant, snapshot_date) already serves "one card's trend" (leading card_id), so no extra index.
create table if not exists public.price_snapshots (
  card_id text not null references public.tcg_cards(id) on delete cascade,
  provider text not null check (provider in ('tcgplayer', 'cardmarket')),
  variant text not null default '',
  currency text not null check (currency in ('EUR', 'USD')),
  snapshot_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (card_id, provider, variant, snapshot_date)
);

alter table public.price_snapshots enable row level security;

revoke all on public.price_snapshots from anon, authenticated;
grant select, insert, update, delete on public.price_snapshots to service_role;

comment on table public.price_snapshots is 'ADR 0042: one row per card, provider and variant when the reference price changed by >= 2% or 7 days passed. Written only by the server with the service role.';
comment on column public.price_snapshots.provider is 'tcgplayer (marketPrice, USD) or cardmarket (trend, EUR), relayed by TCGdex. Reference prices, never sold prices.';
comment on column public.price_snapshots.variant is 'TCGdex variant type (Cardmarket) or finish (TCGplayer); empty string when the source gives none.';
comment on column public.price_snapshots.snapshot_date is 'UTC date of the snapshot run.';
comment on column public.price_snapshots.observed_at is 'The source''s own update time for the value (TCGdex pricing.updated).';
