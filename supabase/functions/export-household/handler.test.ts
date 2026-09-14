// @vitest-environment node
// (Node rather than jsdom: fflate checks `instanceof Uint8Array`, and jsdom's TextEncoder returns another realm's.)
import * as fflate from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { zipExport, type ExportInput } from '../_shared/exportBuilder.ts'
import { ExportFailure, PHOTO_CAP_BYTES, createCallerExport, createExportHandler, type CallerExport, type ExportHandlerDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const EXPORT = 'eeeeeeee-0000-0000-0000-000000000001'
const PHOTO = '77777777-0000-0000-0000-000000000001'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/export-household'
const NOW = new Date('2026-09-14T16:00:00.000Z')

function input(): ExportInput {
  return {
    household: { id: HOUSEHOLD, name: 'Rivera', time_zone: 'America/New_York', dinner_tonight: 'Secret tacos' },
    members: [{ id: 'm1', role: 'owner', display_name: 'Sam' }],
    displays: [],
    children: [{ id: 'c1', name: 'Ivy' }],
    featureOverrides: [],
    routines: [],
    routineDayOverrides: [],
    routineProgress: [],
    medicines: [],
    doses: [],
    sleeps: [],
    feedings: [{ id: 'f1', child_id: 'c1', at: '2026-09-14T12:00:00Z', type: 'milk', note: 'Private note' }],
    stickerCategories: [],
    stickers: [],
    diapers: [],
    jots: [],
    groceries: [],
    sitterSessions: [],
    settingsAudit: [],
    photos: [{ id: PHOTO, storage_path: `${HOUSEHOLD}/${PHOTO}.jpg`, kind: 'avatar', added_at: '2026-09-01T00:00:00Z' }],
    calendarSelections: [],
  }
}

const pendingExport: CallerExport = { id: EXPORT, householdId: HOUSEHOLD, status: 'pending', expired: false, createdAt: '2026-09-14T15:59:00Z' }

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? ReturnType<typeof vi.fn<(...args: A) => R>> : T[K] }

function deps(overrides: Partial<ExportHandlerDeps> = {}): Mocked<ExportHandlerDeps> & { tasks: Promise<void>[] } {
  const tasks: Promise<void>[] = []
  return {
    tasks,
    callerExport: vi.fn(async () => pendingExport),
    claim: vi.fn(async () => ({ householdId: HOUSEHOLD, householdName: 'Rivera', timeZone: 'America/New_York', requesterEmail: 'sam@roost.test' })),
    readRows: vi.fn(async () => input()),
    downloadPhoto: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    zip: vi.fn((files, photos) => zipExport(files, photos, fflate)),
    stillClaimed: vi.fn(async () => true),
    upload: vi.fn(async () => {}),
    removeUpload: vi.fn(async () => {}),
    markReady: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    storagePath: vi.fn(async () => `${HOUSEHOLD}/${EXPORT}.zip`),
    signDownload: vi.fn(async () => `http://kong:8000/storage/v1/object/sign/exports/${HOUSEHOLD}/${EXPORT}.zip?token=signed&download=roost-export-2026-09-14.zip`),
    background: vi.fn((task: Promise<void>) => {
      tasks.push(task)
    }),
    now: () => NOW,
    appUrl: 'http://localhost:5173',
    emailConfigured: true,
    ...overrides,
  } as never
}

const post = (body: unknown, authorization: string | null = 'Bearer owner-jwt') =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body),
  })

afterEach(() => vi.restoreAllMocks())

