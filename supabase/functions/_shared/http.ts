/**
 * Small HTTP helpers shared by the calendar Edge Functions. Displays run on their own origins (and localhost in
 * development); the JWT, not the origin, authorizes, so CORS allows any origin. Calendar responses are never cached
 * by browsers or proxies (`Cache-Control: no-store`): they carry event details or connection state.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function corsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': `${methods}, OPTIONS`,
  }
}

export function jsonResponse(status: number, body: unknown, methods: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(methods), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function preflight(methods: string): Response {
  return new Response('ok', { status: 200, headers: corsHeaders(methods) })
}

/** The JSON object body, or null when it is missing, malformed or not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
