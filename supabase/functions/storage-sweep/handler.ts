/**
 * HTTP handling for the `storage-sweep` Edge Function, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST (optional JSON body `{ minAgeMinutes }`, default 60) with `Authorization: Bearer <service role key>` → the sweep
 * report. Only the service role may call it (a scheduled job or an operator); every other caller gets 401 before
 * anything is read. Not meant for browsers, so no CORS.
 */
import { isServiceCaller, parseSweepOptions, type SweepOptions, type SweepReport } from '../_shared/sweep.ts'

export interface SweepHandlerDeps {
  /** Bearer tokens accepted as the service role (empty entries are ignored). */
  serviceKeys: string[]
  sweep(options: SweepOptions, now: Date): Promise<SweepReport>
  now(): Date
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function createSweepHandler(deps: SweepHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!isServiceCaller(req.headers.get('Authorization'), deps.serviceKeys)) return json(401, { error: 'service role required' })
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

    let body: unknown = null
    const text = await req.text()
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text)
      } catch {
        return json(400, { error: 'invalid JSON body' })
      }
    }
    const options = parseSweepOptions(body)
    if (options === null) return json(400, { error: 'minAgeMinutes must be a whole number of minutes from 0 to 10080' })

    try {
      return json(200, await deps.sweep(options, deps.now()))
    } catch (e) {
      console.error('storage-sweep: failed', e)
      return json(500, { error: 'storage sweep failed' })
    }
  }
}