describe('export-household: build', () => {
  it('answers 202 at once, then builds the ZIP, uploads it, marks it ready and emails the owner', async () => {
    const d = deps()
    const res = await createExportHandler(d)(post({ exportId: EXPORT }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ exportId: EXPORT, status: 'pending' })
    expect(d.callerExport).toHaveBeenCalledWith(expect.any(Request), EXPORT)
    expect(d.claim).toHaveBeenCalledWith(EXPORT)
    expect(d.tasks).toHaveLength(1)
    await d.tasks[0]

    expect(d.readRows).toHaveBeenCalledWith(HOUSEHOLD)
    expect(d.downloadPhoto).toHaveBeenCalledWith(`${HOUSEHOLD}/${PHOTO}.jpg`)
    const [path, bytes] = d.upload.mock.calls[0]!
    expect(path).toBe(`${HOUSEHOLD}/${EXPORT}.zip`)
    const entries = fflate.unzipSync(bytes)
    expect(Object.keys(entries).sort()).toEqual(
      ['README.txt', 'diapers.csv', 'doses.csv', 'feedings.csv', 'household.json', 'jots.csv', `photos/${PHOTO}.jpg`,
        'routine_progress.csv', 'settings_audit.csv', 'sitter_sessions.csv', 'sleeps.csv', 'stickers.csv'].sort(),
    )
    const json = JSON.parse(new TextDecoder().decode(entries['household.json']))
    expect(json).toMatchObject({ exportedAt: NOW.toISOString(), timeZone: 'America/New_York' })

    expect(d.markReady).toHaveBeenCalledWith(EXPORT, `${HOUSEHOLD}/${EXPORT}.zip`)
    expect(d.markFailed).not.toHaveBeenCalled()
    const message = d.sendEmail.mock.calls[0]![0]
    expect(message.to).toBe('sam@roost.test')
    expect(message.subject).toBe('Your Roost Family export is ready')
    expect(message.text).toContain(`http://localhost:5173/manage/export/${EXPORT}`)
    expect(message.text).not.toContain('Secret tacos')
    expect(message.text).not.toContain('Ivy')
    // Checked, uploaded, marked ready, then emailed: an email only ever goes out for an export that is ready.
    expect(d.stillClaimed).toHaveBeenCalledWith(EXPORT)
    expect(d.stillClaimed.mock.invocationCallOrder[0]!).toBeLessThan(d.upload.mock.invocationCallOrder[0]!)
    expect(d.upload.mock.invocationCallOrder[0]!).toBeLessThan(d.markReady.mock.invocationCallOrder[0]!)
    expect(d.markReady.mock.invocationCallOrder[0]!).toBeLessThan(d.sendEmail.mock.invocationCallOrder[0]!)
    expect(d.removeUpload).not.toHaveBeenCalled()
  })

  it('awaits the build when the runtime cannot run it in the background', async () => {
    let finished = false
    const d = deps({
      background: vi.fn((task: Promise<void>) => task.then(() => void (finished = true))),
    })
    const res = await createExportHandler(d)(post({ exportId: EXPORT }))
    expect(res.status).toBe(202)
    expect(finished).toBe(true)
    expect(d.markReady).toHaveBeenCalled()
  })

  it('marks the export failed with a short code on any error, without uploading, emailing or logging details', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ readRows: vi.fn(async () => Promise.reject(new Error('relation "doses" at Rivera: Secret tacos'))) })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    expect(d.markFailed).toHaveBeenCalledWith(EXPORT, 'internal')
    expect(d.upload).not.toHaveBeenCalled()
    expect(d.sendEmail).not.toHaveBeenCalled()
    expect(d.markReady).not.toHaveBeenCalled()
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/Rivera|Secret|doses/)
  })

  it('keeps an ExportFailure code (a ZIP over the upload limit is too_large)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ maxZipBytes: 10 })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    expect(d.markFailed).toHaveBeenCalledWith(EXPORT, 'too_large')
    expect(d.upload).not.toHaveBeenCalled()

    const d2 = deps({ upload: vi.fn(async () => Promise.reject(new ExportFailure('too_large'))) })
    await createExportHandler(d2)(post({ exportId: EXPORT }))
    await d2.tasks[0]
    expect(d2.markFailed).toHaveBeenCalledWith(EXPORT, 'too_large')
  })

  it('moves a ready export to failed (email_failed) and removes its file when the email cannot be sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ sendEmail: vi.fn(async () => Promise.reject(new Error('smtp down'))) })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    expect(d.markReady).toHaveBeenCalled()
    expect(d.markFailed).toHaveBeenCalledWith(EXPORT, 'email_failed')
    expect(d.markReady.mock.invocationCallOrder[0]!).toBeLessThan(d.markFailed.mock.invocationCallOrder[0]!)
    expect(d.removeUpload).toHaveBeenCalledWith(`${HOUSEHOLD}/${EXPORT}.zip`)
  })

  it('uploads nothing and sends nothing when the export is no longer claimed just before the upload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ stillClaimed: vi.fn(async () => false) })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    expect(d.upload).not.toHaveBeenCalled()
    expect(d.markReady).not.toHaveBeenCalled()
    expect(d.sendEmail).not.toHaveBeenCalled()
    expect(d.markFailed).not.toHaveBeenCalled()
  })

  it('deletes the uploaded file and sends no email when marking it ready fails (purged or household deleted meanwhile)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ markReady: vi.fn(async () => Promise.reject(Object.assign(new Error('svc_mark_export_ready failed'), { code: '22023' }))) })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    expect(d.upload).toHaveBeenCalled()
    expect(d.removeUpload).toHaveBeenCalledWith(`${HOUSEHOLD}/${EXPORT}.zip`)
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('still finishes when removing the file after a failure also fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({
      markReady: vi.fn(async () => Promise.reject(new Error('gone'))),
      removeUpload: vi.fn(async () => Promise.reject(new Error('storage down'))),
    })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await expect(d.tasks[0]).resolves.toBeUndefined()
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('caps photos at 30 MiB by default', () => {
    expect(PHOTO_CAP_BYTES).toBe(30 * 1024 * 1024)
  })

  it('leaves photos out past the cap and says so in README.txt', async () => {
    const d = deps({ photoCapBytes: 2 })
    await createExportHandler(d)(post({ exportId: EXPORT }))
    await d.tasks[0]
    const entries = fflate.unzipSync(d.upload.mock.calls[0]![1])
    expect(Object.keys(entries)).not.toContain(`photos/${PHOTO}.jpg`)
    expect(new TextDecoder().decode(entries['README.txt'])).toContain('1 photo was not included')
  })

  it('rejects a caller who is not a full sign-in owner of the export’s household, before claiming', async () => {
    for (const status of [401, 403] as const) {
      const d = deps({ callerExport: vi.fn(async () => Promise.reject(new AuthError(status, 'forbidden'))) })
      const res = await createExportHandler(d)(post({ exportId: EXPORT }))
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: 'forbidden' })
      expect(d.claim).not.toHaveBeenCalled()
      expect(d.background).not.toHaveBeenCalled()
    }
  })

  it('rejects an export that is not pending, or already claimed', async () => {
    for (const status of ['ready', 'failed'] as const) {
      const d = deps({ callerExport: vi.fn(async () => ({ ...pendingExport, status })) })
      const res = await createExportHandler(d)(post({ exportId: EXPORT }))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'not_pending' })
      expect(d.claim).not.toHaveBeenCalled()
    }
    const d = deps({ claim: vi.fn(async () => null) })
    const res = await createExportHandler(d)(post({ exportId: EXPORT }))
    expect(res.status).toBe(409)
    expect(d.background).not.toHaveBeenCalled()
  })

  it('refuses to claim anything when APP_URL or SMTP is not configured, and marks the export failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const overrides of [{ appUrl: null }, { emailConfigured: false }]) {
      const d = deps(overrides)
      const res = await createExportHandler(d)(post({ exportId: EXPORT }))
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'not_configured' })
      expect(d.claim).not.toHaveBeenCalled()
      expect(d.markFailed).toHaveBeenCalledWith(EXPORT, 'not_configured')
    }
    const d = deps({ appUrl: null, markFailed: vi.fn(async () => Promise.reject(new Error('db down'))) })
    expect((await createExportHandler(d)(post({ exportId: EXPORT }))).status).toBe(503)
  })

  it('rejects bad requests', async () => {
    const d = deps()
    for (const body of [{}, { exportId: 'nope' }, { exportId: EXPORT, action: 'delete' }, null]) {
      const res = await createExportHandler(d)(post(body))
      expect(res.status).toBe(400)
    }
    expect((await createExportHandler(d)(new Request(ENDPOINT, { method: 'GET' }))).status).toBe(405)
    expect((await createExportHandler(d)(new Request(ENDPOINT, { method: 'OPTIONS' }))).status).toBe(200)
    expect(d.callerExport).not.toHaveBeenCalled()
  })
})

