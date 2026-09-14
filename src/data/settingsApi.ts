import type { Feature, RoutineStep, TimeWindow } from '@/domain/types'
import type { EntryTable } from './logCommands'
import type { PhotoKind, SitterInfo } from './snapshot'
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

/** Fields an adult can change on a non-dose log entry or jot from Settings > Logs and Inbox (spec §7.9). Only
 *  the keys present are written; the server allows only each table's own fields. Doses are never edited this way
 *  (spec §11.4): they are voided with `voidDose`. */
export interface EntryPatch {
  /** feeding, sticker and diaper entries */
  at?: string
  /** sleep entries */
  startAt?: string
  endAt?: string | null
  /** feeding entries */
  type?: 'milk' | 'meal' | 'snack'
  amount?: string | null
  note?: string | null
  /** sticker entries */
  categoryId?: string
  /** diaper entries */
  kind?: 'wet' | 'dirty' | 'both'
  /** jots: the text, and checked off (a timestamp) or reopened (null) */
  text?: string
  doneAt?: string | null
}

/** A current member of the household, as Settings > Members lists it. */
export interface MemberRow {
  membershipId: string
  displayName: string
  color: string
  role: 'owner' | 'adult' | 'caregiver'
  /** ISO timestamp; null when unknown (demo). */
  joinedAt: string | null
}

/** An active (not revoked) display of the household, as Settings > Displays lists it. */
export interface DisplayRow {
  displayId: string
  name: string
  /** ISO timestamp of the last heartbeat; null when it has never checked in. */
  lastSeenAt: string | null
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
  /** Sets the household's weather location (spec §5.6) from the tablet's position; the server rounds it to 2 decimals.
   *  The ZIP code never sets it. */
  setHouseholdLocation(auth: SettingsAuth, lat: number, lon: number): Promise<void>
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
  /** Edits one non-dose entry or jot, checked against the settings session's PIN and audited. 'invalid' with
   *  "That entry no longer exists." when it's gone. */
  updateEntry(auth: SettingsAuth, table: EntryTable, entryId: string, patch: EntryPatch): Promise<void>
  /** Deletes one non-dose entry or jot, checked against the settings session's PIN and audited (the UI also asks
   *  for a confirmation). 'invalid' with "That entry no longer exists." when it's gone. */
  deleteEntry(auth: SettingsAuth, table: EntryTable, entryId: string): Promise<void>
  /** Voids a dose with a reason (1–200 characters), checked against the settings session's PIN (spec §11.4). */
  voidDose(auth: SettingsAuth, doseId: string, reason: string): Promise<void>

  // ─── Photos (spec §7.9, §11.1) ────────────────────────────────────────────────────────────────────────
  /** Uploads an already prepared JPEG (see `prepareImage` in photosApi) to the household's private folder under a
   *  new id and returns the id. Not PIN-checked (storage lets members and displays upload into their own household's
   *  folder); the photo appears in the household only after `addPhoto`. */
  uploadPhoto(householdId: string, image: Blob): Promise<string>
  /** Adds an uploaded photo to the household. A household keeps at most 200 slideshow photos ('invalid' past that). */
  addPhoto(auth: SettingsAuth, photoId: string, kind: PhotoKind): Promise<void>
  /** Deletes the photo and its stored file, and clears any child or routine step that used it. */
  deletePhoto(auth: SettingsAuth, photoId: string): Promise<void>

  // ─── Full sign-in only (spec §6.3): members, displays, household deletion ─────────────────────────────
  createMemberInvite(client: AdultClient, householdId: string, role: 'owner' | 'adult'): Promise<{ token: string; expiresAt: string }>
  acceptMemberInvite(client: AdultClient, input: { token: string; displayName: string; color: string; pin: string }): Promise<string>
  /** Deletes an unused invite when the add-adult hand-off is cancelled. Runs on the display's own client: by then the
   *  owner's sign-in has ended, and the token itself authorizes it. Unknown or used tokens are a no-op. */
  revokeMemberInvite(token: string): Promise<void>
  setMemberRole(client: AdultClient, membershipId: string, role: 'owner' | 'adult'): Promise<void>
  removeMember(client: AdultClient, membershipId: string): Promise<void>
  leaveHousehold(client: AdultClient, householdId: string): Promise<void>
  /** Sets the signed-in adult's own PIN in the household (My account > Change my PIN). */
  setMyPin(client: AdultClient, householdId: string, pin: string): Promise<void>
  /** The signed-in adult's current membership in the household, or null when they aren't a member. */
  adultMembership(client: AdultClient, householdId: string, userId: string): Promise<{ membershipId: string; role: string } | null>
  /** Records the signed-in adult's acceptance of `policyVersion` with health-data consent (spec §6.4 step 3),
   *  which `acceptMemberInvite` requires. */
  recordConsent(client: AdultClient, policyVersion: string): Promise<void>
  /** Current members (not former), oldest first. Read with the owner's client (members can read memberships). */
  listMembers(client: AdultClient, householdId: string): Promise<MemberRow[]>
  /** Active displays, oldest first, with last-seen times. */
  listDisplays(client: AdultClient, householdId: string): Promise<DisplayRow[]>
  renameDisplay(client: AdultClient, displayId: string, name: string): Promise<void>
  /** Removes a display from the household at once (spec §6.3); that tablet shows "This display was removed". */
  revokeDisplay(client: AdultClient, displayId: string): Promise<void>
  deleteHousehold(client: AdultClient, householdId: string, confirmName: string): Promise<void>
}
