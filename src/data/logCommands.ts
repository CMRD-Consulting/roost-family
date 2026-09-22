import type { DiaperEntry, DoseEntry, FeedingEntry, HouseholdDate, IsoTimestamp, SleepEntry, StickerEntry } from '@/domain/types'
import type { GroceryItem, Jot, ShoppingList, Task } from './snapshot'

export interface Attribution {
  displayId: string | null
  loggedByMembershipId: string | null
  sitterSessionId: string | null
  /** Shown optimistically until the server's logged_by_name snapshot arrives. */
  loggedByName: string | null
}

export type EntryTable = 'sleep_entries' | 'feeding_entries' | 'sticker_entries' | 'diaper_entries' | 'jots'

/** The editable fields of a task: what `task.update` sets, and what it carries as the state it replaced. */
export interface TaskFields {
  text: string
  assignedMembershipId: string | null
  dueOn: HouseholdDate | null
}

/** What a day's plan held: the label shown and, when planned from the recipe box, the recipe. */
export interface MealFields {
  text: string
  recipeId: string | null
}

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
  /** The item carries its own `listId` (spec §3.1). An empty one lands on the household's default list, which is
   *  what keeps an item queued by an older build replayable. */
  | { kind: 'grocery.add'; householdId: string; item: GroceryItem; displayId: string | null }
  | { kind: 'grocery.check'; householdId: string; itemId: string; checkedAt: IsoTimestamp | null; previousCheckedAt: IsoTimestamp | null }
  | { kind: 'grocery.delete'; householdId: string; item: GroceryItem; displayId: string | null }
  // Shopping lists (spec §3.1, §7.1). Lists archive, they never delete, and every command carries the before-state
  // its inverse needs, since an inverse is built without the snapshot.
  | { kind: 'list.add'; householdId: string; list: ShoppingList }
  | { kind: 'list.rename'; householdId: string; listId: string; name: string; previousName: string }
  | { kind: 'list.archive'; householdId: string; listId: string; archivedAt: IsoTimestamp; previousArchivedAt: IsoTimestamp | null }
  | { kind: 'list.restore'; householdId: string; listId: string; previousArchivedAt: IsoTimestamp }
  // To-dos (spec §4.1, §7.1).
  | { kind: 'task.add'; householdId: string; task: Task; displayId: string | null }
  | { kind: 'task.check'; householdId: string; taskId: string; doneAt: IsoTimestamp | null; previousDoneAt: IsoTimestamp | null }
  | {
      kind: 'task.update'
      householdId: string
      taskId: string
      text: string
      assignedMembershipId: string | null
      dueOn: HouseholdDate | null
      previous: TaskFields
    }
  | { kind: 'task.delete'; householdId: string; task: Task; displayId: string | null }
  /** One planned dinner per day (`unique (household_id, day)`), so the day is the key, not an id. `previous` is
   *  null when nothing was planned for that day. */
  | { kind: 'meal.set'; householdId: string; day: HouseholdDate; text: string; recipeId: string | null; previous: MealFields | null }
  | { kind: 'meal.clear'; householdId: string; day: HouseholdDate; previous: MealFields }
  | { kind: 'entry.delete'; householdId: string; table: EntryTable; entryId: string }
  | { kind: 'dose.void'; householdId: string; doseId: string; membershipId: string; pin: string; reason: string }
  | { kind: 'dose.acknowledge'; householdId: string; doseId: string; membershipId: string; pin: string }
  | { kind: 'dinner.set'; householdId: string; text: string | null; previous: string | null }
  | {
      /** Marks one routine step done (or not done). Only that step changes, so two displays never overwrite each other. */
      kind: 'routine.step'
      householdId: string
      childId: string
      routineId: string
      day: HouseholdDate
      stepIndex: number
      done: boolean
    }
  | {
      /** Starts Sitter Mode for the household with an adult's PIN. `sessionId` is made on the device and stored as
       *  the session's id, so the optimistic session and the server's are the same one. */
      kind: 'sitter.start'
      householdId: string
      sessionId: string
      membershipId: string
      pin: string
      sitterName: string | null
      displayId: string | null
      startedAt: IsoTimestamp
    }
  | { kind: 'sitter.end'; householdId: string; sessionId: string; membershipId: string; pin: string; endedAt: IsoTimestamp }
  | { kind: 'sitter.summaryShown'; householdId: string; sessionId: string }

/** Commands that need a live connection (PIN checks happen on the server). */
export function requiresOnline(cmd: LogCommand): boolean {
  switch (cmd.kind) {
    case 'dose.void':
    case 'dose.acknowledge':
    case 'sitter.start':
    case 'sitter.end':
    case 'sitter.summaryShown':
      return true
    default:
      return false
  }
}

export function newId(): string {
  return crypto.randomUUID()
}
