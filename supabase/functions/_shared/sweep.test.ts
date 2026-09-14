import { describe, expect, it, vi } from 'vitest'
import {
  isServiceCaller, parseExportPath, parsePhotoPath, parseSweepOptions, runExportSweep, runSweep, selectExportsForSweep, selectForSweep,
  type ExportRecord, type ExportSweepStore, type SweepStore, type StoredObject,
} from './sweep.ts'

const H1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const H_GONE = 'aaaaaaaa-0000-0000-0000-0000000000ff'
const P1 = 'eeeeeeee-0000-0000-0000-000000000001'
const P2 = 'eeeeeeee-0000-0000-0000-000000000002'
const P3 = 'eeeeeeee-0000-0000-0000-000000000003'
const NOW = new Date('2026-09-14T19:00:00Z')

const obj = (name: string, minutesAgo: number | null): StoredObject => ({
  name,
  createdAt: minutesAgo === null ? null : new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
})

describe('parsePhotoPath', () => {
  it('reads <household>/<photo>.jpg', () => {
    expect(parsePhotoPath(`${H1}/${P1}.jpg`)).toEqual({ householdId: H1, photoId: P1 })
  })

  it('rejects anything else', () => {
    for (const name of [`${H1}/avatar.png`, `${H1}/x/${P1}.jpg`, `${P1}.jpg`, `${H1}/${P1}.JPG`, `../${H1}/${P1}.jpg`, '']) {
      expect(parsePhotoPath(name)).toBeNull()
    }
  })
})

describe('selectForSweep', () => {
  const base = { now: NOW, minAgeMinutes: 60, existingHouseholds: new Set([H1]), recordedPaths: new Set([`${H1}/${P1}.jpg`]) }

  it('keeps recorded photos, removes old unrecorded files, keeps new ones', () => {
    const result = selectForSweep([obj(`${H1}/${P1}.jpg`, 600), obj(`${H1}/${P2}.jpg`, 61), obj(`${H1}/${P3}.jpg`, 59)], base)
    expect(result.remove).toEqual([`${H1}/${P2}.jpg`])
    expect(result).toMatchObject({ orphans: 1, goneHousehold: 0, kept: 2, skipped: 0 })
  })

  it('removes every file of a household that no longer exists, however new', () => {
    const result = selectForSweep([obj(`${H_GONE}/${P1}.jpg`, 1), obj(`${H_GONE}/${P2}.jpg`, 9000)], base)
    expect(result.remove).toEqual([`${H_GONE}/${P1}.jpg`, `${H_GONE}/${P2}.jpg`])
    expect(result).toMatchObject({ orphans: 0, goneHousehold: 2, kept: 0 })
  })

  it('an age threshold of 0 removes an unrecorded file uploaded just now', () => {
    expect(selectForSweep([obj(`${H1}/${P2}.jpg`, 0)], { ...base, minAgeMinutes: 0 }).remove).toEqual([`${H1}/${P2}.jpg`])
  })

  it('leaves names it does not understand and files with no creation time alone', () => {
    const result = selectForSweep([obj('stray.txt', 9000), obj(`${H1}/${P2}.jpg`, null)], base)
    expect(result.remove).toEqual([])
    expect(result).toMatchObject({ skipped: 2, kept: 0 })
  })
})

describe('parseSweepOptions', () => {
  it('defaults to 60 minutes', () => {
    expect(parseSweepOptions(null)).toEqual({ minAgeMinutes: 60 })
    expect(parseSweepOptions({})).toEqual({ minAgeMinutes: 60 })
  })

  it('accepts a whole number of minutes from 0 to a week', () => {
    expect(parseSweepOptions({ minAgeMinutes: 0 })).toEqual({ minAgeMinutes: 0 })
    expect(parseSweepOptions({ minAgeMinutes: 10080 })).toEqual({ minAgeMinutes: 10080 })
    for (const bad of [-1, 1.5, '60', 10081, Number.NaN, null]) {
      expect(parseSweepOptions({ minAgeMinutes: bad })).toBeNull()
    }
  })
})

