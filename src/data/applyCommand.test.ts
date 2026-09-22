import { describe, expect, it } from 'vitest'
import { buildDemoSnapshot } from './demo/demoFixture'
import { applyCommand } from './applyCommand'
import type { Attribution, LogCommand } from './logCommands'

const now = new Date('2026-09-14T19:00:00Z')
const base = buildDemoSnapshot(now)
const ivy = base.children[0]!
const theo = base.children[1]!
const sam = base.members[0]!

const attribution: Attribution = {
  displayId: 'demo-display',
  loggedByMembershipId: sam.id,
  sitterSessionId: null,
  loggedByName: sam.displayName,
}

/** Asserts applying `cmd` twice against `snapshot` yields the same result as applying it once. */
function expectIdempotent(snapshot = base, cmd: LogCommand) {
  const once = applyCommand(snapshot, cmd, now)
  const twice = applyCommand(once, cmd, now)
  expect(twice).toEqual(once)
}

describe('applyCommand', () => {
  describe('sleep.start', () => {
    const entry = { id: 'new-sleep', childId: ivy.id, startAt: now.toISOString(), endAt: null, type: 'nap' as const, sitterSessionId: null }
    const cmd: LogCommand = { kind: 'sleep.start', householdId: base.household.id, entry, attribution }

    it('appends the entry without mutating the input', () => {
      const next = applyCommand(base, cmd, now)
      expect(next).not.toBe(base)
      expect(next.sleeps).toContainEqual(entry)
      expect(base.sleeps.some((s) => s.id === 'new-sleep')).toBe(false)
    })

    it('does not duplicate an entry with the same id', () => {
      expectIdempotent(base, cmd)
    })
  })

  describe('sleep.end', () => {
    const open = { id: 'open-sleep', childId: theo.id, startAt: now.toISOString(), endAt: null, type: 'nap' as const, sitterSessionId: null }
    const withOpen = applyCommand(base, { kind: 'sleep.start', householdId: base.household.id, entry: open, attribution }, now)

    it('sets endAt on the matching entry', () => {
      const cmd: LogCommand = { kind: 'sleep.end', householdId: base.household.id, entryId: 'open-sleep', endAt: now.toISOString(), previousEndAt: null }
      const next = applyCommand(withOpen, cmd, now)
      expect(next.sleeps.find((s) => s.id === 'open-sleep')?.endAt).toBe(now.toISOString())
    })

    it('is a no-op when the entry is missing', () => {
      const cmd: LogCommand = { kind: 'sleep.end', householdId: base.household.id, entryId: 'no-such-id', endAt: now.toISOString(), previousEndAt: null }
      const next = applyCommand(base, cmd, now)
      expect(next).toEqual(base)
    })

    it('is idempotent', () => {
      const cmd: LogCommand = { kind: 'sleep.end', householdId: base.household.id, entryId: 'open-sleep', endAt: now.toISOString(), previousEndAt: null }
      expectIdempotent(withOpen, cmd)
    })
  })

  describe('sleep.discard / sleep.restore', () => {
    const entry = base.sleeps[0]!

    it('discard removes the entry', () => {
      const cmd: LogCommand = { kind: 'sleep.discard', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.sleeps.some((s) => s.id === entry.id)).toBe(false)
    })

    it('restore re-adds it without duplicating', () => {
      const discarded = applyCommand(base, { kind: 'sleep.discard', householdId: base.household.id, entry, attribution }, now)
      const cmd: LogCommand = { kind: 'sleep.restore', householdId: base.household.id, entry, attribution }
      const restored = applyCommand(discarded, cmd, now)
      expect(restored.sleeps).toContainEqual(entry)
      expectIdempotent(restored, cmd)
    })
  })

  describe('feeding.add / sticker.add / diaper.add', () => {
    it('feeding.add appends and is idempotent', () => {
      const entry = { id: 'new-feed', childId: ivy.id, at: now.toISOString(), type: 'milk' as const, amount: '4 oz', note: null, sitterSessionId: null }
      const cmd: LogCommand = { kind: 'feeding.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.feedings).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })

    it('sticker.add appends and is idempotent', () => {
      const entry = { id: 'new-sticker', childId: ivy.id, categoryId: base.stickerCategories[0]!.id, at: now.toISOString(), sitterSessionId: null }
      const cmd: LogCommand = { kind: 'sticker.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.stickers).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })

    it('diaper.add appends and is idempotent', () => {
      const entry = { id: 'new-diaper', childId: theo.id, at: now.toISOString(), kind: 'wet' as const, sitterSessionId: null }
      const cmd: LogCommand = { kind: 'diaper.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.diapers).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })

    it("entries take their sitter session from the command's attribution", () => {
      const sitter = { ...attribution, loggedByMembershipId: null, sitterSessionId: 'sitter-1', loggedByName: 'Jess (sitter)' }
      const h = base.household.id
      let next = applyCommand(base, { kind: 'feeding.add', householdId: h, entry: { id: 'sf', childId: ivy.id, at: now.toISOString(), type: 'milk', amount: null, note: null, sitterSessionId: null }, attribution: sitter }, now)
      next = applyCommand(next, { kind: 'sticker.add', householdId: h, entry: { id: 'ss', childId: ivy.id, categoryId: base.stickerCategories[0]!.id, at: now.toISOString(), sitterSessionId: null }, attribution: sitter }, now)
      next = applyCommand(next, { kind: 'diaper.add', householdId: h, entry: { id: 'sd', childId: theo.id, at: now.toISOString(), kind: 'wet', sitterSessionId: null }, attribution: sitter }, now)
      next = applyCommand(next, { kind: 'sleep.start', householdId: h, entry: { id: 'sl', childId: theo.id, startAt: now.toISOString(), endAt: null, type: 'nap', sitterSessionId: null }, attribution: sitter }, now)
      next = applyCommand(next, {
        kind: 'dose.add', householdId: h, attribution: sitter,
        entry: {
          id: 'sdo', childId: theo.id, medicineId: base.medicines[0]!.id, at: now.toISOString(), loggedByName: null, loggedOffline: false,
          voidedAt: null, voidReason: null, conflictAcknowledgedAt: null, createdAt: '', note: null, warningsConfirmed: [], sitterSessionId: null,
        },
      }, now)
      expect(next.feedings.find((e) => e.id === 'sf')?.sitterSessionId).toBe('sitter-1')
      expect(next.stickers.find((e) => e.id === 'ss')?.sitterSessionId).toBe('sitter-1')
      expect(next.diapers.find((e) => e.id === 'sd')?.sitterSessionId).toBe('sitter-1')
      expect(next.sleeps.find((e) => e.id === 'sl')?.sitterSessionId).toBe('sitter-1')
      expect(next.doses.find((e) => e.id === 'sdo')?.sitterSessionId).toBe('sitter-1')
    })
  })

  describe('dose.add', () => {
    it('appends and is idempotent', () => {
      const entry = {
        id: 'new-dose', childId: theo.id, medicineId: base.medicines[0]!.id, at: now.toISOString(),
        loggedByName: null, loggedOffline: false, voidedAt: null, voidReason: null, conflictAcknowledgedAt: null,
        createdAt: '', note: null, warningsConfirmed: [], sitterSessionId: null,
      }
      const cmd: LogCommand = { kind: 'dose.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.doses).toContainEqual({ ...entry, createdAt: now.toISOString(), loggedByName: sam.displayName })
      expectIdempotent(base, cmd)
    })

    it('sets createdAt to now only when the entry has no createdAt', () => {
      const entry = {
        id: 'new-dose-2', childId: theo.id, medicineId: base.medicines[0]!.id, at: now.toISOString(),
        loggedByName: 'Alex', loggedOffline: false, voidedAt: null, voidReason: null, conflictAcknowledgedAt: null,
        createdAt: '2026-09-14T18:00:00.000Z', note: null, warningsConfirmed: [], sitterSessionId: null,
      }
      const cmd: LogCommand = { kind: 'dose.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      const added = next.doses.find((d) => d.id === 'new-dose-2')
      expect(added?.createdAt).toBe('2026-09-14T18:00:00.000Z')
      expect(added?.loggedByName).toBe('Alex')
    })
  })

  describe('jot.add / grocery.add / grocery.check / grocery.delete', () => {
    it('jot.add appends and is idempotent', () => {
      const jot = { id: 'new-jot', text: 'Buy diapers', createdAt: now.toISOString(), doneAt: null }
      const cmd: LogCommand = { kind: 'jot.add', householdId: base.household.id, jot, displayId: 'demo-display' }
      const next = applyCommand(base, cmd, now)
      expect(next.jots).toContainEqual(jot)
      expectIdempotent(base, cmd)
    })

    it('grocery.add appends and is idempotent', () => {
      const item = { id: 'new-grocery', listId: 'list-costco', text: 'Eggs', createdAt: now.toISOString(), checkedAt: null }
      const cmd: LogCommand = { kind: 'grocery.add', householdId: base.household.id, item, displayId: 'demo-display' }
      const next = applyCommand(base, cmd, now)
      expect(next.groceries).toContainEqual(item)
      expectIdempotent(base, cmd)
    })

    it('grocery.add without a list puts the item on the default (oldest un-archived) list', () => {
      const item = { id: 'new-grocery-2', listId: '', text: 'Eggs', createdAt: now.toISOString(), checkedAt: null }
      const cmd: LogCommand = { kind: 'grocery.add', householdId: base.household.id, item, displayId: null }
      const next = applyCommand(base, cmd, now)
      expect(next.groceries.find((g) => g.id === 'new-grocery-2')?.listId).toBe(base.shoppingLists![0]!.id)
      expectIdempotent(base, cmd)
    })

    it('grocery.add without a list skips the archived ones, and leaves the list empty when none is known', () => {
      const item = { id: 'new-grocery-3', listId: '', text: 'Eggs', createdAt: now.toISOString(), checkedAt: null }
      const cmd: LogCommand = { kind: 'grocery.add', householdId: base.household.id, item, displayId: null }
      const archivedFirst = {
        ...base,
        shoppingLists: base.shoppingLists!.map((l, i) => (i === 0 ? { ...l, archivedAt: now.toISOString() } : l)),
      }
      expect(applyCommand(archivedFirst, cmd, now).groceries.find((g) => g.id === 'new-grocery-3')?.listId).toBe(base.shoppingLists![1]!.id)
      // A device-cached snapshot from before the Kitchen screen has no lists at all: the server's trigger decides.
      const noLists = { ...base, shoppingLists: undefined }
      expect(applyCommand(noLists, cmd, now).groceries.find((g) => g.id === 'new-grocery-3')?.listId).toBe('')
    })

    it('grocery.check sets checkedAt', () => {
      const item = base.groceries[0]!
      const cmd: LogCommand = { kind: 'grocery.check', householdId: base.household.id, itemId: item.id, checkedAt: now.toISOString(), previousCheckedAt: null }
      const next = applyCommand(base, cmd, now)
      expect(next.groceries.find((g) => g.id === item.id)?.checkedAt).toBe(now.toISOString())
    })

    it('grocery.delete removes the item', () => {
      const item = base.groceries[0]!
      const cmd: LogCommand = { kind: 'grocery.delete', householdId: base.household.id, item, displayId: 'demo-display' }
      const next = applyCommand(base, cmd, now)
      expect(next.groceries.some((g) => g.id === item.id)).toBe(false)
    })
  })

  describe('list.add / list.rename / list.archive / list.restore', () => {
    const householdId = base.household.id
    const list = { id: 'list-hardware', name: 'Hardware', createdAt: now.toISOString(), archivedAt: null }
    const archivedAt = '2026-09-14T20:00:00.000Z'

    it('list.add appends and is idempotent', () => {
      const cmd: LogCommand = { kind: 'list.add', householdId, list }
      const next = applyCommand(base, cmd, now)
      expect(next.shoppingLists).toContainEqual(list)
      expect(base.shoppingLists!.some((l) => l.id === list.id)).toBe(false)
      expectIdempotent(base, cmd)
    })

    it('list.add starts the array on a snapshot cached before the Kitchen screen', () => {
      const cmd: LogCommand = { kind: 'list.add', householdId, list }
      expect(applyCommand({ ...base, shoppingLists: undefined }, cmd, now).shoppingLists).toEqual([list])
    })

    it('list.rename renames the matching list only', () => {
      const target = base.shoppingLists![1]!
      const cmd: LogCommand = { kind: 'list.rename', householdId, listId: target.id, name: 'Warehouse', previousName: target.name }
      const next = applyCommand(base, cmd, now)
      expect(next.shoppingLists!.find((l) => l.id === target.id)?.name).toBe('Warehouse')
      expect(next.shoppingLists![0]).toEqual(base.shoppingLists![0])
      expectIdempotent(base, cmd)
    })

    it('list.archive sets archivedAt, list.restore clears it', () => {
      const target = base.shoppingLists![1]!
      const archive: LogCommand = { kind: 'list.archive', householdId, listId: target.id, archivedAt, previousArchivedAt: null }
      const archived = applyCommand(base, archive, now)
      expect(archived.shoppingLists!.find((l) => l.id === target.id)?.archivedAt).toBe(archivedAt)
      expectIdempotent(base, archive)

      const restore: LogCommand = { kind: 'list.restore', householdId, listId: target.id, previousArchivedAt: archivedAt }
      const restored = applyCommand(archived, restore, now)
      expect(restored.shoppingLists!.find((l) => l.id === target.id)?.archivedAt).toBeNull()
      expectIdempotent(archived, restore)
    })

    it('is a no-op for a list that is not in the snapshot', () => {
      const cmd: LogCommand = { kind: 'list.rename', householdId, listId: 'no-such-list', name: 'x', previousName: 'y' }
      expect(applyCommand(base, cmd, now)).toEqual(base)
    })
  })

  describe('task.add / task.check / task.update / task.delete', () => {
    const householdId = base.household.id
    const task = {
      id: 'task-new', text: 'Water the plants', assignedMembershipId: null, dueOn: '2026-09-15',
      createdAt: now.toISOString(), doneAt: null,
    }

    it('task.add appends and is idempotent', () => {
      const cmd: LogCommand = { kind: 'task.add', householdId, task, displayId: 'demo-display' }
      const next = applyCommand(base, cmd, now)
      expect(next.tasks).toContainEqual(task)
      expectIdempotent(base, cmd)
    })

    it('task.add starts the array on a snapshot cached before the Kitchen screen', () => {
      const cmd: LogCommand = { kind: 'task.add', householdId, task, displayId: null }
      expect(applyCommand({ ...base, tasks: undefined }, cmd, now).tasks).toEqual([task])
    })

    it('task.check sets doneAt, and clears it again', () => {
      const open = base.tasks!.find((t) => t.doneAt === null)!
      const doneAt = now.toISOString()
      const check: LogCommand = { kind: 'task.check', householdId, taskId: open.id, doneAt, previousDoneAt: null }
      const checked = applyCommand(base, check, now)
      expect(checked.tasks!.find((t) => t.id === open.id)?.doneAt).toBe(doneAt)
      expectIdempotent(base, check)

      const uncheck: LogCommand = { kind: 'task.check', householdId, taskId: open.id, doneAt: null, previousDoneAt: doneAt }
      expect(applyCommand(checked, uncheck, now).tasks!.find((t) => t.id === open.id)?.doneAt).toBeNull()
    })

    it('task.update replaces the text, assignee and due date, leaving the rest alone', () => {
      const target = base.tasks![0]!
      const cmd: LogCommand = {
        kind: 'task.update', householdId, taskId: target.id, text: 'Refill both prescriptions',
        assignedMembershipId: null, dueOn: null,
        previous: { text: target.text, assignedMembershipId: target.assignedMembershipId, dueOn: target.dueOn },
      }
      const next = applyCommand(base, cmd, now)
      expect(next.tasks!.find((t) => t.id === target.id)).toEqual({
        ...target, text: 'Refill both prescriptions', assignedMembershipId: null, dueOn: null,
      })
      expectIdempotent(base, cmd)
    })

    it('task.delete removes the task and is idempotent', () => {
      const target = base.tasks![0]!
      const cmd: LogCommand = { kind: 'task.delete', householdId, task: target, displayId: null }
      const next = applyCommand(base, cmd, now)
      expect(next.tasks!.some((t) => t.id === target.id)).toBe(false)
      expectIdempotent(base, cmd)
    })

    it('is a no-op for a task that is not in the snapshot', () => {
      const cmd: LogCommand = { kind: 'task.check', householdId, taskId: 'no-such-task', doneAt: null, previousDoneAt: null }
      expect(applyCommand(base, cmd, now)).toEqual(base)
    })
  })

  describe('meal.set / meal.clear', () => {
    const householdId = base.household.id
    const planned = base.mealPlan![0]!
    const emptyDay = '2026-09-30'

    it('meal.set adds an entry for a day with no plan, and is idempotent', () => {
      const cmd: LogCommand = { kind: 'meal.set', householdId, day: emptyDay, text: 'Soup', recipeId: null, previous: null }
      const next = applyCommand(base, cmd, now)
      expect(next.mealPlan!.filter((e) => e.day === emptyDay)).toEqual([
        { id: `meal-${emptyDay}`, day: emptyDay, text: 'Soup', recipeId: null, createdAt: now.toISOString() },
      ])
      expectIdempotent(base, cmd)
    })

    it('meal.set replaces the day that is already planned, keeping one entry per day', () => {
      const cmd: LogCommand = {
        kind: 'meal.set', householdId, day: planned.day, text: 'Pizza', recipeId: null,
        previous: { text: planned.text, recipeId: planned.recipeId },
      }
      const next = applyCommand(base, cmd, now)
      expect(next.mealPlan!.filter((e) => e.day === planned.day)).toEqual([{ ...planned, text: 'Pizza', recipeId: null }])
      expect(next.mealPlan).toHaveLength(base.mealPlan!.length)
      expectIdempotent(base, cmd)
    })

    it('meal.set carries the recipe when the day was planned from the recipe box', () => {
      const recipe = base.recipes![0]!
      const cmd: LogCommand = { kind: 'meal.set', householdId, day: emptyDay, text: recipe.title, recipeId: recipe.id, previous: null }
      expect(applyCommand(base, cmd, now).mealPlan!.find((e) => e.day === emptyDay)).toMatchObject({
        text: recipe.title, recipeId: recipe.id,
      })
    })

    it('meal.clear removes the day and is idempotent', () => {
      const cmd: LogCommand = {
        kind: 'meal.clear', householdId, day: planned.day, previous: { text: planned.text, recipeId: planned.recipeId },
      }
      const next = applyCommand(base, cmd, now)
      expect(next.mealPlan!.some((e) => e.day === planned.day)).toBe(false)
      expectIdempotent(base, cmd)
    })

    it('works on a snapshot cached before the Kitchen screen', () => {
      const noPlan = { ...base, mealPlan: undefined }
      const set: LogCommand = { kind: 'meal.set', householdId, day: emptyDay, text: 'Soup', recipeId: null, previous: null }
      expect(applyCommand(noPlan, set, now).mealPlan).toHaveLength(1)
      const clear: LogCommand = { kind: 'meal.clear', householdId, day: emptyDay, previous: { text: 'Soup', recipeId: null } }
      expect(applyCommand(noPlan, clear, now).mealPlan).toEqual([])
    })
  })

  describe('entry.delete', () => {
    it.each([
      ['sleep_entries', 'sleeps', () => base.sleeps[0]!.id],
      ['feeding_entries', 'feedings', () => base.feedings[0]!.id],
      ['sticker_entries', 'stickers', () => base.stickers[0]!.id],
      ['jots', 'jots', () => base.jots[0]!.id],
    ] as const)('removes by id from %s', (table, collection, getId) => {
      const entryId = getId()
      const cmd: LogCommand = { kind: 'entry.delete', householdId: base.household.id, table, entryId }
      const next = applyCommand(base, cmd, now)
      expect((next[collection] as { id: string }[]).some((e) => e.id === entryId)).toBe(false)
    })

    it('removes a diaper entry', () => {
      const diaperEntry = { id: 'diaper-x', childId: theo.id, at: now.toISOString(), kind: 'wet' as const, sitterSessionId: null }
      const withDiaper = applyCommand(base, { kind: 'diaper.add', householdId: base.household.id, entry: diaperEntry, attribution }, now)
      const cmd: LogCommand = { kind: 'entry.delete', householdId: base.household.id, table: 'diaper_entries', entryId: 'diaper-x' }
      const next = applyCommand(withDiaper, cmd, now)
      expect(next.diapers.some((d) => d.id === 'diaper-x')).toBe(false)
    })
  })

  describe('dose.void / dose.acknowledge', () => {
    const doseId = base.doses[0]!.id

    it('dose.void sets voidedAt to now and keeps the reason', () => {
      const cmd: LogCommand = { kind: 'dose.void', householdId: base.household.id, doseId, membershipId: sam.id, pin: '1234', reason: 'test' }
      const next = applyCommand(base, cmd, now)
      expect(next.doses.find((d) => d.id === doseId)?.voidedAt).toBe(now.toISOString())
      expect(next.doses.find((d) => d.id === doseId)?.voidReason).toBe('test')
    })

    it('dose.acknowledge sets conflictAcknowledgedAt to now', () => {
      const cmd: LogCommand = { kind: 'dose.acknowledge', householdId: base.household.id, doseId, membershipId: sam.id, pin: '1234' }
      const next = applyCommand(base, cmd, now)
      expect(next.doses.find((d) => d.id === doseId)?.conflictAcknowledgedAt).toBe(now.toISOString())
    })
  })

  describe('dinner.set', () => {
    it('sets household.dinnerTonight', () => {
      const cmd: LogCommand = { kind: 'dinner.set', householdId: base.household.id, text: 'Pasta', previous: base.household.dinnerTonight }
      const next = applyCommand(base, cmd, now)
      expect(next.household.dinnerTonight).toBe('Pasta')
    })

    it('accepts null to clear it', () => {
      const cmd: LogCommand = { kind: 'dinner.set', householdId: base.household.id, text: null, previous: base.household.dinnerTonight }
      const next = applyCommand(base, cmd, now)
      expect(next.household.dinnerTonight).toBeNull()
    })
  })

  describe('sitter.start / sitter.end / sitter.summaryShown', () => {
    const householdId = base.household.id
    const startedAt = '2026-09-14T17:00:00.000Z'
    const endedAt = '2026-09-14T18:30:00.000Z'
    const start: LogCommand = {
      kind: 'sitter.start', householdId, sessionId: 'sitter-client-id', membershipId: sam.id, pin: '1234',
      sitterName: 'Jess', displayId: 'demo-display', startedAt,
    }
    const end: LogCommand = { kind: 'sitter.end', householdId, sessionId: 'sitter-client-id', membershipId: sam.id, pin: '1234', endedAt }
    const shown: LogCommand = { kind: 'sitter.summaryShown', householdId, sessionId: 'sitter-client-id' }

    it('start sets the active session optimistically with the client id', () => {
      const next = applyCommand(base, start, now)
      expect(next.activeSitterSession).toEqual({ id: 'sitter-client-id', sitterName: 'Jess', startedAt, endedAt: null, summaryShownAt: null })
      expect(base.activeSitterSession).toBeNull()
    })

    it('start keeps a session that is already active (the server allows only one) and is idempotent', () => {
      const active = { id: 'server-id', sitterName: 'Robin', startedAt, endedAt: null, summaryShownAt: null }
      const withActive = { ...base, activeSitterSession: active }
      expect(applyCommand(withActive, start, now).activeSitterSession).toEqual(active)
      expectIdempotent(base, start)
    })

    it('end moves the active session to recentSitterSession with endedAt, and to the end of the unseen summaries', () => {
      const earlier = { id: 'earlier', sitterName: null, startedAt, endedAt: startedAt, summaryShownAt: null }
      const next = applyCommand(applyCommand({ ...base, unseenSitterSessions: [earlier] }, start, now), end, now)
      const ended = { id: 'sitter-client-id', sitterName: 'Jess', startedAt, endedAt, summaryShownAt: null }
      expect(next.activeSitterSession).toBeNull()
      expect(next.recentSitterSession).toEqual(ended)
      expect(next.unseenSitterSessions).toEqual([earlier, ended])
    })

    it('end is a no-op when the active session is a different one, and idempotent', () => {
      const started = applyCommand(base, start, now)
      expect(applyCommand(started, { ...end, sessionId: 'other' }, now)).toEqual(started)
      expectIdempotent(started, end)
    })

    it('summaryShown sets summaryShownAt on the recent session, keeping the first time', () => {
      const ended = applyCommand(applyCommand(base, start, now), end, now)
      const next = applyCommand(ended, shown, now)
      expect(next.recentSitterSession?.summaryShownAt).toBe(now.toISOString())
      const later = new Date(now.getTime() + 60_000)
      expect(applyCommand(next, shown, later).recentSitterSession?.summaryShownAt).toBe(now.toISOString())
    })

    it('summaryShown removes the session from the unseen summaries', () => {
      const earlier = { id: 'earlier', sitterName: null, startedAt, endedAt: startedAt, summaryShownAt: null }
      const ended = applyCommand(applyCommand({ ...base, unseenSitterSessions: [earlier] }, start, now), end, now)
      expect(applyCommand(ended, shown, now).unseenSitterSessions.map((x) => x.id)).toEqual(['earlier'])
      const next = applyCommand(ended, { ...shown, sessionId: 'earlier' }, now)
      expect(next.unseenSitterSessions.map((x) => x.id)).toEqual(['sitter-client-id'])
      expect(next.recentSitterSession?.summaryShownAt).toBeNull()
    })

    it('summaryShown is a no-op without a matching recent session', () => {
      expect(applyCommand(base, shown, now)).toEqual(base)
      const ended = applyCommand(applyCommand(base, start, now), end, now)
      expect(applyCommand(ended, { ...shown, sessionId: 'other' }, now)).toEqual(ended)
    })
  })

  describe('routine.step', () => {
    const routine = base.routines[0]!
    const existing = base.routineProgress.find((p) => p.childId === ivy.id && p.routineId === routine.id)!
    const step = (stepIndex: number, done: boolean, over: Partial<Extract<LogCommand, { kind: 'routine.step' }>> = {}): LogCommand => ({
      kind: 'routine.step', householdId: base.household.id, childId: ivy.id, routineId: routine.id,
      day: existing.day, stepIndex, done, ...over,
    })
    const completedAfter = (next: typeof base, childId = ivy.id, routineId = routine.id, day = existing.day) =>
      next.routineProgress.find((p) => p.childId === childId && p.routineId === routineId && p.day === day)?.completed

    it('adds the step to an existing row, keeping the array sorted (matched by childId/routineId/day)', () => {
      expect(existing.completed).toEqual([0, 1, 2])
      const next = applyCommand(applyCommand(base, step(5, true), now), step(3, true), now)
      expect(completedAfter(next)).toEqual([0, 1, 2, 3, 5])
      // No new row added.
      expect(next.routineProgress.length).toBe(base.routineProgress.length)
    })

    it('removes the step when done is false', () => {
      expect(completedAfter(applyCommand(base, step(1, false), now))).toEqual([0, 2])
    })

    it('adds a new row when none exists yet for (childId, routineId, day)', () => {
      const next = applyCommand(base, step(0, true, { childId: theo.id, routineId: 'routine-new', day: '2026-09-20' }), now)
      expect(next.routineProgress).toContainEqual({ childId: theo.id, routineId: 'routine-new', day: '2026-09-20', completed: [0] })
      expect(next.routineProgress.length).toBe(base.routineProgress.length + 1)
    })

    it('applied on top of a newer server row, keeps the other display\'s steps', () => {
      const server = { ...base, routineProgress: base.routineProgress.map((p) => (p === existing ? { ...p, completed: [0, 1, 2, 4] } : p)) }
      expect(completedAfter(applyCommand(server, step(3, true), now))).toEqual([0, 1, 2, 3, 4])
    })

    it('is idempotent, both ways', () => {
      expectIdempotent(base, step(3, true))
      expectIdempotent(base, step(1, false))
      expect(completedAfter(applyCommand(base, step(1, true), now))).toEqual([0, 1, 2])
      expect(completedAfter(applyCommand(base, step(7, false), now))).toEqual([0, 1, 2])
    })

    it('does not mutate the input snapshot', () => {
      const next = applyCommand(base, step(3, true), now)
      expect(next).not.toBe(base)
      expect(completedAfter(base)).toEqual(existing.completed)
      expect(existing.completed).toEqual([0, 1, 2])
    })
  })
})
