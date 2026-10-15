-- ADR 0043 TW variant split replay: must change nothing. planDigest a82723c8b70ac30ad009dbab916a23df9f3a167c65552e362ab9dd7a16e15f62
drop table if exists pg_temp.tw_official_variant_result;
create temporary table tw_official_variant_result (v jsonb) on commit drop;
do $do$
declare r jsonb;
begin
  r := private.split_pokemon_tw_official_variants($plan${"version":1,"rule":"adr-0043","rows":[{"baseCardId":"pokemon-official-tw-m-p-037","seriesCode":"M-P","number":"037","nameZh":"含羞苞","officialDetailIds":["14443","14444"],"baseOfficial":{"detailId":"14443","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00014443.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/14443/"},"variants":[{"cardId":"pokemon-official-tw-m-p-037-v2","detailId":"14444","variantIndex":2,"variantName":"版本 2","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00014444.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/14444/"}]},{"baseCardId":"pokemon-official-tw-m-p-113","seriesCode":"M-P","number":"113","nameZh":"寶可平板","officialDetailIds":["20089","20090"],"baseOfficial":{"detailId":"20089","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00020089.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/20089/"},"variants":[{"cardId":"pokemon-official-tw-m-p-113-v2","detailId":"20090","variantIndex":2,"variantName":"版本 2","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00020090.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/20090/"}]}]}$plan$::jsonb, 'claude-code-local:aa26488931', false);
  if not (r->>'replay')::boolean or r->>'planDigest' <> 'a82723c8b70ac30ad009dbab916a23df9f3a167c65552e362ab9dd7a16e15f62'
    or r->'inserted' <> '{"cards": 0, "printings": 0, "images": 0, "baseImages": 0}'::jsonb
    or r->'updated' <> '{"baseCards": 0, "basePrintings": 0}'::jsonb then raise exception 'replay changed rows %', r; end if;
  insert into tw_official_variant_result values (r);
end
$do$;
select v from tw_official_variant_result;
