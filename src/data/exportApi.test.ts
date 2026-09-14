import { describe, expect, it, vi } from 'vitest'
import { SettingsError } from './settingsApi'
import { ExportError, exportDownloadUrl, exportStatus, requestExport } from './exportApi'
import type { RoostClient } from './supabase'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const EXPORT = 'eeeeeeee-0000-0000-0000-000000000001'
const SUPABASE = 'http://127.0.0.1:55321'

function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  }
}

function client(opts: { rpc?: unknown; invoke?: unknown } = {}) {
  const rpc = vi.fn(async () => opts.rpc ?? { data: EXPORT, error: null, status: 200 })
  const invoke = vi.fn(async () => opts.invoke ?? { data: { exportId: EXPORT, status: 'pending' }, error: null })
  return { c: { rpc, functions: { invoke } } as unknown as RoostClient, rpc, invoke }
}

describe('requestExport', () => {
  it('records the export, then asks the export function to build it', async () => {
    const { c, rpc, invoke } = client()
    await expect(requestExport(c, HOUSEHOLD)).resolves.toBe(EXPORT)
    expect(rpc).toHaveBeenCalledWith('request_household_export', { p_household_id: HOUSEHOLD })
    expect(invoke).toHaveBeenCalledWith('export-household', { body: { exportId: EXPORT } })
    expect(rpc.mock.invocationCallOrder[0]!).toBeLessThan(invoke.mock.invocationCallOrder[0]!)
  })

  it('maps the hourly limit to the minutes left, as a validation error', async () => {
    const { c, invoke } = client({
      rpc: { data: null, status: 400, error: { code: 'RL001', message: 'an export was requested less than an hour ago', details: 'retry_after_minutes=42' } },
    })
    const e = await requestExport(c, HOUSEHOLD).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ExportError)
    expect(e).toBeInstanceOf(SettingsError)
    expect(e).toMatchObject({ reason: 'rate_limited', code: 'invalid', retryAfterMinutes: 42, message: 'You can request another export in 42 minutes.' })
    expect(invoke).not.toHaveBeenCalled()

    const one = client({ rpc: { data: null, status: 400, error: { code: 'RL001', message: 'x', details: 'retry_after_minutes=1' } } })
    await expect(requestExport(one.c, HOUSEHOLD)).rejects.toMatchObject({ message: 'You can request another export in 1 minute.' })
  })

  it('maps a refusal, an ended sign-in and a lost connection', async () => {
    const refused = client({ rpc: { data: null, status: 403, error: { code: '42501', message: 'only an owner can export the household' } } })
    await expect(requestExport(refused.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'forbidden', code: 'auth' })

    const ended = client({ rpc: { data: null, status: 401, error: { code: 'PGRST301', message: 'JWT expired' } } })
    await expect(requestExport(ended.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'session', code: 'network', status: 401 })

    const offline = client({ rpc: { data: null, status: 0, error: { message: 'TypeError: Failed to fetch' } } })
    await expect(requestExport(offline.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'network', code: 'network' })
  })

  it('maps function failures after the export was recorded', async () => {
    const notConfigured = client({ invoke: { data: null, error: httpError(503, { error: 'not_configured' }) } })
    await expect(requestExport(notConfigured.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'not_configured', message: 'Export isn’t set up on this server yet.' })

    const forbidden = client({ invoke: { data: null, error: httpError(403, { error: 'forbidden' }) } })
    await expect(requestExport(forbidden.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'forbidden', code: 'auth' })

    // The export was recorded but never started: say so, rather than the hourly limit the owner would hit next.
    const started = 'We couldn’t start the export. Try again in a few minutes.'
    const offline = client({ invoke: { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } } })
    await expect(requestExport(offline.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'not_started', code: 'other', message: started })

    const thrown = client()
    thrown.invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(requestExport(thrown.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'not_started', message: started })

    const broken = client({ invoke: { data: null, error: httpError(500, { error: 'internal' }) } })
    await expect(requestExport(broken.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'not_started', message: started })

    const busy = client({ invoke: { data: null, error: httpError(409, { error: 'not_pending' }) } })
    await expect(requestExport(busy.c, HOUSEHOLD)).rejects.toMatchObject({ reason: 'not_started', message: started })
  })
})

describe('exportStatus', () => {
  it('reads the export through my_household_export', async () => {
    const row = {
      id: EXPORT, household_id: HOUSEHOLD, status: 'ready', error: null, created_at: '2026-09-14T15:00:00+00:00',
      ready_at: '2026-09-14T15:01:00+00:00', expires_at: '2026-09-15T15:01:00+00:00', expired: false,
    }
    const { c, rpc } = client({ rpc: { data: [row], error: null, status: 200 } })
    await expect(exportStatus(c, EXPORT)).resolves.toEqual({
      id: EXPORT, householdId: HOUSEHOLD, status: 'ready', expired: false, createdAt: row.created_at, readyAt: row.ready_at, expiresAt: row.expires_at,
    })
    expect(rpc).toHaveBeenCalledWith('my_household_export', { p_export_id: EXPORT })
  })

  it('treats a refusal or no row as not available', async () => {
    const refused = client({ rpc: { data: null, status: 403, error: { code: '42501', message: 'export not found' } } })
    await expect(exportStatus(refused.c, EXPORT)).rejects.toMatchObject({ reason: 'not_found' })
    const empty = client({ rpc: { data: [], error: null, status: 200 } })
    await expect(exportStatus(empty.c, EXPORT)).rejects.toMatchObject({ reason: 'not_found' })
  })
})

describe('exportDownloadUrl', () => {
  const PATH = `/storage/v1/object/sign/exports/${HOUSEHOLD}/${EXPORT}.zip?token=abc&download=roost-export-2026-09-14.zip`

  it('asks the export function for a signed path and makes it absolute on this app’s Supabase URL', async () => {
    const { c, invoke } = client({ invoke: { data: { path: PATH, expiresAt: '2026-09-14T16:10:00Z' }, error: null } })
    await expect(exportDownloadUrl(c, EXPORT, SUPABASE)).resolves.toBe(`${SUPABASE}${PATH}`)
    expect(invoke).toHaveBeenCalledWith('export-household', { body: { exportId: EXPORT, action: 'download' } })
  })

  it('refuses anything but a signed exports path', async () => {
    for (const path of ['https://evil.test/x.zip', '//evil.test/storage/v1/object/sign/exports/x.zip', '/storage/v1/object/public/exports/x.zip', null]) {
      const { c } = client({ invoke: { data: { path }, error: null } })
      await expect(exportDownloadUrl(c, EXPORT, SUPABASE)).rejects.toMatchObject({ reason: 'internal' })
    }
  })

  it('maps expired, failed, still-pending and not-owner answers', async () => {
    const cases: [number, string, string][] = [
      [410, 'expired', 'expired'],
      [410, 'failed', 'failed'],
      [409, 'not_ready', 'not_ready'],
      [403, 'forbidden', 'not_found'],
    ]
    for (const [status, error, reason] of cases) {
      const { c } = client({ invoke: { data: null, error: httpError(status, { error }) } })
      await expect(exportDownloadUrl(c, EXPORT, SUPABASE)).rejects.toMatchObject({ reason })
    }
  })
})
