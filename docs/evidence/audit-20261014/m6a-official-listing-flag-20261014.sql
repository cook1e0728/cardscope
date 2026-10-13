-- M6a 35 張：日本官方卡片搜尋未列、使用者決定保留並標示（2026-10-14）。
do $$
declare n int;
begin
  update public.tcg_printings p set metadata = p.metadata || jsonb_build_object('officialListing','jp-not-listed','officialListingCheckedAt','2026-10-14','officialListingEvidence','docs/evidence/audit-20261014/pokemon-jp.json')
  where p.region='JP' and p.local_set_code='M6a' and p.source='tcgdex-ja' and p.local_card_number in ('104','105','106','107','108','109','110','111','112','113','114','115','116','117','118','119','120','121','122','123','124','125','126','127','128','129','130','131','132','133','134','135','B','G','R') and p.metadata->>'officialListing' is distinct from 'jp-not-listed';
  get diagnostics n = row_count; if n <> 35 then raise exception 'updated % printings, expected 35', n; end if;
  update public.tcg_cards c set metadata = c.metadata || jsonb_build_object('officialListing','jp-not-listed')
  where c.id in (select card_id from public.tcg_printings where region='JP' and local_set_code='M6a' and source='tcgdex-ja' and local_card_number in ('104','105','106','107','108','109','110','111','112','113','114','115','116','117','118','119','120','121','122','123','124','125','126','127','128','129','130','131','132','133','134','135','B','G','R')) and c.metadata->>'officialListing' is distinct from 'jp-not-listed';
  get diagnostics n = row_count; if n <> 35 then raise exception 'updated % cards, expected 35', n; end if;
end
$$;
