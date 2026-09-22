import { describe, it, expect } from 'vitest'
import { sleepStatus } from '@/domain/sleep'
import { unacknowledgedConflicts } from '@/domain/medicine'
import { householdDate } from '@/domain/time'
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
    expect(s.household.nightModeEnabled).toBe(true)
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
    expect(progress?.day).toBe(householdDate(now, s.household.timeZone))
    expect(progress?.completed).toEqual([0, 1, 2])
  })

  it('routine progress day tracks a different `now`, not a fixed date', () => {
    const laterNow = new Date('2026-12-25T19:00:00Z')
    const s = buildDemoSnapshot(laterNow)
    const ivy = s.children.find((c) => c.name === 'Ivy')!
    const homeDay = s.routines.find((r) => r.childId === ivy.id && r.name === 'Home day')!
    const progress = s.routineProgress.find((p) => p.childId === ivy.id && p.routineId === homeDay.id)
    expect(progress?.day).toBe(householdDate(laterNow, s.household.timeZone))
    expect(progress?.day).toBe('2026-12-25')
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

  it('has two un-archived shopping lists, oldest first, with the grocery items split across them', () => {
    const s = buildDemoSnapshot(now)
    expect(s.shoppingLists?.map((l) => l.name)).toEqual(['Groceries', 'Costco'])
    expect(s.shoppingLists?.every((l) => l.archivedAt === null)).toBe(true)
    const [groceriesList, costco] = s.shoppingLists!
    expect(Date.parse(groceriesList!.createdAt)).toBeLessThan(Date.parse(costco!.createdAt))
    expect(s.groceries.map((g) => [g.text, g.listId])).toEqual([
      ['Whole milk', groceriesList!.id],
      ['Bananas', costco!.id],
    ])
  })

  it('has four tasks: overdue, due today, undated and done 2 h ago', () => {
    const s = buildDemoSnapshot(now)
    const tasks = s.tasks ?? []
    expect(tasks).toHaveLength(4)
    const today = householdDate(now, s.household.timeZone)
    const open = tasks.filter((t) => t.doneAt === null)
    expect(open).toHaveLength(3)
    expect(open.some((t) => t.dueOn !== null && t.dueOn < today)).toBe(true)
    expect(open.some((t) => t.dueOn === today)).toBe(true)
    expect(open.some((t) => t.dueOn === null && t.assignedMembershipId === null)).toBe(true)
    const done = tasks.filter((t) => t.doneAt !== null)
    expect(done.map((t) => t.doneAt)).toEqual([new Date(now.getTime() - 2 * 3_600_000).toISOString()])
    // Every assignee is one of the household's adults.
    const memberIds = s.members.map((m) => m.id)
    expect(tasks.every((t) => t.assignedMembershipId === null || memberIds.includes(t.assignedMembershipId))).toBe(true)
  })

  it('has two recipes, each with ordered ingredients and steps', () => {
    const s = buildDemoSnapshot(now)
    const recipes = s.recipes ?? []
    expect(recipes.map((r) => r.title).sort()).toEqual(['Sheet-pan chicken', 'Weeknight tacos'])
    for (const recipe of recipes) {
      expect(recipe.archivedAt).toBeNull()
      expect(recipe.ingredients.length).toBeGreaterThan(0)
      expect(recipe.steps.length).toBeGreaterThan(0)
      expect(recipe.ingredients.map((l) => l.sort)).toEqual(recipe.ingredients.map((_, i) => i))
      expect(recipe.steps.map((l) => l.sort)).toEqual(recipe.steps.map((_, i) => i))
    }
  })

  it('plans three days from today, with today taken from the recipe box', () => {
    const s = buildDemoSnapshot(now)
    const plan = s.mealPlan ?? []
    const today = householdDate(now, s.household.timeZone)
    expect(plan).toHaveLength(3)
    expect(plan.map((e) => e.day)).toEqual([today, '2026-09-15', '2026-09-16'])
    expect(new Set(plan.map((e) => e.day)).size).toBe(3)
    // Every entry carries the label it shows, whether or not it came from a recipe (spec §5.1).
    expect(plan.every((e) => e.text.length > 0)).toBe(true)
    const tonight = plan.find((e) => e.day === today)!
    expect(tonight.text).toBe('Tacos')
    expect(s.recipes?.some((r) => r.id === tonight.recipeId)).toBe(true)
    expect(plan.some((e) => e.recipeId === null)).toBe(true)
  })

  it('the meal plan tracks a different `now`, not a fixed date', () => {
    const laterNow = new Date('2026-12-25T19:00:00Z')
    const s = buildDemoSnapshot(laterNow)
    expect(s.mealPlan?.map((e) => e.day)).toEqual(['2026-12-25', '2026-12-26', '2026-12-27'])
  })

  it('has sample weather fetched now', () => {
    expect(buildDemoSnapshot(now).weather).toEqual({
      fetchedAt: now.toISOString(),
      currentTempF: 74,
      highF: 78,
      lowF: 61,
      precipChance: 10,
      summary: 'Mostly Sunny',
      icon: 'partly',
    })
  })

  it('has no photos by default', () => {
    expect(buildDemoSnapshot(now).photos).toEqual([])
  })

  it('has a few sample slideshow photos (bundled SVG data URLs) with { photos: true }', () => {
    const photos = buildDemoSnapshot(now, { photos: true }).photos ?? []
    expect(photos.length).toBeGreaterThanOrEqual(3)
    expect(new Set(photos.map((p) => p.id)).size).toBe(photos.length)
    for (const p of photos) {
      expect(p.kind).toBe('slideshow')
      expect(p.storagePath).toMatch(/^data:image\/svg\+xml,/)
    }
  })

  it('has no active or recent sitter session and loadedAt equal to now', () => {
    const s = buildDemoSnapshot(now)
    expect(s.activeSitterSession).toBeNull()
    expect(s.recentSitterSession).toBeNull()
    expect(s.loadedAt).toBe(now.toISOString())
  })

  it('has sitter info matching the seed', () => {
    const s = buildDemoSnapshot(now)
    expect(s.household.sitterInfo).toMatchObject({
      napInstructions: 'Theo naps in the crib with the sound machine on.',
      bedtime: 'Ivy 7:00 PM, Theo 6:30 PM',
      pediatrician: 'Dr. Patel 704-555-0199',
      address: '12 Maple St',
      whereThings: 'Spare diapers: hall closet',
    })
  })

  it('starts an active sitter session named Jess 2h ago with sitter-attributed logs, with { sitter: true }', () => {
    const base = buildDemoSnapshot(now)
    const s = buildDemoSnapshot(now, { sitter: true })
    const session = s.activeSitterSession
    expect(session).toEqual({
      id: expect.any(String), sitterName: 'Jess', startedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      endedAt: null, summaryShownAt: null,
    })
    expect(s.recentSitterSession).toBeNull()

    const inSession = (at: string) => Date.parse(at) >= Date.parse(session!.startedAt) && Date.parse(at) <= now.getTime()
    const newDoses = s.doses.filter((d) => !base.doses.some((b) => b.id === d.id))
    expect(newDoses.length).toBeGreaterThan(0)
    expect(newDoses.every((d) => d.loggedByName === 'Jess (sitter)' && inSession(d.at))).toBe(true)
    const newFeedings = s.feedings.filter((f) => !base.feedings.some((b) => b.id === f.id))
    const newStickers = s.stickers.filter((st) => !base.stickers.some((b) => b.id === st.id))
    expect(newFeedings.length + newStickers.length).toBeGreaterThan(0)
    expect([...newFeedings, ...newStickers].every((e) => inSession(e.at))).toBe(true)
    expect(unacknowledgedConflicts(s.medicines, s.doses)).toEqual([])
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
