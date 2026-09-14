/**
 * Photo storage sweep (spec §11.1, §11.3): which files in the private `household-photos` bucket to erase.
 *
 * A photo's file stays in Storage after `delete_photo` removes its `photos` row (and after the household purge removes
 * the household): SQL cannot erase Storage file bytes, only the Storage API can. The `storage-sweep` Edge Function
 * (service role) runs this regularly and erases, through the Storage API:
 *  - files with no `photos` row that are older than `minAgeMinutes` (deleted photos, and uploads whose `add_photo`
 *    never happened; the age gives an upload in progress time to be recorded), and
 *  - every file in the folder of a household that no longer exists.
 * Names that aren't `<household uuid>/<photo uuid>.jpg` are left alone.
 *
 * Export ZIPs in the private `exports` bucket (`<household>/<export>.zip`, spec §11.3) are swept too: a file is erased
 * once its `household_exports` row is failed, past its 24-hour expiry, or gone (purged after 7 days, or deleted with
 * its household). The row is always written before the upload, so a file with no row is never a build in progress
 * and needs no age threshold.
 *
 * Plain TypeScript with no Deno or browser globals, so Vitest (Node) and the Edge Function (Deno) share it.
 */

export interface StoredObject {
  /** Full object name within the bucket, `<household>/<photo>.jpg`. */
  name: string
  /** ISO timestamp, or null when Storage didn't report one. */
  createdAt: string | null
}

export interface SweepOptions {
  /** Unrecorded files younger than this are kept. Default 60. */
  minAgeMinutes: number
}

export interface SweepSelection {
  remove: string[]
  orphans: number
  goneHousehold: number
  kept: number
  skipped: number
}

export interface SweepReport {
  /** Files listed in household folders. */
  scanned: number
  kept: number
  removedOrphans: number
  removedGoneHousehold: number
  /** Folders and files left alone because their names aren't household photos (or have no creation time). */
  skipped: number
  /** Files whose removal failed (tried again on the next run). */
  failed: number
}

/** What the sweep needs from Storage and the database (the Edge Function implements it with the service role). */
export interface SweepStore {
  /** Top-level folder names in the bucket. */
  listFolders(): Promise<string[]>
  /** Every file in one folder (all pages). */
  listObjects(folder: string): Promise<StoredObject[]>
  /** Which of these household ids still exist (soft-deleted households still exist until the purge). */
  existingHouseholds(ids: string[]): Promise<Set<string>>
  /** The `photos.storage_path` of every photo recorded for the household. */
  recordedPaths(householdId: string): Promise<Set<string>>
  /** Erases these files through the Storage API. */
  remove(paths: string[]): Promise<void>
}

export const DEFAULT_MIN_AGE_MINUTES = 60
const MAX_MIN_AGE_MINUTES = 7 * 24 * 60
const REMOVE_BATCH = 100

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(`^${UUID}$`)
const PHOTO_PATH_RE = new RegExp(`^(${UUID})/(${UUID})\\.jpg$`)

/** The household and photo of an object named exactly `<uuid>/<uuid>.jpg` (lowercase, as the app names them), or null. */
export function parsePhotoPath(name: string): { householdId: string; photoId: string } | null {
  const match = PHOTO_PATH_RE.exec(name)
  return match ? { householdId: match[1]!, photoId: match[2]! } : null
}

export function selectForSweep(
  objects: StoredObject[],
  context: { now: Date; minAgeMinutes: number; existingHouseholds: Set<string>; recordedPaths: Set<string> },
): SweepSelection {
  const selection: SweepSelection = { remove: [], orphans: 0, goneHousehold: 0, kept: 0, skipped: 0 }
  const cutoff = context.now.getTime() - context.minAgeMinutes * 60_000
  for (const object of objects) {
    const parsed = parsePhotoPath(object.name)
    if (parsed === null) {
      selection.skipped++
    } else if (!context.existingHouseholds.has(parsed.householdId)) {
      selection.remove.push(object.name)
      selection.goneHousehold++
    } else if (context.recordedPaths.has(object.name)) {
      selection.kept++
    } else {
      const created = object.createdAt === null ? Number.NaN : Date.parse(object.createdAt)
      if (Number.isNaN(created)) selection.skipped++
      else if (created <= cutoff) {
        selection.remove.push(object.name)
        selection.orphans++
      } else selection.kept++
    }
  }
  return selection
}

/** The request body's options, or null when they're invalid. `minAgeMinutes`: whole minutes, 0 to a week. */
export function parseSweepOptions(body: unknown): SweepOptions | null {
  if (body === null || body === undefined) return { minAgeMinutes: DEFAULT_MIN_AGE_MINUTES }
  if (typeof body !== 'object' || Array.isArray(body)) return null
  if (!('minAgeMinutes' in body)) return { minAgeMinutes: DEFAULT_MIN_AGE_MINUTES }
  const value = (body as { minAgeMinutes: unknown }).minAgeMinutes
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MIN_AGE_MINUTES) return null
  return { minAgeMinutes: value }
}

/** Constant-time string comparison (the length still shows, which a key's length doesn't give away usefully). */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** True only for `Authorization: Bearer <key>` where key is one of the (non-empty) service keys. */
export function isServiceCaller(authorization: string | null, serviceKeys: string[]): boolean {
  if (!authorization?.startsWith('Bearer ')) return false
  const token = authorization.slice('Bearer '.length)
  if (!token) return false
  let ok = false
  for (const key of serviceKeys) if (key && sameSecret(token, key)) ok = true
  return ok
}