describe('export-household: download', () => {
  const readyExport: CallerExport = { ...pendingExport, status: 'ready' }

  it('returns a 10-minute signed path for a ready, unexpired export', async () => {
    const d = deps({ callerExport: vi.fn(async () => readyExport) })
    const res = await createExportHandler(d)(post({ exportId: EXPORT, action: 'download' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      path: `/storage/v1/object/sign/exports/${HOUSEHOLD}/${EXPORT}.zip?token=signed&download=roost-export-2026-09-14.zip`,
      expiresAt: '2026-09-14T16:10:00.000Z',
    })
    expect(d.signDownload).toHaveBeenCalledWith(`${HOUSEHOLD}/${EXPORT}.zip`, 600, 'roost-export-2026-09-14.zip')
    expect(d.claim).not.toHaveBeenCalled()
  })

  it('refuses expired, failed and pending exports, and non-owners', async () => {
    const cases: [CallerExport, number, string][] = [
      [{ ...readyExport, expired: true }, 410, 'expired'],
      [{ ...pendingExport, status: 'failed' }, 410, 'failed'],
      [pendingExport, 409, 'not_ready'],
    ]
    for (const [row, status, error] of cases) {
      const d = deps({ callerExport: vi.fn(async () => row) })
      const res = await createExportHandler(d)(post({ exportId: EXPORT, action: 'download' }))
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error })
      expect(d.signDownload).not.toHaveBeenCalled()
    }
    const d = deps({ callerExport: vi.fn(async () => Promise.reject(new AuthError(403, 'forbidden'))) })
    expect((await createExportHandler(d)(post({ exportId: EXPORT, action: 'download' }))).status).toBe(403)
    expect(d.signDownload).not.toHaveBeenCalled()
  })

  it('answers 410 expired when the file path is gone', async () => {
    const d = deps({ callerExport: vi.fn(async () => readyExport), storagePath: vi.fn(async () => null) })
    const res = await createExportHandler(d)(post({ exportId: EXPORT, action: 'download' }))
    expect(res.status).toBe(410)
  })
})

