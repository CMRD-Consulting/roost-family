/**
 * HTTP handling for `calendar-create-event`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId, selectionId, title, start, end, allDay, location? } with a full sign-in adult's JWT (Manage
 * household in a browser), or the same body plus { membershipId, pin } from a display, whose Settings PIN session
 * authorises the write (spec §6.3) — exactly as `calendar-connect-ics` takes them.
 *
 * `allDay` decides how `start` and `end` are read: `YYYY-MM-DD` household dates with an **exclusive** end for an
 * all-day event, instants with an offset or `Z` for a timed one (see `_shared/eventDraft.ts` for every limit).
 *
 *   200 { created: true, selectionId, title, startAt, endAt, allDay, location }
 *                                     the event as it was written, so the Today panel can show it at once; `startAt`
 *                                     and `endAt` are UTC instants (an all-day event's are the household zone's
 *                                     midnights, end exclusive)
 *   400 { error: 'invalid_request' }  the body is not { householdId: uuid, selectionId: uuid, … }, carries a `pin`
 *                                     without a well-formed `membershipId`, or fails any event rule (title 1–200
 *                                     characters and no markup, location at most 200, end after start, within about
 *                                     a year, at most a month long)
 *   401/403 { error: 'forbidden' }    not a full sign-in owner or adult of the household, the PIN is wrong, a
 *                                     caregiver's or of another household, or the calendar is not one of the
 *                                     caller's own in this household (a calendar that does not exist answers the
 *                                     same way, so ids cannot be probed)
 *   403 { error: 'not_writable' }     an ICS subscription (one-way), or an account connected before Roost asked for
 *                                     write access: it must be connected again to grant it
 *   403 { error: 'provider_not_supported' }
 *                                     a connection for a provider this build does not offer (`CALENDAR_PROVIDERS`:
 *                                     Microsoft is switched off). Its events are still read; only writing is refused
 *   410 { error: 'calendar_gone' }    the provider no longer has that calendar
 *   422 { error: 'auth_expired' }     the account must be connected again
 *   429 { error: 'rate_limited' }     more than 30 events added by this member in the last hour
 *   502 { error: 'unreachable' }      the provider failed or could not be reached
 *   503 { error: 'not_configured' }   that provider's client id and secret are not set on this server
 *   500 { error: 'internal' }
 *
 * Roost stores no event data (spec §11.2): the event goes to the provider and the normal feed shows it afterwards.
 * The only trace kept is a `settings_audit` row naming the connection and selection, written together with the bump
 * that clears this connection's entry in the 5-minute events cache. Titles, locations and tokens are never logged.
 */
import { AuthError } from '../_shared/auth.ts'
import { CalendarProviderError, type AccessToken, type ConnectionStatus } from '../_shared/calendarProvider.ts'
import { EventInputError, parseEventDraft, type EventDraft } from '../_shared/eventDraft.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import { calendarProviderEnabled } from '../_shared/oauthProviders.ts'

const METHODS = 'POST'

/** The one calendar an event is being added to, with everything needed to decide whether it may be. */
export interface CreateEventTarget {
  householdId: string
  connectionId: string
  /** The membership whose connection this is; only they may add to it. */
  ownerMembershipId: string
  provider: 'ics' | 'google' | 'microsoft'
  status: ConnectionStatus
  canWrite: boolean
  externalCalendarId: string
  gone: boolean
  /** The household's time zone, which all-day dates and wall-clock times are read in. */
  timeZone: string
}

/** One provider's write path. `refresh` may hand back a rotated refresh token, which is saved before the write. */
export interface EventWriter {
  refresh(refreshToken: string, now: Date): Promise<AccessToken>
  createEvent(accessToken: string, calendarId: string, draft: EventDraft): Promise<string | null>
}

