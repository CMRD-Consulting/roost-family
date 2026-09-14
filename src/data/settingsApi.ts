import type { Feature, RoutineStep, TimeWindow } from '@/domain/types'
import type { EntryTable } from './logCommands'
import type { SitterInfo } from './snapshot'
import type { RoostClient } from './supabase'

export type SettingsErrorCode = 'auth' | 'invalid' | 'network' | 'other'

/**
 * Thrown by every `SettingsApi` method. `code` is coarse (the UI doesn't parse messages):
 * 'auth' = wrong PIN, PIN from another household, or not signed in as the right adult (SQLSTATE 42501);
 * 'invalid' = the input failed a business rule (SQLSTATE 22023), safe to show near the offending field;
 * 'network' = worth retrying (dropped connection, expired session, server trouble);
 * 'other' = anything else.
 */
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly code: SettingsErrorCode,
  ) {
    super(message)
  }
}

/** A settings session's credentials, verified once by `settingsVerify` and resent with every PIN-checked RPC
 *  (the server re-checks the PIN every time; nothing trusts the UI). */
export interface SettingsAuth {
  membershipId: string
  pin: string
}

/** A signed-in adult's client (spec §6.3), for the RPCs that require a full sign-in rather than a PIN:
 *  members, displays, and household deletion. */
export type AdultClient = RoostClient

export interface HouseholdSettingsInput {
  name: string
  zip: string | null
  timeZone: string
  leaveByBufferMin: number
  defaultNightSleep: TimeWindow
  nightMode: TimeWindow
  diaperLogEnabled: boolean
}

export interface AddChildInput {
  name: string
  birthday: string
  color: string
}

export interface UpdateChildInput {
  childId: string
  name: string
  birthday: string
  color: string
  allergies: string
  foodRules: string
  /** null = use the household default window; both times are set or both are null. */
  nightSleep: TimeWindow | null
}

export interface RoutineInput {
  /** null creates a new routine. */
  routineId: string | null
  childId: string
  name: string
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  /** At most 20. */
  steps: RoutineStep[]
}

export interface MedicineInput {
  /** null creates a new medicine; an existing medicine's child cannot change. */
  medicineId: string | null
  childId: string
  name: string
  minIntervalHours: number
  maxDosesPer24h: number | null
}

export interface StickerCategoryInput {
  /** null creates a new category. */
  categoryId: string | null
  name: string
  iconKey: string
  /** null appends (new category) or keeps the existing order (update). */
  sortOrder: number | null
}

/** Tables `listEntries` can read for the Logs section. Doses are included for the Medicine filter, but (unlike
 *  the other four) can never be bulk-deleted by `deleteOldEntries` — they are append-only (spec §11.4). */
export type LogTable = EntryTable | 'dose_entries'

export interface ListEntriesQuery {
  table: LogTable
  childId?: string
  /** Only rows strictly before this ISO timestamp, for "load more" paging. */
  before?: string
  limit: number
}

/** One row read directly from a log table (not the domain model), for the Logs section. */
export interface LogEntryRow {
  id: string
  childId: string
  /** The value of whichever time column applies to `table` (start_at/at/created_at). */
  at: string
  loggedByName: string | null
  /** Every column from the table, snake_case, for the caller to interpret per table. */
  row: Record<string, unknown>
}

/**
 * Every configuration change goes through this interface (spec §7.9). Most methods are PIN-checked
 * (`SettingsAuth`, re-verified by the server on every call); the members/displays/deletion methods instead
 * require a full adult sign-in (`AdultClient`, spec §6.3) and are not available in demo mode.
 */
export interface SettingsApi {
  /** Enters a settings session: verifies the PIN and returns the membership's role and display name. */
  settingsVerify(auth: SettingsAuth): Promise<{ role: string; displayName: string }>

  updateHouseholdSettings(auth: SettingsAuth, input: HouseholdSettingsInput): Promise<void>
  updateSitterInfo(auth: SettingsAuth, info: SitterInfo): Promise<void>

  addChild(auth: SettingsAuth, input: AddChildInput): Promise<string>
  updateChild(auth: SettingsAuth, input: UpdateChildInput): Promise<void>
  /** `enabled` null clears the override, back to the age-based default. */
  setFeatureOverride(auth: SettingsAuth, childId: string, feature: Feature, enabled: boolean | null): Promise<void>

  upsertRoutine(auth: SettingsAuth, input: RoutineInput): Promise<string>
  deleteRoutine(auth: SettingsAuth, routineId: string): Promise<void>
  /** "Switch today's routine" for `childId` on `day` (household date). `routineId` null clears the override. */
  setRoutineDayOverride(auth: SettingsAuth, childId: string, day: string, routineId: string | null): Promise<void>

  upsertMedicine(auth: SettingsAuth, input: MedicineInput): Promise<string>
  archiveMedicine(auth: SettingsAuth, medicineId: string): Promise<void>

  upsertStickerCategory(auth: SettingsAuth, input: StickerCategoryInput): Promise<string>
  archiveStickerCategory(auth: SettingsAuth, categoryId: string): Promise<void>

  setMyColor(auth: SettingsAuth, color: string): Promise<void>

  /** Bulk-deletes `table` entries older than `before` (which must be at least 2 years ago). Returns the count deleted. */
  deleteOldEntries(auth: SettingsAuth, table: EntryTable, before: string): Promise<number>
  /** Reads a page of one log table directly (not PIN-checked: it's a read, and the display can always read its
   *  own household's logs). Newest first; pass the last row's `at` as `before` to load more. */
  listEntries(query: ListEntriesQuery): Promise<LogEntryRow[]>

  // ─── Full sign-in only (spec §6.3): members, displays, household deletion ─────────────────────────────
  createMemberInvite(client: AdultClient, householdId: string, role: 'owner' | 'adult'): Promise<{ token: string; expiresAt: string }>
  acceptMemberInvite(client: AdultClient, input: { token: string; displayName: string; color: string; pin: string }): Promise<string>
  setMemberRole(client: AdultClient, membershipId: string, role: 'owner' | 'adult'): Promise<void>
  removeMember(client: AdultClient, membershipId: string): Promise<void>
  leaveHousehold(client: AdultClient, householdId: string): Promise<void>
  renameDisplay(client: AdultClient, displayId: string, name: string): Promise<void>
  deleteHousehold(client: AdultClient, householdId: string, confirmName: string): Promise<void>
}
