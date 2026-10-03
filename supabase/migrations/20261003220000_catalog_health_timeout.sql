-- CardScope: the v2 health snapshot scans every printing, card and image; with the catalog grown to
-- 65k cards it takes about 14 s on the current instance, at its 15 s limit. Raise the limit; the
-- server serves the previous snapshot while one background load computes the next.
alter function public.catalog_health_snapshot_v2(jsonb) set statement_timeout = '45s';