describe('createCallerExport', () => {
  const req = (authorization: string | null) =>
    new Request(ENDPOINT, { method: 'POST', headers: authorization ? { Authorization: authorization } : {} })
  const client = (result: { data: unknown; error: { code?: string; message: string } | null }) => {
    const rpc = vi.fn(async () => result)
    return { factory: vi.fn(() => ({ rpc })), rpc }
  }

  it('asks my_household_export with the caller\u2019s own Authorization header', async () => {
    const c = client({
      data: [{ id: EXPORT, household_id: HOUSEHOLD, status: 'ready', expired: false, created_at: '2026-09-14T15:59:00+00:00' }],
      error: null,
    })
    const row = await createCallerExport(c.factory)(req('Bearer owner-jwt'), EXPORT)
    expect(c.factory).toHaveBeenCalledWith('Bearer owner-jwt')
    expect(c.rpc).toHaveBeenCalledWith('my_household_export', { p_export_id: EXPORT })
    expect(row).toEqual({ id: EXPORT, householdId: HOUSEHOLD, status: 'ready', expired: false, createdAt: '2026-09-14T15:59:00+00:00' })
  })

  it('maps missing JWTs to 401 and refusals to 403', async () => {
    await expect(createCallerExport(client({ data: null, error: null }).factory)(req(null), EXPORT)).rejects.toMatchObject({ status: 401 })
    await expect(createCallerExport(client({ data: null, error: { code: 'PGRST301', message: 'jwt expired' } }).factory)(req('Bearer x'), EXPORT))
      .rejects.toMatchObject({ status: 401 })
    await expect(createCallerExport(client({ data: null, error: { code: '42501', message: 'export not found' } }).factory)(req('Bearer x'), EXPORT))
      .rejects.toMatchObject({ status: 403 })
    await expect(createCallerExport(client({ data: [], error: null }).factory)(req('Bearer x'), EXPORT)).rejects.toMatchObject({ status: 403 })
    await expect(createCallerExport(client({ data: null, error: { code: '08000', message: 'down' } }).factory)(req('Bearer x'), EXPORT))
      .rejects.not.toBeInstanceOf(AuthError)
  })
})
