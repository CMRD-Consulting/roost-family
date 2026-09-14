// @vitest-environment node
// (Node rather than jsdom: fflate checks `instanceof Uint8Array`, and jsdom's TextEncoder returns another realm's.)
import * as fflate from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  EXPORT_TABLES,
  buildExportFiles,
  localTime,
  toCsv,
  zipExport,
  type ExportInput,
  type ExportRow,
} from './exportBuilder'

const TZ = 'America/New_York'
const OPTS = { timeZone: TZ, exportedAt: '2026-09-14T16:00:00.000Z' }

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111'
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADULT = 'aaaaaaaa-0000-4000-8000-000000000002'
const KID = 'cccccccc-0000-4000-8000-000000000001'
const MED = 'dddddddd-0000-4000-8000-000000000001'
const ROUTINE = 'eeeeeeee-0000-4000-8000-000000000001'
const CATEGORY = 'ffffffff-0000-4000-8000-000000000001'
const DISPLAY = '99999999-0000-4000-8000-000000000001'
const SITTER = '88888888-0000-4000-8000-000000000001'
const PHOTO = '77777777-0000-4000-8000-000000000001'

const attribution = {
  household_id: HOUSEHOLD,
  display_id: DISPLAY,
  logged_by_membership_id: OWNER,
  sitter_session_id: null,
  logged_by_name: 'Chris',
  created_at: '2026-09-14T13:00:00+00:00',
  updated_at: '2026-09-14T13:00:00+00:00',
}

