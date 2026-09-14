import { describe, it, expect } from 'vitest'
import type { Tables } from './database.types'
import {
  toChild, toDiaper, toDose, toFeeding, toGrocery, toHousehold, toJot, toMedicine, toMember,
  toRoutine, toRoutineOverride, toRoutineProgress, toSitterInfo, toSitterSession, toSleep, toSticker,
  toStickerCategory,
} from './mappers'

const household = (over: Partial<Tables<'households'>> = {}): Tables<'households'> => ({
  id: 'h1',
  name: 'Rivera',
  time_zone: 'America/New_York',
  zip: null,
  lat: null,
  lon: null,
  plan: 'free',
  default_night_sleep_start: '18:00:00',
  default_night_sleep_end: '05:00:00',
  night_mode_start: '20:00:00',
  night_mode_end: '06:00:00',
  leave_by_buffer_min: 20,
  diaper_log_enabled: false,
  dinner_tonight: 'Tacos',
  sitter_info: {},
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
})

const childRow = (over: Partial<Tables<'children'>> = {}): Tables<'children'> => ({
  id: 'c1',
  name: 'Ivy',
  birthday: '2023-04-10',
  color: '#C2477A',
  photo_id: null,
  allergies: '',
  food_rules: '',
  night_sleep_start: '19:00:00',
  night_sleep_end: '06:00:00',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

const medicineRow = (over: Partial<Tables<'medicines'>> = {}): Tables<'medicines'> => ({
  id: 'm1',
  household_id: 'h1',
  child_id: 'c1',
  name: 'Infant ibuprofen',
  min_interval_hours: 6,
  max_doses_per_24h: 4,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

const doseRow = (over: Partial<Tables<'dose_entries'>> = {}): Tables<'dose_entries'> => ({
  id: 'd1',
  household_id: 'h1',
  child_id: 'c1',
  medicine_id: 'm1',
  at: '2026-09-14T17:00:00Z',
  note: '2.5 ml',
  logged_offline: false,
  warnings_confirmed: [],
  conflict_acknowledged_at: null,
  conflict_acknowledged_by: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  display_id: null,
  logged_by_membership_id: 'mem1',
  sitter_session_id: null,
  logged_by_name: 'Sam',
  created_at: '2026-09-14T17:00:00Z',
  updated_at: '2026-09-14T17:00:00Z',
  ...over,
})

const routineRow = (over: Partial<Tables<'routines'>> = {}): Tables<'routines'> => ({
  id: 'r1',
  household_id: 'h1',
  child_id: 'c1',
  name: 'Home day',
  weekdays: [1, 2, 3, 4, 5],
  steps: [{ iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: '07:00' }],
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

const sleepRow = (over: Partial<Tables<'sleep_entries'>> = {}): Tables<'sleep_entries'> => ({
  id: 's1',
  household_id: 'h1',
  child_id: 'c1',
  start_at: '2026-09-14T04:00:00Z',
  end_at: '2026-09-14T09:00:00Z',
  type: 'night',
  display_id: null,
  logged_by_membership_id: null,
  sitter_session_id: null,
  logged_by_name: null,
  created_at: '2026-09-14T04:00:00Z',
  updated_at: '2026-09-14T09:00:00Z',
  ...over,
})

const feedingRow = (over: Partial<Tables<'feeding_entries'>> = {}): Tables<'feeding_entries'> => ({
  id: 'f1',
  household_id: 'h1',
  child_id: 'c1',
  at: '2026-09-14T17:50:00Z',
  type: 'milk',
  amount: '6 oz',
  note: null,
  display_id: null,
  logged_by_membership_id: null,
  sitter_session_id: null,
  logged_by_name: null,
  created_at: '2026-09-14T17:50:00Z',
  updated_at: '2026-09-14T17:50:00Z',
  ...over,
})

const diaperRow = (over: Partial<Tables<'diaper_entries'>> = {}): Tables<'diaper_entries'> => ({
  id: 'di1',
  household_id: 'h1',
  child_id: 'c1',
  at: '2026-09-14T17:00:00Z',
  kind: 'wet',
  display_id: null,
  logged_by_membership_id: null,
  sitter_session_id: null,
  logged_by_name: null,
  created_at: '2026-09-14T17:00:00Z',
  updated_at: '2026-09-14T17:00:00Z',
  ...over,
})

const stickerRow = (over: Partial<Tables<'sticker_entries'>> = {}): Tables<'sticker_entries'> => ({
  id: 'st1',
  household_id: 'h1',
  child_id: 'c1',
  category_id: 'cat1',
  at: '2026-09-14T18:00:00Z',
  display_id: null,
  logged_by_membership_id: null,
  sitter_session_id: null,
  logged_by_name: null,
  created_at: '2026-09-14T18:00:00Z',
  updated_at: '2026-09-14T18:00:00Z',
  ...over,
})

const stickerCategoryRow = (over: Partial<Tables<'sticker_categories'>> = {}): Tables<'sticker_categories'> => ({
  id: 'cat1',
  household_id: 'h1',
  name: 'Potty',
  icon_key: 'potty',
  sort_order: 0,
  archived_at: null,
  ...over,
})

const routineProgressRow = (over: Partial<Tables<'routine_progress'>> = {}): Tables<'routine_progress'> => ({
  id: 'rp1',
  household_id: 'h1',
  child_id: 'c1',
  routine_id: 'r1',
  day: '2026-09-14',
  completed_step_indexes: [0, 1, 2],
  ...over,
})

const routineOverrideRow = (over: Partial<Tables<'routine_day_overrides'>> = {}): Tables<'routine_day_overrides'> => ({
  id: 'ro1',
  household_id: 'h1',
  child_id: 'c1',
  day: '2026-09-14',
  routine_id: 'r2',
  ...over,
})

const jotRow = (over: Partial<Tables<'jots'>> = {}): Tables<'jots'> => ({
  id: 'j1',
  household_id: 'h1',
  text: "Call pediatrician about Theo's rash",
  display_id: null,
  created_at: '2026-09-14T10:00:00Z',
  done_at: null,
  ...over,
})

const groceryRow = (over: Partial<Tables<'grocery_items'>> = {}): Tables<'grocery_items'> => ({
  id: 'g1',
  household_id: 'h1',
  text: 'Whole milk',
  display_id: null,
  created_at: '2026-09-14T10:00:00Z',
  checked_at: null,
  ...over,
})

const sitterSessionRow = (over: Partial<Tables<'sitter_sessions'>> = {}): Tables<'sitter_sessions'> => ({
  id: 'ss1',
  household_id: 'h1',
  display_id: null,
  sitter_name: 'Jess',
  started_at: '2026-09-14T10:00:00Z',
  ended_at: null,
  summary_shown_at: null,
  ...over,
})

const memberRow = (over: Partial<Tables<'memberships'>> = {}): Tables<'memberships'> => ({
  id: 'mem1',
  user_id: 'u1',
  household_id: 'h1',
  role: 'owner',
  display_name: 'Sam',
  color: '#653437',
  joined_at: '2026-01-01T00:00:00Z',
  left_at: null,
  ...over,
})

describe('toHousehold', () => {
  it('truncates time columns to HH:mm and passes dinner_tonight through', () => {
    expect(toHousehold(household())).toEqual({
      id: 'h1',
      name: 'Rivera',
      zip: null,
      timeZone: 'America/New_York',
      defaultNightSleep: { start: '18:00', end: '05:00' },
      nightMode: { start: '20:00', end: '06:00' },
      leaveByBufferMin: 20,
      diaperLogEnabled: false,
      dinnerTonight: 'Tacos',
      sitterInfo: {},
    })
  })

  it('passes a null dinner_tonight through', () => {
    expect(toHousehold(household({ dinner_tonight: null })).dinnerTonight).toBeNull()
  })

  it('maps sitter_info through toSitterInfo', () => {
    expect(toHousehold(household({ sitter_info: { bedtime: '7:00 PM', notes: 1 } })).sitterInfo).toEqual({ bedtime: '7:00 PM' })
  })
})

describe('toSitterInfo', () => {
  it('keeps every known string field', () => {
    const info = {
      napInstructions: 'Crib, sound machine on', bedtime: '7:00 PM', foodRules: 'No nuts', emergencyContacts: 'Sam 555-0101',
      pediatrician: 'Dr. Patel', address: '12 Maple St', whereThings: 'Diapers: hall closet',
    }
    expect(toSitterInfo(info)).toEqual(info)
  })

  it('drops non-string and unknown fields', () => {
    expect(toSitterInfo({ bedtime: 7, address: null, pediatrician: ['x'], whereThings: 'Hall closet', extra: 'nope' })).toEqual({
      whereThings: 'Hall closet',
    })
  })

  it.each([null, 'text', 42, ['bedtime'], undefined])('returns {} for a non-object (%s)', (raw) => {
    expect(toSitterInfo(raw)).toEqual({})
  })
})

describe('toChild', () => {
  it('maps a null night sleep window to null', () => {
    const child = toChild(childRow({ night_sleep_start: null, night_sleep_end: null }), [])
    expect(child.nightSleep).toBeNull()
  })

  it('maps a set night sleep window', () => {
    const child = toChild(childRow({ night_sleep_start: '19:00:00', night_sleep_end: '06:00:00' }), [])
    expect(child.nightSleep).toEqual({ start: '19:00', end: '06:00' })
  })

  it('builds overrides from known feature rows and ignores unknown features', () => {
    const child = toChild(childRow(), [
      { feature: 'wakeWindow', enabled: true },
      { feature: 'not-a-real-feature', enabled: true },
    ])
    expect(child.overrides).toEqual({ wakeWindow: true })
  })

  it('carries sort_order through as sortOrder', () => {
    expect(toChild(childRow({ sort_order: 3 }), []).sortOrder).toBe(3)
  })

  it('carries allergies and food rules for the Care Info panel', () => {
    const child = toChild(childRow({ allergies: 'Peanuts', food_rules: 'No whole grapes' }), [])
    expect(child).toMatchObject({ allergies: 'Peanuts', foodRules: 'No whole grapes' })
  })
})

describe('toMedicine', () => {
  it('coerces a PostgREST numeric string min_interval_hours to a number', () => {
    const medicine = toMedicine(medicineRow({ min_interval_hours: '6.0' as unknown as number }))
    expect(medicine.minIntervalHours).toBe(6)
  })

  it('passes a null max_doses_per_24h through', () => {
    expect(toMedicine(medicineRow({ max_doses_per_24h: null })).maxDosesPer24h).toBeNull()
  })
})

describe('toDose', () => {
  it('maps every field', () => {
    expect(
      toDose(
        doseRow({
          logged_by_name: 'Sam',
          logged_offline: true,
          voided_at: '2026-09-14T18:00:00Z',
          void_reason: 'Logged twice',
          conflict_acknowledged_at: '2026-09-14T18:05:00Z',
          created_at: '2026-09-14T17:30:00Z',
          note: '2.5 ml',
          warnings_confirmed: ['early'],
          sitter_session_id: 'sess-1',
        }),
      ),
    ).toEqual({
      id: 'd1',
      childId: 'c1',
      medicineId: 'm1',
      at: '2026-09-14T17:00:00Z',
      loggedByName: 'Sam',
      loggedOffline: true,
      voidedAt: '2026-09-14T18:00:00Z',
      voidReason: 'Logged twice',
      conflictAcknowledgedAt: '2026-09-14T18:05:00Z',
      createdAt: '2026-09-14T17:30:00Z',
      note: '2.5 ml',
      warningsConfirmed: ['early'],
      sitterSessionId: 'sess-1',
    })
  })
})

describe('toRoutine', () => {
  it('passes weekdays through', () => {
    expect(toRoutine(routineRow({ weekdays: [0, 6] })).weekdays).toEqual([0, 6])
  })

  it('maps valid steps to RoutineStep', () => {
    const routine = toRoutine(
      routineRow({
        steps: [
          { iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: '07:00:00' },
          { iconKey: null, photoId: 'photo-1', label: 'Brush teeth', time: null },
        ],
      }),
    )
    expect(routine.steps).toEqual([
      { iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: '07:00' },
      { iconKey: null, photoId: 'photo-1', label: 'Brush teeth', time: null },
    ])
  })

  it('skips a malformed step missing a label instead of throwing', () => {
    const routine = toRoutine(
      routineRow({
        steps: [
          { iconKey: 'breakfast', time: '07:00' }, // no label: dropped
          { iconKey: null, photoId: null, label: 'Brush teeth', time: null }, // kept
        ],
      }),
    )
    expect(routine.steps).toEqual([{ iconKey: null, photoId: null, label: 'Brush teeth', time: null }])
  })

  it('skips a non-object step', () => {
    const routine = toRoutine(routineRow({ steps: ['not an object', 42, null] }))
    expect(routine.steps).toEqual([])
  })

  it('treats an invalid time as null instead of dropping the step', () => {
    const routine = toRoutine(
      routineRow({ steps: [{ iconKey: null, photoId: null, label: 'Nap', time: 'not-a-time' }] }),
    )
    expect(routine.steps).toEqual([{ iconKey: null, photoId: null, label: 'Nap', time: null }])
  })

  it('accepts a valid time and truncates it to HH:mm', () => {
    const routine = toRoutine(
      routineRow({ steps: [{ iconKey: null, photoId: null, label: 'Bed', time: '23:59:59' }] }),
    )
    expect(routine.steps[0]?.time).toBe('23:59')
  })

  it('rejects an out-of-range time (hour 24) as null', () => {
    const routine = toRoutine(
      routineRow({ steps: [{ iconKey: null, photoId: null, label: 'Bed', time: '24:00' }] }),
    )
    expect(routine.steps[0]?.time).toBeNull()
  })
})

describe('toSleep', () => {
  it('maps field by field', () => {
    expect(toSleep(sleepRow({ sitter_session_id: 'sess-1' }))).toEqual({
      id: 's1',
      childId: 'c1',
      startAt: '2026-09-14T04:00:00Z',
      endAt: '2026-09-14T09:00:00Z',
      type: 'night',
      sitterSessionId: 'sess-1',
    })
  })

  it('maps an open (null end_at) entry', () => {
    expect(toSleep(sleepRow({ end_at: null, type: 'nap' })).endAt).toBeNull()
  })
})

describe('toFeeding', () => {
  it('maps field by field', () => {
    expect(toFeeding(feedingRow())).toEqual({
      id: 'f1',
      childId: 'c1',
      at: '2026-09-14T17:50:00Z',
      type: 'milk',
      amount: '6 oz',
      note: null,
      sitterSessionId: null,
    })
  })
})

describe('toDiaper', () => {
  it('maps field by field', () => {
    expect(toDiaper(diaperRow({ kind: 'both' }))).toEqual({
      id: 'di1',
      childId: 'c1',
      at: '2026-09-14T17:00:00Z',
      kind: 'both',
      sitterSessionId: null,
    })
  })
})

describe('toSticker', () => {
  it('maps field by field', () => {
    expect(toSticker(stickerRow())).toEqual({
      id: 'st1',
      childId: 'c1',
      categoryId: 'cat1',
      at: '2026-09-14T18:00:00Z',
      sitterSessionId: null,
    })
  })
})

describe('toStickerCategory', () => {
  it('maps field by field', () => {
    expect(toStickerCategory(stickerCategoryRow())).toEqual({
      id: 'cat1',
      name: 'Potty',
      iconKey: 'potty',
      sortOrder: 0,
    })
  })
})

describe('toRoutineProgress', () => {
  it('maps completed_step_indexes to completed', () => {
    expect(toRoutineProgress(routineProgressRow())).toEqual({
      childId: 'c1',
      routineId: 'r1',
      day: '2026-09-14',
      completed: [0, 1, 2],
    })
  })
})

describe('toRoutineOverride', () => {
  it('maps field by field', () => {
    expect(toRoutineOverride(routineOverrideRow())).toEqual({
      childId: 'c1',
      day: '2026-09-14',
      routineId: 'r2',
    })
  })
})

describe('toJot', () => {
  it('maps field by field', () => {
    expect(toJot(jotRow())).toEqual({
      id: 'j1',
      text: "Call pediatrician about Theo's rash",
      createdAt: '2026-09-14T10:00:00Z',
      doneAt: null,
    })
  })
})

describe('toGrocery', () => {
  it('maps field by field', () => {
    expect(toGrocery(groceryRow())).toEqual({
      id: 'g1',
      text: 'Whole milk',
      createdAt: '2026-09-14T10:00:00Z',
      checkedAt: null,
    })
  })
})

describe('toSitterSession', () => {
  it('maps field by field', () => {
    expect(toSitterSession(sitterSessionRow())).toEqual({
      id: 'ss1',
      sitterName: 'Jess',
      startedAt: '2026-09-14T10:00:00Z',
      endedAt: null,
      summaryShownAt: null,
    })
  })

  it('maps ended_at and summary_shown_at', () => {
    expect(toSitterSession(sitterSessionRow({ ended_at: '2026-09-14T12:00:00Z', summary_shown_at: '2026-09-14T12:01:00Z' }))).toMatchObject({
      endedAt: '2026-09-14T12:00:00Z',
      summaryShownAt: '2026-09-14T12:01:00Z',
    })
  })
})

describe('toMember', () => {
  it('maps field by field', () => {
    expect(toMember(memberRow())).toEqual({
      id: 'mem1',
      displayName: 'Sam',
      color: '#653437',
      role: 'owner',
    })
  })

  it('throws on an unknown role', () => {
    expect(() => toMember(memberRow({ role: 'ghost' }))).toThrow('Invalid member role')
  })
})
