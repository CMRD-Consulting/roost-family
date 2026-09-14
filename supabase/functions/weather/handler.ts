/**
 * HTTP handling for the `weather` Edge Function, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId } with the caller's JWT → { status, stale, weather }. The gateway has already verified the
 * JWT (verify_jwt); `isMember` checks the caller belongs to the household before any refresh.
 */
import type { RefreshResult } from './refresh.ts'

export interface WeatherHandlerDeps {
  /** True when the caller (identified by the Authorization header) is a member or display of the household. */
  isMember(authorization: string, householdId: string): Promise<boolean>
  refresh(householdId: string, now: Date): Promise<RefreshResult>
  now(): Date
}

// Displays run on their own origins (and localhost in development); the JWT, not the origin, authorizes.
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function createWeatherHandler(deps: WeatherHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS })
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

    const authorization = req.headers.get('Authorization')
    if (!authorization) return json(401, { error: 'sign-in required' })

    let householdId: unknown
    try {
      householdId = ((await req.json()) as { householdId?: unknown } | null)?.householdId
    } catch {
      return json(400, { error: 'invalid JSON body' })
    }
    if (typeof householdId !== 'string' || !UUID_RE.test(householdId)) {
      return json(400, { error: 'householdId must be a UUID' })
    }

    try {
      if (!(await deps.isMember(authorization, householdId))) {
        return json(403, { error: 'not a member of this household' })
      }
      const result = await deps.refresh(householdId, deps.now())
      if (result.status === 'not_found') return json(404, { error: 'household not found' })
      if (result.status === 'no_location') return json(200, { status: 'no_location', stale: false, weather: null })
      return json(200, result)
    } catch (e) {
      console.error('weather: request failed', e)
      return json(500, { error: 'weather refresh failed' })
    }
  }
}
