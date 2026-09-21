import { describe, expect, it } from 'vitest'
import { buildJoinDisplayChoices, reconnectWarning, type JoinDisplayChoice, type JoinDisplayRow } from './joinDisplayChoices'

const NOW = new Date('2026-09-21T16:00:00Z')
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()

/** The one choice built from one row. */
function only(r: JoinDisplayRow): JoinDisplayChoice {
  const [choice] = buildJoinDisplayChoices([r], NOW)
  if (!choice) throw new Error('No choice was built')
  return choice
}

function row(over: Partial<JoinDisplayRow> & { id: string }): JoinDisplayRow {
  return { name: 'Kitchen', lastSeenAt: null, connected: true, ...over }
}

describe('buildJoinDisplayChoices', () => {
  it('keeps the order it was given (oldest display first) and says when each last checked in', () => {
    const choices = buildJoinDisplayChoices(
      [row({ id: 'a', name: 'Kitchen', lastSeenAt: minutesAgo(3 * 24 * 60) }), row({ id: 'b', name: 'Playroom', lastSeenAt: minutesAgo(90) })],
      NOW,
    )
    expect(choices.map((c) => [c.displayId, c.name, c.detail])).toEqual([
      ['a', 'Kitchen', 'Last seen 3 days ago'],
      ['b', 'Playroom', 'Last seen 1 hour ago'],
    ])
  })

  it('says a display nobody holds is signed out, whenever it last checked in', () => {
    const choice = only(row({ id: 'a', connected: false, lastSeenAt: minutesAgo(1) }))
    expect(choice.detail).toBe('Signed out')
    expect(choice.recentlyActive).toBe(false)
  })

  it('flags a connected display that checked in within 10 minutes: a tablet may still be using it', () => {
    const choices = buildJoinDisplayChoices(
      [
        row({ id: 'fresh', lastSeenAt: minutesAgo(2) }),
        row({ id: 'edge', lastSeenAt: minutesAgo(10) }),
        row({ id: 'stale', lastSeenAt: minutesAgo(11) }),
        row({ id: 'never', lastSeenAt: null }),
      ],
      NOW,
    )
    expect(choices.map((c) => [c.displayId, c.recentlyActive])).toEqual([
      ['fresh', true],
      ['edge', true],
      ['stale', false],
      ['never', false],
    ])
  })

  it('treats a check-in from a clock ahead of this tablet as just now', () => {
    const choice = only(row({ id: 'a', lastSeenAt: minutesAgo(-5) }))
    expect(choice.detail).toBe('Last seen just now')
    expect(choice.recentlyActive).toBe(true)
  })
})

describe('reconnectWarning', () => {
  it('names the display and what happens to the tablet that holds it', () => {
    const choice = only(row({ id: 'a', name: 'Kitchen', lastSeenAt: minutesAgo(2) }))
    expect(reconnectWarning(choice)).toBe(
      'Kitchen checked in 2 minutes ago, so a tablet may still be using it. Reconnecting signs that tablet out.',
    )
  })

  it('reads naturally for a check-in within the last minute', () => {
    const choice = only(row({ id: 'a', name: 'Kitchen', lastSeenAt: minutesAgo(0) }))
    expect(reconnectWarning(choice)).toBe(
      'Kitchen checked in just now, so a tablet may still be using it. Reconnecting signs that tablet out.',
    )
  })
})
