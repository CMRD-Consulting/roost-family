import { describe, it, expect } from 'vitest'
import { routineForDay, currentStepIndex, nextStepIndex } from './routines'
import type { Routine } from './types'

const step = (label: string, time: string | null = null) => ({ iconKey: label.toLowerCase(), photoId: null, label, time })

const homeDay: Routine = {
  id: 'home',
  childId: 'leona',
  name: 'Home day',
  weekdays: [1, 2, 3, 4, 5],
  steps: [step('Breakfast', '07:00'), step('Teeth'), step('Shoes'), step('Nap', '12:30'), step('Bath', '18:30')],
}
const weekend: Routine = { ...homeDay, id: 'weekend', name: 'Weekend', weekdays: [0, 6] }
const maraRoutine: Routine = { ...homeDay, id: 'mara-home', childId: 'mara' }

describe('routineForDay', () => {
  const all = [maraRoutine, homeDay, weekend]
  it('picks the routine assigned to the weekday', () => {
    expect(routineForDay(all, 'leona', 1, null)?.id).toBe('home')
    expect(routineForDay(all, 'leona', 6, null)?.id).toBe('weekend')
  })
  it('uses the override for today when it belongs to the child', () => {
    expect(routineForDay(all, 'leona', 1, 'weekend')?.id).toBe('weekend')
    expect(routineForDay(all, 'leona', 1, 'mara-home')?.id).toBe('home')
  })
  it('returns null when nothing is assigned', () => {
    expect(routineForDay([homeDay], 'leona', 0, null)).toBeNull()
  })
})

describe('currentStepIndex', () => {
  const at = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))

  it('starts at the first unfinished step', () => {
    expect(currentStepIndex(homeDay, [], at('08:00'))).toBe(0)
    expect(currentStepIndex(homeDay, [0], at('08:00'))).toBe(1)
  })
  it('jumps to a timed step once its time arrives', () => {
    expect(currentStepIndex(homeDay, [0], at('12:45'))).toBe(3)
  })
  it('does not jump back to a completed timed step', () => {
    expect(currentStepIndex(homeDay, [0, 3], at('12:45'))).toBe(1)
  })
  it('returns null when every step is done', () => {
    expect(currentStepIndex(homeDay, [0, 1, 2, 3, 4], at('20:00'))).toBeNull()
  })
})

describe('nextStepIndex', () => {
  it('returns the next unfinished step after the current one', () => {
    expect(nextStepIndex(homeDay, [0], 1)).toBe(2)
    expect(nextStepIndex(homeDay, [0, 1, 2], 3)).toBe(4)
  })
  it('returns null after the last step', () => {
    expect(nextStepIndex(homeDay, [0, 1, 2, 3], 4)).toBeNull()
  })
})
