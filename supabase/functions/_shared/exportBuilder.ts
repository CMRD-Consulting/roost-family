/**
 * Household export file builders (spec §11.2, §11.3): turns a household's rows into `household.json`, one CSV per log
 * type, a README, and finally a ZIP with the photos. Database-free; the `export-household` Edge Function reads the rows
 * with the service role and passes them in.
 *
 * Secrets cannot leak by construction: every table has an explicit column allow-list (`EXPORT_TABLES`) and output rows
 * are rebuilt from it, never spread from the input. A column added to a table later stays out of the export until it
 * is added here. The Edge Function should also `select()` exactly these columns.
 *
 * Tables and columns intentionally not exported:
 *   - member_pins (pin_hash), display_claims (token_hash), member_invites (token_hash), take_list_links (token_hash):
 *     credentials, and useless outside Roost.
 *   - calendar_connections: vault_secret_id points at the OAuth tokens / ICS URL in Vault. Labels never contain a URL
 *     (a check constraint), but are excluded too, as defence in depth. Selections keep the calendar names and who each
 *     one is assigned to.
 *   - calendar_selections.external_calendar_id and connection_id: provider identifiers (often an email address).
 *   - household_weather: a cache of public forecast data.
 *   - child_households: the export is of one household, so the mapping adds nothing.
 *   - invite_codes, app_config: service-wide, not household data. consent_records: per user account, not household.
 *   - memberships.user_id, displays.auth_user_id, displays.last_seen_at, households.deleted_at: internal auth ids and
 *     operational state.
 *   - household_id on every row: always the exported household.
 *
 * How `fflate` is supplied (same approach as `ics.ts` with ical.js): this module never imports it. Edge Functions pass
 * `fflate` from `./fflateModule.ts` (an `npm:` import); Vitest passes `import * as fflate from 'fflate'` (a pinned
 * devDependency). Plain TypeScript with no Deno or Node globals beyond `Intl` and `TextEncoder`.
 */
import { wallTimeAt } from './events.ts'

export type ExportRow = Readonly<Record<string, unknown>>

interface TableSpec {
  /** The Postgres table the rows come from. */
  table: string
  /** Allow-listed columns, in output order. */
  columns: readonly string[]
  /** The `timestamptz` columns among `columns`; each gets a `<col>_local` column in CSVs. */
  timestamps: readonly string[]
}

const ATTRIBUTION = ['display_id', 'logged_by_membership_id', 'sitter_session_id', 'logged_by_name'] as const
const CHANGED = ['created_at', 'updated_at'] as const

