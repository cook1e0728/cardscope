-- batch-06 replay: 57 Taiwanese cards, official external image (ADR 0031). Must insert nothing.
create temporary table tw_img_plan (card_id text primary key, detail_id text not null) on commit drop;
insert into tw_img_plan (card_id, detail_id) values
('pokemon-official-tw-sv8-119', '11472'),
('pokemon-official-tw-sv8-120', '11473'),
('pokemon-official-tw-sv8-121', '11474'),
('pokemon-official-tw-sv8-122', '11475'),
('pokemon-official-tw-sv8-123', '11476'),
('pokemon-official-tw-sv8-124', '11477'),
('pokemon-official-tw-sv8-125', '11478'),
('pokemon-official-tw-sv8-126', '11479'),
('pokemon-official-tw-sv8-127', '11480'),
('pokemon-official-tw-sv8-128', '11481'),
('pokemon-official-tw-sv8-129', '11482'),
('pokemon-official-tw-sv8-130', '11483'),
('pokemon-official-tw-sv8-131', '11484'),
('pokemon-official-tw-sv8-132', '11485'),
('pokemon-official-tw-sv8-133', '11486'),
('pokemon-official-tw-sv8-134', '11487'),
('pokemon-official-tw-sv8-135', '11488'),
('pokemon-official-tw-sv8-136', '11489'),
('pokemon-official-tw-sv8-137', '11490'),
('pokemon-official-tw-sv8-138', '11491'),
('pokemon-tcgdex-tw-sval-fir', '7748'),
('pokemon-tcgdex-tw-sval-lig', '7749'),
('pokemon-tcgdex-tw-svam-fig', '7774'),
('pokemon-tcgdex-tw-svam-gra', '7773'),
('pokemon-tcgdex-tw-svaw-psy', '7799'),
('pokemon-tcgdex-tw-svaw-wat', '7798'),
('pokemon-tcgdex-tw-svb-dar', '7845'),
('pokemon-tcgdex-tw-svb-fig', '7844'),
('pokemon-tcgdex-tw-svb-fir', '7840'),
('pokemon-tcgdex-tw-svb-gra', '7839'),
('pokemon-tcgdex-tw-svb-lig', '7842'),
('pokemon-tcgdex-tw-svb-met', '7846'),
('pokemon-tcgdex-tw-svb-psy', '7843'),
('pokemon-tcgdex-tw-svb-wat', '7841'),
('pokemon-tcgdex-tw-svc-lig', '8111'),
('pokemon-tcgdex-tw-svd-dar', '8479'),
('pokemon-tcgdex-tw-svd-fig', '8478'),
('pokemon-tcgdex-tw-svd-fir', '8474'),
('pokemon-tcgdex-tw-svd-gra', '8473'),
('pokemon-tcgdex-tw-svd-lig', '8476'),
('pokemon-tcgdex-tw-svd-met', '8480'),
('pokemon-tcgdex-tw-svd-psy', '8477'),
('pokemon-tcgdex-tw-svd-wat', '8475'),
('pokemon-tcgdex-tw-svel-fir', '8766'),
('pokemon-tcgdex-tw-svem-psy', '8787'),
('pokemon-tcgdex-tw-svf-dar', '8669'),
('pokemon-tcgdex-tw-svf-fig', '8668'),
('pokemon-tcgdex-tw-svf-fir', '8664'),
('pokemon-tcgdex-tw-svf-gra', '8663'),
('pokemon-tcgdex-tw-svf-lig', '8666'),
('pokemon-tcgdex-tw-svf-met', '8670'),
('pokemon-tcgdex-tw-svf-psy', '8667'),
('pokemon-tcgdex-tw-svf-wat', '8665'),
('pokemon-tcgdex-tw-svhk-fig', '10075'),
('pokemon-tcgdex-tw-svhk-fir', '10074'),
('pokemon-tcgdex-tw-svhm-lig', '10098'),
('pokemon-tcgdex-tw-svhm-psy', '10099');
create temporary table tw_img_todo on commit drop as
  select p.card_id, p.detail_id, c.canonical_id
  from tw_img_plan p
  join tcg_cards c on c.id = p.card_id and c.game_id = 'pokemon'
  where exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.region = 'TW')
    and not exists (select 1 from card_images ci where ci.card_id = p.card_id)
    and not exists (select 1 from tcg_printings g where g.card_id = p.card_id and g.image_url is not null and g.image_url <> '');
do $do$
declare n int;
begin
  select count(*) into n from tw_img_todo;
  if n <> 0 then raise exception 'ELIGIBLE_COUNT_MISMATCH % <> 0', n; end if;
end
$do$;
select count(*) as images_now from card_images ci join tw_img_plan p on p.card_id = ci.card_id where ci.rights_note = 'ADR 0031' and ci.source = 'pokemon-tw-official';
