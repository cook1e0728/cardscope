-- ADR 0043 TW variant split: 1 base cards, 1 new cards, 1 base images (private.split_pokemon_tw_official_variants). planDigest 67684a90ae3506ad78e59aab04d06e156792111d2cf276db4e8f434cdcd4c2b1
drop table if exists pg_temp.tw_official_variant_result;
create temporary table tw_official_variant_result (v jsonb) on commit drop;
do $do$
declare d jsonb; r jsonb;
begin
  d := private.split_pokemon_tw_official_variants($plan${"version":1,"rule":"adr-0043","rows":[{"baseCardId":"pokemon-official-tw-sv-p-230","seriesCode":"SV-P","number":"230","nameZh":"好友寶芬","officialDetailIds":["12938","12942"],"baseOfficial":{"detailId":"12938","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00012938.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/12938/"},"variants":[{"cardId":"pokemon-official-tw-sv-p-230-v2","detailId":"12942","variantIndex":2,"variantName":"版本 2","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00012942.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/12942/"}]}]}$plan$::jsonb, 'claude-code-local:aa26488931', true);
  if (d->>'replay')::boolean or (d->>'dryRun')::boolean is distinct from true or d->>'planDigest' <> '67684a90ae3506ad78e59aab04d06e156792111d2cf276db4e8f434cdcd4c2b1'
    or d->'inserted' <> '{"cards": 1, "printings": 1, "images": 1, "baseImages": 1}'::jsonb
    or d->'updated' <> '{"baseCards": 1, "basePrintings": 1}'::jsonb then raise exception 'unexpected dry run %', d; end if;
  r := private.split_pokemon_tw_official_variants($plan${"version":1,"rule":"adr-0043","rows":[{"baseCardId":"pokemon-official-tw-sv-p-230","seriesCode":"SV-P","number":"230","nameZh":"好友寶芬","officialDetailIds":["12938","12942"],"baseOfficial":{"detailId":"12938","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00012938.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/12938/"},"variants":[{"cardId":"pokemon-official-tw-sv-p-230-v2","detailId":"12942","variantIndex":2,"variantName":"版本 2","imageUrl":"https://asia.pokemon-card.com/tw/card-img/tw00012942.png","sourceUrl":"https://asia.pokemon-card.com/tw/card-search/detail/12942/"}]}]}$plan$::jsonb, 'claude-code-local:aa26488931', false);
  if (r->>'replay')::boolean or (r->>'dryRun')::boolean is distinct from false or r->>'planDigest' <> '67684a90ae3506ad78e59aab04d06e156792111d2cf276db4e8f434cdcd4c2b1'
    or r->'inserted' <> '{"cards": 1, "printings": 1, "images": 1, "baseImages": 1}'::jsonb
    or r->'updated' <> '{"baseCards": 1, "basePrintings": 1}'::jsonb then raise exception 'unexpected split %', r; end if;
  insert into tw_official_variant_result values (r);
end
$do$;
select v from tw_official_variant_result;
