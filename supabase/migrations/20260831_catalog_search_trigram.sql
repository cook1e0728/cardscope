create extension if not exists pg_trgm with schema extensions;

create index if not exists tcg_cards_search_trgm_idx
  on public.tcg_cards using gin (search_text extensions.gin_trgm_ops);

comment on column public.tcg_cards.search_text is 'Provider names, card numbers and set identifiers used by server-side multilingual substring search.';
