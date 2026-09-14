/**
 * `calendar-events` Edge Function (spec §5.5, §7.2, §11.2, §13): today's events for a household's displays, fetched
 * on request and kept in this isolate's memory for up to 5 minutes. Event data is never written to the database.
 * See handler.ts for the contract and collect.ts for the fetching rules.
 */
import type { ConnectionStatus } from '../_shared/calendarProvider.ts'
import { createIcsParser } from '../_shared/ics.ts'
import { ical } from '../_shared/icalModule.ts'
import { admin, callerAuth, fetchIcs, oauthClient, svc, waitUntil } from '../_shared/calendarDeno.ts'
import { collectDayEvents, createEventsMemory, type CalendarStore, type ConnectionRow, type SelectionRow } from './collect.ts'
import { createEventsHandler } from './handler.ts'
import { createIcsSource, createOAuthSource, type CalendarSources } from './sources.ts'

/** Module-level, so it lives as long as the isolate. Holds event data in memory only. */
const memory = createEventsMemory()

const sources: CalendarSources = {
  ics: createIcsSource((url, signal) => fetchIcs(url, signal), createIcsParser(ical)),
  google: createOAuthSource('google', fetch, oauthClient('google')),
  microsoft: createOAuthSource('microsoft', fetch, oauthClient('microsoft')),
}

function check<T>(what: string, result: { data: T; error: { code?: string } | null }): T {
  if (result.error) throw Object.assign(new Error(`${what} failed`), { code: result.error.code })
  return result.data
}

const store: CalendarStore = {
  async load(householdId) {
    const household = check(
      'households',
      await admin.from('households').select('time_zone').eq('id', householdId).is('deleted_at', null).maybeSingle(),
    )
    if (!household) return null
    const [connections, selections, members] = await Promise.all([
      // Explicit columns: never vault_secret_id.
      admin.from('calendar_connections').select('id, membership_id, provider, status').eq('household_id', householdId),
      admin
        .from('calendar_selections')
        .select('id, connection_id, external_calendar_id, assigned_membership_id, assigned_child_id')
        .eq('household_id', householdId)
        .eq('visible', true)
        .eq('gone', false),
      admin.from('memberships').select('id, display_name, color, left_at').eq('household_id', householdId),
    ])
    const memberRows = check('memberships', members) ?? []
    const selectionRows = check('calendar_selections', selections) ?? []
    const childIds = [...new Set(selectionRows.map((s) => s.assigned_child_id).filter((id): id is string => !!id))]
    const childRows = childIds.length ? (check('children', await admin.from('children').select('id, color').in('id', childIds)) ?? []) : []

    const names = new Map(memberRows.map((m) => [m.id, m.display_name]))
    return {
      timeZone: household.time_zone,
      connections: (check('calendar_connections', connections) ?? []).map(
        (c): ConnectionRow => ({
          id: c.id,
          provider: c.provider as ConnectionRow['provider'],
          status: c.status as ConnectionStatus,
          ownerName: names.get(c.membership_id) ?? '',
        }),
      ),
      selections: selectionRows.map(
        (s): SelectionRow => ({
          id: s.id,
          connectionId: s.connection_id,
          externalCalendarId: s.external_calendar_id,
          assignedMembershipId: s.assigned_membership_id,
          assignedChildId: s.assigned_child_id,
        }),
      ),
      memberColors: Object.fromEntries(memberRows.filter((m) => m.left_at === null).map((m) => [m.id, m.color])),
      childColors: Object.fromEntries(childRows.map((c) => [c.id, c.color])),
    }
  },
  secret: (connectionId) => svc<string | null>('svc_calendar_secret', { p_connection_id: connectionId }),
  updateSecret: (connectionId, secret) => svc<void>('svc_update_calendar_secret', { p_connection_id: connectionId, p_secret: secret }),
  setStatus: (connectionId, status) => svc<void>('svc_set_calendar_status', { p_connection_id: connectionId, p_status: status }),
  setSelectionGone: (selectionId) => svc<void>('svc_set_calendar_selection_gone', { p_selection_id: selectionId, p_gone: true }),
}

const handler = createEventsHandler({
  callerHousehold: (req, householdId) => callerAuth.callerHousehold(req, householdId),
  collect: (householdId, now) => collectDayEvents(householdId, { store, sources, memory, now, log: (m) => console.log(m), waitUntil }),
  now: () => new Date(),
})

Deno.serve(handler)
