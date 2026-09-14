/**
 * `calendar-connect-ics` Edge Function (spec §5.5, §6.3): a full sign-in adult subscribes the household to an ICS link.
 * See handler.ts for the request and response contract. The link is checked, fetched and parsed here, then stored
 * only in Vault through `svc_create_calendar_connection`.
 */
import { createIcsParser } from '../_shared/ics.ts'
import { ical } from '../_shared/icalModule.ts'
import { allowPrivateHosts, callerAuth, fetchIcs, svc } from '../_shared/calendarDeno.ts'
import { createConnectIcsHandler } from './handler.ts'

const parser = createIcsParser(ical)

const handler = createConnectIcsHandler({
  requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
  allowPrivateHosts,
  fetchIcs: (url) => fetchIcs(url),
  readCalendarName: (text) => parser.readIcsCalendarName(text),
  createConnection: ({ householdId, membershipId, label, secret }) =>
    svc<string>('svc_create_calendar_connection', {
      p_household_id: householdId,
      p_membership_id: membershipId,
      p_provider: 'ics',
      p_label: label,
      p_secret: secret,
    }),
  addSelection: ({ connectionId, externalCalendarId, name }) =>
    svc<string>('svc_add_calendar_selection', {
      p_connection_id: connectionId,
      p_external_calendar_id: externalCalendarId,
      p_name: name,
      p_visible: false,
      p_assigned_membership_id: null,
      p_assigned_child_id: null,
    }),
})

Deno.serve(handler)
