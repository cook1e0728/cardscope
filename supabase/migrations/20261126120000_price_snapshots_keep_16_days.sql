-- 資料庫只剩約 0.06 GB（免費方案 0.5 GB，2026-11-26 已達 440 MB 快照煞車線）：price_snapshots 在資料庫只留 16 天（原 30 天），更舊的照 ADR 0046 封存到 Storage 再刪。
-- 16 天＝漲跌榜（price_movers、price_tcgapi_targets 看 14 天）加 2 天緩衝；價格歷史圖本來就合併讀封存，不受影響。
-- 函式內容與 20261020110000 相同，只改天數。每條線最新的一列仍永遠留在資料庫。
create or replace function public.price_snapshots_archivable_dates(p_limit integer default 400)
returns date[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(d order by d), '{}')
  from (
    select distinct s.snapshot_date as d
    from public.price_snapshots s
    where s.snapshot_date < current_date - 16
      and exists (
        select 1 from public.price_snapshots n
        where n.card_id = s.card_id and n.provider = s.provider and n.variant = s.variant and n.snapshot_date > s.snapshot_date
      )
    order by 1
    limit greatest(1, least(coalesce(p_limit, 400), 1000))
  ) x;
$$;

create or replace function public.price_snapshots_archivable(p_date date)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  if p_date is null or p_date >= current_date - 16 then
    raise exception 'ARCHIVE_DATE_TOO_RECENT: %', p_date;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('card_id', s.card_id, 'provider', s.provider, 'variant', s.variant, 'currency', s.currency, 'snapshot_date', s.snapshot_date, 'amount', s.amount) order by s.card_id, s.provider, s.variant)
    from public.price_snapshots s
    where s.snapshot_date = p_date
      and exists (
        select 1 from public.price_snapshots n
        where n.card_id = s.card_id and n.provider = s.provider and n.variant = s.variant and n.snapshot_date > s.snapshot_date
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.price_snapshots_archive_delete(p_date date, p_expected integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_deleted integer;
begin
  if p_date is null or p_date >= current_date - 16 then
    raise exception 'ARCHIVE_DATE_TOO_RECENT: %', p_date;
  end if;
  select count(*) into v_count
  from public.price_snapshots s
  where s.snapshot_date = p_date
    and exists (
      select 1 from public.price_snapshots n
      where n.card_id = s.card_id and n.provider = s.provider and n.variant = s.variant and n.snapshot_date > s.snapshot_date
    );
  if v_count is distinct from p_expected then
    raise exception 'ARCHIVE_COUNT_MISMATCH: archived %, now archivable %', p_expected, v_count;
  end if;
  delete from public.price_snapshots s
  where s.snapshot_date = p_date
    and exists (
      select 1 from public.price_snapshots n
      where n.card_id = s.card_id and n.provider = s.provider and n.variant = s.variant and n.snapshot_date > s.snapshot_date
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
