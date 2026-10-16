select
  (select count(*) from public.tcg_cards) cards,
  (select count(*) from public.tcg_printings) printings,
  (select count(*) from public.card_images) images,
  (select count(*) from private.catalog_tw_variant_split_audit) audit,
  (select count(*) from public.tcg_cards where metadata->>'variantRule' = 'adr-0043') cards_with_rule,
  (select md5(pg_get_functiondef('private.split_pokemon_tw_official_variants(jsonb,text,boolean)'::regprocedure))) fn_md5,
  (select count(*) from public.tcg_cards where id ~ '^pokemon-tcgdex-tw-sv(2a|8a)-[0-9]+-v[0-9]+$') new_ids_present,
  (select string_agg(version, ',' order by version desc) from (select version from supabase_migrations.schema_migrations order by version desc limit 3) m) latest_migrations
