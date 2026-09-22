-- Supabase Data API roles default to an 8 second statement timeout. This
-- optimized full-catalog report is cached for five minutes by the application,
-- but its cold path can still exceed that role default. Scope the documented
-- exemption to this function only; normal browsing queries keep their limits.
alter function public.catalog_health_snapshot_v2(jsonb)
  set statement_timeout = '15s';

comment on function public.catalog_health_snapshot_v2(jsonb) is
  'Policy-aware cached catalog health snapshot with function-scoped work_mem and a 15 second cold-path timeout.';
