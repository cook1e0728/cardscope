-- 稽核第 6 項清理（2026-10-14）。刪除前的完整列在 docs/evidence/cleanup-20261014/deleted-rows-20261014.json。
do $$
declare n int; s text[];
begin
  select array_agg(id) into s from public.tcg_series where game_id = 'pokemon' and region = 'TW' and provider_id like 'CS%' and source = 'tcgdex-zh-tw';
  if coalesce(array_length(s, 1), 0) <> 15 then raise exception 'expected 15 CS series, got %', array_length(s, 1); end if;
  if exists (select 1 from public.tcg_cards where series_id = any(s)) or exists (select 1 from public.tcg_printings where series_id = any(s)) then
    raise exception 'CS series are no longer empty';
  end if;
  delete from public.tcg_products where series_id = any(s) and source = 'tcgdex-zh-tw' and product_type = '系列';
  get diagnostics n = row_count; if n <> 15 then raise exception 'deleted % CS products, expected 15', n; end if;
  delete from public.tcg_series where id = any(s);
  get diagnostics n = row_count; if n <> 15 then raise exception 'deleted % CS series, expected 15', n; end if;

  if (select count(*) from public.tcg_cards where canonical_id = 'onepiece-monkey-d-luffy') <> 1 then raise exception 'seed canonical now shared'; end if;
  delete from public.card_images where card_id = 'onepiece-luffy-op05-119-jp';
  get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % seed images', n; end if;
  delete from public.tcg_printings where card_id = 'onepiece-luffy-op05-119-jp';
  get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % seed printings', n; end if;
  delete from public.tcg_cards where id = 'onepiece-luffy-op05-119-jp' and source is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % seed cards', n; end if;
  delete from public.tcg_canonical_cards where id = 'onepiece-monkey-d-luffy';
  get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % seed canonical', n; end if;
  delete from public.tcg_series where id = 'onepiece-op05-jp' and not exists (select 1 from public.tcg_cards where series_id = 'onepiece-op05-jp');
  get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % seed series', n; end if;
end
$$;
select (select count(*) from public.tcg_series where game_id='pokemon' and region='TW') tw_series, (select count(*) from public.tcg_series where game_id='onepiece' and region='JP') op_jp_series, (select count(*) from public.tcg_cards where game_id='onepiece') op_cards;