function sampleInput(): ExportInput {
  return {
    household: {
      id: HOUSEHOLD,
      name: 'The Mitchells',
      time_zone: TZ,
      zip: '28202',
      lat: 35.2,
      lon: -80.8,
      plan: 'free',
      default_night_sleep_start: '18:00:00',
      default_night_sleep_end: '05:00:00',
      night_mode_start: '20:00:00',
      night_mode_end: '06:00:00',
      leave_by_buffer_min: 20,
      diaper_log_enabled: true,
      dinner_tonight: 'Tacos',
      sitter_info: { bedtime: '7pm' },
      created_at: '2026-09-01T12:00:00+00:00',
      deleted_at: null,
    },
    members: [
      { id: OWNER, user_id: 'u1', household_id: HOUSEHOLD, role: 'owner', display_name: 'Chris', color: '#112233', joined_at: '2026-09-01T12:00:00+00:00', left_at: null },
      { id: ADULT, user_id: 'u2', household_id: HOUSEHOLD, role: 'adult', display_name: 'Zoë 🌻', color: '#445566', joined_at: '2026-09-02T12:00:00+00:00', left_at: null },
    ],
    displays: [{ id: DISPLAY, household_id: HOUSEHOLD, name: 'Kitchen', auth_user_id: 'd1', last_seen_at: null, revoked_at: null, created_at: '2026-09-01T12:00:00+00:00' }],
    children: [
      { id: KID, name: 'Ada', birthday: '2024-01-02', color: '#778899', photo_id: PHOTO, allergies: '', food_rules: '', night_sleep_start: null, night_sleep_end: null, sort_order: 0, created_at: '2026-09-01T12:00:00+00:00' },
    ],
    featureOverrides: [{ id: 'fo1', child_id: KID, feature: 'diaper', enabled: false }],
    routines: [{ id: ROUTINE, household_id: HOUSEHOLD, child_id: KID, name: 'Bedtime', weekdays: [0, 1], steps: [{ label: 'Teeth' }], sort_order: 0, created_at: '2026-09-01T12:00:00+00:00' }],
    routineDayOverrides: [{ id: 'rdo1', household_id: HOUSEHOLD, child_id: KID, day: '2026-09-15', routine_id: ROUTINE }],
    routineProgress: [{ id: 'rp1', household_id: HOUSEHOLD, child_id: KID, routine_id: ROUTINE, day: '2026-09-14', completed_step_indexes: [0] }],
    medicines: [{ id: MED, household_id: HOUSEHOLD, child_id: KID, name: 'Ibuprofen', min_interval_hours: 6, max_doses_per_24h: 4, archived_at: null, created_at: '2026-09-01T12:00:00+00:00' }],
    doses: [
      {
        ...attribution,
        id: 'dose1',
        child_id: KID,
        medicine_id: MED,
        at: '2026-09-14T13:05:00+00:00',
        note: '=HYPERLINK("http://evil")',
        logged_offline: false,
        warnings_confirmed: ['interval'],
        conflict_acknowledged_at: null,
        conflict_acknowledged_by: null,
        voided_at: '2026-09-14T14:00:00+00:00',
        voided_by: ADULT,
        void_reason: 'Wrong kid',
      },
    ],
    sleeps: [{ ...attribution, id: 'sleep1', child_id: KID, start_at: '2026-09-14T17:00:00+00:00', end_at: null, type: 'nap' }],
    feedings: [
      // Name snapshot missing: the CSV falls back to the membership's current name.
      { ...attribution, logged_by_name: null, logged_by_membership_id: ADULT, id: 'feed1', child_id: KID, at: '2026-09-14T12:00:00+00:00', type: 'milk', amount: '4 oz', note: 'Line one\nline "two", end' },
    ],
    stickerCategories: [{ id: CATEGORY, household_id: HOUSEHOLD, name: 'Kindness', icon_key: 'heart', sort_order: 0, archived_at: null }],
    stickers: [{ ...attribution, id: 'st1', child_id: KID, category_id: CATEGORY, at: '2026-09-14T15:00:00+00:00' }],
    diapers: [{ ...attribution, logged_by_membership_id: null, sitter_session_id: SITTER, logged_by_name: 'Sam', id: 'di1', child_id: KID, at: '2026-09-14T15:30:00+00:00', kind: 'wet' }],
    jots: [{ id: 'j1', household_id: HOUSEHOLD, text: 'Call pediatrician', display_id: DISPLAY, created_at: '2026-09-14T11:00:00+00:00', done_at: null }],
    groceries: [{ id: 'g1', household_id: HOUSEHOLD, text: 'Milk', display_id: DISPLAY, created_at: '2026-09-14T11:00:00+00:00', checked_at: null }],
    sitterSessions: [{ id: SITTER, household_id: HOUSEHOLD, display_id: DISPLAY, sitter_name: 'Sam', started_at: '2026-09-14T15:00:00+00:00', ended_at: '2026-09-14T19:00:00+00:00', summary_shown_at: null, started_by: OWNER, ended_by: ADULT }],
    settingsAudit: [{ id: 1, household_id: HOUSEHOLD, membership_id: OWNER, change: { section: 'household', action: 'update' }, at: '2026-09-14T10:00:00+00:00' }],
    photos: [{ id: PHOTO, household_id: HOUSEHOLD, storage_path: `${HOUSEHOLD}/${PHOTO}.jpg`, kind: 'avatar', added_at: '2026-09-01T12:00:00+00:00' }],
    calendarSelections: [
      { id: 'cs1', household_id: HOUSEHOLD, connection_id: 'conn1', external_calendar_id: 'chris@example.com', name: 'Work', assigned_membership_id: OWNER, assigned_child_id: null, visible: true, gone: false, created_at: '2026-09-01T12:00:00+00:00' },
    ],
  }
}

/** Minimal RFC 4180 parser for assertions: rows of fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  if (field !== '' || row.length) rows.push([...row, field])
  return rows
}

/** CSV rows as objects keyed by header (BOM stripped). */
function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])))
}

function text(file: Uint8Array | string | undefined): string {
  if (file === undefined) throw new Error('missing file')
  return typeof file === 'string' ? file : new TextDecoder('utf-8', { ignoreBOM: true }).decode(file)
}

