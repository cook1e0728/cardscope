drop index if exists public.tcg_printings_source_provider_uidx;

alter table public.tcg_printings
  add constraint tcg_printings_source_provider_key unique (source, provider_id);
