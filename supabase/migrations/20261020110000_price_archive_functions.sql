-- ADR 0046：price_snapshots 只留最近 30 天，更舊的列先封存到私有 Storage bucket `price-archive`，驗證後才從資料庫刪除。
-- 這四個函式只給伺服器（service role）用；封存與刪除的「可封存」定義放在 SQL，讓抓取與刪除一定指向同一批列。
--
-- 「可封存」= 日期等於 p_date、p_date 早於 current_date - 30，且同一張卡＋來源＋variant 在資料庫裡還有更新的一列。
-- 每條線最新的一列永遠留在資料庫（POST /api/prices/reference 只讀最新一列；價格掉到門檻以下或來源消失的卡才不會失去參考價）。
-- 刪除函式要求呼叫端帶上它剛封存的列數，與當下可封存的列數不同就整個丟例外、什麼都不刪。
-- 可封存的集合在同一天內只會變大（新的一列進來才會讓舊的一列變成可封存），所以「列數相同」等於「就是剛封存並驗證過的那一批」。

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
    where s.snapshot_date < current_date - 30
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
  if p_date is null or p_date >= current_date - 30 then
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
  if p_date is null or p_date >= current_date - 30 then
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

-- 價格快照的自動煞車（440 MB）用：回傳整個資料庫目前的位元組數。
create or replace function public.cardscope_db_size_bytes()
returns bigint
language sql
stable
as $$ select pg_database_size(current_database()); $$;

revoke all on function public.price_snapshots_archivable_dates(integer) from public, anon, authenticated;
revoke all on function public.price_snapshots_archivable(date) from public, anon, authenticated;
revoke all on function public.price_snapshots_archive_delete(date, integer) from public, anon, authenticated;
revoke all on function public.cardscope_db_size_bytes() from public, anon, authenticated;
grant execute on function public.price_snapshots_archivable_dates(integer) to service_role;
grant execute on function public.price_snapshots_archivable(date) to service_role;
grant execute on function public.price_snapshots_archive_delete(date, integer) to service_role;
grant execute on function public.cardscope_db_size_bytes() to service_role;
