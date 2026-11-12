-- F4 daily page-open counts and C3 database size report (SITE_IMPROVEMENT_PLAN decision 4 and package C3, 2026-11-12). Idempotent.
-- Free plan: 500 MB total, about 80 MB headroom, so the size of the new table is stated here.
-- page_stats_daily growth: one row per Taipei day, about 150 bytes (date 4 + jsonb of at most 7 small integers about 100 + timestamptz 8 + tuple header 24).
-- 365 rows a year is about 55 KB of heap plus about 16 KB of primary-key index, so under 0.1 MB a year.
-- The row is updated about every 10 minutes (one flush), so the heap holds a few dead versions until autovacuum runs; that stays inside one or two 8 KB pages.
-- Only totals are stored: no IP address, user agent, query string or referrer.

create table if not exists public.page_stats_daily (
  day date primary key,
  counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.page_stats_daily enable row level security;

revoke all on public.page_stats_daily from anon, authenticated;
grant select on public.page_stats_daily to service_role;

comment on table public.page_stats_daily is 'F4: page opens per Asia/Taipei day by kind (home, game, series, card, search, other, bot). Totals only, no personal data. Written by page_stats_add() from the server with the service role.';

-- Adds p_counts into the row of p_day in one statement (INSERT ... ON CONFLICT takes the row lock), so two flushes cannot lose an increment.
-- Unknown keys are dropped; a non-numeric value raises, and the server keeps its deltas and retries.
create or replace function public.page_stats_add(p_day date, p_counts jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_counts jsonb;
begin
  if p_day is null or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'page_stats_add needs a date and a json object';
  end if;
  select coalesce(jsonb_object_agg(e.key, greatest((e.value #>> '{}')::bigint, 0)), '{}'::jsonb) into v_counts
    from jsonb_each(p_counts) e
   where e.key in ('home', 'game', 'series', 'card', 'search', 'other', 'bot');
  insert into public.page_stats_daily as t (day, counts, updated_at)
  values (p_day, v_counts, now())
  on conflict (day) do update
    set counts = (select coalesce(jsonb_object_agg(k, coalesce((t.counts ->> k)::bigint, 0) + coalesce((v_counts ->> k)::bigint, 0)), '{}'::jsonb)
                    from (select jsonb_object_keys(t.counts) as k union select jsonb_object_keys(v_counts)) ks),
        updated_at = now();
end;
$function$
;

-- C3: total database bytes plus the 15 largest tables, for /api/admin/catalog/health and the public near-limit flag.
create or replace function public.db_size_report()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'bytes', x.bytes, 'liveTuples', x.n_live_tup, 'lastVacuum', x.last_vacuum, 'lastAutovacuum', x.last_autovacuum) order by x.bytes desc)
      from (select s.schemaname || '.' || s.relname as name, pg_total_relation_size(s.relid) as bytes, s.n_live_tup, s.last_vacuum, s.last_autovacuum
              from pg_stat_user_tables s order by pg_total_relation_size(s.relid) desc limit 15) x
    ), '[]'::jsonb),
    'generatedAt', now());
$function$
;

revoke all on function public.page_stats_add(date, jsonb) from public, anon, authenticated;
revoke all on function public.db_size_report() from public, anon, authenticated;
grant execute on function public.page_stats_add(date, jsonb) to service_role;
grant execute on function public.db_size_report() to service_role;
