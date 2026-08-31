update public.tcg_series as series
set metadata = coalesce(series.metadata, '{}'::jsonb) || jsonb_build_object('cardsCount', counts.card_count),
    updated_at = now()
from (
  select series_id, count(distinct card_id)::integer as card_count
  from public.tcg_printings
  where series_id is not null
  group by series_id
) as counts
where series.id = counts.series_id;
