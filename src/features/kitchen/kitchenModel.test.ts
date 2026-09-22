import { describe, expect, it } from 'vitest'
import type { Task } from '@/data/snapshot'
import { DEFAULT_KITCHEN_TAB, KITCHEN_TABS, dueTaskCount, tabFromQuery } from './kitchenModel'

const task = (over: Partial<Task> & { id: string }): Task => ({
  text: 'Something',
  assignedMembershipId: null,
  dueOn: null,
  createdAt: '2026-09-14T10:00:00.000Z',
  doneAt: null,
  ...over,
})

describe('tabFromQuery', () => {
  it('accepts each of the four tabs', () => {
    for (const tab of KITCHEN_TABS) expect(tabFromQuery(tab)).toBe(tab)
  })

  it('falls back to Shopping for a missing, unknown or oddly-shaped value', () => {
    expect(DEFAULT_KITCHEN_TAB).toBe('shopping')
    expect(tabFromQuery(undefined)).toBe('shopping')
    expect(tabFromQuery(null)).toBe('shopping')
    expect(tabFromQuery('')).toBe('shopping')
    expect(tabFromQuery('groceries')).toBe('shopping')
    expect(tabFromQuery(7)).toBe('shopping')
  })

  it('takes the first value when the query repeats ?tab=', () => {
    expect(tabFromQuery(['meals', 'todo'])).toBe('meals')
    expect(tabFromQuery([null])).toBe('shopping')
  })
})

describe('dueTaskCount', () => {
  const today = '2026-09-14'

  it('counts open to-dos that are overdue or due today', () => {
    const tasks = [
      task({ id: 'overdue', dueOn: '2026-09-10' }),
      task({ id: 'today', dueOn: today }),
      task({ id: 'later', dueOn: '2026-09-20' }),
      task({ id: 'no-date' }),
    ]
    expect(dueTaskCount(tasks, today)).toBe(2)
  })

  it('ignores completed to-dos', () => {
    const tasks = [task({ id: 'done', dueOn: today, doneAt: '2026-09-14T12:00:00.000Z' })]
    expect(dueTaskCount(tasks, today)).toBe(0)
  })

  it('is 0 for a device-cached snapshot from before the Kitchen screen', () => {
    expect(dueTaskCount(undefined, today)).toBe(0)
    expect(dueTaskCount([], today)).toBe(0)
  })
})
