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
    const entry = { id: 'new-sleep', childId: ivy.id, startAt: now.toISOString(), endAt: null, type: 'nap' as const }
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
    const open = { id: 'open-sleep', childId: theo.id, startAt: now.toISOString(), endAt: null, type: 'nap' as const }
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
      const entry = { id: 'new-feed', childId: ivy.id, at: now.toISOString(), type: 'milk' as const, amount: '4 oz', note: null }
      const cmd: LogCommand = { kind: 'feeding.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.feedings).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })

    it('sticker.add appends and is idempotent', () => {
      const entry = { id: 'new-sticker', childId: ivy.id, categoryId: base.stickerCategories[0]!.id, at: now.toISOString() }
      const cmd: LogCommand = { kind: 'sticker.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.stickers).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })

    it('diaper.add appends and is idempotent', () => {
      const entry = { id: 'new-diaper', childId: theo.id, at: now.toISOString(), kind: 'wet' as const }
      const cmd: LogCommand = { kind: 'diaper.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.diapers).toContainEqual(entry)
      expectIdempotent(base, cmd)
    })
  })

  describe('dose.add', () => {
    it('appends and is idempotent', () => {
      const entry = {
        id: 'new-dose', childId: theo.id, medicineId: base.medicines[0]!.id, at: now.toISOString(),
        loggedByName: null, loggedOffline: false, voidedAt: null, conflictAcknowledgedAt: null,
        createdAt: '', note: null, warningsConfirmed: [],
      }
      const cmd: LogCommand = { kind: 'dose.add', householdId: base.household.id, entry, attribution }
      const next = applyCommand(base, cmd, now)
      expect(next.doses).toContainEqual({ ...entry, createdAt: now.toISOString(), loggedByName: sam.displayName })
      expectIdempotent(base, cmd)
    })

    it('sets createdAt to now only when the entry has no createdAt', () => {
      const entry = {
        id: 'new-dose-2', childId: theo.id, medicineId: base.medicines[0]!.id, at: now.toISOString(),
        loggedByName: 'Alex', loggedOffline: false, voidedAt: null, conflictAcknowledgedAt: null,
        createdAt: '2026-09-14T18:00:00.000Z', note: null, warningsConfirmed: [],
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
      const item = { id: 'new-grocery', text: 'Eggs', createdAt: now.toISOString(), checkedAt: null }
      const cmd: LogCommand = { kind: 'grocery.add', householdId: base.household.id, item, displayId: 'demo-display' }
      const next = applyCommand(base, cmd, now)
      expect(next.groceries).toContainEqual(item)
      expectIdempotent(base, cmd)
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
      const diaperEntry = { id: 'diaper-x', childId: theo.id, at: now.toISOString(), kind: 'wet' as const }
      const withDiaper = applyCommand(base, { kind: 'diaper.add', householdId: base.household.id, entry: diaperEntry, attribution }, now)
      const cmd: LogCommand = { kind: 'entry.delete', householdId: base.household.id, table: 'diaper_entries', entryId: 'diaper-x' }
      const next = applyCommand(withDiaper, cmd, now)
      expect(next.diapers.some((d) => d.id === 'diaper-x')).toBe(false)
    })
  })

  describe('dose.void / dose.acknowledge', () => {
    const doseId = base.doses[0]!.id

    it('dose.void sets voidedAt to now', () => {
      const cmd: LogCommand = { kind: 'dose.void', householdId: base.household.id, doseId, membershipId: sam.id, pin: '1234', reason: 'test' }
      const next = applyCommand(base, cmd, now)
      expect(next.doses.find((d) => d.id === doseId)?.voidedAt).toBe(now.toISOString())
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

    it('end moves the active session to recentSitterSession with endedAt', () => {
      const next = applyCommand(applyCommand(base, start, now), end, now)
      expect(next.activeSitterSession).toBeNull()
      expect(next.recentSitterSession).toEqual({ id: 'sitter-client-id', sitterName: 'Jess', startedAt, endedAt, summaryShownAt: null })
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
