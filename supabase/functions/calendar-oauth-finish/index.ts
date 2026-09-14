/**
 * `calendar-oauth-finish` Edge Function (spec §5.5, §6.3): the signed-in adult who started a Google or Microsoft
 * connection finishes it, binding the consent to their own membership. See handler.ts for the contract.
 */
import { callerAuth, svc } from '../_shared/calendarDeno.ts'
import { createOAuthFinishHandler, type FinishOutcome } from './handler.ts'

interface FinishRow {
  outcome: 'ok' | 'invalid_attempt' | 'expired' | 'forbidden'
  connection_id: string | null
  label: string | null
  calendar_count: number | null
}

const handler = createOAuthFinishHandler({
  peekAttempt: async (attemptHash) => {
    const householdId = await svc<string | null>('svc_peek_calendar_oauth_attempt', { p_attempt_hash: attemptHash })
    return householdId ? { householdId } : null
  },
  requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
  finishAttempt: async (attemptHash, membershipId): Promise<FinishOutcome> => {
    const rows = await svc<FinishRow[]>('svc_finish_calendar_oauth_attempt', { p_attempt_hash: attemptHash, p_membership_id: membershipId })
    const row = rows[0]
    if (!row) return { outcome: 'invalid_attempt' }
    if (row.outcome === 'ok') return { outcome: 'ok', connectionId: row.connection_id!, label: row.label!, calendarCount: row.calendar_count ?? 0 }
    return { outcome: row.outcome }
  },
})

Deno.serve(handler)
