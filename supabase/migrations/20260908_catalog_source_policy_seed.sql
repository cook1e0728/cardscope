insert into public.catalog_source_policies
  (id,runtime_provider,kind,game_id,region,source_name,source_url,access_method,metadata_policy,image_policy,collection_enabled,attribution_required,refresh_hours,evidence_url,reviewed_at,notes)
values
  ('pokemontcg','pokemon','catalog-api','pokemon','US','Pokémon TCG API','https://docs.pokemontcg.io/','public-api','approved-api','rights-review-required',true,false,72,'https://dev.pokemontcg.io/terms','2026-09-08','Card-art display rights remain unclassified.'),
  ('tcgdex-zh-tw','pokemonZhTw','catalog-api','pokemon','TW','TCGdex API','https://tcgdex.dev/','public-api','approved-api','rights-review-required',true,false,72,'https://github.com/tcgdex/documentation','2026-09-08','Used for metadata and Traditional Chinese matching.'),
  ('ygoprodeck','yugioh','catalog-api','yugioh','GLOBAL','YGOPRODeck API','https://api.ygoprodeck.com/api-guide/','public-api','approved-api','rights-review-required',true,true,72,'https://api.ygoprodeck.com/api-guide/','2026-09-08','Rehosting guidance is not treated as a copyright licence.'),
  ('onepiece-official-runtime','onepiece','official-page','onepiece','JP/TW','ONE PIECE CARD GAME card lists','https://www.onepiece-cardgame.com/cardlist/','official-page','permission-pending','not-collected',false,true,null,'https://www.onepiece-cardgame.com/','2026-09-08','Automatic collection disabled pending terms or permission.'),
  ('yuyutei','yuyutei','market-page',null,'JP','遊々亭買取','https://yuyu-tei.jp/buy/','manual-admin-only','permission-pending','not-collected',false,true,24,'https://yuyu-tei.jp/','2026-09-08','Automatic collection disabled pending terms or permission.'),
  ('ebay','ebay','market-api',null,'GLOBAL','eBay Browse API','https://developer.ebay.com/api-docs/buy/browse/overview.html','authenticated-api','approved-api','remote-listing-only',true,true,24,'https://developer.ebay.com/join/api-license-agreement','2026-09-08','Listing media remains attached to its source listing.'),
  ('frankfurter','frankfurter','exchange-rate-api',null,'GLOBAL','Frankfurter','https://frankfurter.dev/','public-api','approved-api','not-applicable',true,true,24,'https://frankfurter.dev/','2026-09-08','Exchange rates only.')
on conflict (id) do update set
  runtime_provider=excluded.runtime_provider,
  kind=excluded.kind,
  game_id=excluded.game_id,
  region=excluded.region,
  source_name=excluded.source_name,
  source_url=excluded.source_url,
  access_method=excluded.access_method,
  metadata_policy=excluded.metadata_policy,
  image_policy=excluded.image_policy,
  collection_enabled=excluded.collection_enabled,
  attribution_required=excluded.attribution_required,
  refresh_hours=excluded.refresh_hours,
  evidence_url=excluded.evidence_url,
  reviewed_at=excluded.reviewed_at,
  notes=excluded.notes,
  updated_at=now();
