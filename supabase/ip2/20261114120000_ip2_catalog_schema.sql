-- CardScope 第二個資料庫（cardscope-ip2，kcqtmmurmggitbivonll）的卡表結構，放 UA 等新 IP。
-- 2026-11-14 由主庫 ubiaftrvmywwmifqzmik 的系統目錄匯出（表、索引、觸發器、RPC、權限），不重播主庫 migration；見 docs/UA_SECOND_DB_PLAN.md。
-- 之後改卡表結構或這些 RPC 的 migration，要在兩個庫都套用。
set check_function_bodies = off;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;

create collation if not exists public.browse_base (provider = icu, locale = 'und-u-ks-level1', deterministic = false);

create collation if not exists public.browse_numeric (provider = icu, locale = 'und-u-kn-ks-level1', deterministic = false);

create collation if not exists public.browse_root (provider = icu, locale = 'und', deterministic = false);

create sequence if not exists public.browse_key_gen_seq;

create table public.tcg_games (
  id text not null,
  name_zh text,
  name_ja text,
  name_en text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  name_ko text,
  product_line text,
  catalog_status text default 'active'::text not null,
  constraint tcg_games_pkey PRIMARY KEY (id),
  constraint tcg_games_catalog_status_check CHECK ((catalog_status = ANY (ARRAY['active'::text, 'catalog-only'::text, 'planned'::text])))
);

create table public.tcg_series (
  id text not null,
  game_id text not null,
  official_code text not null,
  name_zh text,
  name_ja text,
  name_en text,
  region text,
  release_date date,
  aliases text[] default '{}'::text[] not null,
  source_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  name_ko text,
  language text,
  image_url text,
  image_kind text,
  source text,
  provider_id text,
  metadata jsonb default '{}'::jsonb not null,
  product_category_id text default 'singles'::text not null,
  source_locale text,
  constraint tcg_series_game_id_official_code_region_key UNIQUE (game_id, official_code, region),
  constraint tcg_series_pkey PRIMARY KEY (id)
);

create table public.tcg_canonical_cards (
  id text not null,
  game_id text not null,
  name_zh text,
  name_ja text,
  name_en text,
  name_ko text,
  aliases text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint tcg_canonical_cards_pkey PRIMARY KEY (id)
);

create table public.tcg_cards (
  id text not null,
  canonical_id text not null,
  game_id text not null,
  series_id text,
  official_card_number text,
  rarity text,
  name_zh text,
  name_ja text,
  name_en text,
  aliases text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  name_ko text,
  source text,
  provider_id text,
  search_text text,
  metadata jsonb default '{}'::jsonb not null,
  rarity_tier smallint,
  data_status text default 'verified'::text not null,
  search_names text generated always as (lower(((((((((COALESCE(name_zh, ''::text) || chr(1)) || COALESCE(name_ja, ''::text)) || chr(1)) || COALESCE(name_en, ''::text)) || chr(1)) || COALESCE(name_ko, ''::text)) || chr(1)) || COALESCE(official_card_number, ''::text)))) stored,
  constraint tcg_cards_pkey PRIMARY KEY (id),
  constraint tcg_cards_data_status_check CHECK ((data_status = ANY (ARRAY['verified'::text, 'pending'::text, 'incomplete'::text]))),
  constraint tcg_cards_number_or_not_printed CHECK (((official_card_number IS NOT NULL) OR (COALESCE((metadata ->> 'numberStatus'::text), ''::text) = 'not-printed'::text)))
);

create table public.tcg_printings (
  id bigint generated always as identity not null,
  card_id text not null,
  region text not null,
  language text not null,
  local_set_code text,
  local_card_number text,
  image_url text,
  source_url text,
  release_date date,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  series_id text,
  rarity text,
  source text,
  provider_id text,
  image_rehost_required boolean default false not null,
  metadata jsonb default '{}'::jsonb not null,
  rarity_code text,
  rarity_label text,
  image_rights_status text default 'not-provided'::text not null,
  image_license_expires_at timestamp with time zone,
  source_locale text,
  data_status text default 'incomplete'::text not null,
  rights_note text,
  constraint tcg_printings_card_id_region_language_local_set_code_local__key UNIQUE (card_id, region, language, local_set_code, local_card_number),
  constraint tcg_printings_source_provider_key UNIQUE (source, provider_id),
  constraint tcg_printings_pkey PRIMARY KEY (id),
  constraint tcg_printings_data_status_check CHECK ((data_status = ANY (ARRAY['verified'::text, 'pending'::text, 'incomplete'::text]))),
  constraint tcg_printings_image_rights_status_check CHECK ((image_rights_status = ANY (ARRAY['licensed'::text, 'partner-provided'::text, 'user-provided'::text, 'not-provided'::text, 'not-displayable'::text])))
);

create table public.card_images (
  id bigint generated by default as identity not null,
  card_id text not null,
  language text,
  source text not null,
  image_url text not null,
  source_url text,
  is_primary boolean default false not null,
  fetched_at timestamp with time zone default now() not null,
  canonical_id text not null,
  image_rights_status text default 'not-provided'::text not null,
  image_license_expires_at timestamp with time zone,
  rights_note text,
  constraint card_images_card_id_source_image_url_key UNIQUE (card_id, source, image_url),
  constraint card_images_pkey PRIMARY KEY (id),
  constraint card_images_image_rights_status_check CHECK ((image_rights_status = ANY (ARRAY['licensed'::text, 'partner-provided'::text, 'user-provided'::text, 'not-provided'::text, 'not-displayable'::text])))
);

create table public.tcg_card_names (
  id bigint generated always as identity not null,
  card_id text not null,
  locale text not null,
  name text not null,
  name_type text default 'official'::text not null,
  source_url text,
  data_status text default 'verified'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  source text,
  metadata jsonb default '{}'::jsonb not null,
  constraint tcg_card_names_card_id_locale_name_name_type_key UNIQUE (card_id, locale, name, name_type),
  constraint tcg_card_names_pkey PRIMARY KEY (id),
  constraint tcg_card_names_data_status_check CHECK ((data_status = ANY (ARRAY['verified'::text, 'pending'::text, 'incomplete'::text]))),
  constraint tcg_card_names_name_type_check CHECK ((name_type = ANY (ARRAY['official'::text, 'alias'::text, 'romanized'::text, 'search-alias'::text])))
);

create table public.tcg_rarities (
  game_id text not null,
  rarity_code text not null,
  rarity_label text,
  rarity_tier smallint,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  source text,
  source_url text,
  data_status text default 'incomplete'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  constraint tcg_rarities_pkey PRIMARY KEY (game_id, rarity_code),
  constraint tcg_rarities_data_status_check CHECK ((data_status = ANY (ARRAY['verified'::text, 'pending'::text, 'incomplete'::text])))
);

create table public.tcg_product_categories (
  id text not null,
  name_zh text not null,
  name_en text,
  sort_order smallint not null,
  description_zh text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint tcg_product_categories_pkey PRIMARY KEY (id)
);

create table public.tcg_products (
  id text not null,
  game_id text not null,
  series_id text,
  official_code text,
  product_type text not null,
  name_zh text,
  name_ja text,
  name_en text,
  name_ko text,
  aliases text[] default '{}'::text[] not null,
  region text not null,
  language text not null,
  release_date date,
  image_url text,
  image_kind text not null,
  source text not null,
  source_url text,
  provider_id text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint tcg_products_pkey PRIMARY KEY (id),
  constraint tcg_products_image_kind_check CHECK ((image_kind = ANY (ARRAY['sealed-product'::text, 'series-logo'::text])))
);

create table public.price_snapshots (
  card_id text not null,
  provider text not null,
  variant text default ''::text not null,
  currency text not null,
  snapshot_date date not null,
  amount numeric(12,2) not null,
  observed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint price_snapshots_pkey PRIMARY KEY (card_id, provider, variant, snapshot_date),
  constraint price_snapshots_amount_check CHECK ((amount > (0)::numeric)),
  constraint price_snapshots_currency_check CHECK ((currency = ANY (ARRAY['EUR'::text, 'USD'::text]))),
  constraint price_snapshots_provider_check CHECK ((provider = ANY (ARRAY['tcgplayer'::text, 'cardmarket'::text])))
);

create table public.browse_card_keys_mat (
  game_id text not null,
  gen bigint not null,
  id text not null,
  gid text,
  not_printed boolean default false not null,
  o_num_a integer not null,
  o_num_d integer not null,
  o_name_a integer not null,
  o_name_d integer not null,
  o_rel_a integer not null,
  o_rel_d integer not null,
  regions text[] default '{}'::text[] not null,
  langs text[] default '{}'::text[] not null,
  first_raw text,
  raws text[] default '{}'::text[] not null,
  constraint browse_card_keys_mat_pkey PRIMARY KEY (game_id, gen, id)
);

create table public.browse_key_changes (
  id bigint generated always as identity not null,
  game_id text not null,
  noted_at timestamp with time zone default now() not null,
  constraint browse_key_changes_pkey PRIMARY KEY (id)
);

create table public.browse_key_facets (
  game_id text not null,
  region text not null,
  kind text not null,
  v text not null,
  n integer not null,
  constraint browse_key_facets_pkey PRIMARY KEY (game_id, region, kind, v)
);

create table public.browse_key_pending (
  game_id text not null,
  gen bigint not null,
  seen bigint[] not null,
  card_count integer not null,
  build_ms integer,
  built_at timestamp with time zone default now() not null,
  constraint browse_key_pending_pkey PRIMARY KEY (game_id)
);

