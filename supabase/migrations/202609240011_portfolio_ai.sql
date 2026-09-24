-- Orbis: log portfolio AI suggestions alongside workbook advice (metadata only).

alter table public.ai_generation_events
  drop constraint if exists ai_generation_events_feature_check;

alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check
    check (feature in ('workbook_advice', 'portfolio_advice'));
