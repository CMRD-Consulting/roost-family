/**
 * HTTP handling for `calendar-connect-ics`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId, url } with a full sign-in adult's JWT.
 *   200 { connectionId, selectionId, name }
 *   400 { error: 'invalid_request' }  body is not { householdId: uuid, url }
 *   400 { error: 'invalid_url' }      not https/webcal, credentials, a non-default port, or a non-public host
 *                                     (also for a redirect to one)
 *   401/403 { error: 'forbidden' }    not a full sign-in owner or adult of the household
 *   413 { error: 'too_large' }        over 1 MB
 *   422 { error: 'not_a_calendar' }   the response is not an iCalendar file
 *   502 { error: 'unreachable' }      network failure, timeout, or an HTTP error (including a revoked link)
 *   500 { error: 'internal' }
 *
 * The URL is fetched and parsed before anything is stored. The connection is created for the caller's own membership
 * (from the JWT check, never the body) with the normalized URL as its Vault secret, and one selection (external id
 * `ics`) that stays hidden and unassigned until the adult assigns it in Settings. The label is the calendar's name,
 * never the URL. The URL is never logged or returned.
 */
import { AuthError } from '../_shared/auth.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import { IcsParseError } from '../_shared/ics.ts'
import { IcsFetchError, normalizeIcsUrl } from '../_shared/icsFetch.ts'

const METHODS = 'POST'
export const DEFAULT_ICS_LABEL = 'Calendar subscription'
const LABEL_MAX = 200

export interface ConnectIcsDeps {
  /** The caller's membership id when they are a full sign-in owner or adult; throws AuthError otherwise. */
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
  allowPrivateHosts: boolean
  /** Fetches a normalized URL with the SSRF, size, redirect and time limits (`fetchIcsText`). */
  fetchIcs(url: URL): Promise<string>
  /** `X-WR-CALNAME` or null; throws IcsParseError when the text is not an iCalendar. */
  readCalendarName(text: string): string | null
  /** Throws an error with `code: '42501'` when the membership may no longer connect calendars. */
  createConnection(input: { householdId: string; membershipId: string; label: string; secret: string }): Promise<string>
  addSelection(input: { connectionId: string; externalCalendarId: string; name: string }): Promise<string>
}

/** The connection label: the calendar's name (whitespace collapsed, at most 200 characters), never anything URL-like. */
export function icsLabel(name: string | null, url: URL): string {
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return DEFAULT_ICS_LABEL
  const lower = cleaned.toLowerCase()
  const looksLikeUrl = /[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) || (url.pathname.length > 1 && lower.includes(url.pathname.toLowerCase()))
  if (looksLikeUrl) return DEFAULT_ICS_LABEL
  return cleaned.slice(0, LABEL_MAX).trim()
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

export function createConnectIcsHandler(deps: ConnectIcsDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const body = await readJsonObject(req)
    const householdId = body?.householdId
    if (!body || typeof householdId !== 'string' || !UUID_RE.test(householdId)) return json(400, { error: 'invalid_request' })

    try {
      const membershipId = await deps.requireFullSignInAdult(req, householdId)

      const url = normalizeIcsUrl(body.url, { allowPrivateHosts: deps.allowPrivateHosts })
      const text = await deps.fetchIcs(url)
      const label = icsLabel(deps.readCalendarName(text), url)

      const connectionId = await deps.createConnection({ householdId, membershipId, label, secret: url.href })
      const selectionId = await deps.addSelection({ connectionId, externalCalendarId: 'ics', name: label })
      return json(200, { connectionId, selectionId, name: label })
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      if (e instanceof IcsFetchError) {
        switch (e.code) {
          case 'invalid_url':
          case 'blocked_host':
            return json(400, { error: 'invalid_url' })
          case 'too_large':
            return json(413, { error: 'too_large' })
          default:
            return json(502, { error: 'unreachable' })
        }
      }
      if (e instanceof IcsParseError) return json(422, { error: 'not_a_calendar' })
      if ((e as { code?: unknown } | null)?.code === '42501') return json(403, { error: 'forbidden' })
      // Only the error's name and code: messages from lower layers could echo the request.
      console.error('calendar-connect-ics: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