describe('isServiceCaller', () => {
  it('accepts only a bearer token equal to one of the service keys', () => {
    expect(isServiceCaller('Bearer service-key', ['service-key'])).toBe(true)
    expect(isServiceCaller('Bearer sb_secret_x', ['service-key', 'sb_secret_x'])).toBe(true)
    expect(isServiceCaller('Bearer anon-key', ['service-key'])).toBe(false)
    expect(isServiceCaller('service-key', ['service-key'])).toBe(false)
    expect(isServiceCaller(null, ['service-key'])).toBe(false)
    expect(isServiceCaller('Bearer ', ['', 'service-key'])).toBe(false)
    expect(isServiceCaller('Bearer service-key', [])).toBe(false)
  })
})

describe('runSweep', () => {
  function store(files: Record<string, StoredObject[]>, overrides: Partial<SweepStore> = {}): SweepStore & Record<'remove', ReturnType<typeof vi.fn>> {
    return {
      listFolders: vi.fn(async () => Object.keys(files)),
      listObjects: vi.fn(async (folder: string) => files[folder] ?? []),
      existingHouseholds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => id === H1))),
      recordedPaths: vi.fn(async () => new Set([`${H1}/${P1}.jpg`])),
      remove: vi.fn(async () => {}),
      ...overrides,
    } as never
  }

  it('sweeps folder by folder and reports counts', async () => {
    const s = store({
      [H1]: [obj(`${H1}/${P1}.jpg`, 600), obj(`${H1}/${P2}.jpg`, 120)],
      [H_GONE]: [obj(`${H_GONE}/${P3}.jpg`, 5)],
      'not-a-household': [obj('not-a-household/x.jpg', 600)],
    })
    const report = await runSweep(s, { minAgeMinutes: 60 }, NOW)

    expect(s.existingHouseholds).toHaveBeenCalledWith([H1, H_GONE])
    expect(s.recordedPaths).toHaveBeenCalledTimes(1)
    expect(s.recordedPaths).toHaveBeenCalledWith(H1)
    expect(s.remove).toHaveBeenCalledWith([`${H1}/${P2}.jpg`])
    expect(s.remove).toHaveBeenCalledWith([`${H_GONE}/${P3}.jpg`])
    expect(s.listObjects).not.toHaveBeenCalledWith('not-a-household')
    expect(report).toEqual({ scanned: 3, kept: 1, removedOrphans: 1, removedGoneHousehold: 1, skipped: 1, failed: 0 })
  })

  it('removes in batches of at most 100', async () => {
    const many = Array.from({ length: 250 }, (_, i) => obj(`${H_GONE}/eeeeeeee-0000-0000-0000-${String(i).padStart(12, '0')}.jpg`, 600))
    const s = store({ [H_GONE]: many })
    const report = await runSweep(s, { minAgeMinutes: 60 }, NOW)
    expect(s.remove.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([100, 100, 50])
    expect(report.removedGoneHousehold).toBe(250)
  })

  it('counts a failed removal and carries on', async () => {
    const s = store({ [H_GONE]: [obj(`${H_GONE}/${P1}.jpg`, 600)], [H1]: [obj(`${H1}/${P2}.jpg`, 600)] })
    s.remove.mockRejectedValueOnce(new Error('storage down'))
    const report = await runSweep(s, { minAgeMinutes: 60 }, NOW)
    expect(report).toMatchObject({ failed: 1, removedOrphans: 1, removedGoneHousehold: 0 })
  })
})

// ─── Export files ─────────────────────────────────────────────────────────
const E1 = 'ffffffff-0000-0000-0000-000000000001'
const E2 = 'ffffffff-0000-0000-0000-000000000002'
const E3 = 'ffffffff-0000-0000-0000-000000000003'
const E4 = 'ffffffff-0000-0000-0000-000000000004'
const zip = (household: string, exportId: string, minutesAgo: number | null = 5) => obj(`${household}/${exportId}.zip`, minutesAgo)
const rec = (id: string, status: string, expiresInMinutes: number): ExportRecord => ({
  id,
  status,
  expiresAt: new Date(NOW.getTime() + expiresInMinutes * 60_000).toISOString(),
})

