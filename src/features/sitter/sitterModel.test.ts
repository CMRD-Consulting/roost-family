import { describe, expect, it } from 'vitest'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot, SitterSession } from '@/data/snapshot'
import type { DoseEntry } from '@/domain/types'
import {
  careInfoModel, pendingSummary, sitterAttribution, sitterLabel, summaryBannerLabel, summaryModel,
} from './sitterModel'

const now = new Date('2026-09-14T19:00:00Z') // 3:00 PM EDT, Monday
const H = 3_600_000
const MIN = 60_000
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const IBUPROFEN_THEO = 'eeeeeeee-0000-0000-0000-000000000001'
const at = (iso: string) => new Date(iso).toISOString()

const session = (over: Partial<SitterSession> = {}): SitterSession => ({
  id: 'session-1',
  sitterName: 'Jess',
  startedAt: '2026-09-14T16:30:00.000Z', // 12:30 PM
  endedAt: '2026-09-14T19:10:00.000Z', // 3:10 PM
  summaryShownAt: null,
  ...over,
})

/** The demo household with nothing logged, so each test adds exactly what it checks. */
function emptyLogs(): HouseholdSnapshot {
  const s = buildDemoSnapshot(now)
  return { ...s, sleeps: [], feedings: [], doses: [], stickers: [], diapers: [] }
}

const dose = (over: Partial<DoseEntry>): DoseEntry => ({
  id: crypto.randomUUID(),
  childId: THEO,
  medicineId: IBUPROFEN_THEO,
  at: at('2026-09-14T18:00:00Z'),
  loggedByName: 'Jess (sitter)',
  loggedOffline: false,
  voidedAt: null,
  voidReason: null,
  conflictAcknowledgedAt: null,
  createdAt: at('2026-09-14T18:00:00Z'),
  note: '2.5 ml',
  warningsConfirmed: [],
  sitterSessionId: 'session-1',
  ...over,
})

describe('sitterLabel and sitterAttribution', () => {
  it('names the sitter, or says "Sitter" without a name', () => {
    expect(sitterLabel(session())).toBe('Jess (sitter)')
    expect(sitterLabel(session({ sitterName: null }))).toBe('Sitter')
    expect(sitterAttribution(session())).toEqual({ sitterSessionId: 'session-1', loggedByName: 'Jess (sitter)' })
    expect(sitterAttribution(session({ sitterName: null }))).toEqual({ sitterSessionId: 'session-1', loggedByName: 'Sitter' })
  })
})

describe('careInfoModel', () => {
  it('lists the sections in order, with routines, food rules and the household notes', () => {
    const s = buildDemoSnapshot(now)
    s.children = s.children.map((c) => (c.id === IVY ? { ...c, allergies: 'Peanuts', foodRules: 'No whole grapes' } : c))
    s.household.sitterInfo = { ...s.household.sitterInfo, foodRules: 'No sweets after 5 PM' }

    const model = careInfoModel(s, now)

    expect(model.sections.map((x) => x.title)).toEqual([
      "Today's routine", 'Naps & bedtime', 'Food & allergies', 'Emergency contacts', 'Pediatrician', 'Address', 'Where things are',
    ])
    // Ivy's weekday routine: breakfast, teeth and dressed are done; Nap (12:30) is the current step at 3 PM.
    expect(model.sections[0]!.body).toBe('Ivy: Nap\nTheo: No routine today')
    expect(model.sections[1]!.body).toBe('Theo naps in the crib with the sound machine on.\nBedtime: Ivy 7:00 PM, Theo 6:30 PM')
    expect(model.sections[2]!.body).toBe('Ivy allergies: Peanuts\nIvy: No whole grapes\nNo sweets after 5 PM')
    expect(model.sections[3]!.body).toBe('Sam 704-555-0101 · Alex 704-555-0102')
    expect(model.sections[4]!.body).toBe('Dr. Patel 704-555-0199')
    expect(model.sections[5]!.body).toBe('12 Maple St')
    expect(model.sections[6]!.body).toBe('Spare diapers: hall closet')
  })

  it('skips empty sections and blank notes, and copes with a cached snapshot without sitter info', () => {
    const s = buildDemoSnapshot(now)
    s.children = []
    s.household.sitterInfo = { napInstructions: '   ', bedtime: '7 PM', address: '' }
    expect(careInfoModel(s, now).sections).toEqual([{ title: 'Naps & bedtime', body: 'Bedtime: 7 PM' }])

    const cached = buildDemoSnapshot(now)
    cached.children = []
    ;(cached.household as { sitterInfo?: unknown }).sitterInfo = undefined
    expect(careInfoModel(cached, now).sections).toEqual([])
  })

  it('says when a routine is finished for the day', () => {
    const s = buildDemoSnapshot(now)
    s.routineProgress = [{ childId: IVY, routineId: 'routine-ivy-homeday', day: '2026-09-14', completed: [0, 1, 2, 3, 4, 5, 6, 7, 8] }]
    expect(careInfoModel(s, now).sections[0]!.body).toBe('Ivy: Routine done for today\nTheo: No routine today')
  })
})

