import { describe, expect, it } from 'vitest'
import { requiresOnline, type LogCommand } from './logCommands'

const householdId = 'h1'

describe('requiresOnline', () => {
  it.each<LogCommand>([
    { kind: 'dose.void', householdId, doseId: 'd1', membershipId: 'm1', pin: '1234', reason: 'x' },
    { kind: 'dose.acknowledge', householdId, doseId: 'd1', membershipId: 'm1', pin: '1234' },
    {
      kind: 'sitter.start', householdId, sessionId: 's1', membershipId: 'm1', pin: '1234', sitterName: null, displayId: null,
      startedAt: '2026-09-14T19:00:00Z',
    },
    { kind: 'sitter.end', householdId, sessionId: 's1', membershipId: 'm1', pin: '1234', endedAt: '2026-09-14T19:00:00Z' },
    { kind: 'sitter.summaryShown', householdId, sessionId: 's1' },
  ])('$kind needs a live connection', (cmd) => {
    expect(requiresOnline(cmd)).toBe(true)
  })

  it('log entries can be queued offline', () => {
    expect(requiresOnline({ kind: 'dinner.set', householdId, text: 'Tacos', previous: null })).toBe(false)
    expect(requiresOnline({ kind: 'entry.delete', householdId, table: 'jots', entryId: 'j1' })).toBe(false)
  })

  it.each<LogCommand>([
    { kind: 'list.add', householdId, list: { id: 'l1', name: 'Costco', createdAt: '2026-09-14T19:00:00Z', archivedAt: null } },
    { kind: 'list.rename', householdId, listId: 'l1', name: 'Warehouse', previousName: 'Costco' },
    { kind: 'list.archive', householdId, listId: 'l1', archivedAt: '2026-09-14T19:00:00Z', previousArchivedAt: null },
    { kind: 'list.restore', householdId, listId: 'l1', previousArchivedAt: '2026-09-14T19:00:00Z' },
    {
      kind: 'task.add', householdId, displayId: null,
      task: { id: 't1', text: 'Book the sitter', assignedMembershipId: null, dueOn: null, createdAt: '2026-09-14T19:00:00Z', doneAt: null },
    },
    { kind: 'task.check', householdId, taskId: 't1', doneAt: '2026-09-14T19:00:00Z', previousDoneAt: null },
    {
      kind: 'task.update', householdId, taskId: 't1', text: 'x', assignedMembershipId: null, dueOn: null,
      previous: { text: 'y', assignedMembershipId: null, dueOn: null },
    },
    {
      kind: 'task.delete', householdId, displayId: null,
      task: { id: 't1', text: 'Book the sitter', assignedMembershipId: null, dueOn: null, createdAt: '2026-09-14T19:00:00Z', doneAt: null },
    },
    { kind: 'meal.set', householdId, day: '2026-09-14', text: 'Tacos', recipeId: null, previous: null },
    { kind: 'meal.clear', householdId, day: '2026-09-14', previous: { text: 'Tacos', recipeId: null } },
  ])('$kind can be queued offline (spec §8: the Kitchen keeps working offline)', (cmd) => {
    expect(requiresOnline(cmd)).toBe(false)
  })
})
