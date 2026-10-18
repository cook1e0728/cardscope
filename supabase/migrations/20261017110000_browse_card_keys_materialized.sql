-- 圖鑑分頁 RPC 的排序鍵物化（2026-10-17，依序執行 107）。
-- 依序執行 102 的 browse_cards_filtered / browse_cards_facets / browse_rarity_values 每次都掃整個遊戲（寶可夢 5.6 萬張卡、10 萬筆 printing），
-- 暖快取 1–3 s、資料庫冷快取 9–15 s。這裡把「每張卡的排序位置、地區集合、稀有度原始字串」算好存成一張窄表，
-- 查詢只掃這張窄表（寶可夢約 10 MB）再取該頁的卡片，不再碰 printing 與卡片寬欄。
--
-- 設計：
--   browse_card_keys_mat   每遊戲、每世代（gen）、每張卡一列：
--       o_num_a/_d、o_name_a/_d、o_rel_a/_d  該排序下在整個遊戲內的位置（row_number，已含完整 tie-break 鏈：與 102 的 ORDER BY 逐項相同，
--                                              編號 ICU 數字排序、名稱 base 強度、id ICU 預設、日期 ISO 位元組序，最後再加 id "C" 排序保證唯一）；
--       regions/langs           該卡所有 printing 的地區／語言集合（地區篩選、facet）；
--       first_raw               卡片稀有度，沒有時取第一個有稀有度的 printing（與 102 的 first_code 同序）的原始字串；
--       raws                    卡片與所有 printing 的稀有度原始字串集合（篩選 token、unmapped）。
--     稀有度代碼、排名、token 仍由伺服器的 p_rmap 在查詢時對應（data/rarity-rankings.json 改動不必重建這張表）。
--   browse_key_raws        每遊戲×地區（'' 代表不限）的稀有度原始字串集合：browse_rarity_values 與 unmapped 偵測直接讀它。
--   browse_key_facets      每遊戲×地區的地區／語言 facet（與稀有度對照無關，重建時算好）。
--   browse_key_state       某遊戲目前對外的世代；存在才可能走快路徑。
--   browse_key_pending     已 build、尚未 publish 的世代（與 build 當時看見的異動 id）。
--   browse_key_changes     tcg_cards / tcg_printings 的任何影響排序鍵的異動（INSERT/DELETE/關鍵欄位 UPDATE/TRUNCATE）由 statement trigger 記一列。
--
-- 正確性護欄：公開的三個 RPC（簽章不變）先問 browse_keys_fresh(game)：有對外世代、且沒有任何未處理的異動，才走快路徑；
--   否則改走 *_live（就是 102 的原函式，只改名），結果一定正確，只是慢。因此「匯入後尚未重建」「新卡沒有鍵列」都不會產生錯誤結果，
--   只會暫時退回舊速度。重建分兩段：browse_refresh_keys_build(game) 先記下已看見的異動、再算出新世代的鍵列（讀取端看不到）；
--   browse_refresh_keys_publish(game) 在同一交易內換掉 raws／facet、切換世代、只清除 build 開始前已看見的異動，所以重建過程中
--   提交的新異動不會被誤清（遊戲會繼續標記為過期）。
--   * 不納入異動偵測：printing 的 image_url / image_rehost_required（圖片改存只影響「無編號、無稀有度卡在多版本間誰排第一」的極端情形，
--     下次重建即更正；伺服器的圖片快取會一直改這兩欄，納入會讓鍵表永遠過期）。
--   * session_replication_role = replica 或停用 trigger 的操作不會被記錄；做完請手動呼叫 browse_refresh_keys()。
--   * 經 PostgREST 的 service_role 單一請求只有 20 s（函式內的 SET statement_timeout 不會延長已開始的陳述）；build 冷快取時可能超過，
--     已讀進快取的頁面在重試時就快了，所以伺服器端的呼叫會重試；Management API（run-sql）沒有這個限制。
--
-- 呼叫時機：providers/catalog-sync.mjs 的 syncCatalog 結束後；伺服器排程另用 browse_keys_stale() 補做遺漏；
--   手動資料批次（SQL migration、scripts/ 的匯入／補值）結束後請呼叫
--   select public.browse_refresh_keys('pokemon');  -- 或不帶參數重建全部
--
-- 簽章不變；只新增資料表、函式、trigger，並把 102 的三個函式改名為 *_live。

-- ---------------------------------------------------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------------------------------------------------
create sequence if not exists public.browse_key_gen_seq;

