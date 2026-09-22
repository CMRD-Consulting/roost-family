import { describe, expect, it } from 'vitest'
import type { Member, Task } from '@/data/snapshot'
import {
  ALL_FILTER, FAMILY_FILTER, PICK_A_DATE, addDays, assignableMembers, assigneeForFilter, cleanTaskText,
  dueChoiceFor, dueChoices, dueLabel, matchesFilter, thisWeekend, todoFilters, todoGroups, weekdayOf,
} from './todoModel'

const TODAY = '2026-09-14' // a Monday
const NOW = new Date('2026-09-14T19:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const HOUR = 3_600_000

const SAM: Member = { id: 'sam', displayName: 'Sam', color: '#653437', role: 'owner' }
const ALEX: Member = { id: 'alex', displayName: 'Alex', color: '#2C7F8C', role: 'adult' }
const NANA: Member = { id: 'nana', displayName: 'Nana', color: '#887425', role: 'caregiver' }

const task = (over: Partial<Task> & { id: string }): Task => ({
  text: over.id,
  assignedMembershipId: null,
  dueOn: null,
  createdAt: ago(2 * HOUR),
  doneAt: null,
  ...over,
})

const TASKS = [
  task({ id: 'overdue', assignedMembershipId: 'sam', dueOn: '2026-09-13' }),
  task({ id: 'today-late', dueOn: TODAY, createdAt: ago(HOUR) }),
  task({ id: 'today-early', assignedMembershipId: 'alex', dueOn: TODAY, createdAt: ago(6 * HOUR) }),
  task({ id: 'later', assignedMembershipId: 'alex', dueOn: '2026-09-20' }),
  task({ id: 'someday' }),
  task({ id: 'done-recently', dueOn: TODAY, doneAt: ago(2 * HOUR) }),
  task({ id: 'done-last-week', dueOn: '2026-09-05', doneAt: ago(60 * HOUR) }),
]

describe('todoFilters', () => {
  it('offers All, Family and one chip per adult, each with its open count', () => {
    expect(todoFilters(TASKS, [SAM, ALEX])).toEqual([
      { value: ALL_FILTER, label: 'All', count: 5, color: null },
      { value: FAMILY_FILTER, label: 'Family', count: 2, color: null },
      { value: 'sam', label: 'Sam', count: 1, color: SAM.color },
      { value: 'alex', label: 'Alex', count: 2, color: ALEX.color },
    ])
  })

  it('leaves caregivers out: to-dos are assigned to adults only', () => {
    expect(assignableMembers([SAM, ALEX, NANA]).map((m) => m.id)).toEqual(['sam', 'alex'])
    expect(todoFilters(undefined, [SAM, NANA]).map((c) => c.value)).toEqual([ALL_FILTER, FAMILY_FILTER, 'sam'])
  })
})

describe('matchesFilter and assigneeForFilter', () => {
  it('matches everything under All, the unassigned under Family, and one adult otherwise', () => {
    const mine = task({ id: 'x', assignedMembershipId: 'sam' })
    const family = task({ id: 'y' })
    expect([matchesFilter(mine, ALL_FILTER), matchesFilter(family, ALL_FILTER)]).toEqual([true, true])
    expect([matchesFilter(mine, FAMILY_FILTER), matchesFilter(family, FAMILY_FILTER)]).toEqual([false, true])
    expect([matchesFilter(mine, 'sam'), matchesFilter(family, 'sam')]).toEqual([true, false])
  })

  it('gives a new to-do the filter\'s assignee, and nobody under All or Family', () => {
    expect(assigneeForFilter(ALL_FILTER)).toBeNull()
    expect(assigneeForFilter(FAMILY_FILTER)).toBeNull()
    expect(assigneeForFilter('alex')).toBe('alex')
  })
})

describe('todoGroups', () => {
  it('groups Overdue, Today, Later and No date, with the last 24 h of completions at the bottom', () => {
    const groups = todoGroups(TASKS, ALL_FILTER, TODAY, NOW)
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Overdue', ['overdue']],
      ['Today', ['today-early', 'today-late']],
      ['Later', ['later']],
      ['No date', ['someday']],
      ['Done', ['done-recently']],
    ])
  })

  it('leaves empty groups out and filters by assignee', () => {
    const groups = todoGroups(TASKS, 'alex', TODAY, NOW)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Later'])
    expect(todoGroups(TASKS, FAMILY_FILTER, TODAY, NOW).map((g) => g.label)).toEqual(['Today', 'No date', 'Done'])
  })

  it('is empty for a snapshot from before the Kitchen screen', () => {
    expect(todoGroups(undefined, ALL_FILTER, TODAY, NOW)).toEqual([])
  })
})

describe('household dates', () => {
  it('adds days without a local-time shift', () => {
    expect(addDays('2026-09-14', 1)).toBe('2026-09-15')
    expect(addDays('2026-09-14', -1)).toBe('2026-09-13')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('reads the weekday, and takes "This weekend" as the coming Saturday', () => {
    expect(weekdayOf(TODAY)).toBe(1)
    expect(thisWeekend(TODAY)).toBe('2026-09-19')
    expect(thisWeekend('2026-09-19')).toBe('2026-09-19') // already Saturday
    expect(thisWeekend('2026-09-20')).toBe('2026-09-20') // already Sunday
  })
})

describe('due dates', () => {
  it('offers None, Today, Tomorrow, This weekend and Pick a date', () => {
    expect(dueChoices(TODAY)).toEqual([
      { value: 'none', label: 'None', dueOn: null },
      { value: 'today', label: 'Today', dueOn: '2026-09-14' },
      { value: 'tomorrow', label: 'Tomorrow', dueOn: '2026-09-15' },
      { value: 'weekend', label: 'This weekend', dueOn: '2026-09-19' },
      { value: PICK_A_DATE, label: 'Pick a date', dueOn: null },
    ])
  })

  it('puts an existing date on its chip, and any other date on "Pick a date"', () => {
    expect(dueChoiceFor(null, TODAY)).toBe('none')
    expect(dueChoiceFor('2026-09-14', TODAY)).toBe('today')
    expect(dueChoiceFor('2026-09-19', TODAY)).toBe('weekend')
    expect(dueChoiceFor('2026-10-31', TODAY)).toBe(PICK_A_DATE)
  })

  it('labels a row\'s due date', () => {
    expect(dueLabel(null, TODAY)).toBeNull()
    expect(dueLabel('2026-09-14', TODAY)).toBe('Today')
    expect(dueLabel('2026-09-15', TODAY)).toBe('Tomorrow')
    expect(dueLabel('2026-09-13', TODAY)).toBe('Yesterday')
    expect(dueLabel('2026-09-19', TODAY)).toBe('Sat, Sep 19')
  })
})

describe('cleanTaskText', () => {
  it('trims, collapses runs of spaces and caps at 100 characters', () => {
    expect(cleanTaskText('  Book   the sitter ')).toBe('Book the sitter')
    expect(cleanTaskText('  ')).toBe('')
    expect(cleanTaskText('x'.repeat(140))).toHaveLength(100)
  })
})
