/**
 * HTTP handling for `calendar-oauth-finish`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { attempt } with a full sign-in adult's JWT, where `attempt` is the token calendar-oauth-callback put in the
 * /manage redirect.
 *   200 { connectionId, calendars, label }  calendars: how many of the account's calendars were recorded (hidden and
 *                                            unassigned until the adult assigns them in Settings)
 *   400 { error: 'invalid_request' }   no attempt token of the right shape
 *   404 { error: 'invalid_attempt' }   unknown or already finished
 *   410 { error: 'expired' }           older than 15 minutes (it is deleted)
 *   403 { error: 'forbidden' }         the caller is not a full sign-in adult of the attempt's household, or is not
 *                                      the adult who started it (401 when there is no usable JWT)
 *   500 { error: 'internal' }
 *
 * This is what binds a consent to the right person: an attempt started by one adult and completed in someone else's
 * browser can only be finished by the adult who started it. A mismatched caller does not consume the attempt. On a
 * match the attempt is consumed and the connection and all its calendars are created in one transaction, moving the
 * refresh token's Vault secret to the connection; connecting the same provider account again updates the existing
 * connection's token instead.
 */
import { AuthError } from '../_shared/auth.ts'
import { jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import { sha256Hex } from '../_shared/pkce.ts'

const METHODS = 'POST'
const ATTEMPT_RE = /^[A-Za-z0-9_-]{43}$/

export type FinishOutcome =
  | { outcome: 'ok'; connectionId: string; label: string; calendarCount: number }
  | { outcome: 'invalid_attempt' | 'expired' | 'forbidden' }

export interface OAuthFinishDeps {
  /** The household of the attempt with this hash (expired or not), without consuming it; null when there is none. */
  peekAttempt(attemptHash: string): Promise<{ householdId: string } | null>
  /** The caller's membership id when they are a full sign-in owner or adult; throws AuthError otherwise. */
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
  /**
   * Atomically: unknown → invalid_attempt; expired → deleted, expired; another membership's → forbidden (kept);
   * otherwise consumed and connected.
   */
  finishAttempt(attemptHash: string, membershipId: string): Promise<FinishOutcome>
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

export function createOAuthFinishHandler(deps: OAuthFinishDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const token = (await readJsonObject(req))?.attempt
    if (typeof token !== 'string' || !ATTEMPT_RE.test(token)) return json(400, { error: 'invalid_request' })

    try {
      const attemptHash = await sha256Hex(token)
      const pending = await deps.peekAttempt(attemptHash)
      if (!pending) return json(404, { error: 'invalid_attempt' })
      const membershipId = await deps.requireFullSignInAdult(req, pending.householdId)

      const result = await deps.finishAttempt(attemptHash, membershipId)
      switch (result.outcome) {
        case 'ok':
          return json(200, { connectionId: result.connectionId, calendars: result.calendarCount, label: result.label })
        case 'invalid_attempt':
          return json(404, { error: 'invalid_attempt' })
        case 'expired':
          return json(410, { error: 'expired' })
        default:
          return json(403, { error: 'forbidden' })
      }
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      if ((e as { code?: unknown } | null)?.code === '42501') return json(403, { error: 'forbidden' })
      console.error('calendar-oauth-finish: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
