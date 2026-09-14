import { describe, expect, it, vi } from 'vitest'
import { EXPORT_TABLES } from '../_shared/exportBuilder.ts'
import { collectPhotos, photoNote, readBytes, readHouseholdRows, type RowQuery } from './collect.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const KID1 = 'cccccccc-0000-0000-0000-000000000001'
const KID2 = 'cccccccc-0000-0000-0000-000000000002'

describe('readHouseholdRows', () => {
  function reader(rows: Record<string, Record<string, unknown>[]> = {}) {
    return vi.fn(async (q: RowQuery) => (rows[q.table] ?? []).slice(q.from, q.to + 1))
  }

  it('selects exactly the allow-listed columns of every export table, filtered to the household', async () => {
    const read = reader({
      households: [{ id: HOUSEHOLD, name: 'Rivera' }],
      child_households: [{ child_id: KID1 }, { child_id: KID2 }],
    })
    const input = await readHouseholdRows(read, HOUSEHOLD)

    const queries = read.mock.calls.map((c) => c[0])
    for (const [key, spec] of Object.entries(EXPORT_TABLES)) {
      const q = queries.find((x) => x.table === spec.table)
      expect(q, key).toBeDefined()
      expect(q!.columns).toEqual(spec.columns)
    }
    const byTable = (table: string) => queries.find((q) => q.table === table)!
    expect(byTable('households').filter).toEqual({ column: 'id', values: [HOUSEHOLD] })
    expect(byTable('memberships').filter).toEqual({ column: 'household_id', values: [HOUSEHOLD] })
    expect(byTable('dose_entries').filter).toEqual({ column: 'household_id', values: [HOUSEHOLD] })
    expect(byTable('child_households')).toMatchObject({ columns: ['child_id'], filter: { column: 'household_id', values: [HOUSEHOLD] } })
    // Children and their feature overrides have no household_id: they are found through child_households.
    expect(byTable('children').filter).toEqual({ column: 'id', values: [KID1, KID2] })
    expect(byTable('feature_overrides').filter).toEqual({ column: 'child_id', values: [KID1, KID2] })
    expect(input.household).toEqual({ id: HOUSEHOLD, name: 'Rivera' })
    expect(input.doses).toEqual([])
  })

  it('never selects a column outside the allow-list (no pin_hash, token_hash or vault ids)', async () => {
    const read = reader({ households: [{ id: HOUSEHOLD }] })
    await readHouseholdRows(read, HOUSEHOLD)
    const columns = read.mock.calls.flatMap((c) => c[0].columns)
    for (const secret of ['pin_hash', 'token_hash', 'vault_secret_id', 'external_calendar_id', 'user_id', 'auth_user_id']) {
      expect(columns).not.toContain(secret)
    }
    expect(read.mock.calls.map((c) => c[0].table)).not.toContain('member_pins')
    expect(read.mock.calls.map((c) => c[0].table)).not.toContain('calendar_connections')
  })

  it('reads every page, in a stable order', async () => {
    const doses = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }))
    const read = reader({ households: [{ id: HOUSEHOLD }], dose_entries: doses })
    const input = await readHouseholdRows(read, HOUSEHOLD, 2)
    expect(input.doses).toEqual(doses)
    const doseQueries = read.mock.calls.map((c) => c[0]).filter((q) => q.table === 'dose_entries')
    expect(doseQueries.map((q) => [q.from, q.to, q.orderBy])).toEqual([[0, 1, 'id'], [2, 3, 'id'], [4, 5, 'id']])
  })

  it('skips the child queries when the household has no children', async () => {
    const read = reader({ households: [{ id: HOUSEHOLD }] })
    const input = await readHouseholdRows(read, HOUSEHOLD)
    expect(read.mock.calls.map((c) => c[0].table)).not.toContain('children')
    expect(input.children).toEqual([])
    expect(input.featureOverrides).toEqual([])
  })

  it('fails when the household row is missing', async () => {
    await expect(readHouseholdRows(reader(), HOUSEHOLD)).rejects.toThrow('household not found')
  })
})