create table public.browse_key_raws (
  game_id text not null,
  region text not null,
  raw text not null,
  constraint browse_key_raws_pkey PRIMARY KEY (game_id, region, raw)
);

create table public.browse_key_state (
  game_id text not null,
  gen bigint not null,
  refreshed_at timestamp with time zone default now() not null,
  card_count integer not null,
  refresh_ms integer,
  constraint browse_key_state_pkey PRIMARY KEY (game_id)
);

CREATE OR REPLACE FUNCTION public.browse_card_keys(p_game text, p_region text, p_token text, p_rmap jsonb)
 RETURNS TABLE(id text, number_key text, name_key text, rel_key text, not_printed boolean, first_code text, first_rank integer, matched boolean, has_unmapped boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with rmap as (
    select m.raw, m.code, m.token, m.rank
    from jsonb_to_recordset(coalesce(p_rmap, '[]'::jsonb)) as m(raw text, code text, token text, rank integer)
  ),
  rank_by_code as (
    select distinct on (m.code) m.code, m.rank from rmap m where m.code is not null order by m.code
  ),
  cards as (
    select k.id, k.official_card_number, k.name_zh, k.name_en, k.name_ja,
      coalesce((k.metadata->>'numberStatus') = 'not-printed', false) as np,
      case when k.rarity is null then null when mc.raw is not null then mc.code else nullif(btrim(k.rarity), '') end as cc,
      mc.token as ct,
      (k.rarity is not null and mc.raw is null) as cum
    from public.tcg_cards k
    left join rmap mc on mc.raw = k.rarity
    where k.game_id = p_game
      and (p_region is null or exists (select 1 from public.tcg_printings r where r.card_id = k.id and r.region = p_region))
  ),
  pq as (
    select p.card_id, p.id as pid, p.local_card_number, p.release_date,
      case p.region when 'JP' then 0 when 'TW' then 1 when 'US' then 2 when 'KR' then 3 when 'ASIA' then 4 else 9 end as rp,
      (coalesce(p.image_url, '') <> '' and not coalesce(p.image_rehost_required, false)) as has_img,
      coalesce(to_char(p.release_date, 'YYYY-MM-DD'), '') as rel,
      (coalesce(c.official_card_number, '') = '') as need_num,
      (c.cc is null) as need_code,
      case when p.rarity is null then null when m1.raw is not null then m1.code else nullif(btrim(p.rarity), '') end as c1,
      case when p.rarity_code is null then null when m2.raw is not null then m2.code else nullif(btrim(p.rarity_code), '') end as c2,
      case when p.rarity_label is null then null when m3.raw is not null then m3.code else nullif(btrim(p.rarity_label), '') end as c3,
      (p_token is not null and (m1.token = p_token or m2.token = p_token or m3.token = p_token)) as hit,
      ((p.rarity is not null and m1.raw is null) or (p.rarity_code is not null and m2.raw is null) or (p.rarity_label is not null and m3.raw is null)) as um
    from public.tcg_printings p
    join cards c on c.id = p.card_id
    left join rmap m1 on m1.raw = p.rarity
    left join rmap m2 on m2.raw = p.rarity_code
    left join rmap m3 on m3.raw = p.rarity_label
  ),
  agg as (
    select q.card_id,
      (array_agg(q.local_card_number order by q.rp, q.has_img desc, q.rel collate "C" desc, q.pid)
         filter (where q.need_num and coalesce(q.local_card_number, '') <> ''))[1] as pnum,
      max(q.release_date) as prel,
      (array_agg(coalesce(q.c1, q.c2, q.c3) order by q.rp, q.has_img desc, q.rel collate "C" desc, q.pid)
         filter (where q.need_code and coalesce(q.c1, q.c2, q.c3) is not null))[1] as pcode,
      bool_or(q.hit) as hit,
      bool_or(q.um) as um
    from pq q
    group by q.card_id
  )
  select c.id,
    coalesce(nullif(c.official_card_number, ''), a.pnum, ''),
    coalesce(nullif(c.name_zh, ''), nullif(c.name_en, ''), nullif(c.name_ja, ''), c.id),
    coalesce(to_char(a.prel, 'YYYY-MM-DD'), ''),
    c.np,
    coalesce(c.cc, a.pcode),
    rb.rank,
    (p_token is null or c.ct = p_token or coalesce(a.hit, false)),
    (c.cum or coalesce(a.um, false))
  from cards c
  left join agg a on a.card_id = c.id
  left join rank_by_code rb on rb.code = coalesce(c.cc, a.pcode);
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_facets(p_game text, p_region text, p_rmap jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  -- p_region = '' (never sent by the server, which turns it into null) matches no printing in the live query; keep that on the live path.
  if p_region is distinct from '' and public.browse_keys_fresh(p_game) then return public.browse_cards_facets_mat(p_game, p_region, p_rmap); end if;
  return public.browse_cards_facets_live(p_game, p_region, p_rmap);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_facets_live(p_game text, p_region text, p_rmap jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
  with rmap as (
    select m.raw, m.code
    from jsonb_to_recordset(coalesce(p_rmap, '[]'::jsonb)) as m(raw text, code text)
  ),
  cards as (
    select k.id, coalesce(nullif(k.canonical_id, ''), k.id) as gid,
      case when k.rarity is null then null when mc.raw is not null then mc.code else nullif(btrim(k.rarity), '') end as cc,
      (k.rarity is not null and mc.raw is null) as cum
    from public.tcg_cards k
    left join rmap mc on mc.raw = k.rarity
    where k.game_id = p_game
      and (p_region is null or exists (select 1 from public.tcg_printings r where r.card_id = k.id and r.region = p_region))
  ),
  pq as (
    select c.gid, p.region, p.language,
      case when p.rarity is null then null when m1.raw is not null then m1.code else nullif(btrim(p.rarity), '') end as c1,
      case when p.rarity_code is null then null when m2.raw is not null then m2.code else nullif(btrim(p.rarity_code), '') end as c2,
      case when p.rarity_label is null then null when m3.raw is not null then m3.code else nullif(btrim(p.rarity_label), '') end as c3,
      ((p.rarity is not null and m1.raw is null) or (p.rarity_code is not null and m2.raw is null) or (p.rarity_label is not null and m3.raw is null)) as um
    from public.tcg_printings p
    join cards c on c.id = p.card_id
    left join rmap m1 on m1.raw = p.rarity
    left join rmap m2 on m2.raw = p.rarity_code
    left join rmap m3 on m3.raw = p.rarity_label
  ),
  rv as (
    select c.gid, c.cc as v from cards c where c.cc is not null
    union all select q.gid, q.c1 from pq q where q.c1 is not null
    union all select q.gid, q.c2 from pq q where q.c2 is not null
    union all select q.gid, q.c3 from pq q where q.c3 is not null
  ),
  gv as (
    select q.gid, q.region as v from pq q where coalesce(q.region, '') <> ''
  ),
  lv as (
    select q.gid, q.language as v from pq q where coalesce(q.language, '') <> ''
  ),
  gids as (select distinct c.gid from cards c),
  r as (select x.v, count(distinct x.gid) as n from rv x group by x.v),
  rg as (select x.v, count(distinct x.gid) as n from gv x group by x.v),
  lg as (select x.v, count(distinct x.gid) as n from lv x group by x.v)
  select jsonb_build_object(
    'rarity', coalesce((select jsonb_object_agg(r.v, r.n) from r), '{}'::jsonb)
      || coalesce((select jsonb_build_object('unknown', count(*)) from gids g where not exists (select 1 from rv x where x.gid = g.gid) having count(*) > 0), '{}'::jsonb),
    'region', coalesce((select jsonb_object_agg(rg.v, rg.n) from rg), '{}'::jsonb)
      || coalesce((select jsonb_build_object('unknown', count(*)) from gids g where not exists (select 1 from gv x where x.gid = g.gid) having count(*) > 0), '{}'::jsonb),
    'language', coalesce((select jsonb_object_agg(lg.v, lg.n) from lg), '{}'::jsonb)
      || coalesce((select jsonb_build_object('unknown', count(*)) from gids g where not exists (select 1 from lv x where x.gid = g.gid) having count(*) > 0), '{}'::jsonb),
    'unmapped', exists (select 1 from cards c where c.cum) or exists (select 1 from pq q where q.um));
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_facets_mat(p_game text, p_region text, p_rmap jsonb, p_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '20s'
 SET work_mem TO '32MB'
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_cards_filtered(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if p_region is distinct from '' and public.browse_keys_fresh(p_game) then return public.browse_cards_filtered_mat(p_game, p_region, p_token, p_sort, p_limit, p_offset, p_rmap); end if;
  return public.browse_cards_filtered_live(p_game, p_region, p_token, p_sort, p_limit, p_offset, p_rmap);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_filtered_live(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
declare
  v_sort text := coalesce(nullif(p_sort, ''), 'number-asc');
  v_take integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_skip integer := greatest(coalesce(p_offset, 0), 0);
  v_num_asc constant text := 's.number_key collate public.browse_numeric asc, case when s.not_printed then s.id end asc nulls last, s.id collate public.browse_root asc';
  v_num_desc constant text := 's.number_key collate public.browse_numeric desc, case when s.not_printed then s.id end desc nulls last, s.id collate public.browse_root desc';
  v_order text;
  v_result jsonb;
begin
  v_order := case v_sort
    when 'number-asc' then v_num_asc
    when 'number-desc' then v_num_desc
    when 'name-asc' then 's.name_key collate public.browse_base asc, ' || v_num_asc
    when 'name-desc' then 's.name_key collate public.browse_base desc, ' || v_num_desc
    when 'release-asc' then 's.rel_key collate "C" asc, ' || v_num_asc
    when 'release-desc' then 's.rel_key collate "C" desc, ' || v_num_desc
    when 'rarity-desc' then 's.first_rank asc nulls last, coalesce(s.first_code, '''') collate public.browse_numeric asc, ' || v_num_asc
    when 'rarity-asc' then 's.first_rank desc nulls last, coalesce(s.first_code, '''') collate public.browse_numeric asc, ' || v_num_asc
  end;
  if v_order is null then raise exception 'UNSUPPORTED_BROWSE_SORT %', v_sort; end if;
  execute format($q$
    with k as (select * from public.browse_card_keys($1, $2, $4, $3)),
    sel as (select * from k where k.matched),
    ranked as (select s.id, row_number() over (order by %s) as rn from sel s),
    page as (select r.id, r.rn from ranked r where r.rn > $5 and r.rn <= $5 + $6)
    select jsonb_build_object(
      'total', (select count(*) from sel),
      'unmapped', exists (select 1 from k where k.has_unmapped),
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
  $q$, v_order) into v_result using p_game, p_region, p_rmap, p_token, v_skip, v_take;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_filtered_mat(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb, p_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '20s'
 SET work_mem TO '32MB'
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_cards_json(p_ids text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
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
            from public.card_images i where i.card_id = c.id), '[]'::jsonb)) order by t.ord), '[]'::jsonb)
  from unnest(p_ids) with ordinality as t(id, ord)
  join public.tcg_cards c on c.id = t.id;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_page(p_game text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_desc boolean DEFAULT false, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Without a region: two branches so each can walk tcg_cards_game_number_idx; the other is skipped by a one-time filter.
  -- With a region: the card ids come from tcg_printings_region_card_idx first, then sort and page (walking the number
  -- index and testing each card for the region slowed down with every page, 3.5 s at offset 200).
  with region_cards as (
    select distinct r.card_id id from public.tcg_printings r where p_region is not null and r.region = p_region
  ),
  page as (
    select * from (
      select k.*
      from public.tcg_cards k
      where p_region is null and not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) a
    union all
    select * from (
      select k.*
      from public.tcg_cards k
      where p_region is null and coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) d
    union all
    select * from (
      select k.*
      from public.tcg_cards k join region_cards rc on rc.id = k.id
      where not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) ra
    union all
    select * from (
      select k.*
      from public.tcg_cards k join region_cards rc on rc.id = k.id
      where coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) rd
  )
  select jsonb_build_object(
    'total', case when p_region is null then (select count(*) from public.tcg_cards k where k.game_id = p_game)
               else (select count(*) from public.tcg_cards k join region_cards rc on rc.id = k.id where k.game_id = p_game) end,
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
        from public.card_images i where i.card_id = c.id), '[]'::jsonb))
      order by case when coalesce(p_desc, false) then null else c.official_card_number end,
               case when coalesce(p_desc, false) then null else c.id end,
               c.official_card_number desc, c.id desc)
      from page c), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.browse_cards_priced(p_game text, p_region text, p_token text, p_desc boolean, p_limit integer, p_offset integer, p_rmap jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '20s'
 SET work_mem TO '32MB'
AS $function$
declare
  v_take integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_skip integer := greatest(coalesce(p_offset, 0), 0);
  v_fresh boolean := p_region is distinct from '' and public.browse_keys_fresh(p_game);
  v_gen bigint := (select s.gen from public.browse_key_state s where s.game_id = p_game);
  v_result jsonb;
begin
  with rmap as (
    select m.raw, m.code, m.token, m.rank
    from jsonb_to_recordset(coalesce(p_rmap, '[]'::jsonb)) as m(raw text, code text, token text, rank integer)
  ),
  sel as materialized (
    select m.id
    from public.browse_card_keys_mat m
    where v_fresh and m.game_id = p_game and m.gen = v_gen
      and (p_region is null or p_region = any(m.regions))
      and (p_token is null or m.raws && array(select r.raw from rmap r where r.token = p_token))
    union all
    select k.id from public.browse_card_keys(p_game, p_region, p_token, p_rmap) k where not v_fresh and k.matched
  ),
  priced as materialized (
    select s.id, b.amount from sel s join public.price_reference_best(null) b on b.card_id = s.id
  ),
  np as materialized (select count(*)::integer as n from priced),
  page as (
    select q.id, 0 as part, q.rn
    from (select pr.id, row_number() over (order by case when p_desc then pr.amount end desc nulls last, case when not p_desc then pr.amount end asc nulls last, pr.id collate "C") as rn from priced pr) q
    where q.rn > v_skip and q.rn <= v_skip + v_take
    union all
    select u.id, 1, u.rn
    from (select s.id, row_number() over (order by s.id collate "C") as rn from sel s where v_skip + v_take > (select n from np) and not exists (select 1 from priced pr where pr.id = s.id)) u
    where u.rn + (select n from np) > v_skip and u.rn + (select n from np) <= v_skip + v_take
  )
  select jsonb_build_object(
    'total', (select count(*) from sel),
    'priced', (select n from np),
    'unmapped', case when v_fresh then exists (
        select 1 from public.browse_key_raws w
        where w.game_id = p_game and w.region = coalesce(p_region, '')
          and not exists (select 1 from rmap mm where mm.raw = w.raw))
      else exists (select 1 from public.browse_card_keys(p_game, p_region, p_token, p_rmap) k2 where k2.has_unmapped) end,
    'cards', public.browse_cards_json(array(select pg.id from page pg order by pg.part, pg.rn)))
  into v_result;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_keys_fresh(p_game text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.browse_key_state s where s.game_id = p_game)
     and not exists (select 1 from public.browse_key_changes c where c.game_id = p_game);
$function$
;

CREATE OR REPLACE FUNCTION public.browse_keys_stale()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  return (select coalesce(array_agg(g.game_id order by g.game_id), '{}')
    from (select distinct c.game_id from public.tcg_cards c where c.game_id is not null) g
    where not public.browse_keys_fresh(g.game_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_note_card_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_note_printing_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_publish_pending_keys()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g text;
  v_result jsonb := '[]'::jsonb;
begin
  for g in select p.game_id from public.browse_key_pending p order by 1 loop
    begin
      v_result := v_result || jsonb_build_array(public.browse_refresh_keys_publish(g));
    exception when others then
      v_result := v_result || jsonb_build_array(jsonb_build_object('game', g, 'error', sqlerrm));
    end;
  end loop;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_rarity_values(p_game text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if public.browse_keys_fresh(p_game) then return public.browse_rarity_values_mat(p_game); end if;
  return public.browse_rarity_values_live(p_game);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_rarity_values_live(p_game text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb)
  from (
    select c.rarity as v from public.tcg_cards c where c.game_id = p_game and c.rarity is not null
    union
    select p.rarity from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = p_game and p.rarity is not null
    union
    select p.rarity_code from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = p_game and p.rarity_code is not null
    union
    select p.rarity_label from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = p_game and p.rarity_label is not null
  ) t;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_rarity_values_mat(p_game text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(t.raw order by t.raw), '[]'::jsonb)
  from public.browse_key_raws t
  where t.game_id = p_game and t.region = '';
$function$
;

CREATE OR REPLACE FUNCTION public.browse_refresh_keys(p_game text DEFAULT NULL::text, p_publish boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_refresh_keys_build(p_game text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '90s'
 SET work_mem TO '48MB'
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_refresh_keys_publish(p_game text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '90s'
 SET work_mem TO '48MB'
AS $function$
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

CREATE OR REPLACE FUNCTION public.browse_series_cards(p_game text, p_series text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with printings as (
    select p.* from public.tcg_printings p where p.series_id = p_series
  ),
  cards as (
    select c.* from public.tcg_cards c
    where c.game_id = p_game and c.id in (select card_id from printings)
  ),
  groups as (
    select distinct coalesce(c.canonical_id, c.id) as group_id from cards c
  ),
  siblings as (
    select k.id, g.group_id from groups g join public.tcg_cards k on k.canonical_id = g.group_id
    union
    select k.id, g.group_id from groups g join public.tcg_cards k on k.id = g.group_id
  )
  select jsonb_build_object(
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
        'createdAt', p.created_at, 'updatedAt', p.updated_at)
      order by p.local_card_number, p.id) from printings p), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.official_card_number, (c.metadata->>'officialListPosition')::integer, c.id) from cards c), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
        'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by i.card_id, i.is_primary desc, i.fetched_at desc)
      from public.card_images i where i.card_id in (select id from cards)), '[]'::jsonb),
    'siblingImages', coalesce((select jsonb_agg(jsonb_build_object(
        'groupId', s.group_id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by s.group_id, i.is_primary desc, i.fetched_at desc, i.card_id)
      from siblings s join public.card_images i on i.card_id = s.id
      where s.id not in (select id from cards) and i.image_url is not null), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.cardscope_db_size_bytes()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select pg_database_size(current_database()); $function$
;

CREATE OR REPLACE FUNCTION public.catalog_health_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with rarity_printing as (
    select distinct card_id from public.tcg_printings
    where nullif(btrim(coalesce(rarity,rarity_code,rarity_label)),'') is not null
  ), series_printing as (
    select distinct card_id from public.tcg_printings where series_id is not null
  ), image_url_cards as (
    select card_id from public.card_images where card_id is not null and image_url is not null
    union
    select card_id from public.tcg_printings where image_url is not null
  ), displayable_image_cards as (
    select card_id from public.card_images
    where card_id is not null and image_url is not null
      and image_rights_status in ('licensed','partner-provided','user-provided')
      and (image_license_expires_at is null or image_license_expires_at > now())
    union
    select card_id from public.tcg_printings
    where image_url is not null and image_rehost_required is not true
      and image_rights_status in ('licensed','partner-provided','user-provided')
      and (image_license_expires_at is null or image_license_expires_at > now())
  ), games as (
    select
      g.id,
      count(c.id) as cards,
      count(c.id) filter (where nullif(btrim(c.name_zh),'') is not null) as chinese_names,
      count(c.id) filter (where nullif(btrim(c.rarity),'') is not null or rp.card_id is not null) as rarities,
      count(c.id) filter (where c.series_id is not null or sp.card_id is not null) as cards_with_series,
      count(c.id) filter (where iu.card_id is not null) as cards_with_image_urls,
      count(c.id) filter (where di.card_id is not null) as displayable_images
    from public.tcg_games g
    left join public.tcg_cards c on c.game_id=g.id
    left join rarity_printing rp on rp.card_id=c.id
    left join series_printing sp on sp.card_id=c.id
    left join image_url_cards iu on iu.card_id=c.id
    left join displayable_image_cards di on di.card_id=c.id
    group by g.id
  ), orphans as (
    select jsonb_build_object(
      'cardsWithoutCanonical',(select count(*) from public.tcg_cards where canonical_id is null),
      'printingsWithoutCard',(select count(*) from public.tcg_printings p where not exists (select 1 from public.tcg_cards c where c.id=p.card_id)),
      'imagesWithoutCard',(select count(*) from public.card_images i where i.card_id is null or not exists (select 1 from public.tcg_cards c where c.id=i.card_id)),
      'imagesWithoutCanonical',(select count(*) from public.card_images where canonical_id is null)
    ) value
  )
  select jsonb_build_object(
    'totalCards',coalesce((select sum(cards) from games),0),
    'games',coalesce((select jsonb_object_agg(id,jsonb_build_object(
      'cards',cards,'chineseNames',chinese_names,'rarities',rarities,
      'cardsWithSeries',cards_with_series,'cardsWithImageUrls',cards_with_image_urls,
      'displayableImages',displayable_images,'expectedCards',null,'completeness','未核定'
    )) from games),'{}'::jsonb),
    'orphans',(select value from orphans),
    'source','supabase-health-snapshot',
    'updatedAt',now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.catalog_health_snapshot_v2(p_display_policies jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET work_mem TO '64MB'
 SET statement_timeout TO '45s'
AS $function$
with printing_base as materialized (
  select p.card_id,
         p.rarity,
         p.rarity_code,
         p.rarity_label,
         p.series_id,
         p.image_url,
         p.image_rehost_required,
         p.image_license_expires_at,
         p.image_rights_status,
         case
           when p.source is not null then p.source
           else (select c.source from tcg_cards c where c.id = p.card_id)
         end as source
  from tcg_printings p
), printing_rollup as (
  select card_id,
         count(*) as total,
         bool_or(nullif(btrim(coalesce(rarity, rarity_code, rarity_label)), '') is not null) as rarity,
         bool_or(series_id is not null) as series,
         bool_or(nullif(btrim(image_url), '') is not null) as has_url,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and not coalesce(image_rehost_required, false)
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and (
             coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
             or (
               coalesce(image_rights_status, 'not-provided') = 'not-provided'
               and p_display_policies ->> source = 'risk-accepted'
             )
           )
         ) as eligible,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and not coalesce(image_rehost_required, false)
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
         ) as explicit_rights,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce((p_display_policies ? source), false)
         ) as unmapped,
         count(*) filter (where nullif(btrim(image_url), '') is not null) as image_urls,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce(image_rehost_required, false)
             and (image_license_expires_at is null or image_license_expires_at > now())
             and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
             and (
               coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
               or (
                 coalesce(image_rights_status, 'not-provided') = 'not-provided'
                 and p_display_policies ->> source = 'risk-accepted'
               )
             )
         ) as image_eligible
  from printing_base
  group by card_id
), image_rollup as (
  select card_id,
         bool_or(nullif(btrim(image_url), '') is not null) as has_url,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and (
             coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
             or (
               coalesce(image_rights_status, 'not-provided') = 'not-provided'
               and p_display_policies ->> source = 'risk-accepted'
             )
           )
         ) as eligible,
         bool_or(
           nullif(btrim(image_url), '') is not null
           and (image_license_expires_at is null or image_license_expires_at > now())
           and (p_display_policies ->> source) in ('risk-accepted', 'rights-approved')
           and coalesce(image_rights_status, 'not-provided') in ('licensed', 'partner-provided', 'user-provided')
         ) as explicit_rights,
         count(*) filter (
           where nullif(btrim(image_url), '') is not null
             and not coalesce((p_display_policies ? source), false)
         ) as unmapped
  from card_images
  group by card_id
), games as materialized (
  select g.id,
         count(c.id) as cards,
         count(c.id) filter (where nullif(btrim(c.name_zh), '') is not null) as chinese_names,
         count(c.id) filter (where nullif(btrim(c.rarity), '') is not null or coalesce(p.rarity, false)) as rarities,
         count(c.id) filter (where c.series_id is not null or coalesce(p.series, false)) as series,
         count(c.id) filter (where coalesce(p.total, 0) > 0) as with_printings,
         count(c.id) filter (where coalesce(i.has_url, false) or coalesce(p.has_url, false)) as urls,
         count(c.id) filter (where coalesce(i.eligible, false) or coalesce(p.eligible, false)) as eligible,
         count(c.id) filter (where coalesce(i.explicit_rights, false) or coalesce(p.explicit_rights, false)) as explicit_rights,
         count(c.id) filter (
           where (coalesce(i.eligible, false) or coalesce(p.eligible, false))
             and not (coalesce(i.explicit_rights, false) or coalesce(p.explicit_rights, false))
         ) as risk_only,
         coalesce(sum(p.total), 0) as printings,
         coalesce(sum(p.image_urls), 0) as printing_urls,
         coalesce(sum(p.image_eligible), 0) as printing_eligible,
         coalesce(sum(coalesce(i.unmapped, 0) + coalesce(p.unmapped, 0)), 0) as unmapped
  from tcg_games g
  left join tcg_cards c on c.game_id = g.id
  left join image_rollup i on i.card_id = c.id
  left join printing_rollup p on p.card_id = c.id
  group by g.id
)
select jsonb_build_object(
  'source', 'supabase-health-snapshot-v2',
  'updatedAt', now(),
  'snapshotAt', now(),
  'totalCards', coalesce((select sum(cards) from games), 0),
  'totalPrintings', coalesce((select sum(printings) from games), 0),
  'metricStatus', jsonb_build_object('images', 'per-source-policy', 'cards', 'observed-physical-cards'),
  'imageLoadSample', jsonb_build_object('status', 'not-sampled', 'sampleSize', 0, 'successRate', null, 'sampledAt', null),
  'games', (
    select jsonb_object_agg(id, jsonb_build_object(
      'cards', cards,
      'chineseNames', chinese_names,
      'rarities', rarities,
      'cardsWithSeries', series,
      'cardsWithPrintings', with_printings,
      'cardsWithImageUrls', urls,
      'displayableImages', eligible,
      'cardsWithDisplayableImages', eligible,
      'cardsWithExplicitRightsImages', explicit_rights,
      'cardsDisplayableOnlyByRiskAcceptance', risk_only,
      'totalPrintings', printings,
      'printingsWithImageUrls', printing_urls,
      'printingsWithDisplayableImages', printing_eligible,
      'unmappedImageUrlRecords', unmapped,
      'expectedCards', null,
      'completeness', '未核定'
    ))
    from games
  ),
  'orphans', jsonb_build_object(
    'cardsWithoutCanonical', (select count(*) from tcg_cards where canonical_id is null),
    'printingsWithoutCard', (select count(*) from tcg_printings p where not exists (select 1 from tcg_cards c where c.id = p.card_id)),
    'imagesWithoutCard', (select count(*) from card_images i where not exists (select 1 from tcg_cards c where c.id = i.card_id)),
    'imagesWithoutCanonical', (select count(*) from card_images where canonical_id is null)
  )
);
$function$
;

CREATE OR REPLACE FUNCTION public.db_size_report()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.get_card_detail(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with direct as (
    select id from (
      select c.id from public.tcg_cards c where c.id = p_id
      union
      select c.id from public.tcg_cards c where c.canonical_id = p_id
    ) d
    limit 100
  ),
  sibling as (
    select c.id
    from public.tcg_cards c
    where c.canonical_id in (
        select k.canonical_id from public.tcg_cards k
        where k.id in (select id from direct) and k.canonical_id is not null and k.canonical_id <> p_id)
      and c.id not in (select id from direct)
    limit 100
  ),
  cards as (
    select c.* from public.tcg_cards c where c.id in (select id from direct union all select id from sibling)
  ),
  printings as (
    select p.* from public.tcg_printings p where p.card_id in (select id from cards)
  )
  select jsonb_build_object(
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
      'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
      'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', c.metadata,
      'printings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', p.metadata, 'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from printings p where p.card_id = c.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = c.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb)) order by c.id)
      from cards c), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'game', s.game_id, 'officialCode', s.official_code, 'nameZh', s.name_zh, 'nameJa', s.name_ja,
      'nameEn', s.name_en, 'nameKo', s.name_ko, 'region', s.region, 'releaseDate', s.release_date) order by s.id)
      from public.tcg_series s
      where s.id in (select series_id from printings union select series_id from cards)), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'nameZh', g.name_zh, 'nameJa', g.name_ja, 'nameEn', g.name_en, 'nameKo', g.name_ko) order by g.id)
      from public.tcg_games g where g.id in (select game_id from cards)), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.price_reference_best(p_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(card_id text, variant text, currency text, amount numeric, snapshot_date date, observed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select distinct on (l.card_id) l.card_id, l.variant, l.currency, l.amount, l.snapshot_date, l.observed_at
  from (
    (select s.card_id, s.provider, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.provider, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is not null and m.card_id = any(p_ids) and m.snapshot_date >= current_date - 14
             and (m.provider = 'cardmarket' or (m.provider = 'tcgplayer' and m.variant like 'tcgapi-%'))
           group by m.card_id, m.provider, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = k.provider and s.variant = k.variant and s.snapshot_date = k.d)
    union all
    (select s.card_id, s.provider, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.provider, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is null and m.snapshot_date >= current_date - 14
             and (m.provider = 'cardmarket' or (m.provider = 'tcgplayer' and m.variant like 'tcgapi-%'))
           group by m.card_id, m.provider, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = k.provider and s.variant = k.variant and s.snapshot_date = k.d)
  ) l
  order by l.card_id, (l.provider <> 'cardmarket'),
    case l.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 when 'tcgapi-normal' then 4 when 'tcgapi-holofoil' then 5 else 6 end, l.variant;
$function$
;

CREATE OR REPLACE FUNCTION public.search_cards_ranked(p_patterns text[], p_needles text[], p_limit integer DEFAULT 40, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- A two-character pattern has no trigram, so the trigram index hands back every row (76k) and the bitmap scan reads the
  -- whole 51 MB heap (魯夫: 8-23 s with a cold cache). A two-character substring is exactly one bigram, so
  -- tcg_search_bigrams (GIN) finds those rows directly; the like stays as a filter and (|| '') keeps it off the trigram index.
  -- Every other pattern takes the trigram index as before; the branch not taken is skipped by a one-time filter.
  with name_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k
      where lower(pattern) !~ '^%[^%_\\]{2}%$' and k.search_names like lower(pattern)
      union all
      select k.id from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]{2}%$'
        and public.tcg_search_bigrams(k.search_names) @> array[substr(lower(pattern), 2, 2)]
        and (k.search_names || '') like lower(pattern)
    ) c
  ),
  -- Only when no name matched: search_text (card numbers such as SV6a-039, provider IDs), at most 100 cards.
  -- With p_region only cards printed in that region count, so other regions cannot fill the 100 slots
  -- (US search_text carries the series name "30th Celebration"; JP cards would never be reached).
  text_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern
        and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
      limit 100
    ) c
    where not exists (select 1 from name_matched)
  ),
  -- Only when no card matched at all: series names or codes (「ナイトワンダラー」, "SV6a"), at most 5 series,
  -- listing their first 100 printings in card-number order; ord keeps that order.
  -- With p_region only that region's series are candidates (otherwise 5 other-region series could fill the slots and
  -- the region filter below would leave nothing, e.g. 30th on the JP page picked the US me55 sets); newest first.
  series_hit as (
    select s.id, row_number() over (order by s.release_date desc nulls last, s.id) as srank
    from public.tcg_series s
    where not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and (p_region is null or s.region = p_region)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    order by s.release_date desc nulls last, s.id
    limit 5
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by h.srank, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p join series_hit h on h.id = p.series_id
          where p_region is null or p.region = p_region
          order by h.srank, p.local_card_number, p.card_id limit 100) x
    group by card_id
  ),
  matched as (
    select id, null::bigint as ord from name_matched
    union all select id, null from text_matched
    union all select id, ord from series_matched
  ),
  needles as (
    select distinct public.tcg_search_fold(n) as needle from unnest(p_needles) n where public.tcg_search_fold(n) <> ''
  ),
  scored as (
    select c.id, coalesce(c.canonical_id, c.id) as group_id,
      case when m.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      -- Series listings keep card-number order; name and text matches are scored like the server.
      case when m.ord is not null then m.ord else coalesce((
        select min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                        when strpos(f.name, nd.needle) > 0 then 2 end)
        from (select public.tcg_search_fold(v) as name
              from unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number] || coalesce(c.aliases, '{}')) v
              where v is not null) f
        cross join needles nd
        where f.name <> ''), 3) end as score
    from public.tcg_cards c
    join matched m on m.id = c.id
  ),
  -- With p_region, only groups that hold a printing of that region (the server shows only those
  -- printings); lateral index lookups per group, since a correlated EXISTS is planned as a table scan.
  in_region as (
    select distinct g.group_id
    from (select distinct group_id from scored) g
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id and p.region = p_region
    where p_region is not null
  ),
  groups as (
    select s.group_id, min(s.score) as score, min(s.sort_name) as sort_name
    from scored s
    where p_region is null or s.group_id in (select group_id from in_region)
    group by s.group_id
  ),
  top_groups as (
    select group_id, score, sort_name from groups
    order by score, sort_name, group_id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ),
  -- Two index lookups (canonical_id, id) instead of one OR, which would scan the table.
  cards as (
    select c.*, exists (select 1 from matched m where m.id = c.id) as hit
    from public.tcg_cards c
    where c.id in (
      select k.id from public.tcg_cards k join top_groups g on k.canonical_id = g.group_id
      union
      select k.id from public.tcg_cards k join top_groups g on k.id = g.group_id)
    limit 300
  )
  select jsonb_build_object(
    'matchedBy', case when exists (select 1 from name_matched) then 'name' when exists (select 1 from text_matched) then 'text'
                      when exists (select 1 from series_matched) then 'series' end,
    'matchedSeries', (select count(*) from series_hit),
    'matchCount', (select count(*) from matched),
    'groupCount', (select count(*) from groups),
    'cards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases, 'hit', x.hit,
      'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', x.metadata->'nameZhBasis', 'numberStatus', x.metadata->'numberStatus')),
      'printings', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
            'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial', 'officialListing', p.metadata->'officialListing')))) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = x.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb))) order by g.score, g.sort_name, g.group_id, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.search_cards_ranked(p_patterns text[], p_needles text[], p_limit integer, p_region text, p_offset integer, p_rarities text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- 名稱比對與 20261016090000 的版本相同：恰為 %兩字% 的樣式走 bigram GIN，其餘走 trigram。
  -- 多帶幾個欄位（評分用）是同一次 heap 掃描就有的資料。
  with name_matched as (
    select distinct on (c.id) c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) !~ '^%[^%_\\]{1,2}%$' and k.search_names like lower(pattern)
      union all
      -- 單字樣式（%V%）沒有 trigram 可用，走索引反而得讀整個 GIN 再逐筆複核；`|| ''` 讓它直接掃表（約 40 ms）。
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]%$' and (k.search_names || '') like lower(pattern)
      union all
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]{2}%$'
        and public.tcg_search_bigrams(k.search_names) @> array[substr(lower(pattern), 2, 2)]
        and (k.search_names || '') like lower(pattern)
    ) c
  ),
  text_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern
        and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
      limit 100
    ) c
    where not exists (select 1 from name_matched)
  ),
  series_hit as (
    select s.id, row_number() over (order by s.release_date desc nulls last, s.id) as srank
    from public.tcg_series s
    where not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and (p_region is null or s.region = p_region)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    order by s.release_date desc nulls last, s.id
    limit 5
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by h.srank, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p join series_hit h on h.id = p.series_id
          where p_region is null or p.region = p_region
          order by h.srank, p.local_card_number, p.card_id limit 100) x
    group by card_id
  ),
  -- 三種命中方式互斥（後兩種只在前一種沒有任何命中時才有列）；cand = 命中的卡片＋評分用欄位。
  cand as (
    select id, game_id, canonical_id, name_zh, name_ja, name_en, name_ko, official_card_number, null::bigint as ord from name_matched
    union all
    select c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number, m.ord
    from (select id, null::bigint as ord from text_matched union all select id, ord from series_matched) m
    join public.tcg_cards c on c.id = m.id
  ),
  matched as (select id, ord from cand),
  -- is_primary：p_needles 的第一個（使用者原本打的詞；其餘是別名對應或寫法變體）。
  needles as materialized (
    select needle, bool_or(is_primary) as is_primary
    from (select public.tcg_search_fold(n) as needle, o = 1 as is_primary from unnest(p_needles) with ordinality t(n, o)) f
    where needle <> ''
    group by needle
  ),
  -- 每個不同的欄位值各算一次：fold 後與每個 needle 比（0 完全相符、1 開頭、2 包含），fold 後為空字串的值不參與。
  vscore as (
    select f.v,
           min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                    when strpos(f.name, nd.needle) > 0 then 2 end) as name_score,
           bool_or(nd.is_primary and strpos(f.name, nd.needle) > 0) as primary_hit
    from (select d.v, public.tcg_search_fold(d.v) as name
          from (select name_zh as v from cand union select name_ja from cand union select name_en from cand
                union select name_ko from cand union select official_card_number from cand) d
          where d.v is not null offset 0) f
    cross join needles nd
    where f.name <> ''
    group by f.v
  ),
  -- 卡片的階層＝它所有欄位值中最好的一個（只比對名稱與卡號，別名不算）。
  card_score as (
    select u.id, min(s.name_score) as name_score, bool_or(s.primary_hit) as primary_hit
    from (select c.id, x.v from cand c
          cross join lateral unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number]) x(v)) u
    join vscore s on s.v = u.v
    group by u.id
  ),
  scored as (
    select c.id, c.game_id, coalesce(c.canonical_id, c.id) as group_id,
      case when c.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      c.ord is not null as is_series,
      -- 沒有任何名稱命中（只靠別名／文字／系列）＝ 3。
      case when c.ord is not null then 3 else coalesce(r.name_score, 3) end as rank,
      case when c.ord is not null then c.ord
           else coalesce(r.name_score, 3) * 2 + (case when r.primary_hit then 0 else 1 end) end as sort_key
    from cand c
    left join card_score r on r.id = c.id
  ),
  -- 版本與稀有度同一個 printing 都要符合（伺服器之後只留這些 printing）；以 canonical 群組做索引查詢。
  in_filter as (
    select distinct g.group_id
    from (select distinct group_id from scored) g
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id
      and (p_region is null or p.region = p_region)
      and (cardinality(coalesce(p_rarities, '{}')) = 0
           or lower(p.rarity_code) = any (p_rarities) or lower(p.rarity) = any (p_rarities))
    where p_region is not null or cardinality(coalesce(p_rarities, '{}')) > 0
  ),
  groups as (
    select s.group_id, min(s.rank) as rank, min(s.sort_key) as sort_key, min(s.sort_name) as sort_name,
           min(s.game_id) as game_id, bool_or(s.is_series) as is_series
    from scored s
    where (p_region is null and cardinality(coalesce(p_rarities, '{}')) = 0) or s.group_id in (select group_id from in_filter)
    group by s.group_id
  ),
  ordered as (
    select g.*, case when g.is_series then 0 else min(g.sort_key) over (partition by g.game_id) end as game_best
    from groups g
  ),
  numbered as (
    select o.group_id, o.rank, row_number() over (
      order by o.game_best, case when o.is_series then '' else o.game_id end, o.sort_key, o.sort_name, o.group_id) as pos
    from ordered o
  ),
  top_groups as (
    select group_id, rank, pos from numbered
    where pos > greatest(coalesce(p_offset, 0), 0)
      and pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 40), 1), 100)
  ),
  cards as (
    select c.*, exists (select 1 from matched m where m.id = c.id) as hit
    from public.tcg_cards c
    where c.id in (
      select k.id from public.tcg_cards k join top_groups g on k.canonical_id = g.group_id
      union
      select k.id from public.tcg_cards k join top_groups g on k.id = g.group_id)
    limit 300
  )
  select jsonb_build_object(
    'matchedBy', case when exists (select 1 from name_matched) then 'name' when exists (select 1 from text_matched) then 'text'
                      when exists (select 1 from series_matched) then 'series' end,
    'matchedSeries', (select count(*) from series_hit),
    'matchCount', (select count(*) from matched),
    'groupCount', (select count(*) from groups),
    'cards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases, 'hit', x.hit,
      'matchRank', g.rank,
      'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', x.metadata->'nameZhBasis', 'numberStatus', x.metadata->'numberStatus')),
      'printings', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
            'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial', 'officialListing', p.metadata->'officialListing')))) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = x.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb))) order by g.pos, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.search_cards_with_siblings(p_patterns text[], p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with hits as (
    select c.*
    from public.tcg_cards c
    where exists (
      select 1 from unnest(p_patterns) pattern
      where c.name_zh ilike pattern or c.name_ja ilike pattern or c.name_en ilike pattern
         or c.name_ko ilike pattern or c.official_card_number ilike pattern
    )
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ),
  siblings as (
    select c.*
    from public.tcg_cards c
    where c.canonical_id in (select h.canonical_id from hits h where h.canonical_id is not null)
      and c.id not in (select h.id from hits h)
    limit 200
  ),
  shaped as (
    select x.kind, jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases,
      'metadata', x.metadata, 'searchText', x.search_text,
      'printings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', p.metadata, 'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb)) as card
    from (select 'hit' kind, h.* from hits h union all select 'sibling' kind, s.* from siblings s) x
  )
  select jsonb_build_object(
    'hits', coalesce((select jsonb_agg(card) from shaped where kind = 'hit'), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(card) from shaped where kind = 'sibling'), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.search_fold_names(p_fold text, p_limit integer DEFAULT 5)
 RETURNS TABLE(name text, hits bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with q as (
    select '%' || replace(replace(replace(public.tcg_search_fold(p_fold), '\', '\'), '%', '\%'), '_', '\_') || '%' as pattern,
           length(public.tcg_search_fold(p_fold)) as len
  ),
  m as (
    select k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number
    from public.tcg_cards k, q
    where q.len >= 3 and public.tcg_search_fold(k.search_names) like q.pattern
    limit 300
  )
  select f.v, count(*)
  from m
  cross join lateral unnest(array[m.name_zh, m.name_ja, m.name_en, m.name_ko, m.official_card_number]) as f(v)
  cross join q
  where f.v is not null and public.tcg_search_fold(f.v) like q.pattern
  group by f.v
  order by count(*) desc, length(f.v), f.v
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$function$
;

CREATE OR REPLACE FUNCTION public.search_name_suggestion(p_q text, p_region text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  -- 閾值只在這個交易內降到 0.3（函式層級的 SET 不允許設擴充套件參數）。
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);
  return (
  with q as (select lower(btrim(coalesce(p_q, ''))) as t),
  cand as (
    select k.name_zh, k.name_ja, k.name_en, k.name_ko
    from public.tcg_cards k, q
    where length(q.t) >= 3 and q.t <% k.search_names
      and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
    order by word_similarity(q.t, k.search_names) desc
    limit 200
  )
  select f.name
  from cand c
  cross join lateral unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko]) as f(name)
  cross join q
  where f.name is not null and btrim(f.name) <> '' and lower(f.name) <> q.t
    -- 含中日韓字的查詢 trigram 本來就少（三個字只有 4 個），門檻 0.3；純拉丁字母的門檻 0.45，避免 pokemon -> Poker 這種湊出來的建議。
    and similarity(lower(f.name), q.t) >= case when q.t ~ '[^ -~]' then 0.3 else 0.45 end
  group by f.name, q.t
  order by similarity(lower(f.name), q.t) desc, count(*) desc, length(f.name), f.name
  limit 1
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.sitemap_card_groups()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_array(g.id, g.game, g.lastmod) order by g.id), '[]'::jsonb)
  from (
    select coalesce(nullif(btrim(c.canonical_id), ''), c.id) as id, min(c.game_id) as game,
      to_char(max(c.updated_at) at time zone 'UTC', 'YYYY-MM-DD') as lastmod
    from public.tcg_cards c
    where coalesce(nullif(btrim(c.name_zh), ''), nullif(btrim(c.name_ja), ''), nullif(btrim(c.name_en), ''), nullif(btrim(c.name_ko), '')) is not null
    group by 1
  ) g;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_card_image_canonical_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  select c.canonical_id into new.canonical_id
  from public.tcg_cards c
  where c.id = new.card_id;

  if new.canonical_id is null then
    raise foreign_key_violation using message = 'card_images.card_id does not reference a catalog card';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_tcg_canonical_from_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into public.tcg_canonical_cards (
    id, game_id, name_zh, name_ja, name_en, name_ko, aliases, updated_at
  ) values (
    new.canonical_id,
    new.game_id,
    new.name_zh,
    new.name_ja,
    new.name_en,
    new.name_ko,
    array_remove(
      coalesce(new.aliases, '{}'::text[])
      || array_remove(array[new.name_zh, new.name_ja, new.name_en, new.name_ko], null),
      ''
    ),
    now()
  )
  on conflict (id) do update set
    game_id = excluded.game_id,
    name_zh = coalesce(public.tcg_canonical_cards.name_zh, excluded.name_zh),
    name_ja = coalesce(public.tcg_canonical_cards.name_ja, excluded.name_ja),
    name_en = coalesce(public.tcg_canonical_cards.name_en, excluded.name_en),
    name_ko = coalesce(public.tcg_canonical_cards.name_ko, excluded.name_ko),
    aliases = (
      select array_agg(distinct value order by value)
      from unnest(
        coalesce(public.tcg_canonical_cards.aliases, '{}'::text[])
        || coalesce(excluded.aliases, '{}'::text[])
      ) as value
      where btrim(value) <> ''
    ),
    updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcg_search_bigrams(t text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(distinct substr(t, i, 2)), '{}'::text[])
  from generate_series(1, length(t) - 1) as i
$function$
;

CREATE OR REPLACE FUNCTION public.tcg_search_fold(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select regexp_replace(normalize(lower(coalesce(p_value, '')), NFKC),
    '[[:space:]・·._:：''’"<>\[\]​-‍⁠﻿-]', '', 'g');
$function$
;

alter table card_images add constraint card_images_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES tcg_canonical_cards(id) ON UPDATE CASCADE ON DELETE CASCADE;

alter table card_images add constraint card_images_card_id_fkey FOREIGN KEY (card_id) REFERENCES tcg_cards(id) ON UPDATE CASCADE ON DELETE CASCADE;

alter table price_snapshots add constraint price_snapshots_card_id_fkey FOREIGN KEY (card_id) REFERENCES tcg_cards(id) ON DELETE CASCADE;

alter table tcg_canonical_cards add constraint tcg_canonical_cards_game_id_fkey FOREIGN KEY (game_id) REFERENCES tcg_games(id) ON DELETE CASCADE;

alter table tcg_card_names add constraint tcg_card_names_card_id_fkey FOREIGN KEY (card_id) REFERENCES tcg_cards(id) ON DELETE CASCADE;

alter table tcg_cards add constraint tcg_cards_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES tcg_canonical_cards(id) ON UPDATE CASCADE ON DELETE RESTRICT;

alter table tcg_cards add constraint tcg_cards_game_id_fkey FOREIGN KEY (game_id) REFERENCES tcg_games(id) ON DELETE CASCADE;

alter table tcg_cards add constraint tcg_cards_series_id_fkey FOREIGN KEY (series_id) REFERENCES tcg_series(id) ON DELETE SET NULL;

alter table tcg_printings add constraint tcg_printings_card_id_fkey FOREIGN KEY (card_id) REFERENCES tcg_cards(id) ON DELETE CASCADE;

alter table tcg_printings add constraint tcg_printings_series_id_fkey FOREIGN KEY (series_id) REFERENCES tcg_series(id) ON DELETE SET NULL;

alter table tcg_products add constraint tcg_products_game_id_fkey FOREIGN KEY (game_id) REFERENCES tcg_games(id) ON DELETE CASCADE;

alter table tcg_products add constraint tcg_products_series_id_fkey FOREIGN KEY (series_id) REFERENCES tcg_series(id) ON DELETE SET NULL;

alter table tcg_rarities add constraint tcg_rarities_game_id_fkey FOREIGN KEY (game_id) REFERENCES tcg_games(id) ON DELETE CASCADE;

alter table tcg_series add constraint tcg_series_game_id_fkey FOREIGN KEY (game_id) REFERENCES tcg_games(id) ON DELETE CASCADE;

CREATE INDEX browse_key_changes_game_idx ON public.browse_key_changes USING btree (game_id);

CREATE INDEX card_images_displayable_rights_idx ON public.card_images USING btree (card_id, image_rights_status) WHERE ((image_url IS NOT NULL) AND (image_rights_status = ANY (ARRAY['licensed'::text, 'partner-provided'::text, 'user-provided'::text])));

CREATE INDEX card_images_primary_idx ON public.card_images USING btree (card_id, is_primary DESC);

CREATE INDEX tcg_canonical_cards_game_idx ON public.tcg_canonical_cards USING btree (game_id);

CREATE INDEX tcg_card_names_lookup_idx ON public.tcg_card_names USING btree (card_id, locale, name_type);

CREATE INDEX tcg_cards_canonical_idx ON public.tcg_cards USING btree (canonical_id);

CREATE INDEX tcg_cards_game_number_idx ON public.tcg_cards USING btree (game_id, official_card_number, id);

CREATE INDEX tcg_cards_game_series_idx ON public.tcg_cards USING btree (game_id, series_id);

CREATE INDEX tcg_cards_search_names_bigram_idx ON public.tcg_cards USING gin (tcg_search_bigrams(search_names));

CREATE INDEX tcg_cards_search_names_fold_trgm_idx ON public.tcg_cards USING gin (tcg_search_fold(search_names) gin_trgm_ops);

CREATE INDEX tcg_cards_search_names_trgm_idx ON public.tcg_cards USING gin (search_names gin_trgm_ops);

CREATE INDEX tcg_cards_search_trgm_idx ON public.tcg_cards USING gin (search_text gin_trgm_ops);

CREATE INDEX tcg_cards_series_idx ON public.tcg_cards USING btree (series_id);

CREATE INDEX tcg_printings_displayable_rights_idx ON public.tcg_printings USING btree (card_id, image_rights_status) WHERE ((image_url IS NOT NULL) AND (image_rights_status = ANY (ARRAY['licensed'::text, 'partner-provided'::text, 'user-provided'::text])));

CREATE INDEX tcg_printings_region_card_idx ON public.tcg_printings USING btree (region, card_id);

CREATE INDEX tcg_printings_series_idx ON public.tcg_printings USING btree (series_id);

CREATE INDEX tcg_printings_visibility_idx ON public.tcg_printings USING btree (card_id, image_rights_status, region, language);

CREATE INDEX tcg_products_game_release_idx ON public.tcg_products USING btree (game_id, release_date DESC);

CREATE INDEX tcg_products_series_idx ON public.tcg_products USING btree (series_id);

CREATE INDEX tcg_rarities_status_idx ON public.tcg_rarities USING btree (game_id, data_status, rarity_code);

CREATE INDEX tcg_series_category_idx ON public.tcg_series USING btree (game_id, product_category_id, region, release_date DESC);

CREATE INDEX tcg_series_game_idx ON public.tcg_series USING btree (game_id, release_date DESC);

CREATE UNIQUE INDEX tcg_cards_source_provider_uidx ON public.tcg_cards USING btree (source, provider_id) WHERE (provider_id IS NOT NULL);

CREATE UNIQUE INDEX tcg_products_source_provider_uidx ON public.tcg_products USING btree (source, provider_id) WHERE (provider_id IS NOT NULL);

CREATE UNIQUE INDEX tcg_series_source_provider_uidx ON public.tcg_series USING btree (source, provider_id) WHERE (provider_id IS NOT NULL);

create view public.tcg_canonical_card_catalog with (security_invoker = true) as  SELECT cc.id,
    cc.game_id,
    g.name_zh AS game_name_zh,
    g.name_ja AS game_name_ja,
    g.name_en AS game_name_en,
    g.name_ko AS game_name_ko,
    cc.name_zh,
    cc.name_ja,
    cc.name_en,
    cc.name_ko,
    cc.aliases,
    COALESCE(card_stats.physical_card_count, 0) AS physical_card_count,
    COALESCE(card_stats.printing_count, 0) AS printing_count,
    preferred_image.card_id AS image_card_id,
    preferred_image.image_url,
    preferred_image.image_source,
    preferred_image.source_url AS image_source_url,
    preferred_image.language AS image_language,
    preferred_image.region AS image_region,
    cc.updated_at
   FROM tcg_canonical_cards cc
     JOIN tcg_games g ON g.id = cc.game_id
     LEFT JOIN LATERAL ( SELECT count(DISTINCT c.id)::integer AS physical_card_count,
            count(DISTINCT p.id)::integer AS printing_count
           FROM tcg_cards c
             LEFT JOIN tcg_printings p ON p.card_id = c.id
          WHERE c.canonical_id = cc.id) card_stats ON true
     LEFT JOIN LATERAL ( SELECT candidate.card_id,
            candidate.image_url,
            candidate.image_source,
            candidate.source_url,
            candidate.language,
            candidate.region
           FROM ( SELECT ci.card_id,
                    ci.image_url,
                    ci.source AS image_source,
                    ci.source_url,
                    ci.language,
                    p.region,
                        CASE
                            WHEN ci.is_primary THEN 0
                            ELSE 1
                        END AS source_priority,
                    ci.fetched_at AS observed_at
                   FROM card_images ci
                     JOIN tcg_cards c ON c.id = ci.card_id
                     LEFT JOIN tcg_printings p ON p.card_id = ci.card_id AND p.image_url = ci.image_url
                  WHERE ci.canonical_id = cc.id
                UNION ALL
                 SELECT p.card_id,
                    p.image_url,
                    COALESCE(p.source, 'tcg_printings'::text) AS image_source,
                    p.source_url,
                    p.language,
                    p.region,
                    2 +
                        CASE p.region
                            WHEN 'TW'::text THEN 0
                            WHEN 'JP'::text THEN 1
                            WHEN 'US'::text THEN 2
                            WHEN 'KR'::text THEN 3
                            ELSE 4
                        END,
                    p.updated_at
                   FROM tcg_printings p
                     JOIN tcg_cards c ON c.id = p.card_id
                  WHERE c.canonical_id = cc.id AND p.image_url IS NOT NULL AND NOT p.image_rehost_required) candidate
          ORDER BY candidate.source_priority, candidate.observed_at DESC NULLS LAST
         LIMIT 1) preferred_image ON true;

CREATE TRIGGER browse_note_cards_delete AFTER DELETE ON public.tcg_cards REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_card_change();

CREATE TRIGGER browse_note_cards_insert AFTER INSERT ON public.tcg_cards REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_card_change();

CREATE TRIGGER browse_note_cards_truncate AFTER TRUNCATE ON public.tcg_cards FOR EACH STATEMENT EXECUTE FUNCTION browse_note_card_change();

CREATE TRIGGER browse_note_cards_update AFTER UPDATE ON public.tcg_cards REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_card_change();

CREATE TRIGGER browse_note_printings_delete AFTER DELETE ON public.tcg_printings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_printing_change();

CREATE TRIGGER browse_note_printings_insert AFTER INSERT ON public.tcg_printings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_printing_change();

CREATE TRIGGER browse_note_printings_truncate AFTER TRUNCATE ON public.tcg_printings FOR EACH STATEMENT EXECUTE FUNCTION browse_note_printing_change();

CREATE TRIGGER browse_note_printings_update AFTER UPDATE ON public.tcg_printings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION browse_note_printing_change();

CREATE TRIGGER sync_card_image_canonical_id_trigger BEFORE INSERT OR UPDATE OF card_id ON public.card_images FOR EACH ROW EXECUTE FUNCTION sync_card_image_canonical_id();

CREATE TRIGGER sync_tcg_canonical_from_card_trigger BEFORE INSERT OR UPDATE OF canonical_id, game_id, name_zh, name_ja, name_en, name_ko, aliases ON public.tcg_cards FOR EACH ROW EXECUTE FUNCTION sync_tcg_canonical_from_card();

alter table public.browse_card_keys_mat enable row level security;

alter table public.browse_key_changes enable row level security;

alter table public.browse_key_facets enable row level security;

alter table public.browse_key_pending enable row level security;

alter table public.browse_key_raws enable row level security;

alter table public.browse_key_state enable row level security;

alter table public.card_images enable row level security;

alter table public.price_snapshots enable row level security;

alter table public.tcg_canonical_cards enable row level security;

alter table public.tcg_card_names enable row level security;

alter table public.tcg_cards enable row level security;

alter table public.tcg_games enable row level security;

alter table public.tcg_printings enable row level security;

alter table public.tcg_product_categories enable row level security;

alter table public.tcg_products enable row level security;

alter table public.tcg_rarities enable row level security;

alter table public.tcg_series enable row level security;

revoke all on public.browse_card_keys_mat from public, anon, authenticated;

revoke all on public.browse_key_changes from public, anon, authenticated;

revoke all on public.browse_key_facets from public, anon, authenticated;

revoke all on public.browse_key_pending from public, anon, authenticated;

revoke all on public.browse_key_raws from public, anon, authenticated;

revoke all on public.browse_key_state from public, anon, authenticated;

revoke all on public.card_images from public, anon, authenticated;

revoke all on public.price_snapshots from public, anon, authenticated;

revoke all on public.tcg_canonical_card_catalog from public, anon, authenticated;

revoke all on public.tcg_canonical_cards from public, anon, authenticated;

revoke all on public.tcg_card_names from public, anon, authenticated;

revoke all on public.tcg_cards from public, anon, authenticated;

revoke all on public.tcg_games from public, anon, authenticated;

revoke all on public.tcg_printings from public, anon, authenticated;

revoke all on public.tcg_product_categories from public, anon, authenticated;

revoke all on public.tcg_products from public, anon, authenticated;

revoke all on public.tcg_rarities from public, anon, authenticated;

revoke all on public.tcg_series from public, anon, authenticated;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_card_keys_mat to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_key_changes to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_key_facets to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_key_pending to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_key_raws to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.browse_key_state to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.card_images to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.price_snapshots to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_canonical_card_catalog to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_canonical_cards to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_card_names to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_cards to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_games to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_printings to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_product_categories to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_products to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_rarities to service_role;

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tcg_series to service_role;

revoke all on function browse_card_keys(text,text,text,jsonb) from public, anon, authenticated;

revoke all on function browse_cards_facets(text,text,jsonb) from public, anon, authenticated;

revoke all on function browse_cards_facets_live(text,text,jsonb) from public, anon, authenticated;

revoke all on function browse_cards_facets_mat(text,text,jsonb,bigint) from public, anon, authenticated;

revoke all on function browse_cards_filtered(text,text,text,text,integer,integer,jsonb) from public, anon, authenticated;

revoke all on function browse_cards_filtered_live(text,text,text,text,integer,integer,jsonb) from public, anon, authenticated;

revoke all on function browse_cards_filtered_mat(text,text,text,text,integer,integer,jsonb,bigint) from public, anon, authenticated;

revoke all on function browse_cards_json(text[]) from public, anon, authenticated;

revoke all on function browse_cards_page(text,integer,integer,boolean,text) from public, anon, authenticated;

revoke all on function browse_cards_priced(text,text,text,boolean,integer,integer,jsonb) from public, anon, authenticated;

revoke all on function browse_keys_fresh(text) from public, anon, authenticated;

revoke all on function browse_keys_stale() from public, anon, authenticated;

revoke all on function browse_note_card_change() from public, anon, authenticated;

revoke all on function browse_note_printing_change() from public, anon, authenticated;

revoke all on function browse_publish_pending_keys() from public, anon, authenticated;

revoke all on function browse_rarity_values(text) from public, anon, authenticated;

revoke all on function browse_rarity_values_live(text) from public, anon, authenticated;

revoke all on function browse_rarity_values_mat(text) from public, anon, authenticated;

revoke all on function browse_refresh_keys(text,boolean) from public, anon, authenticated;

revoke all on function browse_refresh_keys_build(text) from public, anon, authenticated;

revoke all on function browse_refresh_keys_publish(text) from public, anon, authenticated;

revoke all on function browse_series_cards(text,text) from public, anon, authenticated;

revoke all on function cardscope_db_size_bytes() from public, anon, authenticated;

revoke all on function catalog_health_snapshot() from public, anon, authenticated;

revoke all on function catalog_health_snapshot_v2(jsonb) from public, anon, authenticated;

revoke all on function db_size_report() from public, anon, authenticated;

revoke all on function get_card_detail(text) from public, anon, authenticated;

revoke all on function price_reference_best(text[]) from public, anon, authenticated;

revoke all on function search_cards_ranked(text[],text[],integer,text) from public, anon, authenticated;

revoke all on function search_cards_ranked(text[],text[],integer,text,integer,text[]) from public, anon, authenticated;

revoke all on function search_cards_with_siblings(text[],integer) from public, anon, authenticated;

revoke all on function search_fold_names(text,integer) from public, anon, authenticated;

revoke all on function search_name_suggestion(text,text) from public, anon, authenticated;

revoke all on function sitemap_card_groups() from public, anon, authenticated;

revoke all on function sync_card_image_canonical_id() from public, anon, authenticated;

revoke all on function sync_tcg_canonical_from_card() from public, anon, authenticated;

revoke all on function tcg_search_bigrams(text) from public, anon, authenticated;

revoke all on function tcg_search_fold(text) from public, anon, authenticated;

grant execute on function browse_card_keys(text,text,text,jsonb) to service_role;

grant execute on function browse_cards_facets(text,text,jsonb) to service_role;

grant execute on function browse_cards_facets_live(text,text,jsonb) to service_role;

grant execute on function browse_cards_facets_mat(text,text,jsonb,bigint) to service_role;

grant execute on function browse_cards_filtered(text,text,text,text,integer,integer,jsonb) to service_role;

grant execute on function browse_cards_filtered_live(text,text,text,text,integer,integer,jsonb) to service_role;

grant execute on function browse_cards_filtered_mat(text,text,text,text,integer,integer,jsonb,bigint) to service_role;

grant execute on function browse_cards_json(text[]) to service_role;

grant execute on function browse_cards_page(text,integer,integer,boolean,text) to service_role;

grant execute on function browse_cards_priced(text,text,text,boolean,integer,integer,jsonb) to service_role;

grant execute on function browse_keys_fresh(text) to service_role;

grant execute on function browse_keys_stale() to service_role;

grant execute on function browse_note_card_change() to service_role;

grant execute on function browse_note_printing_change() to service_role;

grant execute on function browse_publish_pending_keys() to service_role;

grant execute on function browse_rarity_values(text) to service_role;

grant execute on function browse_rarity_values_live(text) to service_role;

grant execute on function browse_rarity_values_mat(text) to service_role;

grant execute on function browse_refresh_keys(text,boolean) to service_role;

grant execute on function browse_refresh_keys_build(text) to service_role;

grant execute on function browse_refresh_keys_publish(text) to service_role;

grant execute on function browse_series_cards(text,text) to service_role;

grant execute on function cardscope_db_size_bytes() to service_role;

grant execute on function catalog_health_snapshot() to service_role;

grant execute on function catalog_health_snapshot_v2(jsonb) to service_role;

grant execute on function db_size_report() to service_role;

grant execute on function get_card_detail(text) to service_role;

grant execute on function price_reference_best(text[]) to service_role;

grant execute on function search_cards_ranked(text[],text[],integer,text) to service_role;

grant execute on function search_cards_ranked(text[],text[],integer,text,integer,text[]) to service_role;

grant execute on function search_cards_with_siblings(text[],integer) to service_role;

grant execute on function search_fold_names(text,integer) to service_role;

grant execute on function search_name_suggestion(text,text) to service_role;

grant execute on function sitemap_card_groups() to service_role;

grant execute on function sync_card_image_canonical_id() to service_role;

grant execute on function sync_tcg_canonical_from_card() to service_role;

grant execute on function tcg_search_bigrams(text) to anon;

grant execute on function tcg_search_bigrams(text) to authenticated;

grant execute on function tcg_search_bigrams(text) to public;

grant execute on function tcg_search_bigrams(text) to service_role;

grant execute on function tcg_search_fold(text) to anon;

grant execute on function tcg_search_fold(text) to authenticated;

grant execute on function tcg_search_fold(text) to public;

grant execute on function tcg_search_fold(text) to service_role;

select cron.schedule('browse-keys-publish', '25 * * * *', 'select public.browse_publish_pending_keys()');
