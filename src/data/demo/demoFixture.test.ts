import { describe, it, expect } from 'vitest'
import { sleepStatus } from '@/domain/sleep'
import { unacknowledgedConflicts } from '@/domain/medicine'
import { PERSON_COLORS } from '@/ui/personPalette'
import { buildDemoSnapshot } from './demoFixture'

const now = new Date('2026-09-14T19:00:00Z')

describe('buildDemoSnapshot', () => {
  it('builds the Rivera household', () => {
    const s = buildDemoSnapshot(now)
    expect(s.household.name).toBe('Rivera')
    expect(s.household.timeZone).toBe('America/New_York')
    expect(s.household.dinnerTonight).toBe('Tacos')
    expect(s.household.diaperLogEnabled).toBe(false)
  })

  it('builds members Sam (owner) and Alex (adult) with distinct PERSON_COLORS', () => {
    const s = buildDemoSnapshot(now)
    const sam = s.members.find((m) => m.displayName === 'Sam')
    const alex = s.members.find((m) => m.displayName === 'Alex')
    expect(sam?.role).toBe('owner')
    expect(alex?.role).toBe('adult')
    expect(sam?.color).not.toBe(alex?.color)
    expect(PERSON_COLORS).toContain(sam?.color)
    expect(PERSON_COLORS).toContain(alex?.color)
  })

  it('builds children Ivy and Theo with colors distinct from members', () => {
    const s = buildDemoSnapshot(now)
    const ivy = s.children.find((c) => c.name === 'Ivy')
    const theo = s.children.find((c) => c.name === 'Theo')
    expect(ivy?.birthday).toBe('2023-04-10')
    expect(theo?.birthday).toBe('2025-06-02')
    const memberColors = s.members.map((m) => m.color)
    expect(memberColors).not.toContain(ivy?.color)
    expect(memberColors).not.toContain(theo?.color)
    expect(ivy?.color).not.toBe(theo?.color)
    expect(PERSON_COLORS).toContain(ivy?.color)
    expect(PERSON_COLORS).toContain(theo?.color)
  })

  it('Ivy has the seed night sleep window, Theo uses the household default', () => {
    const s = buildDemoSnapshot(now)
    const ivy = s.children.find((c) => c.name === 'Ivy')
    const theo = s.children.find((c) => c.name === 'Theo')
    expect(ivy?.nightSleep).toEqual({ start: '19:00', end: '06:00' })
    expect(theo?.nightSleep).toBeNull()
  })

  it('Theo is awake for 160 minutes (night sleep ended 9h ago, nap ended 2h40m ago)', () => {
    const s = buildDemoSnapshot(now)
    const theo = s.children.find((c) => c.name === 'Theo')!
    const status = sleepStatus(s.sleeps, theo.id, now)
    expect(status.kind).toBe('awake')
    expect(status.kind === 'awake' && status.durationMs).toBe(160 * 60_000)
  })

  it('Theo has a milk feeding 70 minutes ago', () => {
    const s = buildDemoSnapshot(now)
    const theo = s.children.find((c) => c.name === 'Theo')!
    const feeding = s.feedings.find((f) => f.childId === theo.id)
    expect(feeding?.type).toBe('milk')
    expect(feeding?.at).toBe(new Date(now.getTime() - 70 * 60_000).toISOString())
  })

  it('has three medicines: Theo ibuprofen and acetaminophen, Ivy ibuprofen', () => {
    const s = buildDemoSnapshot(now)
    const ivy = s.children.find((c) => c.name === 'Ivy')!
    const theo = s.children.find((c) => c.name === 'Theo')!
    expect(s.medicines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ childId: theo.id, name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }),
        expect.objectContaining({ childId: theo.id, name: 'Infant acetaminophen', minIntervalHours: 4, maxDosesPer24h: 5 }),
        expect.objectContaining({ childId: ivy.id, name: "Children's ibuprofen", minIntervalHours: 6, maxDosesPer24h: 4 }),
      ]),
    )
  })

  it('has one Theo ibuprofen dose 2h ago logged by Sam', () => {
    const s = buildDemoSnapshot(now)
    const theo = s.children.find((c) => c.name === 'Theo')!
    const ibuprofen = s.medicines.find((m) => m.childId === theo.id && m.name === 'Infant ibuprofen')!
    const dose = s.doses.find((d) => d.medicineId === ibuprofen.id)
    expect(dose?.childId).toBe(theo.id)
    expect(dose?.loggedByName).toBe('Sam')
    expect(dose?.at).toBe(new Date(now.getTime() - 2 * 3_600_000).toISOString())
    expect(dose?.loggedOffline).toBe(false)
  })

  it('has Ivy Home day and Weekend routines matching the seed steps', () => {
    const s = buildDemoSnapshot(now)
    const ivy = s.children.find((c) => c.name === 'Ivy')!
    const homeDay = s.routines.find((r) => r.childId === ivy.id && r.name === 'Home day')!
    expect(homeDay.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(homeDay.steps.map((s2) => s2.label)).toEqual([
      'Breakfast', 'Brush teeth', 'Get dressed', 'Park', 'Snack', 'Nap', 'Books', 'Bath', 'Bed',
    ])
    expect(homeDay.steps[5]).toEqual({ iconKey: 'nap', photoId: null, label: 'Nap', time: '12:30' })
    const weekend = s.routines.find((r) => r.childId === ivy.id && r.name === 'Weekend')!
    expect(weekend.weekdays).toEqual([0, 6])
    expect(weekend.steps).toHaveLength(4)
  })

  it('has routine progress for today with steps 0-2 completed', () => {
    const s = buildDemoSnapshot(now)
    const ivy = s.children.find((c) => c.name === 'Ivy')!
    const homeDay = s.routines.find((r) => r.childId === ivy.id && r.name === 'Home day')!
    const progress = s.routineProgress.find((p) => p.childId === ivy.id && p.routineId === homeDay.id)
    expect(progress?.day).toBe('2026-09-14')
    expect(progress?.completed).toEqual([0, 1, 2])
  })

  it('has sticker categories Potty/Teeth/Tried a new food and an Ivy potty sticker 1h ago', () => {
    const s = buildDemoSnapshot(now)
    expect(s.stickerCategories.map((c) => c.name)).toEqual(['Potty', 'Teeth', 'Tried a new food'])
    const ivy = s.children.find((c) => c.name === 'Ivy')!
    const potty = s.stickerCategories.find((c) => c.name === 'Potty')!
    const sticker = s.stickers.find((st) => st.childId === ivy.id)
    expect(sticker?.categoryId).toBe(potty.id)
    expect(sticker?.at).toBe(new Date(now.getTime() - 3_600_000).toISOString())
  })

  it('has grocery items and a jot', () => {
    const s = buildDemoSnapshot(now)
    expect(s.groceries.map((g) => g.text)).toEqual(['Whole milk', 'Bananas'])
    expect(s.jots.map((j) => j.text)).toEqual(["Call pediatrician about Theo's rash"])
    expect(s.groceries.every((g) => g.checkedAt === null)).toBe(true)
    expect(s.jots.every((j) => j.doneAt === null)).toBe(true)
  })

  it('has no active sitter session and loadedAt equal to now', () => {
    const s = buildDemoSnapshot(now)
    expect(s.activeSitterSession).toBeNull()
    expect(s.loadedAt).toBe(now.toISOString())
  })

  it('adds an offline conflicting dose with { conflict: true }', () => {
    const s = buildDemoSnapshot(now, { conflict: true })
    const theo = s.children.find((c) => c.name === 'Theo')!
    const ibuprofen = s.medicines.find((m) => m.childId === theo.id && m.name === 'Infant ibuprofen')!
    const offline = s.doses.find((d) => d.medicineId === ibuprofen.id && d.loggedOffline)
    expect(offline?.loggedByName).toBe('Alex')
    expect(offline?.at).toBe(new Date(now.getTime() - 3_600_000).toISOString())
    expect(offline?.createdAt).toBe(new Date(now.getTime() - 30 * 60_000).toISOString())
    expect(unacknowledgedConflicts(s.medicines, s.doses).map((d) => d.id)).toContain(offline?.id)
  })

  it('has no conflicting doses by default', () => {
    const s = buildDemoSnapshot(now)
    expect(unacknowledgedConflicts(s.medicines, s.doses)).toEqual([])
  })

  it('adds four more children with { manyKids: true } spanning 8 months to 6 years', () => {
    const base = buildDemoSnapshot(now)
    const s = buildDemoSnapshot(now, { manyKids: true })
    expect(s.children).toHaveLength(6)
    const names = s.children.map((c) => c.name)
    expect(new Set(names).size).toBe(6)
    const extra = s.children.filter((c) => !base.children.some((b) => b.id === c.id))
    expect(extra).toHaveLength(4)
    const birthdays = extra.map((c) => c.birthday).sort()
    expect(birthdays[0]! >= '2020-09-01').toBe(true)
    expect(birthdays[birthdays.length - 1]! <= '2026-01-31').toBe(true)
  })
})
