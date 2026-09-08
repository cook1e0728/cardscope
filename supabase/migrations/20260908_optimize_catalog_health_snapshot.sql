create or replace function public.catalog_health_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with rarity_printing as (
    select distinct card_id from public.tcg_printings
    where nullif(btrim(coalesce(rarity,rarity_code,rarity_label)),'') is not null
  ), series_printing as (
    select distinct card_id from public.tcg_printings where series_id is not null
  ), image_url_cards as (
    select card_id from public.card_images where card_id is not null and image_url is not null
    union
    select card_id from public.tcg_printings where image_url is not null
  ), displayable_image_cards as (
    select card_id from public.card_images
    where card_id is not null and image_url is not null
      and image_rights_status in ('licensed','partner-provided','user-provided')
      and (image_license_expires_at is null or image_license_expires_at > now())
    union
    select card_id from public.tcg_printings
    where image_url is not null and image_rehost_required is not true
      and image_rights_status in ('licensed','partner-provided','user-provided')
      and (image_license_expires_at is null or image_license_expires_at > now())
  ), games as (
    select
      g.id,
      count(c.id) as cards,
      count(c.id) filter (where nullif(btrim(c.name_zh),'') is not null) as chinese_names,
      count(c.id) filter (where nullif(btrim(c.rarity),'') is not null or rp.card_id is not null) as rarities,
      count(c.id) filter (where c.series_id is not null or sp.card_id is not null) as cards_with_series,
      count(c.id) filter (where iu.card_id is not null) as cards_with_image_urls,
      count(c.id) filter (where di.card_id is not null) as displayable_images
    from public.tcg_games g
    left join public.tcg_cards c on c.game_id=g.id
    left join rarity_printing rp on rp.card_id=c.id
    left join series_printing sp on sp.card_id=c.id
    left join image_url_cards iu on iu.card_id=c.id
    left join displayable_image_cards di on di.card_id=c.id
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