create table if not exists public.browse_card_keys_mat (
  game_id text not null,
  gen bigint not null,
  id text not null,
  gid text,
  not_printed boolean not null default false,
  o_num_a integer not null,
  o_num_d integer not null,
  o_name_a integer not null,
  o_name_d integer not null,
  o_rel_a integer not null,
  o_rel_d integer not null,
  regions text[] not null default '{}',
  langs text[] not null default '{}',
  first_raw text,
  raws text[] not null default '{}',
  primary key (game_id, gen, id)
) with (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);

create table if not exists public.browse_key_raws (
  game_id text not null,
  region text not null,
  raw text not null,
  primary key (game_id, region, raw)
);

-- 地區／語言 facet（與稀有度對照表無關，重建時算好）：region = ''（不限）或某個地區；kind = 'region' | 'language'；v = 值或 'unknown'；n = 不同標準身分數。
create table if not exists public.browse_key_facets (
  game_id text not null,
  region text not null,
  kind text not null,
  v text not null,
  n integer not null,
  primary key (game_id, region, kind, v)
);

create table if not exists public.browse_key_state (
  game_id text primary key,
  gen bigint not null,
  refreshed_at timestamptz not null default now(),
  card_count integer not null,
  refresh_ms integer
);

create table if not exists public.browse_key_pending (
  game_id text primary key,
  gen bigint not null,
  seen bigint[] not null,
  card_count integer not null,
  build_ms integer,
  built_at timestamptz not null default now()
);

create table if not exists public.browse_key_changes (
  id bigint generated always as identity primary key,
  game_id text not null,
  noted_at timestamptz not null default now()
);
create index if not exists browse_key_changes_game_idx on public.browse_key_changes (game_id);

alter table public.browse_card_keys_mat enable row level security;
alter table public.browse_key_raws enable row level security;
alter table public.browse_key_facets enable row level security;
alter table public.browse_key_state enable row level security;
alter table public.browse_key_changes enable row level security;
alter table public.browse_key_pending enable row level security;
revoke all on public.browse_card_keys_mat, public.browse_key_raws, public.browse_key_facets, public.browse_key_state, public.browse_key_changes, public.browse_key_pending from public, anon, authenticated;
grant select on public.browse_card_keys_mat, public.browse_key_raws, public.browse_key_facets, public.browse_key_state, public.browse_key_changes, public.browse_key_pending to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 異動記錄（statement trigger；函式以擁有者權限執行，寫入者不需要資料表權限）
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.browse_note_card_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.browse_key_changes (game_id) select distinct n.game_id from new_rows n where n.game_id is not null;
  elsif tg_op = 'DELETE' then
    insert into public.browse_key_changes (game_id) select distinct o.game_id from old_rows o where o.game_id is not null;
  elsif tg_op = 'UPDATE' then
    insert into public.browse_key_changes (game_id)
    select distinct g from (
      select o.game_id as g from old_rows o full join new_rows n on n.id = o.id
      where o.id is null or n.id is null
         or (o.game_id, o.canonical_id, o.official_card_number, o.name_zh, o.name_en, o.name_ja, o.rarity, o.metadata->>'numberStatus')
            is distinct from (n.game_id, n.canonical_id, n.official_card_number, n.name_zh, n.name_en, n.name_ja, n.rarity, n.metadata->>'numberStatus')
      union
      select n.game_id from old_rows o full join new_rows n on n.id = o.id
      where o.id is null or n.id is null
         or (o.game_id, o.canonical_id, o.official_card_number, o.name_zh, o.name_en, o.name_ja, o.rarity, o.metadata->>'numberStatus')
            is distinct from (n.game_id, n.canonical_id, n.official_card_number, n.name_zh, n.name_en, n.name_ja, n.rarity, n.metadata->>'numberStatus')
    ) t where g is not null;
  else
    insert into public.browse_key_changes (game_id) select s.game_id from public.browse_key_state s;
  end if;
  return null;
end;
$function$
;

