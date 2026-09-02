-- Connect every imported physical card and cached image to the canonical catalog.
-- This is additive: physical cards, printings and source metadata stay intact.

insert into public.tcg_canonical_cards (
  id, game_id, name_zh, name_ja, name_en, name_ko, aliases, updated_at
)
select
  c.canonical_id,
  min(c.game_id),
  (array_agg(c.name_zh order by c.updated_at desc) filter (where c.name_zh is not null))[1],
  (array_agg(c.name_ja order by c.updated_at desc) filter (where c.name_ja is not null))[1],
  (array_agg(c.name_en order by c.updated_at desc) filter (where c.name_en is not null))[1],
  (array_agg(c.name_ko order by c.updated_at desc) filter (where c.name_ko is not null))[1],
  '{}'::text[],
  now()
from public.tcg_cards c
group by c.canonical_id
on conflict (id) do update set
  game_id = excluded.game_id,
  name_zh = coalesce(public.tcg_canonical_cards.name_zh, excluded.name_zh),
  name_ja = coalesce(public.tcg_canonical_cards.name_ja, excluded.name_ja),
  name_en = coalesce(public.tcg_canonical_cards.name_en, excluded.name_en),
  name_ko = coalesce(public.tcg_canonical_cards.name_ko, excluded.name_ko),
  updated_at = now();

with canonical_aliases as (
  select
    c.canonical_id,
    array_agg(distinct alias order by alias) filter (where btrim(alias) <> '') as aliases
  from public.tcg_cards c
  cross join lateral unnest(
    coalesce(c.aliases, '{}'::text[])
    || array_remove(array[c.name_zh, c.name_ja, c.name_en, c.name_ko], null)
  ) as alias
  group by c.canonical_id
)
update public.tcg_canonical_cards cc
set aliases = (
  select array_agg(distinct value order by value)
  from unnest(coalesce(cc.aliases, '{}'::text[]) || coalesce(a.aliases, '{}'::text[])) as value
  where btrim(value) <> ''
), updated_at = now()
from canonical_aliases a
where a.canonical_id = cc.id;

alter table public.tcg_cards
  add constraint tcg_cards_canonical_id_fkey
  foreign key (canonical_id) references public.tcg_canonical_cards(id)
  on update cascade on delete restrict not valid;

alter table public.tcg_cards validate constraint tcg_cards_canonical_id_fkey;

alter table public.card_images add column if not exists canonical_id text;

update public.card_images ci
set canonical_id = c.canonical_id
from public.tcg_cards c
where c.id = ci.card_id
  and ci.canonical_id is distinct from c.canonical_id;

alter table public.card_images alter column canonical_id set not null;

alter table public.card_images
  add constraint card_images_card_id_fkey
  foreign key (card_id) references public.tcg_cards(id)
  on update cascade on delete cascade not valid;

alter table public.card_images validate constraint card_images_card_id_fkey;

alter table public.card_images
  add constraint card_images_canonical_id_fkey
  foreign key (canonical_id) references public.tcg_canonical_cards(id)
  on update cascade on delete cascade not valid;

alter table public.card_images validate constraint card_images_canonical_id_fkey;

create index if not exists card_images_canonical_primary_idx
  on public.card_images(canonical_id, is_primary desc, fetched_at desc);

create or replace function public.sync_tcg_canonical_from_card()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.tcg_canonical_cards (
    id, game_id, name_zh, name_ja, name_en, name_ko, aliases, updated_at
  ) values (
    new.canonical_id,
    new.game_id,
    new.name_zh,
    new.name_ja,
    new.name_en,
    new.name_ko,
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
      from unnest(
        coalesce(public.tcg_canonical_cards.aliases, '{}'::text[])
        || coalesce(excluded.aliases, '{}'::text[])
      ) as value
      where btrim(value) <> ''
    ),
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_tcg_canonical_from_card() from public, anon, authenticated;
grant execute on function public.sync_tcg_canonical_from_card() to service_role;