export interface CreateEventDeps {
  /** The caller's membership id when they are a full sign-in owner or adult; throws AuthError otherwise. */
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
  /** The membership a display's caller proves with an open Settings PIN session; throws AuthError otherwise. */
  requirePinMembership(req: Request, householdId: string, membershipId: string, pin: string): Promise<string>
  /** Records an attempt; false when the member has used up the hourly limit. */
  recordAttempt(membershipId: string): Promise<boolean>
  /** The selection, its connection and its household's zone; null when there is no such selection in a live household. */
  load(selectionId: string): Promise<CreateEventTarget | null>
  /** The connection's refresh token, or null when it can no longer be used (the member left, the household went). */
  secret(connectionId: string): Promise<string | null>
  /** Null when that provider's client id and secret are not configured on this server. */
  writers: { google: EventWriter | null; microsoft: EventWriter | null }
  updateSecret(connectionId: string, secret: string): Promise<void>
  setStatus(connectionId: string, status: ConnectionStatus): Promise<void>
  /** Audits the new event and clears this connection's entry in the events cache. */
  recordCreated(membershipId: string, selectionId: string): Promise<void>
  now(): Date
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

/** The HTTP status each provider failure answers with. */
const FAILURE_STATUS = { auth_expired: 422, calendar_gone: 410, unreachable: 502 } as const

function errorKind(e: unknown): string {
  if (e instanceof CalendarProviderError) return `${e.name}:${e.status}`
  return e instanceof Error ? e.name : 'error'
}

export function createCreateEventHandler(deps: CreateEventDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const body = await readJsonObject(req)
    const householdId = body?.householdId
    const selectionId = body?.selectionId
    if (!body || typeof householdId !== 'string' || !UUID_RE.test(householdId)) return json(400, { error: 'invalid_request' })
    if (typeof selectionId !== 'string' || !UUID_RE.test(selectionId)) return json(400, { error: 'invalid_request' })

    // A `pin` means a display acting on its open Settings session; without one the caller is an adult signed in at
    // /manage. `membershipId` alone is ignored: only a checked PIN can name the acting membership.
    const pin = body.pin
    const pinMembershipId = body.membershipId
    const withPin = pin !== undefined && pin !== null
    if (withPin && (typeof pin !== 'string' || !pin || typeof pinMembershipId !== 'string' || !UUID_RE.test(pinMembershipId))) {
      return json(400, { error: 'invalid_request' })
    }

    let connectionId: string | null = null
    try {
      const membershipId = withPin
        ? await deps.requirePinMembership(req, householdId, pinMembershipId as string, pin as string)
        : await deps.requireFullSignInAdult(req, householdId)

      if (!(await deps.recordAttempt(membershipId))) return json(429, { error: 'rate_limited' })

      const target = await deps.load(selectionId)
      // A calendar of another household, or another adult's, is answered exactly as one that does not exist.
      if (!target || target.householdId !== householdId || target.ownerMembershipId !== membershipId) {
        return json(403, { error: 'forbidden' })
      }
      connectionId = target.connectionId
      if (target.gone) return json(410, { error: 'calendar_gone' })
      // A connection left over from a provider this build has switched off (`CALENDAR_PROVIDERS`). Its events are
      // still read by calendar-events, so the calendar does not break — but nothing may be written to it.
      if (target.provider !== 'ics' && !calendarProviderEnabled(target.provider)) return json(403, { error: 'provider_not_supported' })
      // A subscription link is one-way, and an account connected under the old read-only scopes cannot be written
      // to until its owner connects it again.
      if (target.provider === 'ics' || !target.canWrite) return json(403, { error: 'not_writable' })
      if (target.status !== 'ok') return json(FAILURE_STATUS[target.status], { error: target.status })

      const writer = deps.writers[target.provider]
      if (!writer) return json(503, { error: 'not_configured' })

      const draft = parseEventDraft(body, target.timeZone, deps.now())

      const refreshToken = await deps.secret(target.connectionId)
      if (refreshToken === null) return json(403, { error: 'forbidden' })

      const token = await writer.refresh(refreshToken, deps.now())
      if (token.refreshToken && token.refreshToken !== refreshToken) {
        // Saved before the write: the provider may already have invalidated the old one.
        await deps.updateSecret(target.connectionId, token.refreshToken)
      }
      await writer.createEvent(token.accessToken, target.externalCalendarId, draft)

      try {
        await deps.recordCreated(membershipId, selectionId)
      } catch (e) {
        // The event exists; only the audit row and the cache bump failed. The panel catches up within 5 minutes.
        console.warn(`calendar-create-event: could not record the new event of connection ${target.connectionId}: ${errorKind(e)}`)
      }

      return json(200, {
        created: true,
        selectionId,
        title: draft.title,
        startAt: draft.startAt.toISOString(),
        endAt: draft.endAt.toISOString(),
        allDay: draft.allDay,
        location: draft.location,
      })
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      if (e instanceof EventInputError) return json(400, { error: 'invalid_request' })
      if (e instanceof CalendarProviderError) {
        console.warn(`calendar-create-event: connection ${connectionId ?? '?'} failed: ${errorKind(e)}`)
        // Reconnecting is the only fix for an expired grant, so the connection is marked at once, as the events
        // function does. A `calendar_gone` is left to the events function, which knows which selection it was for.
        if (e.status === 'auth_expired' && connectionId) {
          try {
            await deps.setStatus(connectionId, 'auth_expired')
          } catch (err) {
            console.warn(`calendar-create-event: could not record the status of connection ${connectionId}: ${errorKind(err)}`)
          }
        }
        return json(FAILURE_STATUS[e.status], { error: e.status })
      }
      if ((e as { code?: unknown } | null)?.code === '42501') return json(403, { error: 'forbidden' })
      // Only the error's name and code: messages from lower layers could echo the title or the location.
      console.error('calendar-create-event: failed', errorKind(e), (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
