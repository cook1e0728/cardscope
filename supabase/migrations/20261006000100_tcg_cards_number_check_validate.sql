-- CardScope (ADR 0026): validate tcg_cards_number_or_not_printed, added NOT VALID in 20261006000000.
-- VALIDATE takes a SHARE UPDATE EXCLUSIVE lock, so reads and writes continue while existing rows are checked.
alter table public.tcg_cards validate constraint tcg_cards_number_or_not_printed;