describe('toCsv', () => {
  it('writes a header and CRLF-terminated records', () => {
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }, { a: 2, b: 'y' }])).toBe('a,b\r\n1,x\r\n2,y\r\n')
    expect(toCsv(['a'], [])).toBe('a\r\n')
  })

  it('quotes fields with commas, quotes, CR or LF and doubles embedded quotes', () => {
    const csv = toCsv(['v'], [{ v: 'a,b' }, { v: 'say "hi"' }, { v: 'one\ntwo' }, { v: 'one\rtwo' }, { v: 'plain' }])
    expect(csv).toBe('v\r\n"a,b"\r\n"say ""hi"""\r\n"one\ntwo"\r\n"one\rtwo"\r\nplain\r\n')
  })

  it('writes null and undefined as empty, booleans as true/false, objects and arrays as JSON', () => {
    const csv = toCsv(['n', 'u', 't', 'f', 'o', 'a', 'missing'], [{ n: null, u: undefined, t: true, f: false, o: { k: 'v' }, a: [1, 'x'] }])
    expect(parseCsv(csv)[1]).toEqual(['', '', 'true', 'false', '{"k":"v"}', '[1,"x"]', ''])
  })

  it("prefixes ' to strings that a spreadsheet would read as a formula, but leaves numbers alone", () => {
    const rows = ['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx', 'ok = fine'].map((v) => ({ v }))
    expect(parseCsv(toCsv(['v'], rows)).slice(1).map((r) => r[0])).toEqual([
      "'=SUM(A1)",
      "'+1",
      "'-2",
      "'@cmd",
      "'\tx",
      "'\rx",
      'ok = fine',
    ])
    expect(toCsv(['v'], [{ v: -5 }, { v: 1.5 }])).toBe('v\r\n-5\r\n1.5\r\n')
  })

  it('keeps unicode and emoji intact', () => {
    expect(toCsv(['name'], [{ name: 'Zoë 🌻' }, { name: '李雷, 韩梅梅' }])).toBe('name\r\nZoë 🌻\r\n"李雷, 韩梅梅"\r\n')
  })
})

describe('localTime', () => {
  it('formats an instant as YYYY-MM-DD HH:mm in the zone, across DST', () => {
    expect(localTime('2026-09-14T13:30:00Z', TZ)).toBe('2026-09-14 09:30')
    expect(localTime('2026-12-01T14:05:00Z', TZ)).toBe('2026-12-01 09:05')
    // Spring forward (2026-03-08): 06:59Z is 01:59 EST, 07:00Z is 03:00 EDT.
    expect(localTime('2026-03-08T06:59:00Z', TZ)).toBe('2026-03-08 01:59')
    expect(localTime('2026-03-08T07:00:00Z', TZ)).toBe('2026-03-08 03:00')
    // Fall back (2026-11-01): 01:30 happens twice.
    expect(localTime('2026-11-01T05:30:00Z', TZ)).toBe('2026-11-01 01:30')
    expect(localTime('2026-11-01T06:30:00Z', TZ)).toBe('2026-11-01 01:30')
    // Crosses the date line and midnight.
    expect(localTime('2026-09-14T03:59:00+00:00', TZ)).toBe('2026-09-13 23:59')
    expect(localTime('2026-09-14T00:00:00Z', 'UTC')).toBe('2026-09-14 00:00')
  })

  it('returns an empty string for an unparseable instant', () => {
    expect(localTime('not a date', TZ)).toBe('')
  })
})

