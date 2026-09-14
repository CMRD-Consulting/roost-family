/**
 * Household export from the browser (spec §11.3), always on a signed-in owner's temporary client:
 *   - `requestExport`: `request_household_export` (one per household per hour), then the `export-household` Edge
 *     Function builds it and emails the owner a link to /manage/export/<id>.
 *   - `exportStatus`: the export row through `my_household_export` (owners of its household only).
 *   - `exportDownloadUrl`: the same function with `action: 'download'` returns a 10-minute signed Storage path (clients
 *     have no access to the private `exports` bucket), made absolute on this app's Supabase URL.
 * Failures are `ExportError`s: a `SettingsError` whose message is already in the owner's words, with a `reason`.
 */
import { SettingsError, type SettingsErrorCode } from './settingsApi'
import type { RoostClient } from './supabase'

export type ExportErrorReason =
  | 'rate_limited'
  | 'forbidden'
  | 'session'
  | 'network'
  | 'not_configured'
  | 'not_found'
  | 'not_ready'
  | 'expired'
  | 'failed'
  | 'internal'

const MESSAGES: Record<Exclude<ExportErrorReason, 'rate_limited'>, string> = {
  forbidden: 'Only an owner can export this household.',
  session: 'Your sign-in ended. Sign in again.',
  network: 'Couldn’t reach Roost Family. Check the connection and try again.',
  not_configured: 'Export isn’t set up on this server yet.',
  not_found: 'This export isn’t available to you.',
  not_ready: 'This export is still being prepared.',
  expired: 'This export has expired.',
  failed: 'This export didn’t finish.',
  internal: 'Couldn’t start the export. Try again.',
}

const SETTINGS_CODES: Record<ExportErrorReason, SettingsErrorCode> = {
  rate_limited: 'invalid',
  forbidden: 'auth',
  session: 'network',
  network: 'network',
  not_configured: 'other',
  not_found: 'auth',
  not_ready: 'other',
  expired: 'other',
  failed: 'other',
  internal: 'other',
}

export class ExportError extends SettingsError {
  constructor(
    readonly reason: ExportErrorReason,
    readonly retryAfterMinutes: number | null = null,
    status: number | null = null,
  ) {
    super(
      reason === 'rate_limited'
        ? `You can request another export in ${retryAfterMinutes} ${retryAfterMinutes === 1 ? 'minute' : 'minutes'}.`
        : MESSAGES[reason],
      SETTINGS_CODES[reason],
      status,
    )
    this.name = 'ExportError'
  }
}

export interface ExportStatus {
  id: string
  householdId: string
  status: 'pending' | 'ready' | 'failed'
  /** True once a ready export's 24 hours are over. */
  expired: boolean
  createdAt: string
  readyAt: string | null
  expiresAt: string
}

type RpcResult = { data: unknown; error: { code?: string; message: string; details?: string | null } | null; status?: number }

const JWT_ERRORS = new Set(['PGRST301', 'PGRST302', 'PGRST303'])

function rpcError(result: RpcResult, refused: ExportErrorReason): ExportError {
  const { error } = result
  const status = result.status || null
  if (error?.code === 'RL001') {
    const minutes = Number(/retry_after_minutes=(\d+)/.exec(error.details ?? '')?.[1])
    return new ExportError('rate_limited', Number.isInteger(minutes) && minutes > 0 ? minutes : 60, status)
  }
  if (status === 401 || (error?.code && JWT_ERRORS.has(error.code))) return new ExportError('session', null, 401)
  if (error?.code === '42501') return new ExportError(refused, null, status)
  if (status === null || status === 408 || status === 429 || status >= 500) return new ExportError('network', null, status)
  return new ExportError('internal', null, status)
}

async function rpc(client: RoostClient, fn: string, args: Record<string, unknown>, refused: ExportErrorReason): Promise<unknown> {
  let result: RpcResult
  try {
    result = (await client.rpc(fn as never, args as never)) as RpcResult
  } catch {
    throw new ExportError('network')
  }
  if (result.error) throw rpcError(result, refused)
  return result.data
}

const FUNCTION_REASONS: Record<string, ExportErrorReason> = {
  not_configured: 'not_configured',
  not_ready: 'not_ready',
  expired: 'expired',
  failed: 'failed',
  internal: 'internal',
}

/** A `functions.invoke` error as an ExportError: the function's `{ error }` code, or `network` when no response came. */
async function functionError(error: unknown, refused: ExportErrorReason): Promise<ExportError> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } } | null
  if (e?.name !== 'FunctionsHttpError' || !e.context) return new ExportError('network')
  const status = e.context.status ?? 0
  if (status === 401) return new ExportError('session', null, 401)
  if (status === 403) return new ExportError(refused, null, 403)
  try {
    const payload = (await e.context.json?.()) as { error?: unknown } | null
    const reason = typeof payload?.error === 'string' ? FUNCTION_REASONS[payload.error] : undefined
    if (reason) return new ExportError(reason, null, status)
  } catch {
    // Not JSON: fall through to the status.
  }
  return new ExportError(status >= 500 && status !== 500 ? 'network' : 'internal', null, status)
}

async function invoke(client: RoostClient, body: Record<string, unknown>, refused: ExportErrorReason): Promise<unknown> {
  let result: { data: unknown; error: unknown }
  try {
    result = await client.functions.invoke('export-household', { body })
  } catch {
    throw new ExportError('network')
  }
  if (result.error) throw await functionError(result.error, refused)
  return result.data
}

/** Records an export of the household for the signed-in owner and starts building it. Resolves the export id. */
export async function requestExport(client: RoostClient, householdId: string): Promise<string> {
  const exportId = await rpc(client, 'request_household_export', { p_household_id: householdId }, 'forbidden')
  if (typeof exportId !== 'string') throw new ExportError('internal')
  await invoke(client, { exportId }, 'forbidden')
  return exportId
}

/** The export, for an owner of its household; `not_found` for anyone else and for an unknown id. */
export async function exportStatus(client: RoostClient, exportId: string): Promise<ExportStatus> {
  const data = await rpc(client, 'my_household_export', { p_export_id: exportId }, 'not_found')
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row) throw new ExportError('not_found')
  const status = row.status
  if (status !== 'pending' && status !== 'ready' && status !== 'failed') throw new ExportError('internal')
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    status,
    expired: row.expired === true,
    createdAt: String(row.created_at),
    readyAt: typeof row.ready_at === 'string' ? row.ready_at : null,
    expiresAt: String(row.expires_at),
  }
}

const SIGNED_PATH = '/storage/v1/object/sign/exports/'

/** A signed download URL for a ready export, valid for 10 minutes. */
export async function exportDownloadUrl(
  client: RoostClient,
  exportId: string,
  supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL,
): Promise<string> {
  const data = (await invoke(client, { exportId, action: 'download' }, 'not_found')) as { path?: unknown } | null
  const path = data?.path
  if (typeof path !== 'string' || !path.startsWith(SIGNED_PATH)) throw new ExportError('internal')
  const base = new URL(supabaseUrl)
  const url = new URL(path, base)
  if (url.origin !== base.origin) throw new ExportError('internal')
  return url.href
}
