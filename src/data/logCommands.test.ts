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
})