describe('buildExportFiles', () => {
  it('writes household.json with format, version, time zone and every section', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    const json = JSON.parse(text(files['household.json']))
    expect(json.format).toBe('roost-export')
    expect(json.version).toBe(1)
    expect(json.exportedAt).toBe(OPTS.exportedAt)
    expect(json.timeZone).toBe(TZ)
    expect(Object.keys(json)).toEqual(['format', 'version', 'exportedAt', 'timeZone', ...Object.keys(EXPORT_TABLES)])
    expect(json.household.name).toBe('The Mitchells')
    expect(json.members).toEqual([
      { id: OWNER, role: 'owner', display_name: 'Chris', color: '#112233', joined_at: '2026-09-01T12:00:00+00:00', left_at: null },
      { id: ADULT, role: 'adult', display_name: 'Zoë 🌻', color: '#445566', joined_at: '2026-09-02T12:00:00+00:00', left_at: null },
    ])
    expect(json.calendarSelections).toEqual([
      { id: 'cs1', name: 'Work', assigned_membership_id: OWNER, assigned_child_id: null, visible: true },
    ])
    expect(json.photos[0].file).toBe(`photos/${PHOTO}.jpg`)
    expect(text(files['household.json'])).toContain('\n  "format"')
  })

  it('writes only allow-listed columns, filling missing ones with null', () => {
    const input = sampleInput()
    input.jots = [{ id: 'j2', text: 'hi', surprise: 'nope' }]
    const json = JSON.parse(text(buildExportFiles(input, OPTS)['household.json']))
    expect(json.jots).toEqual([{ id: 'j2', text: 'hi', display_id: null, created_at: null, done_at: null }])
  })

  it('writes one CSV per log type plus README.txt', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    expect(Object.keys(files).sort()).toEqual(
      [
        'README.txt',
        'diapers.csv',
        'doses.csv',
        'feedings.csv',
        'household.json',
        'jots.csv',
        'routine_progress.csv',
        'settings_audit.csv',
        'sitter_sessions.csv',
        'sleeps.csv',
        'stickers.csv',
      ].sort(),
    )
    const readme = text(files['README.txt'])
    for (const name of Object.keys(files).filter((f) => f !== 'README.txt')) expect(readme).toContain(name)
    expect(readme).toContain('photos/')
    expect(readme).toContain(TZ)
    expect(readme.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('adds a _local column after every timestamp column in the household zone', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    const header = parseCsv(text(files['sleeps.csv']).replace(/^\uFEFF/, ''))[0]!
    expect(header.indexOf('start_at_local')).toBe(header.indexOf('start_at') + 1)
    expect(header.indexOf('end_at_local')).toBe(header.indexOf('end_at') + 1)
    expect(header).toContain('created_at_local')
    expect(header).toContain('updated_at_local')
    const [sleep] = csvRecords(text(files['sleeps.csv']))
    expect(sleep!.start_at).toBe('2026-09-14T17:00:00+00:00')
    expect(sleep!.start_at_local).toBe('2026-09-14 13:00')
    expect(sleep!.end_at).toBe('')
    expect(sleep!.end_at_local).toBe('')
    const [dose] = csvRecords(text(files['doses.csv']))
    expect(dose!.at_local).toBe('2026-09-14 09:05')
    expect(dose!.voided_at_local).toBe('2026-09-14 10:00')
    const [audit] = csvRecords(text(files['settings_audit.csv']))
    expect(audit!.at_local).toBe('2026-09-14 06:00')
  })

  it('resolves ids to names in added columns', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    const [dose] = csvRecords(text(files['doses.csv']))
    expect(dose).toMatchObject({ child_name: 'Ada', medicine_name: 'Ibuprofen', voided_by_name: 'Zoë 🌻', conflict_acknowledged_by_name: '', display_name: 'Kitchen', logged_by_name: 'Chris' })
    const header = parseCsv(text(files['doses.csv']).replace(/^\uFEFF/, ''))[0]!
    expect(header.indexOf('child_name')).toBe(header.indexOf('child_id') + 1)
    expect(header.indexOf('medicine_name')).toBe(header.indexOf('medicine_id') + 1)
    expect(header.filter((h) => h === 'logged_by_name')).toHaveLength(1)

    const [feeding] = csvRecords(text(files['feedings.csv']))
    expect(feeding!.logged_by_name).toBe('Zoë 🌻')
    expect(feeding!.note).toBe('Line one\nline "two", end')
    const [diaper] = csvRecords(text(files['diapers.csv']))
    expect(diaper).toMatchObject({ logged_by_name: 'Sam', sitter_name: 'Sam' })
    const [sticker] = csvRecords(text(files['stickers.csv']))
    expect(sticker).toMatchObject({ category_name: 'Kindness', child_name: 'Ada' })
    const [progress] = csvRecords(text(files['routine_progress.csv']))
    expect(progress).toMatchObject({ routine_name: 'Bedtime', child_name: 'Ada', completed_step_indexes: '[0]' })
    const [session] = csvRecords(text(files['sitter_sessions.csv']))
    expect(session).toMatchObject({ started_by_name: 'Chris', ended_by_name: 'Zoë 🌻', display_name: 'Kitchen' })
    const [audit] = csvRecords(text(files['settings_audit.csv']))
    expect(audit).toMatchObject({ membership_name: 'Chris', change: '{"section":"household","action":"update"}' })
    const [jot] = csvRecords(text(files['jots.csv']))
    expect(jot).toMatchObject({ display_name: 'Kitchen' })
  })

  it('guards CSV cells against formula injection', () => {
    const [dose] = csvRecords(text(buildExportFiles(sampleInput(), OPTS)['doses.csv']))
    expect(dose!.note).toBe(`'=HYPERLINK("http://evil")`)
  })

  it('never writes secret columns, even when every input row carries them', () => {
    const secrets: ExportRow = {
      pin_hash: '$2a$06$SECRETPINHASHVALUE',
      vault_secret_id: '5ec2e7aa-0000-4000-8000-5ec2e7000001',
      token_hash: 'TOKENHASHVALUE0123',
      claim_token: 'CLAIMTOKENVALUE0123',
      user_id: 'AUTHUSERIDVALUE',
    }
    const input = sampleInput()
    const salted = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map((row) => ({ ...row, ...secrets })) : { ...value, ...secrets },
      ]),
    ) as unknown as ExportInput
    const files = buildExportFiles(salted, OPTS)
    const zip = fflate.unzipSync(zipExport(files, [], fflate))
    const outputs = [...Object.values(files).map(text), ...Object.values(zip).map((b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b))]
    for (const out of outputs) {
      for (const [name, value] of Object.entries(secrets)) {
        expect(out).not.toContain(name)
        expect(out).not.toContain(String(value))
      }
    }
  })

  it('starts each CSV with a UTF-8 byte order mark so spreadsheets read emoji correctly', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    expect(text(files['doses.csv']).startsWith('\uFEFFid,')).toBe(true)
  })

  it('writes header-only CSVs when there are no rows', () => {
    const input = sampleInput()
    input.sleeps = []
    const csv = text(buildExportFiles(input, OPTS)['sleeps.csv'])
    expect(parseCsv(csv.replace(/^\uFEFF/, ''))).toHaveLength(1)
  })
})

