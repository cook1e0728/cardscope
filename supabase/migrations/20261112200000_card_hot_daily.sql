-- Per-card daily open counts for the "hottest cards" list (user approved 2026-11-12, extends page_stats_daily). Idempotent.
-- Free plan: 500 MB total, brake line 440 MB, so the size is stated here.
-- card_hot_daily growth: one row per Taipei day. Each row keeps only that day's top 50 cards as {"card-id": opens}.
-- A card id is at most 120 characters, about 40 on average; one jsonb entry is about 60 bytes, so a row is about 3 KB at most (2 KB typical),
-- and TOAST compression makes it smaller. Rows older than 35 days are deleted on every write, so the table holds at most 36 rows, about 70-110 KB in all.
-- The row is updated about every 10 minutes (one flush), so the heap holds a few dead versions until autovacuum runs; that stays inside a couple of 8 KB pages.
-- Only a card id and a count are stored: no IP address, user agent, session or any trace of who opened the card.

create table if not exists public.card_hot_daily (
  day date primary key,
  counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.card_hot_daily enable row level security;

revoke all on public.card_hot_daily from anon, authenticated;
grant select on public.card_hot_daily to service_role;

comment on table public.card_hot_daily is 'Opens per card per Asia/Taipei day, top 50 cards only. Counts only, no personal data. Written by card_hot_add() from the server with the service role.';

-- Adds p_counts into the row of p_day, then keeps only that day's 50 most opened cards and drops rows older than 35 days.
-- The empty-row insert plus UPDATE takes the row lock, so two flushes cannot lose an increment. A non-numeric value raises, and the server keeps its deltas and retries.
create or replace function public.card_hot_add(p_day date, p_counts jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if p_day is null or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'card_hot_add needs a date and a json object';
  end if;
  if exists (select 1 from jsonb_each(p_counts) e where jsonb_typeof(e.value) is distinct from 'number') then
    raise exception 'card_hot_add counts must be numbers';
  end if;
  insert into public.card_hot_daily (day) values (p_day) on conflict (day) do nothing;
  update public.card_hot_daily t
     set counts = coalesce((
           select jsonb_object_agg(x.k, x.n)
             from (select u.k, sum(u.n)::bigint as n
                     from (select e.key as k, greatest((e.value #>> '{}')::numeric, 0)::bigint as n from jsonb_each(t.counts) e
                           union all
                           select e.key, greatest((e.value #>> '{}')::numeric, 0)::bigint from jsonb_each(p_counts) e where length(e.key) <= 120) u
                    group by u.k
                    order by sum(u.n) desc, u.k
                    limit 50) x), '{}'::jsonb),
         updated_at = now()
   where t.day = p_day;
  delete from public.card_hot_daily where day < (now() at time zone 'Asia/Taipei')::date - 35;
end;
$function$
;

-- The most opened cards of the last p_days Taipei days with at least p_min opens in total, for /api/hot-cards.
-- Names, series and image follow price_movers (20261108090000): zh/ja/en names, the first printing's local number, the first printing image, else the primary displayable card_images row.
-- The open counts are deliberately not returned, only the ranking.
create or replace function public.card_hot_top(p_days integer default 7, p_limit integer default 12, p_min integer default 3)
 returns table (card_id text, name_zh text, name_ja text, name_en text, card_number text, series_code text, series_name text, game text, image_url text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with totals as (
    select e.key as card_id, sum((e.value #>> '{}')::bigint) as opens
      from public.card_hot_daily d
     cross join lateral jsonb_each(d.counts) e
     where d.day > (now() at time zone 'Asia/Taipei')::date - greatest(p_days, 1)
     group by e.key
    having sum((e.value #>> '{}')::bigint) >= greatest(p_min, 1)
     order by sum((e.value #>> '{}')::bigint) desc, e.key
     limit least(greatest(p_limit, 1), 50)
  )
  select k.card_id, c.name_zh, c.name_ja, c.name_en, coalesce(p.local_card_number, c.official_card_number), s.official_code, coalesce(s.name_zh, s.name_ja, s.name_en), c.game_id,
         coalesce((select pr.image_url from public.tcg_printings pr where pr.card_id = k.card_id and pr.image_url is not null order by pr.id limit 1),
                  (select i.image_url from public.card_images i where i.card_id = k.card_id and i.image_url is not null and i.image_rights_status <> 'not-displayable' order by i.is_primary desc, i.id limit 1))
  from totals k
  join public.tcg_cards c on c.id = k.card_id
  left join public.tcg_series s on s.id = c.series_id
  left join lateral (select pr.local_card_number from public.tcg_printings pr where pr.card_id = k.card_id order by pr.id limit 1) p on true
  order by k.opens desc, k.card_id;
$function$
;

revoke all on function public.card_hot_add(date, jsonb) from public, anon, authenticated;
revoke all on function public.card_hot_top(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.card_hot_add(date, jsonb) to service_role;
grant execute on function public.card_hot_top(integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
