/**
 * HTTP handling for `calendar-connect-ics`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId, url } with a full sign-in adult's JWT.
 *   200 { connectionId, selectionId, name, alreadyConnected }
 *                                     alreadyConnected: the caller had already connected this link; the existing
 *                                     connection is returned unchanged
 *   400 { error: 'invalid_request' }  body is not { householdId: uuid, url }
 *   400 { error: 'invalid_url' }      not https/webcal, credentials in the URL, or a non-default port
 *   401/403 { error: 'forbidden' }    not a full sign-in owner or adult of the household
 *   413 { error: 'too_large' }        the server declares a body over the 20 MB download budget (all but
 *                                     unreachable: only the header is read, and the read stops at the first VEVENT)
 *   422 { error: 'not_a_calendar' }   the response is not an iCalendar file
 *   422 { error: 'unreachable' }      network failure, timeout, an HTTP error (including a revoked link), or a host
 *                                     that is not public (deliberately the same answer, so internal names can't be
 *                                     probed; the log keeps the distinction)
 *   429 { error: 'rate_limited' }     more than 10 attempts by this member in the last hour
 *   503 { error: 'not_configured' }   CALENDAR_FINGERPRINT_KEY is not set
 *   500 { error: 'internal' }
 *
 * The URL is fetched and parsed before anything is stored. The connection is created for the caller's own membership
 * (from the JWT check, never the body), in one transaction with its single selection (external id `ics`, hidden and
 * unassigned until the adult assigns it in Settings). Its Vault secret is the normalized URL and its fingerprint the
 * HMAC of that URL, which makes connecting the same link twice return the existing connection. The label is the
 * calendar's name, never the URL. The URL is never logged or returned.
 */
import { AuthError } from '../_shared/auth.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import { IcsParseError } from '../_shared/ics.ts'
import { IcsFetchError, normalizeIcsUrl } from '../_shared/icsFetch.ts'

const METHODS = 'POST'
export const DEFAULT_ICS_LABEL = 'Calendar subscription'
const LABEL_MAX = 200

export interface ConnectIcsResult {
  connectionId: string
  alreadyConnected: boolean
  label: string
  /** Selection ids in the order of `calendars`. */
  selectionIds: string[]
}

export interface ConnectIcsDeps {
  /** The caller's membership id when they are a full sign-in owner or adult; throws AuthError otherwise. */
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
  allowPrivateHosts: boolean
  /**
   * Fetches a normalized URL with the SSRF, size, redirect and time limits (`fetchIcsFiltered`), reading only the
   * calendar header: connecting is about the link and its name, never its events.
   */
  fetchIcs(url: URL): Promise<string>
  /** `X-WR-CALNAME` or null; throws IcsParseError when the text is not an iCalendar. */
  readCalendarName(text: string): string | null
  /** HMAC-SHA256 hex of a value under the server's fingerprint key; null when no key is configured. */
  fingerprint: ((value: string) => Promise<string>) | null
  /** Records an attempt; false when the member has used up the hourly limit. */
  recordConnectAttempt(membershipId: string): Promise<boolean>
  /**
   * Creates the connection and its selections in one transaction, or returns the member's existing connection with
   * the same fingerprint. Throws an error with `code: '42501'` when the membership may no longer connect calendars.
   */
  connect(input: {
    householdId: string
    membershipId: string
    label: string
    secret: string
    fingerprint: string
    calendars: Array<{ id: string; name: string }>
  }): Promise<ConnectIcsResult>
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
      if (!deps.fingerprint) return json(503, { error: 'not_configured' })

      const url = normalizeIcsUrl(body.url, { allowPrivateHosts: deps.allowPrivateHosts })
      if (!(await deps.recordConnectAttempt(membershipId))) return json(429, { error: 'rate_limited' })
      const text = await deps.fetchIcs(url)
      const label = icsLabel(deps.readCalendarName(text), url)

      const result = await deps.connect({
        householdId,
        membershipId,
        label,
        secret: url.href,
        fingerprint: await deps.fingerprint(`ics:${url.href}`),
        calendars: [{ id: 'ics', name: label }],
      })
      return json(200, {
        connectionId: result.connectionId,
        selectionId: result.selectionIds[0] ?? null,
        name: result.label,
        alreadyConnected: result.alreadyConnected,
      })
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      if (e instanceof IcsFetchError) {
        if (e.code === 'invalid_url') return json(400, { error: 'invalid_url' })
        if (e.code === 'too_large') return json(413, { error: 'too_large' })
        console.warn(`calendar-connect-ics: fetch refused or failed (${e.code})`)
        return json(422, { error: 'unreachable' })
      }
      if (e instanceof IcsParseError) return json(422, { error: 'not_a_calendar' })
      if ((e as { code?: unknown } | null)?.code === '42501') return json(403, { error: 'forbidden' })
      // Only the error's name and code: messages from lower layers could echo the request.
      console.error('calendar-connect-ics: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