/** Keys of `household.json` after the header fields, and of `ExportInput`, in this order. */
export const EXPORT_TABLES = {
  household: {
    table: 'households',
    columns: [
      'id', 'name', 'time_zone', 'zip', 'lat', 'lon', 'plan', 'default_night_sleep_start', 'default_night_sleep_end',
      'night_mode_start', 'night_mode_end', 'leave_by_buffer_min', 'diaper_log_enabled', 'dinner_tonight', 'sitter_info',
      'created_at',
    ],
    timestamps: ['created_at'],
  },
  members: {
    table: 'memberships',
    columns: ['id', 'role', 'display_name', 'color', 'joined_at', 'left_at'],
    timestamps: ['joined_at', 'left_at'],
  },
  displays: { table: 'displays', columns: ['id', 'name', 'created_at', 'revoked_at'], timestamps: ['created_at', 'revoked_at'] },
  children: {
    table: 'children',
    columns: [
      'id', 'name', 'birthday', 'color', 'photo_id', 'allergies', 'food_rules', 'night_sleep_start', 'night_sleep_end',
      'sort_order', 'created_at',
    ],
    timestamps: ['created_at'],
  },
  featureOverrides: { table: 'feature_overrides', columns: ['id', 'child_id', 'feature', 'enabled'], timestamps: [] },
  routines: {
    table: 'routines',
    columns: ['id', 'child_id', 'name', 'weekdays', 'steps', 'sort_order', 'created_at'],
    timestamps: ['created_at'],
  },
  routineDayOverrides: { table: 'routine_day_overrides', columns: ['id', 'child_id', 'day', 'routine_id'], timestamps: [] },
  routineProgress: {
    table: 'routine_progress',
    columns: ['id', 'child_id', 'routine_id', 'day', 'completed_step_indexes'],
    timestamps: [],
  },
  medicines: {
    table: 'medicines',
    columns: ['id', 'child_id', 'name', 'min_interval_hours', 'max_doses_per_24h', 'archived_at', 'created_at'],
    timestamps: ['archived_at', 'created_at'],
  },
  doses: {
    table: 'dose_entries',
    columns: [
      'id', 'child_id', 'medicine_id', 'at', 'note', 'logged_offline', 'warnings_confirmed', 'conflict_acknowledged_at',
      'conflict_acknowledged_by', 'voided_at', 'voided_by', 'void_reason', ...ATTRIBUTION, ...CHANGED,
    ],
    timestamps: ['at', 'conflict_acknowledged_at', 'voided_at', ...CHANGED],
  },
  sleeps: {
    table: 'sleep_entries',
    columns: ['id', 'child_id', 'start_at', 'end_at', 'type', ...ATTRIBUTION, ...CHANGED],
    timestamps: ['start_at', 'end_at', ...CHANGED],
  },
  feedings: {
    table: 'feeding_entries',
    columns: ['id', 'child_id', 'at', 'type', 'amount', 'note', ...ATTRIBUTION, ...CHANGED],
    timestamps: ['at', ...CHANGED],
  },
  stickerCategories: {
    table: 'sticker_categories',
    columns: ['id', 'name', 'icon_key', 'sort_order', 'archived_at'],
    timestamps: ['archived_at'],
  },
  stickers: {
    table: 'sticker_entries',
    columns: ['id', 'child_id', 'category_id', 'at', ...ATTRIBUTION, ...CHANGED],
    timestamps: ['at', ...CHANGED],
  },
  diapers: {
    table: 'diaper_entries',
    columns: ['id', 'child_id', 'at', 'kind', ...ATTRIBUTION, ...CHANGED],
    timestamps: ['at', ...CHANGED],
  },
  jots: { table: 'jots', columns: ['id', 'text', 'display_id', 'created_at', 'done_at'], timestamps: ['created_at', 'done_at'] },
  groceries: {
    table: 'grocery_items',
    columns: ['id', 'text', 'display_id', 'created_at', 'checked_at'],
    timestamps: ['created_at', 'checked_at'],
  },
  sitterSessions: {
    table: 'sitter_sessions',
    columns: ['id', 'display_id', 'sitter_name', 'started_at', 'ended_at', 'summary_shown_at', 'started_by', 'ended_by'],
    timestamps: ['started_at', 'ended_at', 'summary_shown_at'],
  },
  settingsAudit: { table: 'settings_audit', columns: ['id', 'membership_id', 'change', 'at'], timestamps: ['at'] },
  photos: { table: 'photos', columns: ['id', 'storage_path', 'kind', 'added_at'], timestamps: ['added_at'] },
  calendarSelections: {
    table: 'calendar_selections',
    columns: ['id', 'name', 'assigned_membership_id', 'assigned_child_id', 'visible'],
    timestamps: [],
  },
} as const satisfies Record<string, TableSpec>

type TableKey = keyof typeof EXPORT_TABLES

/** One household's rows, one array per table (see `EXPORT_TABLES` for the source table of each key). */
export type ExportInput = { household: ExportRow } & { [K in Exclude<TableKey, 'household'>]: readonly ExportRow[] }

export interface ExportOptions {
  /** The household's IANA zone, for the `_local` columns. */
  timeZone: string
  /** ISO instant the export was made. */
  exportedAt: string
}

export type ExportFiles = Record<string, Uint8Array | string>

// ---- CSV ----

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