create or replace function public.browse_note_printing_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.browse_key_changes (game_id)
    select distinct c.game_id from new_rows n join public.tcg_cards c on c.id = n.card_id where c.game_id is not null;
  elsif tg_op = 'DELETE' then
    insert into public.browse_key_changes (game_id)
    select distinct c.game_id from old_rows o join public.tcg_cards c on c.id = o.card_id where c.game_id is not null;
  elsif tg_op = 'UPDATE' then
    insert into public.browse_key_changes (game_id)
    select distinct c.game_id from (
      select coalesce(o.card_id, n.card_id) as card_id, o.card_id as oc, n.card_id as nc
      from old_rows o full join new_rows n on n.id = o.id
      where o.id is null or n.id is null
         or (o.card_id, o.region, o.language, o.local_card_number, o.release_date, o.rarity, o.rarity_code, o.rarity_label)
            is distinct from (n.card_id, n.region, n.language, n.local_card_number, n.release_date, n.rarity, n.rarity_code, n.rarity_label)
    ) x
    join public.tcg_cards c on c.id in (x.oc, x.nc)
    where c.game_id is not null;
  else
    insert into public.browse_key_changes (game_id) select s.game_id from public.browse_key_state s;
  end if;
  return null;
end;
$function$
;

drop trigger if exists browse_note_cards_insert on public.tcg_cards;
drop trigger if exists browse_note_cards_update on public.tcg_cards;
drop trigger if exists browse_note_cards_delete on public.tcg_cards;
drop trigger if exists browse_note_cards_truncate on public.tcg_cards;
create trigger browse_note_cards_insert after insert on public.tcg_cards referencing new table as new_rows for each statement execute function public.browse_note_card_change();
create trigger browse_note_cards_update after update on public.tcg_cards referencing old table as old_rows new table as new_rows for each statement execute function public.browse_note_card_change();
create trigger browse_note_cards_delete after delete on public.tcg_cards referencing old table as old_rows for each statement execute function public.browse_note_card_change();
create trigger browse_note_cards_truncate after truncate on public.tcg_cards for each statement execute function public.browse_note_card_change();

drop trigger if exists browse_note_printings_insert on public.tcg_printings;
drop trigger if exists browse_note_printings_update on public.tcg_printings;
drop trigger if exists browse_note_printings_delete on public.tcg_printings;
drop trigger if exists browse_note_printings_truncate on public.tcg_printings;
create trigger browse_note_printings_insert after insert on public.tcg_printings referencing new table as new_rows for each statement execute function public.browse_note_printing_change();
create trigger browse_note_printings_update after update on public.tcg_printings referencing old table as old_rows new table as new_rows for each statement execute function public.browse_note_printing_change();
create trigger browse_note_printings_delete after delete on public.tcg_printings referencing old table as old_rows for each statement execute function public.browse_note_printing_change();
create trigger browse_note_printings_truncate after truncate on public.tcg_printings for each statement execute function public.browse_note_printing_change();

-- ---------------------------------------------------------------------------------------------------------------
-- 重建：build（算好並寫入新世代的鍵列，讀取端看不到）→ publish（換掉 raws／facet、切換世代、清除已處理的異動）。
-- 兩段各自一個交易：經 PostgREST 的 service_role 單一請求只有 20 s，build 在小型實例上約 8–15 s，publish 約 2 s。
-- browse_refresh_keys() 兩段一起跑（Management API／手動用）。
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.browse_refresh_keys_build(p_game text)
 returns jsonb
 language plpgsql
 volatile
 security definer
 set search_path to ''
 set statement_timeout to '90s'
 set work_mem to '48MB'