describe('summaryModel', () => {
  it('has the title, sitter and time range, and a card per child in order', () => {
    const model = summaryModel(emptyLogs(), session(), now)
    expect(model.title).toBe('While you were out')
    expect(model.sitterName).toBe('Jess')
    expect(model.rangeLabel).toBe('12:30 PM – 3:10 PM')
    expect(model.children.map((c) => [c.name, c.lines])).toEqual([['Ivy', []], ['Theo', []]])
    expect(model.children[0]!.color).toBe(buildDemoSnapshot(now).children[0]!.color)
    expect(summaryModel(emptyLogs(), session({ sitterName: null }), now).sitterName).toBe('Sitter')
  })

  it('describes ended and open sleeps with their ranges', () => {
    const s = emptyLogs()
    s.sleeps = [
      { id: 'nap', childId: THEO, startAt: at('2026-09-14T17:05:00Z'), endAt: at('2026-09-14T18:20:00Z'), type: 'nap', sitterSessionId: 'session-1' },
      { id: 'cross', childId: IVY, startAt: at('2026-09-14T15:30:00Z'), endAt: at('2026-09-14T16:40:00Z'), type: 'nap', sitterSessionId: 'session-1' },
      { id: 'night', childId: THEO, startAt: at('2026-09-14T18:40:00Z'), endAt: null, type: 'night', sitterSessionId: 'session-1' },
    ]
    const model = summaryModel(s, session({ startedAt: at('2026-09-14T16:00:00Z') }), now)
    expect(model.children[0]!.lines).toEqual([{ time: '11:30 AM', icon: 'sleep', text: 'Nap 11:30 AM–12:40 PM (1h 10m)' }])
    expect(model.children[1]!.lines).toEqual([
      { time: '1:05 PM', icon: 'sleep', text: 'Nap 1:05–2:20 PM (1h 15m)' },
      { time: '2:40 PM', icon: 'sleep', text: 'Night sleep from 2:40 PM' },
    ])
  })

  it('describes feedings, doses with their flags, stickers and diapers, ordered by time', () => {
    const s = emptyLogs()
    s.feedings = [
      { id: 'f1', childId: THEO, at: at('2026-09-14T17:00:00Z'), type: 'milk', amount: '6 oz', note: null, sitterSessionId: 'session-1' },
      { id: 'f2', childId: THEO, at: at('2026-09-14T16:45:00Z'), type: 'meal', amount: null, note: 'Pasta', sitterSessionId: 'session-1' },
    ]
    s.doses = [
      dose({ at: at('2026-09-14T18:00:00Z') }),
      dose({ at: at('2026-09-14T18:10:00Z'), warningsConfirmed: ['early'], note: null }),
      dose({ at: at('2026-09-14T18:20:00Z'), voidedAt: at('2026-09-14T18:21:00Z'), voidReason: 'Logged twice', warningsConfirmed: ['early'], loggedOffline: true }),
      dose({ at: at('2026-09-14T18:30:00Z'), loggedOffline: true }),
      dose({ at: at('2026-09-14T18:40:00Z'), voidedAt: at('2026-09-14T18:41:00Z') }),
    ]
    s.stickers = [{ id: 'st', childId: IVY, categoryId: 'dddddddd-0000-0000-0000-000000000001', at: at('2026-09-14T17:30:00Z'), sitterSessionId: 'session-1' }]
    s.diapers = [
      { id: 'd1', childId: THEO, at: at('2026-09-14T17:10:00Z'), kind: 'wet', sitterSessionId: 'session-1' },
      { id: 'd2', childId: THEO, at: at('2026-09-14T17:20:00Z'), kind: 'both', sitterSessionId: 'session-1' },
    ]

    const [ivy, theo] = summaryModel(s, session(), now).children
    expect(ivy!.lines).toEqual([{ time: '1:30 PM', icon: 'sticker', text: 'Sticker: Potty' }])
    expect(theo!.lines).toEqual([
      { time: '12:45 PM', icon: 'feeding', text: 'Meal · Pasta' },
      { time: '1:00 PM', icon: 'feeding', text: 'Milk · 6 oz' },
      { time: '1:10 PM', icon: 'diaper', text: 'Diaper: Wet' },
      { time: '1:20 PM', icon: 'diaper', text: 'Diaper: Wet and dirty' },
      { time: '2:00 PM', icon: 'medicine', text: 'Infant ibuprofen · 2.5 ml' },
      { time: '2:10 PM', icon: 'medicine', text: 'Infant ibuprofen', flags: [{ kind: 'warningConfirmed', text: 'Given despite a timing warning' }] },
      {
        time: '2:20 PM', icon: 'medicine', text: 'Infant ibuprofen · 2.5 ml',
        flags: [
          { kind: 'voided', text: 'Voided: Logged twice' },
          { kind: 'warningConfirmed', text: 'Given despite a timing warning' },
          { kind: 'offline', text: 'Logged offline' },
        ],
      },
      { time: '2:30 PM', icon: 'medicine', text: 'Infant ibuprofen · 2.5 ml', flags: [{ kind: 'offline', text: 'Logged offline' }] },
      { time: '2:40 PM', icon: 'medicine', text: 'Infant ibuprofen · 2.5 ml', flags: [{ kind: 'voided', text: 'Voided' }] },
    ])
  })

  it("counts the sitter's entries by session, not by time, and leaves out adults' entries during the session", () => {
    const s = emptyLogs()
    s.feedings = [
      { id: 'backdated', childId: THEO, at: at('2026-09-14T16:00:00Z'), type: 'milk', amount: null, note: null, sitterSessionId: 'session-1' },
      { id: 'skewed', childId: THEO, at: at('2026-09-14T19:30:00Z'), type: 'snack', amount: null, note: null, sitterSessionId: 'session-1' },
      { id: 'parent', childId: THEO, at: at('2026-09-14T17:00:00Z'), type: 'meal', amount: null, note: null, sitterSessionId: null },
    ]
    s.doses = [dose({ at: at('2026-09-14T18:00:00Z'), loggedByName: 'Sam', sitterSessionId: null })]
    expect(summaryModel(s, session(), new Date(now.getTime() + H)).children[1]!.lines).toEqual([
      { time: '12:00 PM', icon: 'feeding', text: 'Milk' },
      { time: '3:30 PM', icon: 'feeding', text: 'Snack' },
    ])
  })
})