function csvField(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (typeof value === 'string') {
    // Spreadsheets run a cell starting with = + - @ (or tab/CR before one) as a formula. A leading ' makes it text.
    text = FORMULA_START.test(value) ? `'${value}` : value
  } else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') text = String(value)
  else if (value instanceof Date) text = value.toISOString()
  else text = JSON.stringify(value)
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * RFC 4180 CSV: a header row, CRLF after every record, and fields containing `,` `"` CR or LF quoted with embedded
 * quotes doubled. null/undefined are empty, booleans true/false, objects and arrays JSON.
 *
 * Formula-injection guard: string values starting with = + - @ tab or CR get a leading `'` so a spreadsheet shows
 * them as text instead of evaluating them. Numbers are never prefixed, so a real negative number stays numeric; only
 * text that happens to start with `-` (e.g. a note "-2 oz") gains the `'`.
 */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map(csvField).join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvField(row[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

// ---- Time ----

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** "YYYY-MM-DD HH:mm" in `timeZone` for an ISO instant; empty for an unparseable one. */
export function localTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const t = wallTimeAt(ms, timeZone)
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}`
}

// ---- Files ----

function pick(row: ExportRow, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of columns) out[c] = row[c] ?? null
  return out
}

/** The ZIP entry of a photo: its file name under `photos/`. Only the last path segment is kept. */
function photoFile(storagePath: string): string {
  const name = storagePath.split('/').pop() ?? ''
  if (!name || name === '.' || name === '..') throw new Error(`invalid photo path: ${storagePath}`)
  return `photos/${name}`
}

type Lookup = (id: unknown) => string

function lookup(rows: readonly ExportRow[], nameColumn: string): Lookup {
  const names = new Map<unknown, string>()
  for (const row of rows) if (typeof row[nameColumn] === 'string') names.set(row.id, row[nameColumn] as string)
  return (id) => (id === null || id === undefined ? '' : (names.get(id) ?? ''))
}

interface CsvSpec {
  file: string
  key: TableKey
  /** Source id column → [added name column, lookup]; the name column is written right after the id column. */
  names: Record<string, [string, Lookup]>
  description: string
}

const README_HEADER = [
  'Roost household export',
  '======================',
  '',
  'This archive holds everything Roost stores about your household.',
  '',
  'Times: every timestamp column is an ISO 8601 instant in UTC (e.g. 2026-09-14T13:05:00+00:00). CSV files also have a',
  'matching "<column>_local" column with the same moment as "YYYY-MM-DD HH:mm" in the household time zone',
]

/**
 * Builds `household.json` (the complete export), one CSV per log type, and `README.txt`. CSVs start with a UTF-8 byte
 * order mark so spreadsheet apps read names with accents and emoji correctly.
 */
export function buildExportFiles(input: ExportInput, opts: ExportOptions): ExportFiles {
  const { timeZone, exportedAt } = opts
  const member = lookup(input.members, 'display_name')
  const child = lookup(input.children, 'name')
  const display = lookup(input.displays, 'name')
  const medicine = lookup(input.medicines, 'name')
  const routine = lookup(input.routines, 'name')
  const category = lookup(input.stickerCategories, 'name')
  const sitter = lookup(input.sitterSessions, 'sitter_name')

  const logNames: Record<string, [string, Lookup]> = {
    child_id: ['child_name', child],
    display_id: ['display_name', display],
    sitter_session_id: ['sitter_name', sitter],
  }

  const csvs: CsvSpec[] = [
    {
      file: 'doses.csv',
      key: 'doses',
      names: {
        ...logNames,
        medicine_id: ['medicine_name', medicine],
        conflict_acknowledged_by: ['conflict_acknowledged_by_name', member],
        voided_by: ['voided_by_name', member],
      },
      description: 'Medicine doses. Voided doses are kept, with voided_at and void_reason filled in.',
    },
    { file: 'sleeps.csv', key: 'sleeps', names: logNames, description: 'Naps and night sleep. end_at is empty while asleep.' },
    { file: 'feedings.csv', key: 'feedings', names: logNames, description: 'Milk, meals and snacks.' },
    { file: 'diapers.csv', key: 'diapers', names: logNames, description: 'Diaper changes.' },
    { file: 'stickers.csv', key: 'stickers', names: { ...logNames, category_id: ['category_name', category] }, description: 'Stickers awarded.' },
    { file: 'jots.csv', key: 'jots', names: { display_id: ['display_name', display] }, description: 'Jots (quick notes).' },
    {
      file: 'routine_progress.csv',
      key: 'routineProgress',
      names: { child_id: ['child_name', child], routine_id: ['routine_name', routine] },
      description: 'Routine steps completed per day (completed_step_indexes counts from 0).',
    },
    {
      file: 'sitter_sessions.csv',
      key: 'sitterSessions',
      names: { display_id: ['display_name', display], started_by: ['started_by_name', member], ended_by: ['ended_by_name', member] },
      description: 'Sitter Mode sessions and the adults who started and ended them.',
    },
    {
      file: 'settings_audit.csv',
      key: 'settingsAudit',
      names: { membership_id: ['membership_name', member] },
      description: 'Settings changes: who changed what, and when.',
    },
  ]

  const files: ExportFiles = {}

  const json: Record<string, unknown> = { format: 'roost-export', version: 1, exportedAt, timeZone }
  for (const key of Object.keys(EXPORT_TABLES) as TableKey[]) {
    const { columns } = EXPORT_TABLES[key]
    if (key === 'household') {
      json[key] = pick(input.household, columns)
    } else if (key === 'photos') {
      json[key] = input.photos.map((row) => ({ ...pick(row, columns), file: photoFile(String(row.storage_path ?? '')) }))
    } else {
      json[key] = input[key].map((row) => pick(row, columns))
    }
  }
  files['household.json'] = JSON.stringify(json, null, 2) + '\n'

  for (const spec of csvs) {
    const { columns, timestamps } = EXPORT_TABLES[spec.key]
    const header: string[] = []
    for (const c of columns) {
      header.push(c)
      if ((timestamps as readonly string[]).includes(c)) header.push(`${c}_local`)
      if (spec.names[c]) header.push(spec.names[c][0])
    }
    const rows = (input[spec.key] as readonly ExportRow[]).map((row) => {
      const out = pick(row, columns)
      for (const c of timestamps) out[`${c}_local`] = typeof out[c] === 'string' ? localTime(out[c] as string, timeZone) : ''
      for (const [idColumn, [nameColumn, resolve]] of Object.entries(spec.names)) out[nameColumn] = resolve(out[idColumn])
      // logged_by_name is the server's snapshot of who logged the entry (it survives the member's removal); fall back
      // to the membership's current name only when the snapshot is missing.
      if ('logged_by_name' in out && !out.logged_by_name) out.logged_by_name = member(out.logged_by_membership_id)
      return out
    })
    files[spec.file] = '\uFEFF' + toCsv(header, rows)
  }

  files['README.txt'] = [
    ...README_HEADER.slice(0, -1),
    `${README_HEADER.at(-1)} (${timeZone}).`,
    '',
    `Exported at ${exportedAt} (${localTime(exportedAt, timeZone)} ${timeZone}).`,
    '',
    'Files',
    '-----',
    'household.json',
    '  The complete export: household settings, members, displays, children, routines, medicines, every log, lists,',
    '  sitter sessions, settings history, photo details and calendar names and assignments. "format" and "version"',
    '  identify the layout.',
    ...csvs.flatMap((c) => [c.file, `  ${c.description}`]),
    'photos/',
    '  Your photos as JPEG files. household.json > photos lists each one with its "file" name.',
    '',
    'CSV notes',
    '---------',
    'Columns ending in _name (child_name, display_name, ...) show the name for the id beside them. logged_by_name is',
    'the name recorded when the entry was made. Text that starts with = + - or @ has a leading apostrophe (\') so',
    'spreadsheet apps do not run it as a formula. Lists and details are written as JSON.',
    '',
    'Not included: PINs, sign-in and link tokens, calendar passwords and connection secrets, and calendar events',
    '(Roost never stores events).',
    '',
  ].join('\r\n')

  return files
}

// ---- ZIP ----

/** The slice of fflate 0.8 used here. */
export interface FflateApi {
  zipSync(data: Record<string, [Uint8Array, { level: 0 | 6 }]>): Uint8Array
}

/**
 * Zips the export files (compressed) and the photos (stored with level 0: JPEGs are already compressed) under
 * `photos/<file name>`. Throws on duplicate entry names rather than silently dropping a file.
 */
export function zipExport(
  files: ExportFiles,
  photos: readonly { path: string; bytes: Uint8Array }[],
  fflate: FflateApi,
): Uint8Array {
  const encoder = new TextEncoder()
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  const add = (name: string, bytes: Uint8Array, level: 0 | 6) => {
    if (Object.hasOwn(entries, name)) throw new Error(`duplicate export entry: ${name}`)
    entries[name] = [bytes, { level }]
  }
  for (const [name, content] of Object.entries(files)) add(name, typeof content === 'string' ? encoder.encode(content) : content, 6)
  for (const photo of photos) add(photoFile(photo.path), photo.bytes, 0)
  return fflate.zipSync(entries)
}
