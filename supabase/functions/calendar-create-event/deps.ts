/**
 * How `calendar-create-event` reaches the database and the providers, over an injected `fetch` (spec §5.5).
 *
 * Kept apart from index.ts so the same wiring can be driven from a verification script with `fetch` pointed at a
 * stub provider (`supabase/manual-checks/calendar_create_event_e2e.ts`): the real auth, the real queries, the real
 * Google request shapes, and only the provider's host swapped. Nothing here is Deno-free — handler.ts is the part
 * Vitest exercises.
 */
import type { ConnectionStatus, FetchLike } from '../_shared/calendarProvider.ts'
import { admin, callerAuth, oauthClient, svc } from '../_shared/calendarDeno.ts'
import { createGoogleEvent, refreshGoogleAccessToken } from '../_shared/google.ts'
import { createMicrosoftEvent, refreshMicrosoftAccessToken } from '../_shared/microsoft.ts'
import type { CreateEventDeps, CreateEventTarget, EventWriter } from './handler.ts'

/** One provider call (token refresh, the write) may take this long. */
export const PROVIDER_TIMEOUT_MS = 10_000

export const timedFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })

function check<T>(what: string, result: { data: T; error: { code?: string } | null }): T {
  if (result.error) throw Object.assign(new Error(`${what} failed`), { code: result.error.code })
  return result.data
}

/** Null when that provider's client id and secret are not set on this server. */
function writerFor(provider: 'google' | 'microsoft', fetchImpl: FetchLike): EventWriter | null {
  const client = oauthClient(provider)
  if (!client) return null
  const refresh = provider === 'google' ? refreshGoogleAccessToken : refreshMicrosoftAccessToken
  const create = provider === 'google' ? createGoogleEvent : createMicrosoftEvent
  return {
    refresh: (refreshToken, now) => refresh(fetchImpl, { ...client, refreshToken }, now),
    createEvent: (accessToken, calendarId, draft) => create(fetchImpl, accessToken, calendarId, draft),
  }
}

export function createCreateEventDeps(fetchImpl: FetchLike = timedFetch): CreateEventDeps {
  return {
    requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
    requirePinMembership: (req, householdId, membershipId, pin) => callerAuth.requirePinMembership(req, householdId, membershipId, pin),
    recordAttempt: (membershipId) => svc<boolean>('svc_record_calendar_event_attempt', { p_membership_id: membershipId }),

    async load(selectionId): Promise<CreateEventTarget | null> {
      // Explicit columns throughout: never vault_secret_id.
      const selection = check(
        'calendar_selections',
        await admin
          .from('calendar_selections')
          .select('id, household_id, connection_id, external_calendar_id, gone')
          .eq('id', selectionId)
          .maybeSingle(),
      )
      if (!selection) return null
      const [connectionResult, householdResult] = await Promise.all([
        admin.from('calendar_connections').select('id, membership_id, provider, status, can_write').eq('id', selection.connection_id).maybeSingle(),
        admin.from('households').select('time_zone').eq('id', selection.household_id).is('deleted_at', null).maybeSingle(),
      ])
      const connection = check('calendar_connections', connectionResult)
      const household = check('households', householdResult)
      if (!connection || !household) return null
      return {
        householdId: selection.household_id,
        connectionId: connection.id,
        ownerMembershipId: connection.membership_id,
        provider: connection.provider as CreateEventTarget['provider'],
        status: connection.status as ConnectionStatus,
        canWrite: connection.can_write === true,
        externalCalendarId: selection.external_calendar_id,
        gone: selection.gone === true,
        timeZone: household.time_zone,
      }
    },

    secret: (connectionId) => svc<string | null>('svc_calendar_secret', { p_connection_id: connectionId }),
    writers: { google: writerFor('google', fetchImpl), microsoft: writerFor('microsoft', fetchImpl) },
    updateSecret: (connectionId, secret) => svc<void>('svc_update_calendar_secret', { p_connection_id: connectionId, p_secret: secret }),
    setStatus: (connectionId, status) => svc<void>('svc_set_calendar_status', { p_connection_id: connectionId, p_status: status }),
    recordCreated: (membershipId, selectionId) =>
      svc<void>('svc_record_calendar_event_created', { p_membership_id: membershipId, p_selection_id: selectionId }),
    now: () => new Date(),
  }
}
