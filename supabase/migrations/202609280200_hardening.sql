-- Phase 1 hardening: push endpoints may only point at real push services, the
-- app writes subscriptions itself, and grants say exactly what each role may do.
--
-- On Supabase, `authenticated` (and `anon`) start with ALL privileges on public
-- tables, so a narrow `grant` on its own changes nothing: RLS was the only gate.
-- Each table below is revoked in full and then granted exactly what the app
-- uses. Safe to run more than once.

-- Push subscriptions ----------------------------------------------------------
-- The same host list as lib/notifications/push-endpoint.ts. `not valid` keeps any
-- existing rows (the sender skips them in code); every new write is checked.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_host;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
) not valid;

-- Browsers read and remove their own devices; subscribing goes through the
-- server action (service role), which checks the endpoint and the device cap.
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Notification inbox ----------------------------------------------------------
-- Users read their notifications and may only set read_at; sending is server-only.
-- Revoking table-level UPDATE also drops the column grant, so read_at is granted again.
revoke all on public.notification_log from public, anon, authenticated;
grant select on public.notification_log to authenticated;
grant update (read_at) on public.notification_log to authenticated;
grant select, insert, update, delete on public.notification_log to service_role;

-- Health documents and plans --------------------------------------------------
-- Users see their documents, and see and delete their plans. Uploads, indexing,
-- document deletion and chunk access all run on the server with the service role.
revoke all on public.health_documents, public.health_document_chunks, public.health_plans from public, anon, authenticated;
grant select on public.health_documents to authenticated;
grant select, delete on public.health_plans to authenticated;
grant select, insert, update, delete on public.health_documents, public.health_document_chunks, public.health_plans to service_role;

-- Saved AI results ------------------------------------------------------------
-- Users read and delete their saved results; the server writes them.
revoke all on public.ai_results from public, anon, authenticated;
grant select, delete on public.ai_results to authenticated;
grant select, insert, update, delete on public.ai_results to service_role;

-- PIN attempts ------------------------------------------------------------------
-- SECURITY DEFINER with an empty search_path: the body is fully schema-qualified.
alter function public.consume_app_pin_attempt(uuid) set search_path = '';