as $function$
declare
  v_seen bigint[];
  v_gen bigint;
  v_t0 timestamptz := clock_timestamp();
  v_rows integer;
  v_ms integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('browse_keys:' || p_game, 0));
  if not exists (select 1 from public.tcg_cards c where c.game_id = p_game) then raise exception 'BROWSE_KEYS_UNKNOWN_GAME %', p_game; end if;
  -- 先記下已看見的異動，再讀資料：之後才提交的異動不在此集合內，會讓遊戲繼續標記為過期。
  v_seen := array(select ch.id from public.browse_key_changes ch where ch.game_id = p_game);
  v_gen := nextval('public.browse_key_gen_seq');
  -- 清掉先前中斷的 build（不是目前世代的列）。
  delete from public.browse_card_keys_mat m
  where m.game_id = p_game and m.gen is distinct from (select s.gen from public.browse_key_state s where s.game_id = p_game);

  insert into public.browse_card_keys_mat (game_id, gen, id, gid, not_printed, o_num_a, o_num_d, o_name_a, o_name_d, o_rel_a, o_rel_d, regions, langs, first_raw, raws)
    with cards as materialized (
      select k.id, coalesce(nullif(k.canonical_id, ''), k.id) as gid, k.official_card_number as onum, k.rarity,
        coalesce(nullif(k.name_zh, ''), nullif(k.name_en, ''), nullif(k.name_ja, ''), k.id) as name_key,
        coalesce((k.metadata->>'numberStatus') = 'not-printed', false) as np
      from public.tcg_cards k
      where k.game_id = p_game
    ),
    pq as materialized (
      select p.card_id, p.id as pid, p.local_card_number, p.release_date, p.region, p.language, p.rarity, p.rarity_code, p.rarity_label,
        case p.region when 'JP' then 0 when 'TW' then 1 when 'US' then 2 when 'KR' then 3 when 'ASIA' then 4 else 9 end as rp,
        (coalesce(p.image_url, '') <> '' and not coalesce(p.image_rehost_required, false)) as has_img,
        coalesce(to_char(p.release_date, 'YYYY-MM-DD'), '') as rel
      from public.tcg_printings p
      join cards c on c.id = p.card_id
    ),
    -- Printing order of 102 (comparePrintings): region JP, TW, US, KR, ASIA, then with image, then newest release, then id.
    ordered as materialized (
      select q.*, row_number() over (partition by q.card_id order by q.rp, q.has_img desc, q.rel collate "C" desc, q.pid) as rn from pq q
    ),
    a1 as (
      select q.card_id, max(q.release_date) as prel,
        array_agg(distinct q.region) filter (where q.region is not null) as regions,
        array_agg(distinct q.language) filter (where coalesce(q.language, '') <> '') as langs
      from pq q group by q.card_id
    ),
    a2 as (
      select distinct on (o.card_id) o.card_id, o.local_card_number as pnum
      from ordered o where coalesce(o.local_card_number, '') <> '' order by o.card_id, o.rn
    ),
    a3 as (
      select distinct on (o.card_id) o.card_id, v.x as pfirst
      from ordered o cross join lateral (values (1, o.rarity), (2, o.rarity_code), (3, o.rarity_label)) as v(i, x)
      where v.x is not null and btrim(v.x) <> '' order by o.card_id, o.rn, v.i
    ),
    a4 as (
      select t.card_id, array_agg(distinct t.x) as praws
      from (select q.card_id, q.rarity as x from pq q union all select q.card_id, q.rarity_code from pq q union all select q.card_id, q.rarity_label from pq q) t
      where t.x is not null group by t.card_id
    ),
    keys as (
      select c.id, c.gid, c.np, c.name_key,
        coalesce(nullif(c.onum, ''), a2.pnum, '') as number_key,
        coalesce(to_char(a1.prel, 'YYYY-MM-DD'), '') as rel_key,
        coalesce(a1.regions, '{}') as regions,
        coalesce(a1.langs, '{}') as langs,
        case when nullif(btrim(c.rarity), '') is not null then c.rarity else a3.pfirst end as first_raw,
        array(select distinct u.r from unnest(coalesce(a4.praws, '{}') || array[c.rarity]) as u(r) where u.r is not null order by u.r) as raws
      from cards c
      left join a1 on a1.card_id = c.id
      left join a2 on a2.card_id = c.id
      left join a3 on a3.card_id = c.id
      left join a4 on a4.card_id = c.id
    ),
    -- Each ICU key is ranked once (dense_rank keeps level-1 ties equal, as the comparison did); the six orders then sort on integers.
    -- The not-printed tie-break compares ids in the database default collation, not the ICU root one.
    npr as (select n.id, dense_rank() over (order by n.id) as r from keys n where n.np),
    r1 as (
      select k.*, np2.r as npr,
        dense_rank() over (order by k.number_key collate public.browse_numeric) as nkr,
        dense_rank() over (order by k.name_key collate public.browse_base) as nmr,
        dense_rank() over (order by k.id collate public.browse_root) as idr
      from keys k left join npr np2 on np2.id = k.id
    ),
    computed as materialized (
      select r.id, nullif(r.gid, r.id) as gid, r.np as not_printed,
        row_number() over (order by r.nkr asc, r.npr asc nulls last, r.idr asc, r.id collate "C" asc)::integer as o_num_a,
        row_number() over (order by r.nkr desc, r.npr desc nulls last, r.idr desc, r.id collate "C" desc)::integer as o_num_d,
        row_number() over (order by r.nmr asc, r.nkr asc, r.npr asc nulls last, r.idr asc, r.id collate "C" asc)::integer as o_name_a,
        row_number() over (order by r.nmr desc, r.nkr desc, r.npr desc nulls last, r.idr desc, r.id collate "C" desc)::integer as o_name_d,
        row_number() over (order by r.rel_key collate "C" asc, r.nkr asc, r.npr asc nulls last, r.idr asc, r.id collate "C" asc)::integer as o_rel_a,
        row_number() over (order by r.rel_key collate "C" desc, r.nkr desc, r.npr desc nulls last, r.idr desc, r.id collate "C" desc)::integer as o_rel_d,
        r.regions, r.langs, r.first_raw, r.raws
      from r1 r
    )
  select p_game, v_gen, c.id, c.gid, c.not_printed, c.o_num_a, c.o_num_d, c.o_name_a, c.o_name_d, c.o_rel_a, c.o_rel_d, c.regions, c.langs, c.first_raw, c.raws
  from computed c;
  get diagnostics v_rows = row_count;
  v_ms := (extract(epoch from clock_timestamp() - v_t0) * 1000)::integer;
  insert into public.browse_key_pending as p (game_id, gen, seen, card_count, build_ms, built_at)
  values (p_game, v_gen, v_seen, v_rows, v_ms, now())
  on conflict (game_id) do update set gen = excluded.gen, seen = excluded.seen, card_count = excluded.card_count, build_ms = excluded.build_ms, built_at = excluded.built_at;
  return jsonb_build_object('game', p_game, 'gen', v_gen, 'cards', v_rows, 'buildMs', v_ms);
