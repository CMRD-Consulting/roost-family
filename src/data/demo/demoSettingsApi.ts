import type { Feature } from '@/domain/types'
import type { EntryTable } from '../logCommands'
import {
  SettingsError,
  type AddChildInput,
  type AdultClient,
  type DisplayRow,
  type EntryPatch,
  type HouseholdSettingsInput,
  type ListEntriesQuery,
  type LogEntryRow,
  type LogTable,
  type MemberRow,
  type MedicineInput,
  type RoutineInput,
  type SettingsApi,
  type SettingsAuth,
  type StickerCategoryInput,
  type UpdateChildInput,
} from '../settingsApi'
import { MAX_SLIDESHOW_PHOTOS } from '../photosApi'
import type { HouseholdSnapshot, PhotoKind, SitterInfo, StickerCategory } from '../snapshot'
import { getDemoSnapshot, mutateDemo } from './demoHousehold'

/** Membership id -> PIN, for the two demo adults (same as `createDemoLogWriter`). */
const DEMO_PINS: Record<string, string> = {
  'bbbbbbbb-0000-0000-0000-000000000001': '1234', // Sam
  'bbbbbbbb-0000-0000-0000-000000000002': '5678', // Alex
}

function pinOk(membershipId: string, pin: string): boolean {
  return DEMO_PINS[membershipId] === pin
}

function requirePin(auth: SettingsAuth): void {
  if (!pinOk(auth.membershipId, auth.pin)) throw new SettingsError('Incorrect PIN', 'auth')
}

function updateById<T extends { id: string }>(list: T[], id: string, fn: (x: T) => T): T[] {
  const index = list.findIndex((x) => x.id === id)
  if (index === -1) throw new SettingsError('Not found', 'other')
  const copy = list.slice()
  copy[index] = fn(list[index]!)
  return copy
}

const TIME_COLUMN: Record<LogTable, string> = {
  sleep_entries: 'startAt',
  feeding_entries: 'at',
  sticker_entries: 'at',
  diaper_entries: 'at',
  dose_entries: 'at',
  jots: 'createdAt',
}

/** The snapshot array each `listEntries`/`deleteOldEntries` table reads from. Cast to a generic row shape
 *  (rather than each entry's own interface) since the caller picks fields out by a table-dependent key. */
function entriesFor(snapshot: HouseholdSnapshot, table: LogTable): Array<Record<string, unknown>> {
  const list = (() => {
    switch (table) {
      case 'sleep_entries':
        return snapshot.sleeps
      case 'feeding_entries':
        return snapshot.feedings
      case 'sticker_entries':
        return snapshot.stickers
      case 'diaper_entries':
        return snapshot.diapers
      case 'dose_entries':
        return snapshot.doses
      case 'jots':
        return snapshot.jots
    }
  })()
  return list as unknown as Array<Record<string, unknown>>
}

/** The demo snapshot's camelCase entry as the table row `listEntries` promises (snake_case columns). */
function toSnakeRow(entry: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]))
}

/** The snapshot key holding each table's entries. */
const SNAPSHOT_KEY = {
  sleep_entries: 'sleeps',
  feeding_entries: 'feedings',
  sticker_entries: 'stickers',
  diaper_entries: 'diapers',
  jots: 'jots',
} as const satisfies Record<EntryTable, keyof HouseholdSnapshot>

/** Same id as `DEMO_DISPLAY` in householdSource (not imported: householdSource loads this module). */
const DEMO_DISPLAY_ID = 'demo-display'

/** Renaming "this display" isn't part of the demo household (there is exactly one, fixed, display); a
 *  module-local name stands in so the My devices/Displays screens have something to show and change. */
let demoDisplayName = 'Kitchen'

/** Demo uploads not yet added: photo id -> object URL standing in for the storage path. */
const demoUploads = new Map<string, string>()

/** Test-only: resets the demo display name changed by `renameDisplay` and forgets pending uploads. */
export function resetDemoSettingsApiForTests(): void {
  demoDisplayName = 'Kitchen'
  demoUploads.clear()
}

/** Test-only: the current demo display name, as changed by `renameDisplay`. */
export function getDemoDisplayName(): string {
  return demoDisplayName
}

