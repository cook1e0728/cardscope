-- Cover enrichment foreign keys used during review and cleanup.
create index if not exists catalog_enrichment_candidates_game_idx
  on public.catalog_enrichment_candidates(game_id);
create index if not exists catalog_enrichment_candidates_printing_idx
  on public.catalog_enrichment_candidates(target_printing_id);
