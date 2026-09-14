import type { DiaperEntry, DoseEntry, FeedingEntry, HouseholdDate, IsoTimestamp, SleepEntry, StickerEntry } from '@/domain/types'
import type { GroceryItem, Jot } from './snapshot'

export interface Attribution {
  displayId: string | null
  loggedByMembershipId: string | null
  sitterSessionId: string | null
  /** Shown optimistically until the server's logged_by_name snapshot arrives. */
  loggedByName: string | null
}

export type EntryTable = 'sleep_entries' | 'feeding_entries' | 'sticker_entries' | 'diaper_entries' | 'jots'

export type LogCommand =
  | { kind: 'sleep.start'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'sleep.end'; householdId: string; entryId: string; endAt: IsoTimestamp | null; previousEndAt: IsoTimestamp | null }
  | { kind: 'sleep.discard'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'sleep.restore'; householdId: string; entry: SleepEntry; attribution: Attribution }
  | { kind: 'feeding.add'; householdId: string; entry: FeedingEntry; attribution: Attribution }
  | { kind: 'dose.add'; householdId: string; entry: DoseEntry; attribution: Attribution }
  | { kind: 'sticker.add'; householdId: string; entry: StickerEntry; attribution: Attribution }
  | { kind: 'diaper.add'; householdId: string; entry: DiaperEntry; attribution: Attribution }
  | { kind: 'jot.add'; householdId: string; jot: Jot; displayId: string | null }
  | { kind: 'grocery.add'; householdId: string; item: GroceryItem; displayId: string | null }
  | { kind: 'grocery.check'; householdId: string; itemId: string; checkedAt: IsoTimestamp | null; previousCheckedAt: IsoTimestamp | null }
  | { kind: 'grocery.delete'; householdId: string; item: GroceryItem; displayId: string | null }
  | { kind: 'entry.delete'; householdId: string; table: EntryTable; entryId: string }
  | { kind: 'dose.void'; householdId: string; doseId: string; membershipId: string; pin: string; reason: string }
  | { kind: 'dose.acknowledge'; householdId: string; doseId: string; membershipId: string; pin: string }
  | { kind: 'dinner.set'; householdId: string; text: string | null; previous: string | null }
  | {
      kind: 'routine.complete'
      householdId: string
      childId: string
      routineId: string
      day: HouseholdDate
      /** Full new array of completed step indexes, sorted and unique. */
      completed: number[]
      previous: number[]
    }

/** Commands that need a live connection (PIN checks happen on the server). */
export function requiresOnline(cmd: LogCommand): boolean {
  return cmd.kind === 'dose.void' || cmd.kind === 'dose.acknowledge'
}

export function newId(): string {
  return crypto.randomUUID()
}
