/** Pure rules for Manage household (spec §7.10). */
import type { LocationQuery } from 'vue-router'
import { SettingsError, type AdultMembershipRow } from '@/data/settingsApi'

export interface CalendarStatus {
  kind: 'connected' | 'error'
  message: string
}

/** Reasons the calendar OAuth callback may send back, in the adult's words. Anything else gets the generic line. */
const CALENDAR_ERROR_REASONS: Record<string, string> = {
  access_denied: 'access wasn’t allowed.',
  denied: 'access wasn’t allowed.',
  not_configured: 'that calendar provider isn’t set up yet.',
  expired_state: 'the connection took too long. Try again.',
  invalid_state: 'the connection took too long. Try again.',
}

function first(value: LocationQuery[string] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : null
}

/**
 * `?calendar=connected` or `?calendar=error&reason=…`, from the calendar connection callback. The reason is only
 * ever matched against known values: the URL is not trusted text to show.
 */
export function calendarStatusFromQuery(query: LocationQuery): CalendarStatus | null {
  const calendar = first(query.calendar)
  if (calendar === 'connected') return { kind: 'connected', message: 'Your calendar is connected.' }
  if (calendar !== 'error') return null
  const reason = first(query.reason)
  const detail = reason !== null && Object.hasOwn(CALENDAR_ERROR_REASONS, reason) ? CALENDAR_ERROR_REASONS[reason] : null
  return { kind: 'error', message: detail ? `The calendar wasn’t connected: ${detail}` : 'The calendar wasn’t connected. Try again.' }
}

/** The query with the calendar status removed (after the banner is dismissed). */
export function withoutCalendarStatus(query: LocationQuery): LocationQuery {
  const { calendar: _calendar, reason: _reason, ...rest } = query
  return rest
}

/** Which household to open at once: the one kept from before if still there, else the only one, else none (pick). */
export function initialSelection(memberships: AdultMembershipRow[], keepMembershipId: string | null = null): AdultMembershipRow | null {
  const kept = keepMembershipId === null ? undefined : memberships.find((m) => m.membershipId === keepMembershipId)
  return kept ?? (memberships.length === 1 ? memberships[0]! : null)
}

/**
 * True when a failure means the adult's sign-in itself has ended (an expired, missing or rejected token), not a
 * refusal of the action: a 401, the server's "adult sign-in required", or the auth client's own messages.
 */
export function isExpiredSession(error: unknown): boolean {
  if (error instanceof SettingsError && error.status === 401) return true
  if (!(error instanceof Error)) return false
  return /\bjwt\b|auth session missing|refresh token|adult sign-in required/i.test(error.message)
}

/** The refusal an owner or member action gets when the signed-in adult's role or membership may have changed. */
export function isPermissionRefusal(error: unknown): boolean {
  return error instanceof SettingsError && error.code === 'auth'
}
