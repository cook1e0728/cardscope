-- Preserve the source and review evidence used by multilingual names and
-- game-specific rarity dictionaries. This is additive and keeps raw values on
-- tcg_cards / tcg_printings intact.

alter table public.tcg_card_names
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tcg_rarities
  add column if not exists source text,
  add column if not exists source_url text,
  add column if not exists data_status text not null default 'incomplete'
    check (data_status in ('verified', 'pending', 'incomplete')),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists tcg_card_names_status_idx
  on public.tcg_card_names(data_status, locale, card_id);

create index if not exists tcg_rarities_status_idx
  on public.tcg_rarities(game_id, data_status, rarity_code);

comment on column public.tcg_card_names.source is
  'Provider identifier for the asserted localized name.';
comment on column public.tcg_rarities.data_status is
  'Source rarity values remain incomplete until their localized meaning and order are reviewed.';

insert into public.tcg_card_names (card_id, locale, name, name_type, source, data_status)
select id, locale, localized_name, 'official', source, 'pending'
from public.tcg_cards
cross join lateral (values
  ('zh-Hant-TW', name_zh),
  ('ja-JP', name_ja),
  ('en', name_en),
  ('ko', name_ko)
) localized(locale, localized_name)
where localized_name is not null and btrim(localized_name) <> ''
on conflict (card_id, locale, name, name_type) do nothing;

insert into public.tcg_rarities
  (game_id, rarity_code, rarity_label, source, data_status, metadata)
select distinct game_id, rarity, rarity, 'catalog-backfill', 'incomplete',
  jsonb_build_object('labelStatus', 'source-value')
from public.tcg_cards
where rarity is not null and btrim(rarity) <> ''
on conflict (game_id, rarity_code) do nothing;