/**
 * Demo-mode `SettingsApi`: every PIN-checked method mutates the shared in-memory demo household (spec §7.9),
 * so the whole Settings UI can be exercised without a server. The full-sign-in-only methods (members, most of
 * displays, deletion) have no demo backing and refuse; `setMemberRole` and `renameDisplay` are the exceptions
 * called out in the plan, and mutate.
 */
export function createDemoSettingsApi(): SettingsApi {
  async function settingsVerify(auth: SettingsAuth) {
    requirePin(auth)
    const member = getDemoSnapshot(new Date()).members.find((m) => m.id === auth.membershipId)
    if (!member) throw new SettingsError('Incorrect PIN', 'auth')
    return { role: member.role, displayName: member.displayName }
  }

  async function updateHouseholdSettings(auth: SettingsAuth, input: HouseholdSettingsInput): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({
      ...s,
      household: {
        ...s.household,
        name: input.name,
        zip: input.zip,
        timeZone: input.timeZone,
        leaveByBufferMin: input.leaveByBufferMin,
        defaultNightSleep: input.defaultNightSleep,
        nightMode: input.nightMode,
        diaperLogEnabled: input.diaperLogEnabled,
      },
    }))
  }

  async function updateSitterInfo(auth: SettingsAuth, info: SitterInfo): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({ ...s, household: { ...s.household, sitterInfo: info } }))
  }

  async function addChild(auth: SettingsAuth, input: AddChildInput): Promise<string> {
    requirePin(auth)
    const id = crypto.randomUUID()
    mutateDemo((s) => {
      if (s.children.length >= 8) throw new SettingsError('A household can have at most 8 children', 'invalid')
      const sortOrder = s.children.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1
      const child = { id, name: input.name, birthday: input.birthday, color: input.color, nightSleep: null, sortOrder, overrides: {} }
      return { ...s, children: [...s.children, child] }
    })
    return id
  }

  async function updateChild(auth: SettingsAuth, input: UpdateChildInput): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({
      ...s,
      children: updateById(s.children, input.childId, (c) => ({
        ...c,
        name: input.name,
        birthday: input.birthday,
        color: input.color,
        allergies: input.allergies,
        foodRules: input.foodRules,
        nightSleep: input.nightSleep,
      })),
    }))
  }

  async function setFeatureOverride(auth: SettingsAuth, childId: string, feature: Feature, enabled: boolean | null): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({
      ...s,
      children: updateById(s.children, childId, (c) => {
        const overrides = { ...c.overrides }
        if (enabled === null) delete overrides[feature]
        else overrides[feature] = enabled
        return { ...c, overrides }
      }),
    }))
  }

  async function upsertRoutine(auth: SettingsAuth, input: RoutineInput): Promise<string> {
    requirePin(auth)
    const id = input.routineId ?? crypto.randomUUID()
    mutateDemo((s) => {
      const routine = { id, childId: input.childId, name: input.name, weekdays: input.weekdays, steps: input.steps }
      if (input.routineId === null) return { ...s, routines: [...s.routines, routine] }
      return { ...s, routines: updateById(s.routines, input.routineId, () => routine) }
    })
    return id
  }

  async function deleteRoutine(auth: SettingsAuth, routineId: string): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({
      ...s,
      routines: s.routines.filter((r) => r.id !== routineId),
      routineProgress: s.routineProgress.filter((p) => p.routineId !== routineId),
      routineOverrides: s.routineOverrides.filter((o) => o.routineId !== routineId),
    }))
  }

  async function setRoutineDayOverride(auth: SettingsAuth, childId: string, day: string, routineId: string | null): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => {
      const without = s.routineOverrides.filter((o) => !(o.childId === childId && o.day === day))
      if (routineId === null) return { ...s, routineOverrides: without }
      return { ...s, routineOverrides: [...without, { childId, day, routineId }] }
    })
  }

  async function upsertMedicine(auth: SettingsAuth, input: MedicineInput): Promise<string> {
    requirePin(auth)
    const id = input.medicineId ?? crypto.randomUUID()
    mutateDemo((s) => {
      const medicine = {
        id, childId: input.childId, name: input.name, minIntervalHours: input.minIntervalHours, maxDosesPer24h: input.maxDosesPer24h,
      }
      if (input.medicineId === null) return { ...s, medicines: [...s.medicines, medicine] }
      return { ...s, medicines: updateById(s.medicines, input.medicineId, () => medicine) }
    })
    return id
  }

  // Archiving is invisible in the loaded snapshot in the real system too (supabaseSource only loads
  // medicines/categories with archived_at null), so archiving here just removes it.
  async function archiveMedicine(auth: SettingsAuth, medicineId: string): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({ ...s, medicines: s.medicines.filter((m) => m.id !== medicineId) }))
  }

  async function upsertStickerCategory(auth: SettingsAuth, input: StickerCategoryInput): Promise<string> {
    requirePin(auth)
    const id = input.categoryId ?? crypto.randomUUID()
    mutateDemo((s) => {
      const existing = s.stickerCategories.find((c) => c.id === input.categoryId)
      const sortOrder = input.sortOrder ?? existing?.sortOrder ??
        s.stickerCategories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1
      const category: StickerCategory = { id, name: input.name, iconKey: input.iconKey, sortOrder }
      if (input.categoryId === null) return { ...s, stickerCategories: [...s.stickerCategories, category] }
      return { ...s, stickerCategories: updateById(s.stickerCategories, input.categoryId, () => category) }
    })
    return id
  }

  async function archiveStickerCategory(auth: SettingsAuth, categoryId: string): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({ ...s, stickerCategories: s.stickerCategories.filter((c) => c.id !== categoryId) }))
  }

  async function setMyColor(auth: SettingsAuth, color: string): Promise<void> {
    requirePin(auth)
    mutateDemo((s) => ({
      ...s,
      members: s.members.map((m) => (m.id === auth.membershipId ? { ...m, color } : m)),
    }))
  }

  async function deleteOldEntries(auth: SettingsAuth, table: EntryTable, before: string): Promise<number> {
    requirePin(auth)
    let removed = 0
    mutateDemo((s) => {
      const timeKey = TIME_COLUMN[table]
      const kept = entriesFor(s, table).filter((row) => {
        const keep = (row[timeKey] as string) >= before
        if (!keep) removed++
        return keep
      })
      switch (table) {
        case 'sleep_entries':
          return { ...s, sleeps: kept as unknown as HouseholdSnapshot['sleeps'] }
        case 'feeding_entries':
          return { ...s, feedings: kept as unknown as HouseholdSnapshot['feedings'] }
        case 'sticker_entries':
          return { ...s, stickers: kept as unknown as HouseholdSnapshot['stickers'] }
        case 'diaper_entries':
          return { ...s, diapers: kept as unknown as HouseholdSnapshot['diapers'] }
        case 'jots':
          return { ...s, jots: kept as unknown as HouseholdSnapshot['jots'] }
      }
    })
    return removed
  }

  async function listEntries(query: ListEntriesQuery): Promise<LogEntryRow[]> {
    const snapshot = getDemoSnapshot(new Date())
    const timeKey = TIME_COLUMN[query.table]
    let rows = entriesFor(snapshot, query.table)
    if (query.childId) rows = rows.filter((r) => r.childId === query.childId)
    if (query.before) rows = rows.filter((r) => (r[timeKey] as string) < query.before!)
    rows = rows.slice().sort((a, b) => (b[timeKey] as string).localeCompare(a[timeKey] as string)).slice(0, query.limit)
    return rows.map((row) => ({
      id: row.id as string,
      childId: row.childId as string,
      at: row[timeKey] as string,
      loggedByName: (row.loggedByName as string | null | undefined) ?? null,
      row: toSnakeRow(row),
    }))
  }

  async function updateEntry(table: EntryTable, entryId: string, patch: EntryPatch): Promise<void> {
    const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    mutateDemo((s) => {
      const key = SNAPSHOT_KEY[table]
      const list = s[key] as unknown as Array<{ id: string }>
      if (!list.some((e) => e.id === entryId)) throw new SettingsError('That entry no longer exists.', 'invalid')
      return { ...s, [key]: list.map((e) => (e.id === entryId ? { ...e, ...changes } : e)) }
    })
  }

  async function deleteEntry(table: EntryTable, entryId: string): Promise<void> {
    mutateDemo((s) => {
      const key = SNAPSHOT_KEY[table]
      return { ...s, [key]: (s[key] as unknown as Array<{ id: string }>).filter((e) => e.id !== entryId) }
    })
  }

  async function voidDose(auth: SettingsAuth, doseId: string, reason: string): Promise<void> {
    requirePin(auth)
    const trimmed = reason.trim()
    if ([...trimmed].length < 1 || [...trimmed].length > 200) {
      throw new SettingsError('a void reason of 1 to 200 characters is required', 'invalid')
    }
    mutateDemo((s) => ({
      ...s,
      doses: updateById(s.doses, doseId, (d) => {
        if (d.voidedAt !== null) throw new SettingsError('dose is already voided', 'invalid')
        return { ...d, voidedAt: new Date().toISOString(), voidReason: trimmed }
      }),
    }))
  }

  // The demo keeps photos in this browser tab: an object URL stands in for the storage path.
  async function uploadPhoto(_householdId: string, image: Blob): Promise<string> {
    const id = crypto.randomUUID()
    demoUploads.set(id, URL.createObjectURL(image))
    return id
  }

  async function addPhoto(auth: SettingsAuth, photoId: string, kind: PhotoKind): Promise<void> {
    requirePin(auth)
    const url = demoUploads.get(photoId)
    if (url === undefined) throw new SettingsError('upload the photo before adding it', 'invalid')
    mutateDemo((s) => {
      const photos = s.photos ?? []
      if (kind === 'slideshow' && photos.filter((p) => p.kind === 'slideshow').length >= MAX_SLIDESHOW_PHOTOS) {
        throw new SettingsError(`a household can have at most ${MAX_SLIDESHOW_PHOTOS} slideshow photos`, 'invalid')
      }
      return { ...s, photos: [...photos, { id: photoId, storagePath: url, kind, addedAt: new Date().toISOString() }] }
    })
    demoUploads.delete(photoId)
  }

  async function deletePhoto(auth: SettingsAuth, photoId: string): Promise<void> {
    requirePin(auth)
    const photo = getDemoSnapshot(new Date()).photos?.find((p) => p.id === photoId)
    if (!photo) throw new SettingsError('photo not found', 'auth')
    mutateDemo((s) => ({ ...s, photos: (s.photos ?? []).filter((p) => p.id !== photoId) }))
    if (photo.storagePath.startsWith('blob:')) URL.revokeObjectURL(photo.storagePath)
  }

  // ─── Full sign-in only: no demo backing except role changes and display rename ───────────────────────
  async function notAvailable(): Promise<never> {
    throw new SettingsError('Not available in demo', 'other')
  }

  async function listMembers(): Promise<MemberRow[]> {
    return getDemoSnapshot(new Date()).members.map((m) => ({
      membershipId: m.id, displayName: m.displayName, color: m.color, role: m.role, joinedAt: null,
    }))
  }

  async function listDisplays(): Promise<DisplayRow[]> {
    return [{ displayId: DEMO_DISPLAY_ID, name: demoDisplayName, lastSeenAt: new Date().toISOString() }]
  }

  async function setMemberRole(_client: AdultClient, membershipId: string, role: 'owner' | 'adult'): Promise<void> {
    const members = getDemoSnapshot(new Date()).members
    const target = members.find((m) => m.id === membershipId)
    if (!target) throw new SettingsError('Not found', 'other')
    if (target.role === 'owner' && role !== 'owner' && !members.some((m) => m.id !== membershipId && m.role === 'owner')) {
      throw new SettingsError('a household must keep at least one owner', 'invalid')
    }
    mutateDemo((s) => ({ ...s, members: s.members.map((m) => (m.id === membershipId ? { ...m, role } : m)) }))
  }

  async function renameDisplay(_client: AdultClient, _displayId: string, name: string): Promise<void> {
    demoDisplayName = name
  }

  return {
    settingsVerify,
    updateHouseholdSettings,
    updateSitterInfo,
    addChild,
    updateChild,
    setFeatureOverride,
    upsertRoutine,
    deleteRoutine,
    setRoutineDayOverride,
    upsertMedicine,
    archiveMedicine,
    upsertStickerCategory,
    archiveStickerCategory,
    setMyColor,
    deleteOldEntries,
    listEntries,
    updateEntry,
    deleteEntry,
    voidDose,
    uploadPhoto,
    addPhoto,
    deletePhoto,
    createMemberInvite: notAvailable,
    acceptMemberInvite: notAvailable,
    setMemberRole,
    removeMember: notAvailable,
    leaveHousehold: notAvailable,
    setMyPin: notAvailable,
    adultMembership: notAvailable,
    recordConsent: notAvailable,
    listMembers,
    listDisplays,
    renameDisplay,
    revokeDisplay: notAvailable,
    deleteHousehold: notAvailable,
  }
}
