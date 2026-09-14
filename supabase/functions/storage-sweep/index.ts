/**
 * `storage-sweep` Edge Function (spec §11.1, §11.3): erases photo files that no longer belong to anything — files
 * with no `photos` row older than `minAgeMinutes` (default 60), and every file of a household that no longer exists —
 * from the private `household-photos` bucket through the Storage API, which (unlike SQL) removes the bytes. Then it
 * erases export ZIPs in the private `exports` bucket whose `household_exports` row is failed, expired or gone.
 *
 * Service role only: invoke it from a scheduled job or by hand with the service role key (see README, "Scheduled
 * jobs"). The gateway's JWT check is off for this function (config.toml) so either key format works; the handler
 * itself rejects every other caller.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runExportSweep, runSweep, type ExportSweepStore, type StoredObject, type SweepStore } from '../_shared/sweep.ts'
import { createSweepHandler } from './handler.ts'

const BUCKET = 'household-photos'
const EXPORTS_BUCKET = 'exports'
const PAGE = 1000

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Newer projects also expose `sb_secret_…` keys as a JSON object of name → key; accept those too. */
function secretKeys(): string[] {
  try {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? Object.values(parsed).filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type ListEntry = { name: string; id: string | null; created_at: string | null }

async function listAll(prefix: string, bucket = BUCKET): Promise<ListEntry[]> {
  const entries: ListEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`)
    entries.push(...(data as ListEntry[]))
    if (data.length < PAGE) return entries
  }
}

const store: SweepStore = {
  async listFolders() {
    // Folders come back with a null id; a file at the top level (never created by the app) is not a folder.
    return (await listAll('')).filter((e) => e.id === null).map((e) => e.name)
  },
  async listObjects(folder) {
    return (await listAll(folder)).map((e): StoredObject => ({
      name: `${folder}/${e.name}`,
      // A nested folder has no id or creation time; its name isn't a photo path, so the sweep leaves it alone.
      createdAt: e.id === null ? null : e.created_at,
    }))
  },
  async existingHouseholds(ids) {
    const { data, error } = await admin.from('households').select('id').in('id', ids)
    if (error) throw new Error(`households: ${error.message}`)
    return new Set((data ?? []).map((r: { id: string }) => r.id))
  },
  async recordedPaths(householdId) {
    const { data, error } = await admin.from('photos').select('storage_path').eq('household_id', householdId)
    if (error) throw new Error(`photos: ${error.message}`)
    return new Set((data ?? []).map((r: { storage_path: string }) => r.storage_path))
  },
  async remove(paths) {
    const { error } = await admin.storage.from(BUCKET).remove(paths)
    if (error) throw new Error(`remove: ${error.message}`)
  },
}

const exportStore: ExportSweepStore = {
  async listFolders() {
    return (await listAll('', EXPORTS_BUCKET)).filter((e) => e.id === null).map((e) => e.name)
  },
  async listObjects(folder) {
    return (await listAll(folder, EXPORTS_BUCKET)).map((e): StoredObject => ({
      name: `${folder}/${e.name}`,
      createdAt: e.id === null ? null : e.created_at,
    }))
  },
  async exportsOf(householdId) {
    const { data, error } = await admin.from('household_exports').select('id, status, expires_at').eq('household_id', householdId)
    if (error) throw new Error(`household_exports: ${error.message}`)
    return (data ?? []).map((r: { id: string; status: string; expires_at: string }) => ({ id: r.id, status: r.status, expiresAt: r.expires_at }))
  },
  async remove(paths) {
    const { error } = await admin.storage.from(EXPORTS_BUCKET).remove(paths)
    if (error) throw new Error(`remove: ${error.message}`)
  },
}

const handler = createSweepHandler({
  serviceKeys: [SUPABASE_SERVICE_ROLE_KEY, ...secretKeys()],
  sweep: async (options, now) => {
    const report = { ...(await runSweep(store, options, now)), exports: await runExportSweep(exportStore, now) }
    console.log('storage-sweep:', JSON.stringify(report))
    return report
  },
  now: () => new Date(),
})

Deno.serve(handler)