end;
$function$
;

create or replace function public.browse_refresh_keys_publish(p_game text)
 returns jsonb
 language plpgsql
 volatile
 security definer
 set search_path to ''
 set statement_timeout to '90s'
 set work_mem to '48MB'
as $function$
declare
  v_pend public.browse_key_pending%rowtype;
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('browse_keys:' || p_game, 0));
  select * into v_pend from public.browse_key_pending p where p.game_id = p_game;
  if not found then raise exception 'BROWSE_KEYS_NOTHING_BUILT %', p_game; end if;

  delete from public.browse_key_raws where game_id = p_game;
  insert into public.browse_key_raws (game_id, region, raw)
  select p_game, '', r.raw from public.browse_card_keys_mat m cross join lateral unnest(m.raws) as r(raw) where m.game_id = p_game and m.gen = v_pend.gen group by r.raw;
  insert into public.browse_key_raws (game_id, region, raw)
  select p_game, x.region, r.raw
  from public.browse_card_keys_mat m
  cross join lateral unnest(m.regions) as x(region)
  cross join lateral unnest(m.raws) as r(raw)
  where m.game_id = p_game and m.gen = v_pend.gen
  group by x.region, r.raw;

  delete from public.browse_key_facets where game_id = p_game;
  insert into public.browse_key_facets (game_id, region, kind, v, n)
  with cards as (
    select coalesce(m.gid, m.id) as gid, m.regions, m.langs from public.browse_card_keys_mat m where m.game_id = p_game and m.gen = v_pend.gen
  ),
  filters as (
    select ''::text as region
    union
    select r.region from cards c cross join lateral unnest(c.regions) as r(region) where r.region <> ''
  ),
  scoped as (
    select f.region as flt, c.gid, c.regions, c.langs from filters f join cards c on f.region = '' or f.region = any(c.regions)
  ),
  vals as (
    select s.flt, 'region'::text as kind, s.gid, u.v from scoped s cross join lateral unnest(s.regions) as u(v) where u.v <> ''
    union
    select s.flt, 'language'::text, s.gid, u.v from scoped s cross join lateral unnest(s.langs) as u(v) where u.v <> ''
  ),
  cnt as (select x.flt, x.kind, x.v, count(*)::integer as n from vals x group by x.flt, x.kind, x.v),
  tot as (select d.flt, count(*)::integer as n from (select distinct s.flt, s.gid from scoped s) d group by d.flt),
  have as (select d.flt, d.kind, count(*)::integer as n from (select distinct x.flt, x.kind, x.gid from vals x) d group by d.flt, d.kind),
  unk as (
    select t.flt, k.kind, 'unknown'::text as v, (t.n - coalesce(h.n, 0)) as n
    from tot t cross join (values ('region'), ('language')) as k(kind)
    left join have h on h.flt = t.flt and h.kind = k.kind
    where t.n - coalesce(h.n, 0) > 0
  )
  select p_game, a.flt, a.kind, a.v, a.n from (select * from cnt union all select * from unk) a;

  v_ms := v_pend.build_ms + (extract(epoch from clock_timestamp() - v_t0) * 1000)::integer;
  insert into public.browse_key_state as s (game_id, gen, refreshed_at, card_count, refresh_ms)
  values (p_game, v_pend.gen, now(), v_pend.card_count, v_ms)
  on conflict (game_id) do update set gen = excluded.gen, refreshed_at = excluded.refreshed_at, card_count = excluded.card_count, refresh_ms = excluded.refresh_ms;
  delete from public.browse_key_changes where id = any(v_pend.seen);
  delete from public.browse_card_keys_mat m where m.game_id = p_game and m.gen <> v_pend.gen;
  delete from public.browse_key_pending where game_id = p_game;
  analyze public.browse_card_keys_mat;
  return jsonb_build_object('game', p_game, 'gen', v_pend.gen, 'cards', v_pend.card_count, 'ms', v_ms);
