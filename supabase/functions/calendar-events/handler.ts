/**
 * HTTP handling for `calendar-events`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * GET ?householdId=<uuid>[&days=2], or POST { householdId[, days: 2] }, with the JWT of a display or member of the
 * household. `days` is 1 (the default) or 2: a client has to ask for tomorrow, because one that doesn't know about it
 * shows everything it is sent as today.
 *   200 { events, connections, partial, generatedAt }
 *       events:      [{ title, startAt, endAt, allDay, location, personType: 'member' | 'child', personId, calendarColor }]
 *                    today in the household's zone (including events already in progress), and tomorrow with days=2,
 *                    all-day first, then by start
 *       connections: [{ id, ownerName, status: 'ok' | 'auth_expired' | 'unreachable' }] for connections with at least
 *                    one shown calendar
 *       partial:     true when any connection failed or was cut off, so some events may be missing
 *   400 { error: 'invalid_request' }  401/403 { error: 'forbidden' }  404 { error: 'not_found' }  500 { error: 'internal' }
 * Every response has `Cache-Control: no-store`. Nothing about events is stored or logged.
 */
import { AuthError, type Caller } from '../_shared/auth.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import type { EventDays } from '../_shared/events.ts'
import type { EventsResponse } from './collect.ts'

const METHODS = 'GET, POST'

export interface EventsHandlerDeps {
  callerHousehold(req: Request, householdId: string): Promise<Caller>
  collect(householdId: string, now: Date, days: EventDays): Promise<EventsResponse | null>
  now(): Date
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

export function createEventsHandler(deps: EventsHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    let householdId: unknown
    let days: unknown
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams
      householdId = params.get('householdId')
      const asked = params.get('days')
      days = asked === null ? 1 : asked === '1' ? 1 : asked === '2' ? 2 : asked
    } else if (req.method === 'POST') {
      const body = await readJsonObject(req)
      householdId = body?.householdId
      days = body && 'days' in body ? body.days : 1
    } else return json(405, { error: 'method_not_allowed' })
    if (typeof householdId !== 'string' || !UUID_RE.test(householdId)) return json(400, { error: 'invalid_request' })
    if (days !== 1 && days !== 2) return json(400, { error: 'invalid_request' })

    try {
      await deps.callerHousehold(req, householdId)
      const result = await deps.collect(householdId, deps.now(), days)
      if (!result) return json(404, { error: 'not_found' })
      return json(200, result)
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      console.error('calendar-events: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
