create or replace function public.catalog_health_snapshot_v2(p_display_policies jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with assets as (
  select i.card_id,
         null::bigint as printing_id,
         i.image_url,
         coalesce(i.source, c.source) as source,
         coalesce(i.image_rights_status, 'not-provided') as rights,
         i.image_license_expires_at as expires,
         false as rehost
  from card_images i
  join tcg_cards c on c.id = i.card_id
  union all
  select p.card_id,
         p.id,
         p.image_url,
         coalesce(p.source, c.source),
         coalesce(p.image_rights_status, 'not-provided'),
         p.image_license_expires_at,
         coalesce(p.image_rehost_required, false)
  from tcg_printings p
  join tcg_cards c on c.id = p.card_id
), evaluated as (
  select *,
         nullif(btrim(image_url), '') is not null as has_url,
         nullif(btrim(image_url), '') is not null
           and not rehost
           and (expires is null or expires > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and (
             rights in ('licensed', 'partner-provided', 'user-provided')
             or (rights = 'not-provided' and p_display_policies ->> source = 'risk-accepted')
           ) as eligible
  from assets
), image_rollup as (
  select card_id,
         bool_or(has_url) as has_url,
         bool_or(coalesce(eligible, false)) as eligible,
         bool_or(coalesce(eligible, false) and rights in ('licensed', 'partner-provided', 'user-provided')) as explicit_rights,
         count(*) filter (where has_url and not coalesce((p_display_policies ? source), false)) as unmapped,
         count(*) filter (where printing_id is not null and has_url) as printing_urls,
         count(*) filter (where printing_id is not null and eligible) as printing_eligible
  from evaluated
  group by card_id
), printing_rollup as (
  select card_id,
         count(*) as total,
         bool_or(nullif(btrim(coalesce(rarity, rarity_code, rarity_label)), '') is not null) as rarity,
         bool_or(series_id is not null) as series
  from tcg_printings
  group by card_id
), games as (
  select g.id,
         count(c.id) as cards,
         count(c.id) filter (where nullif(btrim(c.name_zh), '') is not null) as chinese_names,
         count(c.id) filter (where nullif(btrim(c.rarity), '') is not null or p.rarity) as rarities,
         count(c.id) filter (where c.series_id is not null or p.series) as series,
         count(c.id) filter (where p.total > 0) as with_printings,
         count(c.id) filter (where i.has_url) as urls,
         count(c.id) filter (where i.eligible) as eligible,
         count(c.id) filter (where i.explicit_rights) as explicit_rights,
         count(c.id) filter (where i.eligible and not i.explicit_rights) as risk_only,
         coalesce(sum(p.total), 0) as printings,
         coalesce(sum(i.printing_urls), 0) as printing_urls,
         coalesce(sum(i.printing_eligible), 0) as printing_eligible,
         coalesce(sum(i.unmapped), 0) as unmapped
  from tcg_games g
  left join tcg_cards c on c.game_id = g.id
  left join image_rollup i on i.card_id = c.id
  left join printing_rollup p on p.card_id = c.id
  group by g.id
)
select jsonb_build_object(
  'source', 'supabase-health-snapshot-v2',
  'updatedAt', now(),
  'snapshotAt', now(),
  'totalCards', coalesce((select sum(cards) from games), 0),
  'totalPrintings', coalesce((select sum(printings) from games), 0),
  'metricStatus', jsonb_build_object('images', 'per-source-policy', 'cards', 'observed-physical-cards'),
  'imageLoadSample', jsonb_build_object('status', 'not-sampled', 'sampleSize', 0, 'successRate', null, 'sampledAt', null),
  'games', (
    select jsonb_object_agg(id, jsonb_build_object(
      'cards', cards,
      'chineseNames', chinese_names,
      'rarities', rarities,
      'cardsWithSeries', series,
      'cardsWithPrintings', with_printings,
      'cardsWithImageUrls', urls,
      'displayableImages', eligible,
      'cardsWithDisplayableImages', eligible,
      'cardsWithExplicitRightsImages', explicit_rights,
      'cardsDisplayableOnlyByRiskAcceptance', risk_only,
      'totalPrintings', printings,
      'printingsWithImageUrls', printing_urls,
      'printingsWithDisplayableImages', printing_eligible,
      'unmappedImageUrlRecords', unmapped,
      'expectedCards', null,
      'completeness', '未核定'
    ))
    from games
  ),
  'orphans', jsonb_build_object(
    'cardsWithoutCanonical', (select count(*) from tcg_cards where canonical_id is null),
    'printingsWithoutCard', (select count(*) from tcg_printings p where not exists (select 1 from tcg_cards c where c.id = p.card_id)),
    'imagesWithoutCard', (select count(*) from card_images i where not exists (select 1 from tcg_cards c where c.id = i.card_id)),
    'imagesWithoutCanonical', (select count(*) from card_images where canonical_id is null)
  )
);
$$;

revoke all on function public.catalog_health_snapshot_v2(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_health_snapshot_v2(jsonb) to service_role;
