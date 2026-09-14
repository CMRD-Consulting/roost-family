import { describe, expect, it } from 'vitest'
import type { Jot } from '@/data/snapshot'
import { openJots, recentlyDoneJots } from './inboxModel'

const NOW = new Date('2026-09-14T19:00:00Z')
const DAY = 24 * 60 * 60_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const jots: Jot[] = [
  { id: 'old-open', text: 'Old', createdAt: ago(3 * DAY), doneAt: null },
  { id: 'new-open', text: 'New', createdAt: ago(DAY), doneAt: null },
  { id: 'done-today', text: 'Done today', createdAt: ago(5 * DAY), doneAt: ago(60_000) },
  { id: 'done-6d', text: 'Done 6 days ago', createdAt: ago(9 * DAY), doneAt: ago(6 * DAY) },
  { id: 'done-8d', text: 'Done 8 days ago', createdAt: ago(9 * DAY), doneAt: ago(8 * DAY) },
]

describe('openJots', () => {
  it('lists the jots not yet done, newest first', () => {
    expect(openJots(jots).map((j) => j.id)).toEqual(['new-open', 'old-open'])
  })
})

describe('recentlyDoneJots', () => {
  it('lists jots done in the last 7 days, most recently done first', () => {
    expect(recentlyDoneJots(jots, NOW).map((j) => j.id)).toEqual(['done-today', 'done-6d'])
  })
})