describe('parseExportPath', () => {
  it('reads <household>/<export>.zip', () => {
    expect(parseExportPath(`${H1}/${E1}.zip`)).toEqual({ householdId: H1, exportId: E1 })
  })

  it('rejects anything else', () => {
    for (const name of [`${H1}/${E1}.jpg`, `${H1}/x/${E1}.zip`, `${E1}.zip`, `${H1}/${E1}.ZIP`, `../${H1}/${E1}.zip`, '']) {
      expect(parseExportPath(name)).toBeNull()
    }
  })
})

describe('selectExportsForSweep', () => {
  it('keeps pending and unexpired ready exports; removes failed, expired and unrecorded files, however new', () => {
    const records = new Map([
      [E1, rec(E1, 'ready', 60)],
      [E2, rec(E2, 'ready', -1)],
      [E3, rec(E3, 'failed', 600)],
      [E4, rec(E4, 'pending', 1440)],
    ])
    const unrecorded = 'ffffffff-0000-0000-0000-0000000000aa'
    const result = selectExportsForSweep(
      [zip(H1, E1), zip(H1, E2), zip(H1, E3), zip(H1, E4), zip(H1, unrecorded, 0)],
      { now: NOW, householdId: H1, records },
    )
    expect(result.remove).toEqual([`${H1}/${E2}.zip`, `${H1}/${E3}.zip`, `${H1}/${unrecorded}.zip`])
    expect(result).toMatchObject({ kept: 2, expired: 2, unrecorded: 1, skipped: 0 })
  })

  it('leaves names it does not understand, and files filed under another household’s folder, alone', () => {
    const result = selectExportsForSweep(
      [obj(`${H1}/notes.txt`, 600), zip(H_GONE, E1)],
      { now: NOW, householdId: H1, records: new Map([[E1, rec(E1, 'ready', 60)]]) },
    )
    expect(result.remove).toEqual([])
    expect(result.skipped).toBe(2)
  })
})

describe('runExportSweep', () => {
  function store(files: Record<string, StoredObject[]>, records: Record<string, ExportRecord[]>): ExportSweepStore & {
    remove: ReturnType<typeof vi.fn>
    calls: string[]
  } {
    const calls: string[] = []
    return {
      calls,
      listFolders: vi.fn(async () => Object.keys(files)),
      listObjects: vi.fn(async (folder: string) => {
        calls.push(`list ${folder}`)
        return files[folder] ?? []
      }),
      exportsOf: vi.fn(async (householdId: string) => {
        calls.push(`records ${householdId}`)
        return records[householdId] ?? []
      }),
      remove: vi.fn(async () => {}),
    } as never
  }

  it('reads each folder’s rows after listing its files, removes what is no longer downloadable, and reports counts', async () => {
    const s = store(
      { [H1]: [zip(H1, E1), zip(H1, E2)], [H_GONE]: [zip(H_GONE, E3)], 'not-a-household': [obj('not-a-household/x.zip', 600)] },
      { [H1]: [rec(E1, 'ready', 60), rec(E2, 'ready', -5)] },
    )
    const report = await runExportSweep(s, NOW)
    expect(s.calls).toEqual([`list ${H1}`, `records ${H1}`, `list ${H_GONE}`, `records ${H_GONE}`])
    expect(s.remove).toHaveBeenCalledWith([`${H1}/${E2}.zip`])
    expect(s.remove).toHaveBeenCalledWith([`${H_GONE}/${E3}.zip`])
    expect(report).toEqual({ scanned: 3, kept: 1, removedExpired: 1, removedUnrecorded: 1, skipped: 1, failed: 0 })
  })

  it('counts a failed removal and carries on', async () => {
    const s = store({ [H_GONE]: [zip(H_GONE, E1)], [H1]: [zip(H1, E2)] }, {})
    s.remove.mockRejectedValueOnce(new Error('storage down'))
    const report = await runExportSweep(s, NOW)
    expect(report).toMatchObject({ failed: 1, removedUnrecorded: 1 })
  })
})