describe('pendingSummary and summaryBannerLabel', () => {
  it('is the recent session until its summary has been shown', () => {
    const s = buildDemoSnapshot(now)
    expect(pendingSummary(s, now)).toBeNull()
    s.recentSitterSession = session({ endedAt: at('2026-09-14T18:50:00Z') })
    expect(pendingSummary(s, now)?.id).toBe('session-1')
    s.recentSitterSession = session({ endedAt: at('2026-09-14T18:50:00Z'), summaryShownAt: now.toISOString() })
    expect(pendingSummary(s, now)).toBeNull()
  })

  it('treats a cached snapshot without the fields as nothing pending, and expires after 12 hours', () => {
    const cached = buildDemoSnapshot(now) as Partial<HouseholdSnapshot>
    delete cached.recentSitterSession
    expect(pendingSummary(cached as HouseholdSnapshot, now)).toBeNull()

    const s = buildDemoSnapshot(now)
    s.recentSitterSession = { ...session({ endedAt: at('2026-09-14T18:50:00Z') }), summaryShownAt: undefined as unknown as null }
    expect(pendingSummary(s, now)?.id).toBe('session-1')
    expect(pendingSummary(s, new Date(Date.parse('2026-09-14T18:50:00Z') + 12 * H + MIN))).toBeNull()
  })

  it('offers the oldest unseen summary first, skipping excluded and already shown sessions', () => {
    const s = buildDemoSnapshot(now)
    const older = session({ id: 'older', endedAt: at('2026-09-14T12:00:00Z') })
    const newer = session({ id: 'newer', endedAt: at('2026-09-14T16:00:00Z') })
    s.unseenSitterSessions = [older, newer]
    s.recentSitterSession = older
    expect(pendingSummary(s, now)?.id).toBe('older')
    expect(pendingSummary(s, now, ['older'])?.id).toBe('newer')
    expect(pendingSummary(s, now, ['older', 'newer'])).toBeNull()

    s.unseenSitterSessions = [{ ...older, summaryShownAt: now.toISOString() }, newer]
    s.recentSitterSession = { ...older, summaryShownAt: now.toISOString() }
    expect(pendingSummary(s, now)?.id).toBe('newer')
  })

  it('words the banner with and without a sitter name', () => {
    expect(summaryBannerLabel(session(), 'America/New_York')).toBe('Sitter session with Jess ended at 3:10 PM')
    expect(summaryBannerLabel(session({ sitterName: null }), 'America/New_York')).toBe('Sitter session ended at 3:10 PM')
  })
})
