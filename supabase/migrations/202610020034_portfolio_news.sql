-- Orbis: the news read against your holdings, on the Investments tab.
--
-- Saved like the portfolio suggestions, so it survives a reload and is only
-- written again when the news batch or the holdings change. The result names
-- holdings and sectors; the fingerprint in context says which news batch and
-- which holdings it was written about.
--
-- Safe to run more than once.

alter table public.ai_results drop constraint if exists ai_results_feature_check;
alter table public.ai_results add constraint ai_results_feature_check
  check (feature in ('workbook_advice', 'portfolio_advice', 'home_brief', 'portfolio_news'));