end;
$function$
;

-- p_game = null 重建全部遊戲。p_publish = false 只 build（鍵列留在新世代，公開 RPC 看不到），用來在公開前以 browse_cards_filtered_mat(…, p_gen) 與 *_live 比對。
create or replace function public.browse_refresh_keys(p_game text default null, p_publish boolean default true)
 returns jsonb
 language plpgsql
 volatile
 security definer
 set search_path to ''
as $function$
declare
  g text;
  v_result jsonb := '[]'::jsonb;
begin
  for g in select distinct c.game_id from public.tcg_cards c where c.game_id is not null and (p_game is null or c.game_id = p_game) order by 1 loop
    v_result := v_result || jsonb_build_array(public.browse_refresh_keys_build(g));
    if p_publish then v_result := v_result || jsonb_build_array(public.browse_refresh_keys_publish(g)); end if;
  end loop;
  if p_game is not null and not exists (select 1 from public.tcg_cards c where c.game_id = p_game) then
    delete from public.browse_card_keys_mat where game_id = p_game;
    delete from public.browse_key_raws where game_id = p_game;
    delete from public.browse_key_facets where game_id = p_game;
    delete from public.browse_key_state where game_id = p_game;
    delete from public.browse_key_pending where game_id = p_game;
    delete from public.browse_key_changes where game_id = p_game;
  end if;
  return v_result;
end;
$function$
;

-- 目前有卡、但快路徑不可用（沒建過或有未處理異動）的遊戲：伺服器排程用它補做遺漏的重建（例如手動 SQL 批次之後）。
create or replace function public.browse_keys_stale()
 returns text[]
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  return (select coalesce(array_agg(g.game_id order by g.game_id), '{}')
    from (select distinct c.game_id from public.tcg_cards c where c.game_id is not null) g
    where not public.browse_keys_fresh(g.game_id));
end;
$function$
;

create or replace function public.browse_keys_fresh(p_game text)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select exists (select 1 from public.browse_key_state s where s.game_id = p_game)
     and not exists (select 1 from public.browse_key_changes c where c.game_id = p_game);
$function$
;

-- ---------------------------------------------------------------------------------------------------------------
-- 102 的函式改名為 *_live（內容不動）
-- ---------------------------------------------------------------------------------------------------------------
alter function public.browse_rarity_values(text) rename to browse_rarity_values_live;
alter function public.browse_cards_facets(text, text, jsonb) rename to browse_cards_facets_live;
alter function public.browse_cards_filtered(text, text, text, text, integer, integer, jsonb) rename to browse_cards_filtered_live;

-- ---------------------------------------------------------------------------------------------------------------
-- 快路徑
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.browse_rarity_values_mat(p_game text)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(t.raw order by t.raw), '[]'::jsonb)
  from public.browse_key_raws t
  where t.game_id = p_game and t.region = '';
$function$
;

create or replace function public.browse_cards_facets_mat(p_game text, p_region text, p_rmap jsonb, p_gen bigint default null)
 returns jsonb
 language sql
 stable
 set search_path to ''
 set statement_timeout to '20s'
 set work_mem to '32MB'