describe('zipExport', () => {
  it('round-trips files and puts photos under photos/', () => {
    const files = buildExportFiles(sampleInput(), OPTS)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
    const zipped = zipExport(files, [{ path: `${HOUSEHOLD}/${PHOTO}.jpg`, bytes: jpeg }], fflate)
    const unzipped = fflate.unzipSync(zipped)
    expect(Object.keys(unzipped).sort()).toEqual([...Object.keys(files), `photos/${PHOTO}.jpg`].sort())
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(unzipped['household.json'])).toBe(files['household.json'])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(unzipped['doses.csv'])).toBe(files['doses.csv'])
    expect(unzipped[`photos/${PHOTO}.jpg`]).toEqual(jpeg)
  })

  it('stores photos uncompressed and compresses text', () => {
    const big = 'a'.repeat(10_000)
    const photo = new Uint8Array(10_000).fill(7)
    const calls: unknown[] = []
    const spy = {
      zipSync: (data: Parameters<typeof fflate.zipSync>[0], opts?: Parameters<typeof fflate.zipSync>[1]) => {
        calls.push(data)
        return fflate.zipSync(data, opts)
      },
    }
    const zipped = zipExport({ 'big.txt': big }, [{ path: 'p.jpg', bytes: photo }], spy)
    const entries = calls[0] as Record<string, [Uint8Array, { level: number }]>
    expect(entries['photos/p.jpg']![1].level).toBe(0)
    expect(entries['big.txt']![1].level).toBeGreaterThan(0)
    expect(zipped.length).toBeGreaterThan(10_000)
    expect(zipped.length).toBeLessThan(11_000)
  })

  it('keeps only the file name of a photo path, so nothing escapes photos/', () => {
    const bytes = new Uint8Array([1])
    const unzipped = fflate.unzipSync(zipExport({}, [{ path: '../../etc/x.jpg', bytes }], fflate))
    expect(Object.keys(unzipped)).toEqual(['photos/x.jpg'])
    expect(() => zipExport({}, [{ path: 'a/', bytes }], fflate)).toThrow()
    expect(() => zipExport({}, [{ path: 'a/..', bytes }], fflate)).toThrow()
  })

  it('refuses duplicate entry names', () => {
    const bytes = new Uint8Array([1])
    expect(() => zipExport({}, [{ path: 'h1/x.jpg', bytes }, { path: 'h2/x.jpg', bytes }], fflate)).toThrow(/duplicate/)
  })
})
