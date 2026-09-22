-- Keep the public health contract unchanged while avoiding the v2 union of
-- card_images and tcg_printings and the second full printing aggregation.
-- Source is already populated on all card_images and all but a handful of
-- legacy printings; the scalar fallback runs only for those null rows.
create or replace function public.catalog_health_snapshot_v2(p_display_policies jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with printing_base as materialized (
  select p.card_id,
         p.rarity,
         p.rarity_code,
         p.rarity_label,
         p.series_id,
         p.image_url,
         p.image_rehost_required,
         p.image_license_expires_at,
         p.image_rights_status,
         case
           when p.source is not null then p.source
           else (select c.source from tcg_cards c where c.id = p.card_id)
         end as source
  from tcg_printings p
), printing_rollup as (
  select card_id,
         count(*) as total,
         bool_or(nullif(btrim(coalesce(rarity, rarity_code, rarity_label)), '') is not null) as rarity,
         bool_or(series_id is not null) as series,
         bool_or(nullif(btrim(image_url), '') is not null) as has_url,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and not coalesce(image_rehost_required, false)
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and (
             coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
             or (
               coalesce(image_rights_status, 'not-provided') = 'not-provided'
               and p_display_policies ->> source = 'risk-accepted'
             )
           )
         ) as eligible,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and not coalesce(image_rehost_required, false)
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
         ) as explicit_rights,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce((p_display_policies ? source), false)
         ) as unmapped,
         count(*) filter (where nullif(btrim(image_url), '') is not null) as image_urls,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce(image_rehost_required, false)
             and (image_license_expires_at is null or image_license_expires_at > now())
             and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
             and (
               coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
               or (
                 coalesce(image_rights_status, 'not-provided') = 'not-provided'
                 and p_display_policies ->> source = 'risk-accepted'
               )
             )
         ) as image_eligible
  from printing_base
  group by card_id
), image_rollup as (
  select card_id,
         bool_or(nullif(btrim(image_url), '') is not null) as has_url,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and (
             coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
             or (
               coalesce(image_rights_status, 'not-provided') = 'not-provided'
               and p_display_policies ->> source = 'risk-accepted'
             )
           )
         ) as eligible,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
         ) as explicit_rights,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce((p_display_policies ? source), false)
         ) as unmapped
  from card_images
  group by card_id
), games as materialized (
  select g.id,
         count(c.id) as cards,
         count(c.id) filter (where nullif(btrim(c.name_zh), '') is not null) as chinese_names,
         count(c.id) filter (where nullif(btrim(c.rarity), '') is not null or coalesce(p.rarity, false)) as rarities,
         count(c.id) filter (where c.series_id is not null or coalesce(p.series, false)) as series,
         count(c.id) filter (where coalesce(p.total, 0) > 0) as with_printings,
         count(c.id) filter (where coalesce(i.has_url, false) or coalesce(p.has_url, false)) as urls,
         count(c.id) filter (where coalesce(i.eligible, false) or coalesce(p.eligible, false)) as eligible,
         count(c.id) filter (where coalesce(i.explicit_rights, false) or coalesce(p.explicit_rights, false)) as explicit_rights,
         count(c.id) filter (
           where (coalesce(i.eligible, false) or coalesce(p.eligible, false))
             and not (coalesce(i.explicit_rights, false) or coalesce(p.explicit_rights, false))
         ) as risk_only,
         coalesce(sum(p.total), 0) as printings,
         coalesce(sum(p.image_urls), 0) as printing_urls,
         coalesce(sum(p.image_eligible), 0) as printing_eligible,
         coalesce(sum(coalesce(i.unmapped, 0) + coalesce(p.unmapped, 0)), 0) as unmapped
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

comment on function public.catalog_health_snapshot_v2(jsonb) is
  'Policy-aware catalog health snapshot; aggregates each asset table once and preserves the v2 response contract.';
