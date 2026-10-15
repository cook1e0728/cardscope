-- SV-P-rarity-group: tw-official 4 rows (ADR 0010). Rolls back unless exactly that many are filled.
create temporary table official_tw_result (v jsonb) on commit drop;
do $do$
declare r jsonb;
begin
  r := private.fill_pokemon_official_rarity_tw($plan${"version":1,"kind":"tw-official","seriesId":"pokemon-tcgdex-tw-sv-p","rows":[{"printingId":123895,"cardId":"pokemon-tcgdex-tw-sv-p-no0","number":"no0","name":"樂園度假地","rarity":"NONE","officialDetailIds":["8736","18358","18359"]},{"printingId":123896,"cardId":"pokemon-tcgdex-tw-sv-p-no1","number":"no1","name":"勝利之證(冠軍)","rarity":"NONE","officialDetailIds":["9025","9026","9027","12564","12565","12566","12578","12579","12580","12939","12940","12941"]},{"printingId":123897,"cardId":"pokemon-tcgdex-tw-sv-p-no2","number":"no2","name":"勝利之證(亞軍)","rarity":"NONE","officialDetailIds":["9025","9026","9027","12564","12565","12566","12578","12579","12580","12939","12940","12941"]},{"printingId":123898,"cardId":"pokemon-tcgdex-tw-sv-p-no3","number":"no3","name":"勝利之證(季軍)","rarity":"NONE","officialDetailIds":["9025","9026","9027","12564","12565","12566","12578","12579","12580","12939","12940","12941"]}]}$plan$::jsonb, 'claude-code-local:aa26488931', false);
  if (r->>'replay')::boolean or (r->>'filled')::int <> 4 then raise exception 'unexpected tw-official result %', r; end if;
  insert into official_tw_result values (r);
end
$do$;
select v from official_tw_result;
