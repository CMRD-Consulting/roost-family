/** Pure rules for Manage household (spec §7.10). */
import type { LocationQuery } from 'vue-router'
import { CalendarError } from '@/data/calendarApi'
import { SettingsError, type AdultMembershipRow } from '@/data/settingsApi'

export interface CalendarStatus {
  /** 'pending': a Google / Microsoft attempt came back and is being finished for the signed-in adult. */
  kind: 'pending' | 'connected' | 'error'
  message: string
}

export const CALENDAR_PENDING_MESSAGE = 'Finishing connecting your calendar…'
/** An OAuth attempt token as the callback sends it: URL-safe characters only. Anything else is ignored. */
const ATTEMPT_RE = /^[A-Za-z0-9_-]{16,256}$/

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

/** A valid attempt token, or null. */
export function validCalendarAttempt(value: unknown): string | null {
  return typeof value === 'string' && ATTEMPT_RE.test(value) ? value : null
}

/** The OAuth attempt from `?calendar=pending&attempt=…`, or null. */
export function calendarAttemptFromQuery(query: LocationQuery): string | null {
  return first(query.calendar) === 'pending' ? validCalendarAttempt(first(query.attempt)) : null
}

/**
 * `?calendar=pending&attempt=…`, `?calendar=connected` or `?calendar=error&reason=…`, from the calendar connection
 * callback. The reason is only ever matched against known values: the URL is not trusted text to show.
 */
export function calendarStatusFromQuery(query: LocationQuery): CalendarStatus | null {
  const calendar = first(query.calendar)
  if (calendar === 'pending') {
    return calendarAttemptFromQuery(query)
      ? { kind: 'pending', message: CALENDAR_PENDING_MESSAGE }
      : { kind: 'error', message: 'The calendar wasn’t connected. Try again.' }
  }
  if (calendar === 'connected') return { kind: 'connected', message: 'Your calendar is connected.' }
  if (calendar !== 'error') return null
  const reason = first(query.reason)
  const detail = reason !== null && Object.hasOwn(CALENDAR_ERROR_REASONS, reason) ? CALENDAR_ERROR_REASONS[reason] : null
  return { kind: 'error', message: detail ? `The calendar wasn’t connected: ${detail}` : 'The calendar wasn’t connected. Try again.' }
}

/** The query with the calendar status removed (after the banner is dismissed). */
export function withoutCalendarStatus(query: LocationQuery): LocationQuery {
  const { calendar: _calendar, reason: _reason, attempt: _attempt, ...rest } = query
  return rest
}

/** After `calendar-oauth-finish` succeeded. */
export function calendarConnectedMessage(label: string): string {
  const name = label.trim() || 'Your calendar'
  return `${name} connected — choose which calendars to show and who they belong to.`
}

/** `calendar-oauth-finish` failed, in the adult's words. */
export function calendarFinishMessage(error: unknown): string {
  const code = error instanceof CalendarError ? error.code : null
  switch (code) {
    case 'expired':
      return 'That took too long. Connect again.'
    case 'forbidden':
      return 'Sign in as the adult who started connecting.'
    case 'invalid_attempt':
      return 'That calendar connection didn’t finish. Connect again.'
    case 'network':
      return 'Couldn’t reach Roost Family to finish connecting your calendar. Check the connection and try again.'
    default:
      return 'The calendar wasn’t connected. Try again.'
  }
}

/** Whether a failed finish is worth trying again with the same attempt (the attempt itself may still be good). */
export function calendarFinishRetryable(error: unknown): boolean {
  const code = error instanceof CalendarError ? error.code : null
  return code !== 'expired' && code !== 'invalid_attempt'
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
