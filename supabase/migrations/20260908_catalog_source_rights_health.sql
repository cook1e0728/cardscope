-- Separate image availability from permission to display, and expose an
-- aggregate health snapshot without disclosing card-level/admin data.

alter table public.card_images
  add column if not exists image_rights_status text not null default 'not-provided',
  add column if not exists image_license_expires_at timestamptz,
  add column if not exists rights_note text;

alter table public.tcg_printings
  add column if not exists image_rights_status text not null default 'not-provided',
  add column if not exists image_license_expires_at timestamptz,
  add column if not exists rights_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='card_images_image_rights_status_check') then
    alter table public.card_images add constraint card_images_image_rights_status_check
      check (image_rights_status in ('licensed','partner-provided','user-provided','not-provided','not-displayable'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tcg_printings_image_rights_status_check') then
    alter table public.tcg_printings add constraint tcg_printings_image_rights_status_check
      check (image_rights_status in ('licensed','partner-provided','user-provided','not-provided','not-displayable'));
  end if;
end $$;

create index if not exists card_images_displayable_rights_idx
  on public.card_images(card_id, image_rights_status)
  where image_url is not null and image_rights_status in ('licensed','partner-provided','user-provided');

create index if not exists tcg_printings_displayable_rights_idx
  on public.tcg_printings(card_id, image_rights_status)
  where image_url is not null and image_rights_status in ('licensed','partner-provided','user-provided');

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

create index if not exists catalog_source_policies_game_id_idx on public.catalog_source_policies(game_id);
alter table public.catalog_source_policies enable row level security;
revoke all on table public.catalog_source_policies from anon, authenticated;
grant select, insert, update, delete on table public.catalog_source_policies to service_role;

create or replace function public.catalog_health_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with games as (
    select
      g.id,
      count(distinct c.id) as cards,
      count(distinct c.id) filter (where nullif(btrim(c.name_zh),'') is not null) as chinese_names,
      count(distinct c.id) filter (where nullif(btrim(coalesce(c.rarity,p.rarity,p.rarity_code,p.rarity_label)),'') is not null) as rarities,
      count(distinct c.id) filter (where c.series_id is not null or p.series_id is not null) as cards_with_series,
      count(distinct c.id) filter (
        where (ci.image_url is not null and ci.image_rights_status in ('licensed','partner-provided','user-provided') and (ci.image_license_expires_at is null or ci.image_license_expires_at > now()))
           or (p.image_url is not null and p.image_rehost_required is not true and p.image_rights_status in ('licensed','partner-provided','user-provided') and (p.image_license_expires_at is null or p.image_license_expires_at > now()))
      ) as displayable_images,
      count(distinct c.id) filter (where ci.image_url is not null or p.image_url is not null) as cards_with_image_urls
    from public.tcg_games g
    left join public.tcg_cards c on c.game_id=g.id
    left join public.tcg_printings p on p.card_id=c.id
    left join public.card_images ci on ci.card_id=c.id
    group by g.id
  ), orphans as (
    select jsonb_build_object(
      'cardsWithoutCanonical',(select count(*) from public.tcg_cards where canonical_id is null),
      'printingsWithoutCard',(select count(*) from public.tcg_printings p where not exists (select 1 from public.tcg_cards c where c.id=p.card_id)),
      'imagesWithoutCard',(select count(*) from public.card_images i where i.card_id is null or not exists (select 1 from public.tcg_cards c where c.id=i.card_id)),
      'imagesWithoutCanonical',(select count(*) from public.card_images where canonical_id is null)
    ) value
  )
  select jsonb_build_object(
    'totalCards',coalesce((select sum(cards) from games),0),
    'games',coalesce((select jsonb_object_agg(id,jsonb_build_object(
      'cards',cards,'chineseNames',chinese_names,'rarities',rarities,
      'cardsWithSeries',cards_with_series,'cardsWithImageUrls',cards_with_image_urls,
      'displayableImages',displayable_images,'expectedCards',null,'completeness','未核定'
    )) from games),'{}'::jsonb),
    'orphans',(select value from orphans),
    'source','supabase-health-snapshot',
    'updatedAt',now()
  );
$function$;

revoke all on function public.catalog_health_snapshot() from public, anon, authenticated;
grant execute on function public.catalog_health_snapshot() to service_role;

comment on function public.catalog_health_snapshot() is
  'Service-role aggregate health report. Image URL availability and explicit display rights are deliberately separate.';
