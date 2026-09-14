/**
 * HTTP handling for `export-household` (spec §6.3, §11.3), kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { exportId, action?: 'build' | 'download' } with the JWT of a full sign-in owner of the export's household
 * (checked through `my_household_export` with the caller's own JWT, so the SQL rules decide).
 *
 * action 'build' (default), called by Manage household right after `request_household_export`:
 *   202 { exportId, status: 'pending' }   the export was claimed; it is built after the response (see `background`)
 *   409 { error: 'not_pending' }          already building, ready or failed
 *   503 { error: 'not_configured' }       APP_URL or the SMTP settings are missing (nothing is claimed)
 * The build reads the household's rows (exact `EXPORT_TABLES` columns) and photo files with the service role, zips
 * them (`buildExportFiles` + `zipExport`), uploads `exports/<household>/<export>.zip`, emails the requesting owner a
 * link to `${APP_URL}/manage/export/<id>`, then marks the export ready. Any failure marks it failed with a short code:
 * `too_large` (the ZIP is over the upload limit), `email_failed`, or `internal`.
 *
 * action 'download', called by /manage/export/:id after the owner signs in:
 *   200 { path, expiresAt }   a signed Storage URL path valid for 10 minutes, relative to the Supabase URL (the
 *                             browser prefixes its own Supabase URL: inside the local runtime SUPABASE_URL is not the
 *                             browser-facing one)
 *   409 { error: 'not_ready' }   still pending
 *   410 { error: 'expired' | 'failed' }
 *
 * Both actions:
 *   400 { error: 'invalid_request' }   401/403 { error: 'forbidden' }   500 { error: 'internal' }
 *
 * Memory: photos are capped at 40 MB per export (`PHOTO_CAP_BYTES`); the ZIP holds them uncompressed plus the
 * compressed data files, and the build keeps photos and ZIP in memory together, so the peak stays around 100 MB. Photos
 * past the cap are left out and README.txt says how many. A ZIP over 50 MiB (the project's upload limit) fails as
 * `too_large`. Logs carry only error names and codes, never household data.
 */
import { AuthError, type CallerClientFactory } from '../_shared/auth.ts'
import { buildExportFiles, type ExportFiles, type ExportInput } from '../_shared/exportBuilder.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import { collectPhotos, photoNote } from './collect.ts'
import { exportReadyEmail } from './email.ts'

const METHODS = 'POST'
export const PHOTO_CAP_BYTES = 40 * 1024 * 1024
export const MAX_ZIP_BYTES = 50 * 1024 * 1024
export const DOWNLOAD_URL_SECONDS = 600

/** The export as `my_household_export` returns it to the caller. */
export interface CallerExport {
  id: string
  householdId: string
  status: 'pending' | 'ready' | 'failed'
  expired: boolean
  createdAt: string
}

/** What `svc_claim_household_export` returns. */
export interface ClaimedExport {
  householdId: string
  householdName: string
  timeZone: string
  requesterEmail: string
}

/** A known failure with the short code stored on the export. */
export class ExportFailure extends Error {
  constructor(readonly code: 'too_large' | 'email_failed' | 'internal') {
    super(code)
    this.name = 'ExportFailure'
  }
}