describe('collectPhotos', () => {
  const photo = (id: string, kind: string, addedAt: string) => ({ id, kind, added_at: addedAt, storage_path: `${HOUSEHOLD}/${id}.jpg` })
  const bytes = (n: number) => new Uint8Array(n)

  it('downloads avatars and step photos first, then slideshow photos oldest first, up to the byte cap', async () => {
    const rows = [
      photo('s2', 'slideshow', '2026-09-02T00:00:00Z'),
      photo('s1', 'slideshow', '2026-09-01T00:00:00Z'),
      photo('a1', 'avatar', '2026-09-03T00:00:00Z'),
      photo('t1', 'step', '2026-09-04T00:00:00Z'),
    ]
    const download = vi.fn(async () => bytes(40))
    const result = await collectPhotos(rows, download, 130)
    expect(download.mock.calls.map((c) => c[0])).toEqual([
      `${HOUSEHOLD}/a1.jpg`, `${HOUSEHOLD}/t1.jpg`, `${HOUSEHOLD}/s1.jpg`, `${HOUSEHOLD}/s2.jpg`,
    ])
    expect(result.files.map((f) => f.path)).toEqual([`${HOUSEHOLD}/a1.jpg`, `${HOUSEHOLD}/t1.jpg`, `${HOUSEHOLD}/s1.jpg`])
    expect(result).toMatchObject({ omittedForSize: 1, missing: 0, bytes: 120 })
  })

  it('stops downloading once the cap is reached', async () => {
    const rows = [photo('a', 'avatar', '2026-09-01T00:00:00Z'), photo('b', 'avatar', '2026-09-02T00:00:00Z'), photo('c', 'avatar', '2026-09-03T00:00:00Z')]
    const download = vi.fn(async () => bytes(50))
    const result = await collectPhotos(rows, download, 50)
    expect(download).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ omittedForSize: 2, bytes: 50 })
  })

  it('counts photos whose file is missing and carries on; other download failures fail the export', async () => {
    const rows = [photo('a', 'avatar', '2026-09-01T00:00:00Z'), photo('b', 'avatar', '2026-09-02T00:00:00Z')]
    const result = await collectPhotos(rows, vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(bytes(1)), 100)
    expect(result).toMatchObject({ missing: 1, omittedForSize: 0 })
    expect(result.files).toHaveLength(1)
    await expect(collectPhotos(rows, vi.fn().mockRejectedValue(new Error('storage down')), 100)).rejects.toThrow('storage down')
  })
})

describe('photoNote', () => {
  it('is empty when every photo is included', () => {
    expect(photoNote({ omittedForSize: 0, missing: 0 }, 30 * 1024 * 1024)).toBe('')
  })

  it('explains photos left out for size and missing files', () => {
    const note = photoNote({ omittedForSize: 3, missing: 1 }, 30 * 1024 * 1024)
    expect(note).toContain('3 photos were not included')
    expect(note).toContain('30 MB')
    expect(note).toContain('1 photo file could not be found')
    expect(note.endsWith('\r\n')).toBe(true)
  })
})

describe('readBytes', () => {
  const body = (chunks: number[][], headers: Record<string, string> = {}) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new Uint8Array(c))
          controller.close()
        },
      }),
      { headers },
    )

  it('reads a response with Content-Length straight into one buffer of that size', async () => {
    const bytes = await readBytes(body([[1, 2], [3], [4, 5]], { 'Content-Length': '5' }))
    expect([...bytes]).toEqual([1, 2, 3, 4, 5])
    expect(bytes.buffer.byteLength).toBe(5)
  })

  it('reads a response without Content-Length, or with a wrong one', async () => {
    expect([...(await readBytes(body([[1, 2], [3]])))]).toEqual([1, 2, 3])
    expect([...(await readBytes(body([[1, 2], [3, 4]], { 'Content-Length': '2' })))]).toEqual([1, 2, 3, 4])
    expect([...(await readBytes(body([[1]], { 'Content-Length': '3' })))]).toEqual([1])
  })

  it('reads an empty body', async () => {
    expect((await readBytes(new Response(null))).length).toBe(0)
  })
})
