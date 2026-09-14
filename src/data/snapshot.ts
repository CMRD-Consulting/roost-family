import type {
  Child, DiaperEntry, DoseEntry, Feature, FeedingEntry, HouseholdDate, IsoTimestamp,
  Medicine, Routine, SleepEntry, StickerEntry, TimeWindow,
} from '@/domain/types'

export interface HouseholdInfo {
  id: string
  name: string
  timeZone: string
  defaultNightSleep: TimeWindow
  nightMode: TimeWindow
  leaveByBufferMin: number
  diaperLogEnabled: boolean
  dinnerTonight: string | null
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
  loadedAt: IsoTimestamp
}
