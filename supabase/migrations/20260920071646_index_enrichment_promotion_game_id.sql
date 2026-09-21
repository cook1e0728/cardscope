-- Cover the audit table foreign key used by game-scoped batch lookups and
-- parent-row maintenance. The table remains private and service-role only.
create index if not exists catalog_enrichment_promotion_batches_game_id_idx
  on public.catalog_enrichment_promotion_batches(game_id);