export interface ExportHandlerDeps {
  /** The export, when the caller is a full sign-in owner of its household; throws AuthError otherwise. */
  callerExport(req: Request, exportId: string): Promise<CallerExport>
  /** Claims a pending export (once); null when it can't be claimed. */
  claim(exportId: string): Promise<ClaimedExport | null>
  readRows(householdId: string): Promise<ExportInput>
  /** A photo file's bytes; null when the file is missing. */
  downloadPhoto(path: string): Promise<Uint8Array | null>
  zip(files: ExportFiles, photos: readonly { path: string; bytes: Uint8Array }[]): Uint8Array
  /** Uploads to the exports bucket; throws ExportFailure('too_large') when Storage refuses the size. */
  upload(path: string, bytes: Uint8Array): Promise<void>
  markReady(exportId: string, path: string): Promise<void>
  markFailed(exportId: string, code: string): Promise<void>
  sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<void>
  /** The ready export's object path, or null. */
  storagePath(exportId: string): Promise<string | null>
  /** An absolute signed URL for the object, valid for `seconds`, that downloads as `fileName`. */
  signDownload(path: string, seconds: number, fileName: string): Promise<string>
  /** Runs the build after the response when the runtime can (EdgeRuntime.waitUntil); otherwise returns the task to
   *  await before responding. */
  background(task: Promise<void>): Promise<void> | void
  now(): Date
  /** Origin and base path of the web app, without a trailing slash; null when APP_URL isn't configured. */
  appUrl: string | null
  /** False when the SMTP settings are missing. */
  emailConfigured: boolean
  photoCapBytes?: number
  maxZipBytes?: number
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

// PostgREST: PGRST301 (JWT invalid or expired), PGRST302 (anonymous access not allowed), PGRST303 (JWT claims invalid).
const JWT_ERRORS = new Set(['PGRST301', 'PGRST302', 'PGRST303'])

/**
 * `callerExport` over `my_household_export`, called with a client carrying the caller's own Authorization header:
 * 401 without a usable JWT, 403 when the database refuses (not a full sign-in owner of the household, or no such
 * export).
 */
export function createCallerExport(callerClient: CallerClientFactory): ExportHandlerDeps['callerExport'] {
  return async (req, exportId) => {
    const authorization = req.headers.get('Authorization')
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new AuthError(401, 'sign-in required')
    const { data, error } = await callerClient(authorization).rpc('my_household_export', { p_export_id: exportId })
    if (error) {
      if (error.code && JWT_ERRORS.has(error.code)) throw new AuthError(401, 'sign-in required')
      if (error.code === '42501') throw new AuthError(403, 'forbidden')
      throw Object.assign(new Error('my_household_export failed'), { code: error.code })
    }
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
    if (!row || row.id !== exportId || typeof row.household_id !== 'string') throw new AuthError(403, 'forbidden')
    const status = row.status
    if (status !== 'pending' && status !== 'ready' && status !== 'failed') throw new AuthError(403, 'forbidden')
    return { id: exportId, householdId: row.household_id, status, expired: row.expired === true, createdAt: String(row.created_at) }
  }
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'error'
}

/** Builds, uploads and emails one claimed export, marking it ready or failed. Never throws. */
export async function runExport(deps: ExportHandlerDeps & { appUrl: string }, exportId: string, claimed: ClaimedExport): Promise<void> {
  const cap = deps.photoCapBytes ?? PHOTO_CAP_BYTES
  const path = `${claimed.householdId}/${exportId}.zip`
  let stage = 'build'
  try {
    const rows = await deps.readRows(claimed.householdId)
    const photos = await collectPhotos(rows.photos, (p) => deps.downloadPhoto(p), cap)
    const files = buildExportFiles(rows, { timeZone: claimed.timeZone, exportedAt: deps.now().toISOString() })
    const note = photoNote(photos, cap)
    if (note) files['README.txt'] = `${files['README.txt']}\r\n${note}`
    const bytes = deps.zip(files, photos.files)
    if (bytes.length > (deps.maxZipBytes ?? MAX_ZIP_BYTES)) throw new ExportFailure('too_large')

    stage = 'upload'
    await deps.upload(path, bytes)

    stage = 'email'
    const email = exportReadyEmail({ householdName: claimed.householdName, link: `${deps.appUrl}/manage/export/${exportId}` })
    try {
      await deps.sendEmail({ to: claimed.requesterEmail, ...email })
    } catch (e) {
      throw Object.assign(new ExportFailure('email_failed'), { cause: errorName(e) })
    }

    stage = 'ready'
    await deps.markReady(exportId, path)
  } catch (e) {
    const code = e instanceof ExportFailure ? e.code : 'internal'
    console.error('export-household: failed', { stage, code, error: errorName(e) })
    try {
      await deps.markFailed(exportId, code)
    } catch (markError) {
      console.error('export-household: could not mark the export failed', { error: errorName(markError) })
    }
  }
}

export function createExportHandler(deps: ExportHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const body = await readJsonObject(req)
    const exportId = body?.exportId
    const action = body?.action ?? 'build'
    if (!body || typeof exportId !== 'string' || !UUID_RE.test(exportId) || (action !== 'build' && action !== 'download')) {
      return json(400, { error: 'invalid_request' })
    }

    try {
      const row = await deps.callerExport(req, exportId)

      if (action === 'download') {
        if (row.status === 'pending') return json(409, { error: 'not_ready' })
        if (row.status === 'failed') return json(410, { error: 'failed' })
        if (row.expired) return json(410, { error: 'expired' })
        const path = await deps.storagePath(exportId)
        if (!path) return json(410, { error: 'expired' })
        const fileName = `roost-export-${row.createdAt.slice(0, 10)}.zip`
        const signed = new URL(await deps.signDownload(path, DOWNLOAD_URL_SECONDS, fileName))
        const expiresAt = new Date(deps.now().getTime() + DOWNLOAD_URL_SECONDS * 1000).toISOString()
        return json(200, { path: `${signed.pathname}${signed.search}`, expiresAt })
      }

      if (row.status !== 'pending') return json(409, { error: 'not_pending' })
      const appUrl = deps.appUrl
      if (!appUrl || !deps.emailConfigured) {
        console.error('export-household: APP_URL or SMTP settings are missing')
        return json(503, { error: 'not_configured' })
      }
      const claimed = await deps.claim(exportId)
      if (!claimed) return json(409, { error: 'not_pending' })
      await deps.background(runExport({ ...deps, appUrl }, exportId, claimed))
      return json(202, { exportId, status: 'pending' })
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      console.error('export-household: request failed', { action, error: errorName(e), code: (e as { code?: unknown } | null)?.code ?? '' })
      return json(500, { error: 'internal' })
    }
  }
}