as $function$
  with rmap as (
    select m.raw, m.code
    from jsonb_to_recordset(coalesce(p_rmap, '[]'::jsonb)) as m(raw text, code text)
  ),
  cards as materialized (
    select coalesce(k.gid, k.id) as gid, k.raws
    from public.browse_card_keys_mat k
    where k.game_id = p_game and k.gen = coalesce(p_gen, (select s.gen from public.browse_key_state s where s.game_id = p_game))
      and (p_region is null or p_region = any(k.regions))
  ),
  gids as (select distinct c.gid from cards c),
  rv as (
    select distinct c.gid,
      case when mm.raw is not null then mm.code else nullif(btrim(u.raw), '') end as v
    from cards c
    cross join lateral unnest(c.raws) as u(raw)
    left join rmap mm on mm.raw = u.raw
  ),
  r as (select x.v, count(*) as n from rv x where x.v is not null group by x.v)
  select jsonb_build_object(
    'rarity', coalesce((select jsonb_object_agg(r.v, r.n) from r), '{}'::jsonb)
      || coalesce((select jsonb_build_object('unknown', count(*)) from gids g where not exists (select 1 from rv x where x.gid = g.gid and x.v is not null) having count(*) > 0), '{}'::jsonb),
    'region', coalesce((select jsonb_object_agg(f.v, f.n) from public.browse_key_facets f where f.game_id = p_game and f.region = coalesce(p_region, '') and f.kind = 'region'), '{}'::jsonb),
    'language', coalesce((select jsonb_object_agg(f.v, f.n) from public.browse_key_facets f where f.game_id = p_game and f.region = coalesce(p_region, '') and f.kind = 'language'), '{}'::jsonb),
    'unmapped', exists (
      select 1 from public.browse_key_raws w
      where w.game_id = p_game and w.region = coalesce(p_region, '')
        and not exists (select 1 from rmap mm where mm.raw = w.raw)));
$function$
;

create or replace function public.browse_cards_filtered_mat(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb, p_gen bigint default null)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
 set statement_timeout to '20s'
 set work_mem to '32MB'
as $function$
declare
  v_sort text := coalesce(nullif(p_sort, ''), 'number-asc');
  v_take integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_skip integer := greatest(coalesce(p_offset, 0), 0);
  v_order text;
  v_cols text := '';
  v_join text := '';
  v_result jsonb;
begin
  v_order := case v_sort
    when 'number-asc' then '@.o_num_a'
    when 'number-desc' then '@.o_num_d'
    when 'name-asc' then '@.o_name_a'
    when 'name-desc' then '@.o_name_d'
    when 'release-asc' then '@.o_rel_a'
    when 'release-desc' then '@.o_rel_d'
    when 'rarity-desc' then '@.first_rank asc nulls last, coalesce(@.first_code, '''') collate public.browse_numeric asc, @.o_num_a'
    when 'rarity-asc' then '@.first_rank desc nulls last, coalesce(@.first_code, '''') collate public.browse_numeric asc, @.o_num_a'
  end;
  if v_order is null then raise exception 'UNSUPPORTED_BROWSE_SORT %', v_sort; end if;
  if v_sort in ('rarity-desc', 'rarity-asc') then
    v_cols := ', fc.code as first_code, rb.rank as first_rank';
    v_join := $j$
      left join rmap fr on fr.raw = m.first_raw
      left join lateral (select case when m.first_raw is null then null when fr.raw is not null then fr.code else nullif(btrim(m.first_raw), '') end as code) fc on true
      left join rank_by_code rb on rb.code = fc.code$j$;
  end if;
  execute format($q$
    with rmap as (
      select m.raw, m.code, m.token, m.rank
      from jsonb_to_recordset(coalesce($3, '[]'::jsonb)) as m(raw text, code text, token text, rank integer)
    ),
    rank_by_code as (
      select distinct on (m.code) m.code, m.rank from rmap m where m.code is not null order by m.code
    ),
    sel as materialized (
      select m.id, m.o_num_a, m.o_num_d, m.o_name_a, m.o_name_d, m.o_rel_a, m.o_rel_d %s
      from public.browse_card_keys_mat m %s
      where m.game_id = $1
        and m.gen = coalesce($7, (select s.gen from public.browse_key_state s where s.game_id = $1))
        and ($2 is null or $2 = any(m.regions))
        and ($4 is null or m.raws && array(select r.raw from rmap r where r.token = $4))
    ),
    page as (
      select s.id, row_number() over (order by %s) as rn
      from (select s2.* from sel s2 order by %s limit $6 offset $5) s
    )
    select jsonb_build_object(
      'total', (select count(*) from sel),
      'unmapped', case when $7 is null then exists (
        select 1 from public.browse_key_raws w
        where w.game_id = $1 and w.region = coalesce($2, '')
          and not exists (select 1 from rmap mm where mm.raw = w.raw))
        -- an explicit generation (checking a build before it is published) reads the raw values from the keys themselves
        else exists (
        select 1 from public.browse_card_keys_mat m2 cross join lateral unnest(m2.raws) as r2(raw)
        where m2.game_id = $1 and m2.gen = $7 and ($2 is null or $2 = any(m2.regions))
          and not exists (select 1 from rmap mm where mm.raw = r2.raw)) end,
      'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
        'printings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
            'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
            'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
            'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
            'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
            'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
            'metadata', jsonb_strip_nulls(jsonb_build_object(
              'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
              'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial', 'officialListing', p.metadata->'officialListing')),
            'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
            from public.tcg_printings p where p.card_id = c.id), '[]'::jsonb),
        'images', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
            'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
            'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
            order by i.is_primary desc, i.fetched_at desc)
            from public.card_images i where i.card_id = c.id), '[]'::jsonb)) order by pg.rn)
        from page pg join public.tcg_cards c on c.id = pg.id), '[]'::jsonb))
  $q$, v_cols, v_join, replace(v_order, '@.', 's.'), replace(v_order, '@.', 's2.')) into v_result using p_game, p_region, p_rmap, p_token, v_skip, v_take, p_gen;
  return v_result;
