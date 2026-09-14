/**
 * Reading one household for the export (spec §11.3): its rows, table by table with exactly the `EXPORT_TABLES` columns,
 * and its photo files up to a byte cap. Plain TypeScript over injected readers so Vitest runs it; index.ts passes the
 * service-role client.
 */
import { EXPORT_TABLES, type ExportInput, type ExportRow } from '../_shared/exportBuilder.ts'

export interface RowQuery {
  table: string
  /** Select exactly these columns. */
  columns: readonly string[]
  /** `column in values` (a single value for most tables). */
  filter: { column: string; values: string[] }
  /** Order by this column, so pages are stable. */
  orderBy: string
  /** Inclusive row range, as PostgREST's `range(from, to)`. */
  from: number
  to: number
}

export type RowReader = (query: RowQuery) => Promise<ExportRow[]>

/** PostgREST returns at most `max_rows` (1000) rows per request. */
export const PAGE_SIZE = 1000

type TableKey = keyof typeof EXPORT_TABLES

async function readAll(read: RowReader, query: Omit<RowQuery, 'from' | 'to'>, pageSize: number): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await read({ ...query, from, to: from + pageSize - 1 })
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

/**
 * Every export table's rows for the household. Children and feature overrides have no household_id: they are found
 * through `child_households`. Fails when the household row is missing.
 */
export async function readHouseholdRows(read: RowReader, householdId: string, pageSize = PAGE_SIZE): Promise<ExportInput> {
  const byHousehold = (key: TableKey, filterColumn = 'household_id') =>
    readAll(read, { table: EXPORT_TABLES[key].table, columns: EXPORT_TABLES[key].columns, filter: { column: filterColumn, values: [householdId] }, orderBy: 'id' }, pageSize)

  const [household] = await byHousehold('household', 'id')
  if (!household) throw new Error('household not found')

  const links = await readAll(
    read,
    { table: 'child_households', columns: ['child_id'], filter: { column: 'household_id', values: [householdId] }, orderBy: 'child_id' },
    pageSize,
  )
  const childIds = links.map((l) => String(l.child_id))
  const byChild = async (key: 'children' | 'featureOverrides', column: string) =>
    childIds.length === 0
      ? []
      : readAll(read, { table: EXPORT_TABLES[key].table, columns: EXPORT_TABLES[key].columns, filter: { column, values: childIds }, orderBy: 'id' }, pageSize)

  const input: Record<string, unknown> = { household }
  for (const key of Object.keys(EXPORT_TABLES) as TableKey[]) {
    if (key === 'household') continue
    if (key === 'children') input[key] = await byChild('children', 'id')
    else if (key === 'featureOverrides') input[key] = await byChild('featureOverrides', 'child_id')
    else input[key] = await byHousehold(key)
  }
  return input as ExportInput
}

export interface CollectedPhotos {
  files: { path: string; bytes: Uint8Array }[]
  /** Total bytes of `files`. */
  bytes: number
  /** Photos left out because the cap was reached. */
  omittedForSize: number
  /** Photos with a row but no file in Storage. */
  missing: number
}

const KIND_ORDER: Record<string, number> = { avatar: 0, step: 1, slideshow: 2 }

/**
 * Downloads the photos' files one at a time, keeping at most `capBytes` in total: avatars and routine step photos
 * first, then slideshow photos oldest first. A photo that would pass the cap is left out, and once the cap is reached
 * nothing more is downloaded. `download` resolves null for a missing file and throws for anything else, which fails
 * the export (better than a silently incomplete one).
 */
export async function collectPhotos(
  photos: readonly ExportRow[],
  download: (path: string) => Promise<Uint8Array | null>,
  capBytes: number,
): Promise<CollectedPhotos> {
  const ordered = [...photos].sort(
    (a, b) =>
      (KIND_ORDER[String(a.kind)] ?? 3) - (KIND_ORDER[String(b.kind)] ?? 3) ||
      String(a.added_at ?? '').localeCompare(String(b.added_at ?? '')),
  )
  const result: CollectedPhotos = { files: [], bytes: 0, omittedForSize: 0, missing: 0 }
  for (const row of ordered) {
    if (result.bytes >= capBytes) {
      result.omittedForSize++
      continue
    }
    const path = String(row.storage_path)
    const bytes = await download(path)
    if (bytes === null) result.missing++
    else if (result.bytes + bytes.length > capBytes) result.omittedForSize++
    else {
      result.files.push({ path, bytes })
      result.bytes += bytes.length
    }
  }
  return result
}

/** Lines appended to README.txt when photos are missing from the ZIP; empty when none are. */
export function photoNote(photos: Pick<CollectedPhotos, 'omittedForSize' | 'missing'>, capBytes: number): string {
  const lines: string[] = []
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (photos.omittedForSize > 0) {
    lines.push(
      `${plural(photos.omittedForSize, 'photo was', 'photos were')} not included: an export holds at most ${Math.round(capBytes / (1024 * 1024))} MB of photos.`,
      'They are still listed in household.json > photos.',
    )
  }
  if (photos.missing > 0) {
    lines.push(`${plural(photos.missing, 'photo file', 'photo files')} could not be found and ${photos.missing === 1 ? 'is' : 'are'} not included.`)
  }
  return lines.length === 0 ? '' : ['Photos not included', '--------------------', ...lines, ''].join('\r\n')
}

/**
 * A response body as one Uint8Array. With a Content-Length it reads straight into a buffer of that size (one copy of
 * the bytes, rather than a Blob and then an ArrayBuffer); without one, or if the length turns out wrong, it gathers the
 * chunks and joins them once.
 */
export async function readBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const declared = Number(response.headers.get('Content-Length'))
  let buffer = Number.isSafeInteger(declared) && declared > 0 ? new Uint8Array(declared) : null
  let length = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (buffer && length + value.length <= buffer.length) {
      buffer.set(value, length)
    } else {
      if (buffer) {
        // Longer than declared: keep what was read so far as a chunk and gather the rest.
        chunks.push(buffer.subarray(0, length))
        buffer = null
      }
      chunks.push(value)
    }
    length += value.length
  }
  if (buffer) return length === buffer.length ? buffer : buffer.slice(0, length)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
