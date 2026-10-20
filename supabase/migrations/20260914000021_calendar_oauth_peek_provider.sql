-- ─── Google only for now: Microsoft is switched off (spec §5.5, §16) ─────
-- Roost supports Google Calendar and ICS subscription links. The Microsoft code is kept and still tested, but no
-- entry point offers it: the Edge Functions read one allowlist (`CALENDAR_PROVIDERS` in
-- supabase/functions/_shared/oauthProviders.ts) and refuse anything not on it.
--
-- `calendar-oauth-finish` is the one entry point that could not tell: it looks the pending attempt up only to check
-- the caller, and `peek_calendar_oauth_attempt` returned the household alone. `calendar_oauth_attempts` is revoked
-- from every client role (including service_role), so the function cannot read the row itself — it has to come back
-- from the wrapper. Peek therefore returns the provider beside the household, and the function refuses an attempt
-- for a provider that is switched off rather than connecting it.
--
-- Nothing about existing data changes: a `calendar_connections` row with provider = 'microsoft' is still read by
-- `calendar-events`, so a household that had one keeps seeing its events. Only connecting and writing are refused.

-- The return type changes, so the wrapper and the helper are replaced rather than redefined.
drop function public.svc_peek_calendar_oauth_attempt(text);
drop function private.peek_calendar_oauth_attempt(text);

-- The household and provider of the attempt with this hash (expired or not), or no row. Used to check the caller,
-- and to refuse a provider this build no longer offers, before finishing.
create function private.peek_calendar_oauth_attempt(p_attempt_hash text)
returns table (household_id uuid, provider text)
language sql stable security definer set search_path = '' as $$
  select a.household_id, a.provider from public.calendar_oauth_attempts a where a.attempt_hash = p_attempt_hash
$$;

create function public.svc_peek_calendar_oauth_attempt(p_attempt_hash text)
returns table (household_id uuid, provider text)
language sql stable security definer set search_path = '' as $$
  select p.household_id, p.provider from private.peek_calendar_oauth_attempt(p_attempt_hash) p
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────
revoke execute on function private.peek_calendar_oauth_attempt(text) from public, anon, authenticated, service_role;
revoke execute on function public.svc_peek_calendar_oauth_attempt(text) from public, anon, authenticated;
grant execute on function public.svc_peek_calendar_oauth_attempt(text) to service_role;