end;
$function$
;

-- ---------------------------------------------------------------------------------------------------------------
-- 公開 RPC（簽章與 102 相同）：鍵表可用且沒有未處理異動才走快路徑，否則走 *_live
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.browse_rarity_values(p_game text)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  if public.browse_keys_fresh(p_game) then return public.browse_rarity_values_mat(p_game); end if;
  return public.browse_rarity_values_live(p_game);
end;
$function$
;

create or replace function public.browse_cards_facets(p_game text, p_region text, p_rmap jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  -- p_region = '' (never sent by the server, which turns it into null) matches no printing in the live query; keep that on the live path.
  if p_region is distinct from '' and public.browse_keys_fresh(p_game) then return public.browse_cards_facets_mat(p_game, p_region, p_rmap); end if;
  return public.browse_cards_facets_live(p_game, p_region, p_rmap);
end;
$function$
;

create or replace function public.browse_cards_filtered(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  if p_region is distinct from '' and public.browse_keys_fresh(p_game) then return public.browse_cards_filtered_mat(p_game, p_region, p_token, p_sort, p_limit, p_offset, p_rmap); end if;
  return public.browse_cards_filtered_live(p_game, p_region, p_token, p_sort, p_limit, p_offset, p_rmap);
end;
$function$
;

revoke all on function public.browse_note_card_change() from public, anon, authenticated;
revoke all on function public.browse_note_printing_change() from public, anon, authenticated;
revoke all on function public.browse_refresh_keys(text, boolean) from public, anon, authenticated;
grant execute on function public.browse_refresh_keys(text, boolean) to service_role;
revoke all on function public.browse_refresh_keys_build(text) from public, anon, authenticated;
grant execute on function public.browse_refresh_keys_build(text) to service_role;
revoke all on function public.browse_refresh_keys_publish(text) from public, anon, authenticated;
grant execute on function public.browse_refresh_keys_publish(text) to service_role;
revoke all on function public.browse_keys_stale() from public, anon, authenticated;
grant execute on function public.browse_keys_stale() to service_role;
revoke all on function public.browse_keys_fresh(text) from public, anon, authenticated;
grant execute on function public.browse_keys_fresh(text) to service_role;
revoke all on function public.browse_rarity_values(text) from public, anon, authenticated;
grant execute on function public.browse_rarity_values(text) to service_role;
revoke all on function public.browse_rarity_values_live(text) from public, anon, authenticated;
grant execute on function public.browse_rarity_values_live(text) to service_role;
revoke all on function public.browse_rarity_values_mat(text) from public, anon, authenticated;
grant execute on function public.browse_rarity_values_mat(text) to service_role;
revoke all on function public.browse_cards_facets(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_facets(text, text, jsonb) to service_role;
revoke all on function public.browse_cards_facets_live(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_facets_live(text, text, jsonb) to service_role;
revoke all on function public.browse_cards_facets_mat(text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.browse_cards_facets_mat(text, text, jsonb, bigint) to service_role;
revoke all on function public.browse_cards_filtered(text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_filtered(text, text, text, text, integer, integer, jsonb) to service_role;
revoke all on function public.browse_cards_filtered_live(text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_filtered_live(text, text, text, text, integer, integer, jsonb) to service_role;
revoke all on function public.browse_cards_filtered_mat(text, text, text, text, integer, integer, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.browse_cards_filtered_mat(text, text, text, text, integer, integer, jsonb, bigint) to service_role;

notify pgrst, 'reload schema';