drop trigger if exists sync_tcg_canonical_from_card_trigger on public.tcg_cards;
create trigger sync_tcg_canonical_from_card_trigger
before insert or update of canonical_id, game_id, name_zh, name_ja, name_en, name_ko, aliases
on public.tcg_cards
for each row execute function public.sync_tcg_canonical_from_card();

create or replace function public.sync_card_image_canonical_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select c.canonical_id into new.canonical_id
  from public.tcg_cards c
  where c.id = new.card_id;

  if new.canonical_id is null then
    raise foreign_key_violation using message = 'card_images.card_id does not reference a catalog card';
  end if;
  return new;
end;
$$;

revoke all on function public.sync_card_image_canonical_id() from public, anon, authenticated;
grant execute on function public.sync_card_image_canonical_id() to service_role;

drop trigger if exists sync_card_image_canonical_id_trigger on public.card_images;
create trigger sync_card_image_canonical_id_trigger
before insert or update of card_id
on public.card_images
for each row execute function public.sync_card_image_canonical_id();

create or replace view public.tcg_canonical_card_catalog
with (security_invoker = true)
as
select
  cc.id,
  cc.game_id,
  g.name_zh as game_name_zh,
  g.name_ja as game_name_ja,
  g.name_en as game_name_en,
  g.name_ko as game_name_ko,
  cc.name_zh,
  cc.name_ja,
  cc.name_en,
  cc.name_ko,
  cc.aliases,
  coalesce(card_stats.physical_card_count, 0) as physical_card_count,
  coalesce(card_stats.printing_count, 0) as printing_count,
  preferred_image.card_id as image_card_id,
  preferred_image.image_url,
  preferred_image.image_source,
  preferred_image.source_url as image_source_url,
  preferred_image.language as image_language,
  preferred_image.region as image_region,
  cc.updated_at
from public.tcg_canonical_cards cc
join public.tcg_games g on g.id = cc.game_id
left join lateral (
  select
    count(distinct c.id)::integer as physical_card_count,
    count(distinct p.id)::integer as printing_count
  from public.tcg_cards c
  left join public.tcg_printings p on p.card_id = c.id
  where c.canonical_id = cc.id
) card_stats on true
left join lateral (
  select candidate.card_id, candidate.image_url, candidate.image_source,
         candidate.source_url, candidate.language, candidate.region
  from (
    select
      ci.card_id,
      ci.image_url,
      ci.source as image_source,
      ci.source_url,
      ci.language,
      p.region,
      case when ci.is_primary then 0 else 1 end as source_priority,
      ci.fetched_at as observed_at
    from public.card_images ci
    join public.tcg_cards c on c.id = ci.card_id
    left join public.tcg_printings p on p.card_id = ci.card_id and p.image_url = ci.image_url
    where ci.canonical_id = cc.id

    union all

    select
      p.card_id,
      p.image_url,
      coalesce(p.source, 'tcg_printings') as image_source,
      p.source_url,
      p.language,
      p.region,
      2 + case p.region when 'TW' then 0 when 'JP' then 1 when 'US' then 2 when 'KR' then 3 else 4 end,
      p.updated_at
    from public.tcg_printings p
    join public.tcg_cards c on c.id = p.card_id
    where c.canonical_id = cc.id
      and p.image_url is not null
      and not p.image_rehost_required
  ) candidate
  order by candidate.source_priority, candidate.observed_at desc nulls last
  limit 1
) preferred_image on true;

revoke all on public.tcg_canonical_card_catalog from anon, authenticated;
grant select on public.tcg_canonical_card_catalog to service_role;

comment on column public.card_images.canonical_id is
  'Canonical identity shared by every language/region-specific image of the card.';
comment on view public.tcg_canonical_card_catalog is
  'Canonical card information joined to its game, physical cards, printings and preferred legal image.';