/** Sweeps the whole bucket, one household folder at a time. A failed removal is counted and the sweep carries on. */
export async function runSweep(store: SweepStore, options: SweepOptions, now: Date): Promise<SweepReport> {
  const report: SweepReport = { scanned: 0, kept: 0, removedOrphans: 0, removedGoneHousehold: 0, skipped: 0, failed: 0 }
  const folders = await store.listFolders()
  const householdFolders = folders.filter((f) => UUID_RE.test(f))
  report.skipped += folders.length - householdFolders.length
  if (householdFolders.length === 0) return report
  const existing = await store.existingHouseholds(householdFolders)

  for (const folder of householdFolders) {
    const objects = await store.listObjects(folder)
    report.scanned += objects.length
    const recorded = existing.has(folder) ? await store.recordedPaths(folder) : new Set<string>()
    const selection = selectForSweep(objects, { now, minAgeMinutes: options.minAgeMinutes, existingHouseholds: existing, recordedPaths: recorded })
    report.kept += selection.kept
    report.skipped += selection.skipped
    for (let i = 0; i < selection.remove.length; i += REMOVE_BATCH) {
      const batch = selection.remove.slice(i, i + REMOVE_BATCH)
      try {
        await store.remove(batch)
        if (existing.has(folder)) report.removedOrphans += batch.length
        else report.removedGoneHousehold += batch.length
      } catch {
        report.failed += batch.length
      }
    }
  }
  return report
}

// ─── Export files ─────────────────────────────────────────────────────────

/** A `household_exports` row as the sweep needs it. */
export interface ExportRecord {
  id: string
  status: string
  /** ISO timestamp. */
  expiresAt: string
}

export interface ExportSweepStore {
  /** Top-level folder names in the `exports` bucket. */
  listFolders(): Promise<string[]>
  /** Every file in one folder (all pages). */
  listObjects(folder: string): Promise<StoredObject[]>
  /** The household's `household_exports` rows (none once the household is deleted). */
  exportsOf(householdId: string): Promise<ExportRecord[]>
  /** Erases these files through the Storage API. */
  remove(paths: string[]): Promise<void>
}

export interface ExportSweepSelection {
  remove: string[]
  /** Failed or expired exports. */
  expired: number
  /** Files with no row. */
  unrecorded: number
  kept: number
  skipped: number
}

export interface ExportSweepReport {
  scanned: number
  kept: number
  removedExpired: number
  removedUnrecorded: number
  skipped: number
  failed: number
}

/** The photo sweep's counts plus the export sweep's, as `storage-sweep` returns them. */
export type StorageSweepReport = SweepReport & { exports: ExportSweepReport }

const EXPORT_PATH_RE = new RegExp(`^(${UUID})/(${UUID})\\.zip$`)

/** The household and export of an object named exactly `<uuid>/<uuid>.zip`, or null. */
export function parseExportPath(name: string): { householdId: string; exportId: string } | null {
  const match = EXPORT_PATH_RE.exec(name)
  return match ? { householdId: match[1]!, exportId: match[2]! } : null
}

/**
 * Which of one household folder's export files to erase: those whose row is failed, expired or missing. Pending
 * exports (being built) and ready, unexpired ones are kept. Names that aren't this household's `<uuid>/<uuid>.zip` are
 * left alone.
 */
export function selectExportsForSweep(
  objects: StoredObject[],
  context: { now: Date; householdId: string; records: Map<string, ExportRecord> },
): ExportSweepSelection {
  const selection: ExportSweepSelection = { remove: [], expired: 0, unrecorded: 0, kept: 0, skipped: 0 }
  for (const object of objects) {
    const parsed = parseExportPath(object.name)
    if (parsed === null || parsed.householdId !== context.householdId) {
      selection.skipped++
      continue
    }
    const record = context.records.get(parsed.exportId)
    if (!record) {
      selection.remove.push(object.name)
      selection.unrecorded++
      continue
    }
    const expires = Date.parse(record.expiresAt)
    const downloadable = record.status === 'pending' || (record.status === 'ready' && expires > context.now.getTime())
    if (downloadable) selection.kept++
    else {
      selection.remove.push(object.name)
      selection.expired++
    }
  }
  return selection
}

/** Sweeps the whole `exports` bucket, one household folder at a time. Rows are read after the folder is listed, so a
 *  file uploaded meanwhile always has its row. A failed removal is counted and the sweep carries on. */
export async function runExportSweep(store: ExportSweepStore, now: Date): Promise<ExportSweepReport> {
  const report: ExportSweepReport = { scanned: 0, kept: 0, removedExpired: 0, removedUnrecorded: 0, skipped: 0, failed: 0 }
  const folders = await store.listFolders()
  const householdFolders = folders.filter((f) => UUID_RE.test(f))
  report.skipped += folders.length - householdFolders.length

  for (const folder of householdFolders) {
    const objects = await store.listObjects(folder)
    report.scanned += objects.length
    const records = new Map((await store.exportsOf(folder)).map((r) => [r.id, r]))
    const selection = selectExportsForSweep(objects, { now, householdId: folder, records })
    report.kept += selection.kept
    report.skipped += selection.skipped
    const expired = new Set(
      selection.remove.filter((name) => records.has(parseExportPath(name)!.exportId)),
    )
    for (let i = 0; i < selection.remove.length; i += REMOVE_BATCH) {
      const batch = selection.remove.slice(i, i + REMOVE_BATCH)
      try {
        await store.remove(batch)
        for (const name of batch) {
          if (expired.has(name)) report.removedExpired++
          else report.removedUnrecorded++
        }
      } catch {
        report.failed += batch.length
      }
    }
  }
  return report
}
