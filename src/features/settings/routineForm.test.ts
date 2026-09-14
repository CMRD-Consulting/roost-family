import { describe, expect, it } from 'vitest'
import type { Routine } from '@/domain/types'
import {
  addStep, emptyRoutineForm, moveStep, removeStep, routineFormFrom, stepsOutOfOrder, toRoutineInput,
  todaysRoutineChoice, validateRoutineForm, weekdayConflicts, weekdaySummary, MAX_STEPS, type RoutineForm,
} from './routineForm'

const homeDay: Routine = {
  id: 'r-home',
  childId: 'ivy',
  name: 'Home day',
  weekdays: [1, 2, 3, 4, 5],
  steps: [
    { iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: '07:00' },
    { iconKey: 'teeth', photoId: null, label: 'Brush teeth', time: null },
  ],
}
const weekend: Routine = { id: 'r-weekend', childId: 'ivy', name: 'Weekend', weekdays: [0, 6], steps: [] }

function form(overrides: Partial<RoutineForm> = {}): RoutineForm {
  return { ...emptyRoutineForm(), name: 'School day', ...overrides }
}

describe('routineFormFrom', () => {
  it('fills from a routine, turning the time toggle on only for timed steps', () => {
    const f = routineFormFrom(homeDay)
    expect(f.name).toBe('Home day')
    expect(f.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(f.steps.map((s) => ({ iconKey: s.iconKey, label: s.label, hasTime: s.hasTime, time: s.time }))).toEqual([
      { iconKey: 'breakfast', label: 'Breakfast', hasTime: true, time: '07:00' },
      { iconKey: 'teeth', label: 'Brush teeth', hasTime: false, time: '' },
    ])
    expect(new Set(f.steps.map((s) => s.key)).size).toBe(2)
  })

  it('copies weekdays and steps so editing the form never touches the routine', () => {
    const f = routineFormFrom(homeDay)
    f.weekdays.push(6)
    f.steps[0]!.label = 'Changed'
    expect(homeDay.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(homeDay.steps[0]!.label).toBe('Breakfast')
  })
})

describe('validateRoutineForm', () => {
  it('requires a name of up to 40 characters', () => {
    expect(validateRoutineForm(form({ name: '  ' })).name).toBe('Give this routine a name.')
    expect(validateRoutineForm(form({ name: 'x'.repeat(41) })).name).toBe('Names can be up to 40 characters.')
    expect(validateRoutineForm(form())).toEqual({})
  })

  it('requires every step to have a label of up to 40 characters and a time when the toggle is on', () => {
    let f = addStep(addStep(addStep(form())))
    f.steps[0]!.label = 'Breakfast'
    f.steps[1]!.label = 'y'.repeat(41)
    f.steps[2]!.label = 'Park'
    f.steps[2]!.hasTime = true
    f.steps[2]!.time = ''
    const errors = validateRoutineForm(f)
    expect(errors.steps).toEqual({
      [f.steps[1]!.key]: 'Step labels can be up to 40 characters.',
      [f.steps[2]!.key]: 'Pick a time or turn off the time.',
    })
    f = { ...f, steps: [f.steps[0]!, { ...f.steps[1]!, label: '' }] }
    expect(validateRoutineForm(f).steps).toEqual({ [f.steps[1]!.key]: 'Give this step a label.' })
  })
})

describe('steps', () => {
  it('adds up to 20 steps', () => {
    let f = form()
    for (let i = 0; i < 25; i++) f = addStep(f)
    expect(f.steps).toHaveLength(MAX_STEPS)
  })

  it('moves a step up or down and ignores moves off either end', () => {
    const f = routineFormFrom(homeDay)
    const down = moveStep(f, 0, 1)
    expect(down.steps.map((s) => s.label)).toEqual(['Brush teeth', 'Breakfast'])
    expect(moveStep(f, 0, -1)).toBe(f)
    expect(moveStep(f, 1, 1)).toBe(f)
  })

  it('removes a step', () => {
    expect(removeStep(routineFormFrom(homeDay), 0).steps.map((s) => s.label)).toEqual(['Brush teeth'])
  })

  it('reordering produces the steps JSON in the new order, with null times for untimed steps', () => {
    const f = moveStep(routineFormFrom(homeDay), 1, -1)
    f.steps[0]!.label = '  Teeth  '
    expect(toRoutineInput('r-home', 'ivy', f)).toEqual({
      routineId: 'r-home',
      childId: 'ivy',
      name: 'Home day',
      weekdays: [1, 2, 3, 4, 5],
      steps: [
        { iconKey: 'teeth', photoId: null, label: 'Teeth', time: null },
        { iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: '07:00' },
      ],
    })
  })

  it('drops a time that was entered but then turned off', () => {
    const f = routineFormFrom(homeDay)
    f.steps[0]!.hasTime = false
    expect(toRoutineInput(null, 'ivy', f).steps[0]!.time).toBeNull()
  })

  it('sends weekdays sorted', () => {
    expect(toRoutineInput(null, 'ivy', form({ weekdays: [6, 0, 3] })).weekdays).toEqual([0, 3, 6])
  })
})

describe('stepsOutOfOrder', () => {
  it('is true only when a timed step comes before an earlier time', () => {
    const f = addStep(addStep(addStep(form())))
    f.steps[0]!.hasTime = true
    f.steps[0]!.time = '09:00'
    f.steps[2]!.hasTime = true
    f.steps[2]!.time = '10:00'
    expect(stepsOutOfOrder(f.steps)).toBe(false)
    f.steps[2]!.time = '08:30'
    expect(stepsOutOfOrder(f.steps)).toBe(true)
  })
})

describe('weekdayConflicts', () => {
  it('warns for each other routine of the child that already has a chosen weekday', () => {
    const others = [homeDay, weekend, { ...weekend, id: 'theo-weekend', childId: 'theo' }]
    expect(weekdayConflicts([6], 'ivy', null, others)).toEqual(['Weekend already uses Saturday — the first routine wins.'])
    expect(weekdayConflicts([0, 1, 6], 'ivy', null, others)).toEqual([
      'Home day already uses Monday — the first routine wins.',
      'Weekend already uses Sunday and Saturday — the first routine wins.',
    ])
  })

  it('ignores the routine being edited', () => {
    expect(weekdayConflicts([0, 6], 'ivy', 'r-weekend', [homeDay, weekend])).toEqual([])
  })
})

describe('weekdaySummary', () => {
  it('lists the days Sunday first', () => {
    expect(weekdaySummary([5, 1])).toEqual(['Mon', 'Fri'])
    expect(weekdaySummary([])).toEqual([])
  })
})

describe('todaysRoutineChoice', () => {
  it('is the override for this child and day, or null for the weekday default', () => {
    const overrides = [
      { childId: 'ivy', day: '2026-09-14', routineId: 'r-weekend' },
      { childId: 'theo', day: '2026-09-14', routineId: 'x' },
      { childId: 'ivy', day: '2026-09-13', routineId: 'r-home' },
    ]
    expect(todaysRoutineChoice(overrides, 'ivy', '2026-09-14')).toBe('r-weekend')
    expect(todaysRoutineChoice(overrides, 'ivy', '2026-09-15')).toBeNull()
  })
})
