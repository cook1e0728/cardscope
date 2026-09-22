-- Scope the larger hash-aggregation budget to this one reporting function.
-- Do not raise the Data API role or database-wide statement timeout.
alter function public.catalog_health_snapshot_v2(jsonb)
  set work_mem = '64MB';

comment on function public.catalog_health_snapshot_v2(jsonb) is
  'Policy-aware catalog health snapshot; aggregates each asset table once with a function-scoped 64MB work_mem budget.';
