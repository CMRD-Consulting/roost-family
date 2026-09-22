/**
 * To-do tab (kitchen spec §4.2): the filter chips with their open counts, the rows grouped by when they are
 * due, and the due-date choices the task sheet offers. Pure — no Vue, no stores.
 */
import type { Member, Task } from '@/data/snapshot'
import type { HouseholdDate } from '@/domain/types'

const DAY_MS = 24 * 3_600_000

export const MAX_TASK_TEXT = 100
export const EMPTY_TODO_MESSAGE = 'Nothing to do.'

/** The two filters that are not a membership id. */
export const ALL_FILTER = 'all'
export const FAMILY_FILTER = 'family'

/** `all`, `family`, or an adult's membership id. */
export type TodoFilter = string

export interface TodoFilterChip {
  value: TodoFilter
  label: string
  /** Open to-dos this filter would show. */
  count: number
  /** The adult's person colour, or null for All and Family (never colour alone — chips carry the name). */
  color: string | null
}

/** Children are not assignees (kitchen spec §2); neither are caregiver memberships. */
export function assignableMembers(members: Member[]): Member[] {
  return members.filter((member) => member.role === 'owner' || member.role === 'adult')
}

export function todoFilters(tasks: Task[] | undefined, members: Member[]): TodoFilterChip[] {
  const open = (tasks ?? []).filter((task) => task.doneAt === null)
  return [
    { value: ALL_FILTER, label: 'All', count: open.length, color: null },
    {
      value: FAMILY_FILTER,
      label: 'Family',
      count: open.filter((task) => task.assignedMembershipId === null).length,
      color: null,
    },
    ...assignableMembers(members).map((member) => ({
      value: member.id,
      label: member.displayName,
      count: open.filter((task) => task.assignedMembershipId === member.id).length,
      color: member.color,
    })),
  ]
}

/** A to-do added under `filter` takes that filter's assignee — nobody under All and Family. */
export function assigneeForFilter(filter: TodoFilter): string | null {
  return filter === ALL_FILTER || filter === FAMILY_FILTER ? null : filter
}

export function matchesFilter(task: Task, filter: TodoFilter): boolean {
  if (filter === ALL_FILTER) return true
  if (filter === FAMILY_FILTER) return task.assignedMembershipId === null
  return task.assignedMembershipId === filter
}

export type TaskGroupId = 'overdue' | 'today' | 'later' | 'none' | 'done'

export interface TaskGroup {
  id: TaskGroupId
  label: string
  tasks: Task[]
}

const GROUP_LABELS: Record<TaskGroupId, string> = {
  overdue: 'Overdue',
  today: 'Today',
  later: 'Later',
  none: 'No date',
  done: 'Done',
}

/**
 * The filter's to-dos grouped Overdue · Today · Later · No date, each sorted by due date then when it was
 * added, with those completed in the last 24 h at the bottom. Empty groups are left out.
 */
export function todoGroups(
  tasks: Task[] | undefined,
  filter: TodoFilter,
  today: HouseholdDate,
  now: Date,
): TaskGroup[] {
  const mine = (tasks ?? []).filter((task) => matchesFilter(task, filter))
  const open = mine.filter((task) => task.doneAt === null)
  const byDue = (a: Task, b: Task) =>
    (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || Date.parse(a.createdAt) - Date.parse(b.createdAt)
  const at = now.getTime()

  const of = (id: TaskGroupId, list: Task[]): TaskGroup => ({ id, label: GROUP_LABELS[id], tasks: list.sort(byDue) })

  return [
    of('overdue', open.filter((t) => t.dueOn !== null && t.dueOn < today)),
    of('today', open.filter((t) => t.dueOn === today)),
    of('later', open.filter((t) => t.dueOn !== null && t.dueOn > today)),
    of('none', open.filter((t) => t.dueOn === null)),
    of('done', mine.filter((t) => t.doneAt !== null && at - Date.parse(t.doneAt) < DAY_MS)),
  ].filter((group) => group.tasks.length > 0)
}

/** `2026-09-14` plus `days`, staying a household date (parsed and formatted in UTC, never a local shift). */
export function addDays(day: HouseholdDate, days: number): HouseholdDate {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** 0 (Sunday) to 6 (Saturday). */
export function weekdayOf(day: HouseholdDate): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

/** "This weekend": the coming Saturday, or today when today is already Saturday or Sunday. */
export function thisWeekend(today: HouseholdDate): HouseholdDate {
  const weekday = weekdayOf(today)
  return weekday === 0 || weekday === 6 ? today : addDays(today, 6 - weekday)
}

export interface DueChoice {
  value: string
  label: string
  /** The date this choice sets, or null for "None" and for "Pick a date" (which asks for one). */
  dueOn: HouseholdDate | null
}

/** Not a fixed date: the sheet shows a date field for it. */
export const PICK_A_DATE = 'pick'

export function dueChoices(today: HouseholdDate): DueChoice[] {
  return [
    { value: 'none', label: 'None', dueOn: null },
    { value: 'today', label: 'Today', dueOn: today },
    { value: 'tomorrow', label: 'Tomorrow', dueOn: addDays(today, 1) },
    { value: 'weekend', label: 'This weekend', dueOn: thisWeekend(today) },
    { value: PICK_A_DATE, label: 'Pick a date', dueOn: null },
  ]
}

/** Which chip a to-do's due date is already on; any other date is "Pick a date". */
export function dueChoiceFor(dueOn: HouseholdDate | null, today: HouseholdDate): string {
  if (dueOn === null) return 'none'
  return dueChoices(today).find((choice) => choice.value !== PICK_A_DATE && choice.dueOn === dueOn)?.value ?? PICK_A_DATE
}

/** The due date on a row: "Today", "Tomorrow", "Yesterday", else "Sat, Sep 19". Null when there is no date. */
export function dueLabel(dueOn: HouseholdDate | null, today: HouseholdDate): string | null {
  if (dueOn === null) return null
  if (dueOn === today) return 'Today'
  if (dueOn === addDays(today, 1)) return 'Tomorrow'
  if (dueOn === addDays(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dueOn}T00:00:00Z`))
}

/** A to-do's text as it is saved: trimmed and capped. Empty means "don't save". */
export function cleanTaskText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_TASK_TEXT)
}
