/**
 * `calendar-connect-ics` Edge Function (spec §5.5, §6.3): a full sign-in adult subscribes the household to an ICS link.
 * See handler.ts for the request and response contract. The link is checked, fetched and parsed here, then stored
 * only in Vault, with its selection, through `svc_create_calendar_connection_with_selections`.
 */
import { createIcsParser } from '../_shared/ics.ts'
import { ical } from '../_shared/icalModule.ts'
import { allowPrivateHosts, callerAuth, fetchIcs, fingerprint, svc, type ConnectRow } from '../_shared/calendarDeno.ts'
import { createConnectIcsHandler } from './handler.ts'

const parser = createIcsParser(ical)

const handler = createConnectIcsHandler({
  requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
  allowPrivateHosts,
  fetchIcs: (url) => fetchIcs(url),
  readCalendarName: (text) => parser.readIcsCalendarName(text),
  fingerprint,
  recordConnectAttempt: (membershipId) => svc<boolean>('svc_record_calendar_connect_attempt', { p_membership_id: membershipId }),
  connect: async ({ householdId, membershipId, label, secret, fingerprint, calendars }) => {
    const rows = await svc<ConnectRow[]>('svc_create_calendar_connection_with_selections', {
      p_household_id: householdId,
      p_membership_id: membershipId,
      p_provider: 'ics',
      p_label: label,
      p_secret: secret,
      p_vault_secret_id: null,
      p_fingerprint: fingerprint,
      p_calendars: calendars,
    })
    const row = rows[0]!
    return {
      connectionId: row.connection_id,
      alreadyConnected: row.already_connected,
      label: row.label,
      selectionIds: row.selection_ids.filter((id): id is string => !!id),
    }
  },
})

Deno.serve(handler)
