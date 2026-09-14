/**
 * `export-household` Edge Function (spec §6.3, §11.3): builds an owner-requested household export and hands out its
 * download link. See handler.ts for the request and response contract.
 *
 * The build runs after the 202 response through `EdgeRuntime.waitUntil` (Supabase's edge runtime, hosted and local);
 * where that isn't available the request waits for the build instead. Background work is still bound by the runtime's
 * wall-clock limit (150 s on the free plan, 400 s on paid plans).
 *
 * Environment (Edge Function secrets; locally `supabase/functions/.env`, git-ignored):
 *   SMTP_HOST, SMTP_PORT (default 587; 465 uses implicit TLS), SMTP_USER and SMTP_PASS (optional, together),
 *   SMTP_FROM (e.g. `Roost Family <no-reply@roost.cmrd.dev>`)
 *   APP_URL   the web app's origin for the emailed link; defaults to http://localhost:5173 only on a local stack
 * Locally, Mailpit's SMTP port is reachable from the edge runtime container as `SMTP_HOST=inbucket`, `SMTP_PORT=1025`
 * (its alias on the stack's Docker network), so no `[inbucket] smtp_port` mapping is needed. The container name
 * `supabase_inbucket_<project_id>` does not work: the runtime's DNS resolver rejects the underscores.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
// @deno-types="npm:@types/nodemailer@7.0.12"
import nodemailer from 'npm:nodemailer@7.0.13'
import type { RpcClient } from '../_shared/auth.ts'
import { zipExport } from '../_shared/exportBuilder.ts'
import { fflate } from '../_shared/fflateModule.ts'
import { readBytes, readHouseholdRows } from './collect.ts'
import { ExportFailure, createCallerExport, createExportHandler, type ClaimedExport } from './handler.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PHOTOS_BUCKET = 'household-photos'
const EXPORTS_BUCKET = 'exports'
const NO_SESSION = { persistSession: false, autoRefreshToken: false }

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: NO_SESSION })

const isLocal = ['localhost', '127.0.0.1', 'kong', 'host.docker.internal'].includes(new URL(SUPABASE_URL).hostname)

function readAppUrl(): string | null {
  const raw = Deno.env.get('APP_URL')?.trim() || (isLocal ? 'http://localhost:5173' : '')
  if (!raw) return null
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('APP_URL must be an http(s) URL')
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

const smtpHost = Deno.env.get('SMTP_HOST')?.trim()
const smtpFrom = Deno.env.get('SMTP_FROM')?.trim()
const smtpPort = Number(Deno.env.get('SMTP_PORT')?.trim() || '587')
const smtpUser = Deno.env.get('SMTP_USER')?.trim()
const smtpPass = Deno.env.get('SMTP_PASS')
const transport = smtpHost && smtpFrom
  ? nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  : null

/** A PostgREST error as a thrown Error keeping only its SQLSTATE (messages may echo arguments; never log them). */
function rpcFailure(fn: string, error: { code?: string }): Error {
  return Object.assign(new Error(`${fn} failed`), { code: error.code })
}

function statusOf(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown } | null
  const status = Number(e?.status ?? e?.statusCode)
  return Number.isFinite(status) ? status : null
}

const handler = createExportHandler({
  callerExport: createCallerExport(
    (authorization): RpcClient =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: NO_SESSION, global: { headers: { Authorization: authorization } } }),
  ),

  async claim(exportId) {
    const { data, error } = await admin.rpc('svc_claim_household_export', { p_export_id: exportId })
    if (error) throw rpcFailure('svc_claim_household_export', error)
    const row = (data as Record<string, string>[] | null)?.[0]
    if (!row) return null
    return {
      householdId: row.household_id,
      householdName: row.household_name,
      timeZone: row.time_zone,
      requesterEmail: row.requester_email,
    } satisfies ClaimedExport
  },

  readRows: (householdId) =>
    readHouseholdRows(async (q) => {
      const { data, error } = await admin
        .from(q.table)
        .select(q.columns.join(','))
        .in(q.filter.column, q.filter.values)
        .order(q.orderBy)
        .range(q.from, q.to)
      if (error) throw rpcFailure(`select ${q.table}`, error)
      return (data ?? []) as unknown as Record<string, unknown>[]
    }, householdId),

  // Straight from the Storage API rather than supabase-js's download (a Blob, then another copy as an ArrayBuffer), so
  // each photo is held once.
  async downloadPhoto(path) {
    const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${PHOTOS_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // Storage answers a missing object with 400 and {"statusCode":"404"}, or with 404.
      if (res.status === 404 || /"statusCode":\s*"404"|not.?found/i.test(text)) return null
      throw Object.assign(new Error('photo download failed'), { code: res.status })
    }
    return readBytes(res)
  },

  zip: (files, photos) => zipExport(files, photos, fflate),

  async stillClaimed(exportId) {
    const { data, error } = await admin.rpc('svc_export_still_claimed', { p_export_id: exportId })
    if (error) throw rpcFailure('svc_export_still_claimed', error)
    return data === true
  },

  async removeUpload(path) {
    const { error } = await admin.storage.from(EXPORTS_BUCKET).remove([path])
    if (error) throw Object.assign(new Error('export remove failed'), { code: statusOf(error) })
  },

  async upload(path, bytes) {
    const { error } = await admin.storage.from(EXPORTS_BUCKET).upload(path, bytes, { contentType: 'application/zip', upsert: false })
    if (error) {
      if (statusOf(error) === 413 || /maximum allowed size|too large/i.test(error.message)) throw new ExportFailure('too_large')
      throw Object.assign(new Error('export upload failed'), { code: statusOf(error) })
    }
  },

  async markReady(exportId, path) {
    const { error } = await admin.rpc('svc_mark_export_ready', { p_export_id: exportId, p_storage_path: path })
    if (error) throw rpcFailure('svc_mark_export_ready', error)
  },

  async markFailed(exportId, code) {
    const { error } = await admin.rpc('svc_mark_export_failed', { p_export_id: exportId, p_error: code })
    if (error) throw rpcFailure('svc_mark_export_failed', error)
  },

  async sendEmail(message) {
    if (!transport || !smtpFrom) throw new Error('SMTP is not configured')
    await transport.sendMail({ from: smtpFrom, to: message.to, subject: message.subject, text: message.text, html: message.html })
  },

  async storagePath(exportId) {
    const { data, error } = await admin.from('household_exports').select('storage_path').eq('id', exportId).maybeSingle()
    if (error) throw rpcFailure('select household_exports', error)
    return (data as { storage_path: string | null } | null)?.storage_path ?? null
  },

  async signDownload(path, seconds, fileName) {
    const { data, error } = await admin.storage.from(EXPORTS_BUCKET).createSignedUrl(path, seconds, { download: fileName })
    if (error || !data) throw Object.assign(new Error('signing failed'), { code: statusOf(error) })
    return data.signedUrl
  },

  background(task) {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime
    if (runtime?.waitUntil) {
      runtime.waitUntil(task)
      return
    }
    return task
  },

  now: () => new Date(),
  appUrl: readAppUrl(),
  emailConfigured: transport !== null,
})

Deno.serve(handler)
