import { describe, expect, it } from 'vitest'
import { buildDemoSnapshot } from './demo/demoFixture'
import { inverseCommand } from './inverseCommand'
import type { Attribution, LogCommand } from './logCommands'

const now = new Date('2026-09-14T19:00:00Z')
const base = buildDemoSnapshot(now)
const ivy = base.children[0]!
const sam = base.members[0]!
const householdId = base.household.id

const attribution: Attribution = {
  displayId: 'demo-display',
  loggedByMembershipId: sam.id,
  sitterSessionId: null,
  loggedByName: sam.displayName,
}

describe('inverseCommand', () => {
  it('sleep.start -> entry.delete on sleep_entries for the same id', () => {
    const entry = { id: 'sleep-1', childId: ivy.id, startAt: now.toISOString(), endAt: null, type: 'nap' as const }
    const cmd: LogCommand = { kind: 'sleep.start', householdId, entry, attribution }
    expect(inverseCommand(cmd)).toEqual({ kind: 'entry.delete', householdId, table: 'sleep_entries', entryId: 'sleep-1' })
  })

  it('sleep.end -> sleep.end with endAt/previousEndAt swapped', () => {
    const cmd: LogCommand = { kind: 'sleep.end', householdId, entryId: 'sleep-1', endAt: '2026-09-14T20:00:00Z', previousEndAt: null }
    expect(inverseCommand(cmd)).toEqual({ kind: 'sleep.end', householdId, entryId: 'sleep-1', endAt: null, previousEndAt: '2026-09-14T20:00:00Z' })
  })

  it('sleep.discard -> sleep.restore with the same entry', () => {
    const entry = base.sleeps[0]!
    const cmd: LogCommand = { kind: 'sleep.discard', householdId, entry, attribution }
    expect(inverseCommand(cmd)).toEqual({ kind: 'sleep.restore', householdId, entry, attribution })
  })

  it('sleep.restore -> sleep.discard with the same entry', () => {
    const entry = base.sleeps[0]!
    const cmd: LogCommand = { kind: 'sleep.restore', householdId, entry, attribution }
    expect(inverseCommand(cmd)).toEqual({ kind: 'sleep.discard', householdId, entry, attribution })
  })

  it.each([
    ['feeding.add', 'feeding_entries'],
    ['sticker.add', 'sticker_entries'],
    ['diaper.add', 'diaper_entries'],
  ] as const)('%s -> entry.delete for %s', (kind, table) => {
    const entry = { id: 'entry-1' } as never
    const cmd = { kind, householdId, entry, attribution } as LogCommand
    expect(inverseCommand(cmd)).toEqual({ kind: 'entry.delete', householdId, table, entryId: 'entry-1' })
  })

  it('jot.add -> entry.delete for jots', () => {
    const jot = { id: 'jot-x', text: 'note', createdAt: now.toISOString(), doneAt: null }
    const cmd: LogCommand = { kind: 'jot.add', householdId, jot, displayId: 'demo-display' }
    expect(inverseCommand(cmd)).toEqual({ kind: 'entry.delete', householdId, table: 'jots', entryId: 'jot-x' })
  })

  it('grocery.add -> grocery.delete with the same item', () => {
    const item = { id: 'g1', text: 'Milk', createdAt: now.toISOString(), checkedAt: null }
    const cmd: LogCommand = { kind: 'grocery.add', householdId, item, displayId: 'demo-display' }
    expect(inverseCommand(cmd)).toEqual({ kind: 'grocery.delete', householdId, item, displayId: 'demo-display' })
  })

  it('grocery.delete -> grocery.add with the same item', () => {
    const item = { id: 'g1', text: 'Milk', createdAt: now.toISOString(), checkedAt: null }
    const cmd: LogCommand = { kind: 'grocery.delete', householdId, item, displayId: 'demo-display' }
    expect(inverseCommand(cmd)).toEqual({ kind: 'grocery.add', householdId, item, displayId: 'demo-display' })
  })

  it('grocery.check -> grocery.check with checkedAt/previousCheckedAt swapped', () => {
    const cmd: LogCommand = { kind: 'grocery.check', householdId, itemId: 'g1', checkedAt: '2026-09-14T20:00:00Z', previousCheckedAt: null }
    expect(inverseCommand(cmd)).toEqual({ kind: 'grocery.check', householdId, itemId: 'g1', checkedAt: null, previousCheckedAt: '2026-09-14T20:00:00Z' })
  })

  it('dinner.set -> dinner.set with text/previous swapped', () => {
    const cmd: LogCommand = { kind: 'dinner.set', householdId, text: 'Tacos', previous: null }
    expect(inverseCommand(cmd)).toEqual({ kind: 'dinner.set', householdId, text: null, previous: 'Tacos' })
  })

  it('routine.step -> routine.step with done flipped', () => {
    const cmd: LogCommand = {
      kind: 'routine.step', householdId, childId: ivy.id, routineId: 'routine-1', day: '2026-09-14', stepIndex: 2, done: true,
    }
    expect(inverseCommand(cmd)).toEqual({
      kind: 'routine.step', householdId, childId: ivy.id, routineId: 'routine-1', day: '2026-09-14', stepIndex: 2, done: false,
    })
    expect(inverseCommand(inverseCommand(cmd)!)).toEqual(cmd)
  })

  it.each([
    ['dose.add', { kind: 'dose.add', householdId, entry: base.doses[0]!, attribution }],
    ['entry.delete', { kind: 'entry.delete', householdId, table: 'jots', entryId: 'jot-1' }],
    ['dose.void', { kind: 'dose.void', householdId, doseId: base.doses[0]!.id, membershipId: sam.id, pin: '1234', reason: 'x' }],
    ['dose.acknowledge', { kind: 'dose.acknowledge', householdId, doseId: base.doses[0]!.id, membershipId: sam.id, pin: '1234' }],
  ] as const)('%s -> null', (_kind, cmd) => {
    expect(inverseCommand(cmd as LogCommand)).toBeNull()
  })
})
