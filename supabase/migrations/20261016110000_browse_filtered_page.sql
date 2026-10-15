-- 稀有度篩選／名稱、發售日、稀有度排序的圖鑑分頁改由資料庫完成（2026-10-16）。
-- 原本 server.mjs 的 browseDatabaseCardsFull 為了這些請求把整個遊戲（寶可夢 5.5 萬張卡、10 萬筆 printing、圖片）讀進記憶體，
-- 單一請求就可能讓 Render 免費版（約 255 MB 堆積）記憶體不足當機。這裡改成：
--   browse_rarity_values(p_game)                              該遊戲出現過的稀有度原始字串（伺服器據此算出標準代碼、排名與比對用 token）。
--   browse_card_keys(p_game, p_region, p_token, p_rmap)       每張卡的排序鍵與是否符合稀有度篩選（內部使用）。
--   browse_cards_filtered(p_game, p_region, p_token, p_sort, p_limit, p_offset, p_rmap)  篩選＋排序＋分頁，回傳總數與該頁卡片（含 printing、圖片）。
--   browse_cards_facets(p_game, p_region, p_rmap)             稀有度／版本／語言的 facet 計數（每個標準身分最多算一次）。
-- 排序語意與伺服器 buildBrowsePage／browseCompare 逐項相同：
--   * 稀有度標準代碼與排名由伺服器依 data/rarity-rankings.json 算好，以 p_rmap（原始字串 -> 代碼、比對 token、排名）傳入；不在表內的原始字串
--     以修剪後原文當代碼、排名視為未知，並以 unmapped = true 回報，由伺服器重算對照表後重試。
--   * 編號用 ICU 數字排序（等同 Intl.Collator numeric、sensitivity base）；名稱用 sensitivity base；id 用 ICU 預設；日期是 ISO 字串位元組序。
--   * Printing 順序同 comparePrintings：地區 JP、TW、US、KR、ASIA，再有圖，再發售日新到舊，最後 id。
--   * 名稱、發售日、編號遞減是整個比較函式反向（含編號與 id 的次序）；稀有度只反向排名，未知排名永遠在最後。
-- 簽章與既有函式不變；只新增函式與三個 collation。

create collation if not exists public.browse_numeric (provider = icu, locale = 'und-u-kn-true-ks-level1', deterministic = false);
create collation if not exists public.browse_base (provider = icu, locale = 'und-u-ks-level1', deterministic = false);
create collation if not exists public.browse_root (provider = icu, locale = 'und', deterministic = false);

create or replace function public.browse_rarity_values(p_game text)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
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

create or replace function public.browse_card_keys(p_game text, p_region text, p_token text, p_rmap jsonb)
 returns table (
   id text, number_key text, name_key text, rel_key text, not_printed boolean,
   first_code text, first_rank integer, matched boolean, has_unmapped boolean)
 language sql
 stable
 set search_path to ''
as $function$
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

create or replace function public.browse_cards_facets(p_game text, p_region text, p_rmap jsonb)
 returns jsonb
 language sql
 stable
 set search_path to ''
 set statement_timeout to '20s'
as $function$
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

create or replace function public.browse_cards_filtered(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
 set statement_timeout to '20s'
as $function$
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

revoke all on function public.browse_rarity_values(text) from public, anon, authenticated;
grant execute on function public.browse_rarity_values(text) to service_role;
revoke all on function public.browse_card_keys(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.browse_card_keys(text, text, text, jsonb) to service_role;
revoke all on function public.browse_cards_facets(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_facets(text, text, jsonb) to service_role;
revoke all on function public.browse_cards_filtered(text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_filtered(text, text, text, text, integer, integer, jsonb) to service_role;
