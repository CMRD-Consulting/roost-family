import { describe, expect, it } from 'vitest'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import { completeCurrent, cornerChildren, scheduleModel, stickerGridModel } from './cornerModel'

const now = new Date('2026-09-14T19:00:00Z') // 3:00 PM EDT, Monday
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const HOME_DAY = 'routine-ivy-homeday'
const WEEKEND = 'routine-ivy-weekend'
const POTTY = 'dddddddd-0000-0000-0000-000000000001'

const demo = (at: Date = now): HouseholdSnapshot => buildDemoSnapshot(at)

describe('cornerChildren', () => {
  it('includes children with Kids’ Corner enabled by age (Ivy, 3 y) and not a 15-month-old (Theo)', () => {
    expect(cornerChildren(demo(), now).map((c) => c.id)).toEqual([IVY])
  })

  it('follows per-child overrides and sorts by sortOrder', () => {
    const s = demo()
    s.children = s.children.map((c) => (c.id === THEO ? { ...c, overrides: { kidsCorner: true }, sortOrder: -1 } : c))
    expect(cornerChildren(s, now).map((c) => c.id)).toEqual([THEO, IVY])

    s.children = s.children.map((c) => (c.id === IVY ? { ...c, overrides: { kidsCorner: false } } : c))
    expect(cornerChildren(s, now).map((c) => c.id)).toEqual([THEO])
  })
})

describe('scheduleModel', () => {
  it("builds today's routine with progress, the current step and the next one", () => {
    const model = scheduleModel(demo(), IVY, now)!
    expect(model.routineId).toBe(HOME_DAY)
    expect(model.householdId).toBe('aaaaaaaa-0000-0000-0000-000000000001')
    expect(model.childId).toBe(IVY)
    expect(model.day).toBe('2026-09-14')
    expect(model.completed).toEqual([0, 1, 2])
    // 3:00 PM: Nap (12:30) is the latest timed step that has passed and it's unfinished, so it's current.
    expect(model.currentIndex).toBe(5)
    expect(model.nextIndex).toBe(6)
    expect(model.steps).toHaveLength(9)
    expect(model.steps[0]).toEqual({ index: 0, label: 'Breakfast', iconKey: 'breakfast', time: '07:00', done: true })
    expect(model.steps[5]).toEqual({ index: 5, label: 'Nap', iconKey: 'nap', time: '12:30', done: false })
    expect(model.steps[6]!.time).toBeNull()
  })

  it('uses the day override instead of the weekday routine', () => {
    const s = demo()
    s.routineOverrides = [{ childId: IVY, day: '2026-09-14', routineId: WEEKEND }]
    const model = scheduleModel(s, IVY, now)!
    expect(model.routineId).toBe(WEEKEND)
    expect(model.completed).toEqual([])
    expect(model.currentIndex).toBe(0)
  })

  it('has no current step once every remaining step is done', () => {
    const s = demo()
    s.routineProgress = [{ childId: IVY, routineId: HOME_DAY, day: '2026-09-14', completed: [5, 6, 7, 8] }]
    const model = scheduleModel(s, IVY, now)!
    expect(model.currentIndex).toBeNull()
    expect(model.nextIndex).toBeNull()
  })

  it('is null when the child has no routine today', () => {
    expect(scheduleModel(demo(), THEO, now)).toBeNull()
  })

  it('ignores progress from another day', () => {
    const tuesday = new Date('2026-09-15T12:00:00Z') // 8:00 AM EDT
    const model = scheduleModel(demo(now), IVY, tuesday)!
    expect(model.day).toBe('2026-09-15')
    expect(model.completed).toEqual([])
    expect(model.currentIndex).toBe(0)
  })
})

describe('completeCurrent', () => {
  it('marks just the current step done', () => {
    const model = scheduleModel(demo(), IVY, now)!
    expect(completeCurrent(model)).toEqual({
      kind: 'routine.step',
      householdId: 'aaaaaaaa-0000-0000-0000-000000000001',
      childId: IVY,
      routineId: HOME_DAY,
      day: '2026-09-14',
      stepIndex: 5,
      done: true,
    })
  })

  it('is null when nothing is current', () => {
    const s = demo()
    s.routineProgress = [{ childId: IVY, routineId: HOME_DAY, day: '2026-09-14', completed: [5, 6, 7, 8] }]
    expect(completeCurrent(scheduleModel(s, IVY, now)!)).toBeNull()
  })
})

describe('stickerGridModel', () => {
  it("counts this week's stickers per category, Monday first, and marks today", () => {
    const s = demo()
    const grid = stickerGridModel(s, IVY, now)
    expect(grid.weekStart).toBe('2026-09-14')
    expect(grid.days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(grid.todayIndex).toBe(0)
    expect(grid.rows.map((r) => r.name)).toEqual(['Potty', 'Teeth', 'Tried a new food'])
    expect(grid.rows[0]).toEqual({ categoryId: POTTY, name: 'Potty', iconKey: 'potty', counts: [1, 0, 0, 0, 0, 0, 0] })
    expect(grid.rows[1]!.counts).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it("puts today's index on the right weekday in the household zone and ignores other children", () => {
    const sunday = new Date('2026-09-21T02:00:00Z') // Sun 10:00 PM EDT
    const s = demo()
    s.stickers = [
      { id: 'a', childId: IVY, categoryId: POTTY, at: '2026-09-20T15:00:00Z', sitterSessionId: null },
      { id: 'b', childId: IVY, categoryId: POTTY, at: '2026-09-20T16:00:00Z', sitterSessionId: null },
      { id: 'c', childId: THEO, categoryId: POTTY, at: '2026-09-20T16:00:00Z', sitterSessionId: null },
    ]
    const grid = stickerGridModel(s, IVY, sunday)
    expect(grid.todayIndex).toBe(6)
    expect(grid.rows[0]!.counts).toEqual([0, 0, 0, 0, 0, 0, 2])
  })
})
