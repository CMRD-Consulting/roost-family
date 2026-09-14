import type {
  Child, DiaperEntry, DoseEntry, Feature, FeedingEntry, HouseholdDate, IsoTimestamp,
  Medicine, Routine, SleepEntry, StickerEntry, TimeWindow,
} from '@/domain/types'

/** Care notes a sitter sees in Sitter Mode (spec §7.6), edited in Settings. Every field is optional free text. */
export interface SitterInfo {
  napInstructions?: string
  bedtime?: string
  foodRules?: string
  emergencyContacts?: string
  pediatrician?: string
  address?: string
  whereThings?: string
}

export interface HouseholdInfo {
  id: string
  name: string
  /** 5-digit ZIP code, or null when not set. Optional: a device-cached snapshot from before it was loaded won't have it. */
  zip?: string | null
  timeZone: string
  defaultNightSleep: TimeWindow
  nightMode: TimeWindow
  leaveByBufferMin: number
  diaperLogEnabled: boolean
  dinnerTonight: string | null
  sitterInfo: SitterInfo
}

export interface Member {
  id: string
  displayName: string
  color: string
  role: 'owner' | 'adult' | 'caregiver'
}

export interface SnapshotChild extends Child {
  sortOrder: number
  overrides: Partial<Record<Feature, boolean>>
  /** Free text from the child profile, shown on the sitter's Care Info panel. Optional: a device-cached
   *  snapshot from before these were loaded won't have them. */
  allergies?: string
  foodRules?: string
}

export interface StickerCategory {
  id: string
  name: string
  iconKey: string
  sortOrder: number
}

export interface RoutineProgress {
  childId: string
  routineId: string
  day: HouseholdDate
  completed: number[]
}

export interface RoutineDayOverride {
  childId: string
  day: HouseholdDate
  routineId: string
}

export interface Jot {
  id: string
  text: string
  createdAt: IsoTimestamp
  doneAt: IsoTimestamp | null
}

export interface GroceryItem {
  id: string
  text: string
  createdAt: IsoTimestamp
  checkedAt: IsoTimestamp | null
}

export interface SitterSession {
  id: string
  sitterName: string | null
  startedAt: IsoTimestamp
  endedAt: IsoTimestamp | null
  /** When a display showed this session's "While You Were Out" summary; null until then. */
  summaryShownAt: IsoTimestamp | null
}

export interface HouseholdSnapshot {
  household: HouseholdInfo
  members: Member[]
  children: SnapshotChild[]
  medicines: Medicine[]
  doses: DoseEntry[]
  sleeps: SleepEntry[]
  feedings: FeedingEntry[]
  diapers: DiaperEntry[]
  stickerCategories: StickerCategory[]
  stickers: StickerEntry[]
  routines: Routine[]
  routineProgress: RoutineProgress[]
  routineOverrides: RoutineDayOverride[]
  jots: Jot[]
  groceries: GroceryItem[]
  activeSitterSession: SitterSession | null
  /** The oldest unseen session below, else the latest session that ended within the last 12 hours. */
  recentSitterSession: SitterSession | null
  /** Up to 3 sessions that ended within the last 12 hours and whose summary no display has shown, oldest first
   *  (drives the "see summary" banner). */
  unseenSitterSessions: SitterSession[]
  loadedAt: IsoTimestamp
}
