import type {
  Child, DiaperEntry, DoseEntry, Feature, FeedingEntry, Medicine, Routine, RoutineStep,
  SleepEntry, StickerEntry,
} from '@/domain/types'
import type {
  GroceryItem, HouseholdInfo, Jot, Member, RoutineDayOverride, RoutineProgress, SitterSession,
  SnapshotChild, StickerCategory,
} from './snapshot'
import type { Tables } from './database.types'

/** Truncate a Postgres `time` string ("HH:mm:ss") to "HH:mm". */
const hm = (t: string): string => t.slice(0, 5)

function assertOneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`Invalid ${what} "${value}"`)
  return value as T
}

const SLEEP_TYPES = ['nap', 'night'] as const
const FEEDING_TYPES = ['milk', 'meal', 'snack'] as const
const DIAPER_KINDS = ['wet', 'dirty', 'both'] as const
const MEMBER_ROLES = ['owner', 'adult', 'caregiver'] as const

export const FEATURES: readonly Feature[] = ['wakeWindow', 'feeding', 'kidsCorner', 'diaper']

export function toRoutineStep(raw: unknown): RoutineStep {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid routine step')
  const s = raw as Record<string, unknown>
  if (typeof s.label !== 'string') throw new Error('Invalid routine step')
  const time = typeof s.time === 'string' ? s.time.slice(0, 5) : null
  return {
    iconKey: typeof s.iconKey === 'string' ? s.iconKey : null,
    photoId: typeof s.photoId === 'string' ? s.photoId : null,
    label: s.label,
    time,
  }
}

export function toHousehold(row: Tables<'households'>): HouseholdInfo {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    defaultNightSleep: { start: hm(row.default_night_sleep_start), end: hm(row.default_night_sleep_end) },
    nightMode: { start: hm(row.night_mode_start), end: hm(row.night_mode_end) },
    leaveByBufferMin: row.leave_by_buffer_min,
    diaperLogEnabled: row.diaper_log_enabled,
    dinnerTonight: row.dinner_tonight,
  }
}

export function toChild(
  row: Tables<'children'>,
  overrideRows: { feature: string; enabled: boolean }[],
): SnapshotChild {
  const child: Child = {
    id: row.id,
    name: row.name,
    birthday: row.birthday,
    color: row.color,
    nightSleep:
      row.night_sleep_start !== null && row.night_sleep_end !== null
        ? { start: hm(row.night_sleep_start), end: hm(row.night_sleep_end) }
        : null,
  }
  const overrides: Partial<Record<Feature, boolean>> = {}
  for (const o of overrideRows) {
    if ((FEATURES as readonly string[]).includes(o.feature)) {
      overrides[o.feature as Feature] = o.enabled
    }
  }
  return { ...child, sortOrder: row.sort_order, overrides }
}

export function toMedicine(row: Tables<'medicines'>): Medicine {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    minIntervalHours: Number(row.min_interval_hours),
    maxDosesPer24h: row.max_doses_per_24h === null ? null : Number(row.max_doses_per_24h),
  }
}

export function toDose(row: Tables<'dose_entries'>): DoseEntry {
  return {
    id: row.id,
    childId: row.child_id,
    medicineId: row.medicine_id,
    at: row.at,
    loggedByName: row.logged_by_name,
    loggedOffline: row.logged_offline,
    voidedAt: row.voided_at,
    conflictAcknowledgedAt: row.conflict_acknowledged_at,
    createdAt: row.created_at,
    note: row.note,
    warningsConfirmed: row.warnings_confirmed,
  }
}

export function toRoutine(row: Tables<'routines'>): Routine {
  const rawSteps = Array.isArray(row.steps) ? row.steps : []
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    weekdays: row.weekdays,
    steps: rawSteps.map(toRoutineStep),
  }
}

export function toSleep(row: Tables<'sleep_entries'>): SleepEntry {
  return {
    id: row.id,
    childId: row.child_id,
    startAt: row.start_at,
    endAt: row.end_at,
    type: assertOneOf(row.type, SLEEP_TYPES, 'sleep type'),
  }
}

export function toFeeding(row: Tables<'feeding_entries'>): FeedingEntry {
  return {
    id: row.id,
    childId: row.child_id,
    at: row.at,
    type: assertOneOf(row.type, FEEDING_TYPES, 'feeding type'),
    amount: row.amount,
    note: row.note,
  }
}

export function toDiaper(row: Tables<'diaper_entries'>): DiaperEntry {
  return {
    id: row.id,
    childId: row.child_id,
    at: row.at,
    kind: assertOneOf(row.kind, DIAPER_KINDS, 'diaper kind'),
  }
}

export function toSticker(row: Tables<'sticker_entries'>): StickerEntry {
  return {
    id: row.id,
    childId: row.child_id,
    categoryId: row.category_id,
    at: row.at,
  }
}

export function toStickerCategory(row: Tables<'sticker_categories'>): StickerCategory {
  return {
    id: row.id,
    name: row.name,
    iconKey: row.icon_key,
    sortOrder: row.sort_order,
  }
}

export function toRoutineProgress(row: Tables<'routine_progress'>): RoutineProgress {
  return {
    childId: row.child_id,
    routineId: row.routine_id,
    day: row.day,
    completed: row.completed_step_indexes,
  }
}

export function toRoutineOverride(row: Tables<'routine_day_overrides'>): RoutineDayOverride {
  return {
    childId: row.child_id,
    day: row.day,
    routineId: row.routine_id,
  }
}

export function toJot(row: Tables<'jots'>): Jot {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    doneAt: row.done_at,
  }
}

export function toGrocery(row: Tables<'grocery_items'>): GroceryItem {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    checkedAt: row.checked_at,
  }
}

export function toSitterSession(row: Tables<'sitter_sessions'>): SitterSession {
  return {
    id: row.id,
    sitterName: row.sitter_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

export function toMember(row: Tables<'memberships'>): Member {
  return {
    id: row.id,
    displayName: row.display_name,
    color: row.color,
    role: assertOneOf(row.role, MEMBER_ROLES, 'member role'),
  }
}
