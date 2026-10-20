import { describe, expect, it } from 'vitest'
import type { MyConnection } from '@/data/calendarApi'
import {
  DEFAULT_DURATION_MIN,
  MAX_EVENT_TITLE,
  PICK_A_DATE,
  addEventBlock,
  addEventBlockMessage,
  addEventFailureMessage,
  assigneeOf,
  buildNewEvent,
  calendarFor,
  dateLabel,
  defaultStartTime,
  durationLabel,
  eventPeople,
  formDate,
  formProblem,
  newEventForm,
  optimisticRow,
  resolveCalendar,
  writableCalendars,
  type EventForm,
  type EventPerson,
} from './addEventModel'

const TZ = 'America/New_York'
const NOW = new Date('2026-10-19T18:07:00Z') // 2:07 PM in New York
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'

const sam: EventPerson = { type: 'member', id: SAM, name: 'Sam', color: '#653437' }
const ivy: EventPerson = { type: 'child', id: IVY, name: 'Ivy', color: '#D9A441' }

const calendar = (over: Record<string, unknown> = {}) => ({
  id: 'sel-1',
  name: 'Family',
  visible: true,
  gone: false,
  assignee: { type: 'member' as const, id: SAM },
  ...over,
})

const connection = (over: Partial<MyConnection> = {}): MyConnection => ({
  id: 'conn-1',
  provider: 'google',
  label: 'sam@example.com',
  status: 'ok',
  canWrite: true,
  calendars: [calendar()],
  ...over,
})

const form = (over: Partial<EventForm> = {}): EventForm => ({
  ...newEventForm(NOW, TZ),
  title: 'Swim lesson',
  personKey: `member:${SAM}`,
  ...over,
})

describe('writableCalendars', () => {
  it('offers a shown calendar of a working, writable connection', () => {
    expect(writableCalendars([connection()])).toEqual([
      { selectionId: 'sel-1', name: 'Family', accountLabel: 'sam@example.com', assignee: { type: 'member', id: SAM } },
    ])
  })

  it('leaves out ICS links, read-only accounts and accounts that need reconnecting', () => {
    expect(writableCalendars([connection({ provider: 'ics', canWrite: false })])).toEqual([])
    expect(writableCalendars([connection({ canWrite: false })])).toEqual([])
    expect(writableCalendars([connection({ status: 'auth_expired' })])).toEqual([])
    expect(writableCalendars([connection({ status: 'unreachable' })])).toEqual([])
  })

  it('leaves out calendars that are hidden, gone, or belong to nobody — writing there would show nowhere', () => {
    expect(writableCalendars([connection({ calendars: [calendar({ visible: false })] })])).toEqual([])
    expect(writableCalendars([connection({ calendars: [calendar({ gone: true })] })])).toEqual([])
    expect(writableCalendars([connection({ calendars: [calendar({ assignee: null })] })])).toEqual([])
  })

  it('keeps every offered calendar of every connection', () => {
    const two = connection({
      calendars: [calendar(), calendar({ id: 'sel-2', name: 'Ivy school', assignee: { type: 'child', id: IVY } })],
    })
    expect(writableCalendars([two, connection({ id: 'conn-2', label: 'work', calendars: [calendar({ id: 'sel-3' })] })]).map((c) => c.selectionId)).toEqual([
      'sel-1',
      'sel-2',
      'sel-3',
    ])
  })
})

describe('addEventBlock', () => {
  it('says offline before anything else', () => {
    expect(addEventBlock([connection()], false)).toBe('offline')
    expect(addEventBlockMessage('offline')).toContain('needs a connection')
  })

  it('is clear when there is a calendar to write to', () => {
    expect(addEventBlock([connection()], true)).toBeNull()
  })

  it('asks for a reconnection when a writable account has stopped working', () => {
    expect(addEventBlock([connection({ status: 'auth_expired' })], true)).toBe('needs_reconnecting')
    expect(addEventBlockMessage('needs_reconnecting')).toContain('reconnecting')
  })

  it('explains that links are one-way when nothing writable is connected at all', () => {
    expect(addEventBlock([], true)).toBe('no_writable_calendar')
    expect(addEventBlock([connection({ provider: 'ics', canWrite: false })], true)).toBe('no_writable_calendar')
    const message = addEventBlockMessage('no_writable_calendar')
    expect(message).toContain('one-way')
    expect(message).toContain('Manage household')
  })

  it('asks for a calendar to be shown when a writable account has none on the displays', () => {
    expect(addEventBlock([connection({ calendars: [calendar({ visible: false })] })], true)).toBe('not_shown')
    expect(addEventBlock([connection({ calendars: [] })], true)).toBe('not_shown')
    expect(addEventBlockMessage('not_shown')).toContain('shown on the displays')
  })
})

describe('choosing the calendar', () => {
  const calendars = writableCalendars([
    connection({ calendars: [calendar(), calendar({ id: 'sel-2', name: 'Ivy school', assignee: { type: 'child', id: IVY } })] }),
  ])

  it('defaults to the chosen person’s own calendar', () => {
    expect(calendarFor({ type: 'member', id: SAM }, calendars)?.selectionId).toBe('sel-1')
    expect(calendarFor({ type: 'child', id: IVY }, calendars)?.selectionId).toBe('sel-2')
  })

  it('has none for a person with no writable calendar, so the adult is asked to pick', () => {
    expect(calendarFor({ type: 'child', id: 'other' }, calendars)).toBeNull()
    expect(calendarFor(null, calendars)).toBeNull()
    expect(formProblem(form({ personKey: 'child:other' }), calendars)).toBe('Choose which calendar to add it to.')
  })

  it('lets a picked calendar override the person’s own', () => {
    expect(resolveCalendar(form({ selectionId: 'sel-2' }), calendars)?.selectionId).toBe('sel-2')
    expect(resolveCalendar(form({ selectionId: 'gone' }), calendars)).toBeNull()
  })
})

describe('assigneeOf and personKeyOf', () => {
  it('round-trips a member and a child, and refuses anything else', () => {
    expect(assigneeOf(`member:${SAM}`)).toEqual({ type: 'member', id: SAM })
    expect(assigneeOf(`child:${IVY}`)).toEqual({ type: 'child', id: IVY })
    expect(assigneeOf('sitter:1')).toBeNull()
    expect(assigneeOf('member:')).toBeNull()
    expect(assigneeOf(null)).toBeNull()
  })
})

describe('eventPeople', () => {
  it('lists members then children with their own colors', () => {
    expect(eventPeople([{ id: SAM, displayName: 'Sam', color: '#653437' }], [{ id: IVY, name: 'Ivy', color: '#D9A441' }])).toEqual([sam, ivy])
  })
})

describe('defaultStartTime', () => {
  it('rounds up to the next quarter hour in the household zone', () => {
    expect(defaultStartTime(NOW, TZ)).toBe('14:15')
    expect(defaultStartTime(new Date('2026-10-19T18:15:00Z'), TZ)).toBe('14:15')
    expect(defaultStartTime(new Date('2026-10-19T18:16:00Z'), TZ)).toBe('14:30')
    expect(defaultStartTime(NOW, 'UTC')).toBe('18:15')
  })

  it('never rolls past the end of the day', () => {
    // 11:52 PM in New York.
    expect(defaultStartTime(new Date('2026-10-20T03:52:00Z'), TZ)).toBe('23:45')
  })
})

describe('formDate and dateLabel', () => {
  it('reads the chosen day, and a picked date only when it is one', () => {
    expect(formDate(form())).toBe('2026-10-19')
    expect(formDate(form({ dateChoice: PICK_A_DATE, pickedDate: '2026-12-01' }))).toBe('2026-12-01')
    expect(formDate(form({ dateChoice: PICK_A_DATE, pickedDate: '' }))).toBeNull()
    expect(formDate(form({ dateChoice: PICK_A_DATE, pickedDate: 'soon' }))).toBeNull()
  })

  it('names today, tomorrow and any other day', () => {
    expect(dateLabel('2026-10-19', '2026-10-19', TZ)).toBe('Today')
    expect(dateLabel('2026-10-20', '2026-10-19', TZ)).toBe('Tomorrow')
    expect(dateLabel('2026-10-24', '2026-10-19', TZ)).toBe('Sat, Oct 24')
  })
})

describe('durationLabel', () => {
  it('reads minutes and hours', () => {
    expect(durationLabel(15)).toBe('15 min')
    expect(durationLabel(60)).toBe('1 h')
    expect(durationLabel(90)).toBe('1 h 30 min')
    expect(durationLabel(120)).toBe('2 h')
  })
})

describe('formProblem', () => {
  const calendars = writableCalendars([connection()])

  it('passes a complete form', () => {
    expect(formProblem(form(), calendars)).toBeNull()
  })

  it('asks for what is missing, one thing at a time', () => {
    expect(formProblem(form({ title: '   ' }), calendars)).toBe('Give the event a name.')
    expect(formProblem(form({ personKey: null }), calendars)).toBe('Choose who the event is for.')
    expect(formProblem(form({ dateChoice: PICK_A_DATE }), calendars)).toBe('Choose a date.')
    expect(formProblem(form({ startTime: '' }), calendars)).toBe('Choose a start time.')
    expect(formProblem(form(), [])).toBe('Choose which calendar to add it to.')
  })

  it('refuses markup in the name or the place, as the provider would', () => {
    expect(formProblem(form({ title: '<b>Swim</b>' }), calendars)).toContain('can’t contain')
    expect(formProblem(form({ location: 'YMCA <pool>' }), calendars)).toContain('can’t contain')
  })

  it('does not ask for a start time on an all-day event', () => {
    expect(formProblem(form({ allDay: true, startTime: '' }), calendars)).toBeNull()
  })
})

describe('buildNewEvent', () => {
  const calendars = writableCalendars([connection()])

  it('turns a day and a wall-clock start into instants in the household zone', () => {
    expect(buildNewEvent(form({ startTime: '16:00', durationMin: 45, location: '  YMCA  Pool ' }), calendars, TZ)).toEqual({
      selectionId: 'sel-1',
      title: 'Swim lesson',
      start: '2026-10-19T20:00:00.000Z',
      end: '2026-10-19T20:45:00.000Z',
      allDay: false,
      location: 'YMCA Pool',
    })
  })

  it('writes an all-day event as household dates with an exclusive end, and no time', () => {
    expect(buildNewEvent(form({ allDay: true, dateChoice: '2026-10-20' }), calendars, TZ)).toEqual({
      selectionId: 'sel-1',
      title: 'Swim lesson',
      start: '2026-10-20',
      end: '2026-10-21',
      allDay: true,
      location: null,
    })
  })

  it('uses the default duration and trims an over-long title', () => {
    const built = buildNewEvent(form({ title: `  ${'x'.repeat(MAX_EVENT_TITLE + 10)}  ` }), calendars, TZ)!
    expect(built.title).toHaveLength(MAX_EVENT_TITLE)
    expect(Date.parse(built.end) - Date.parse(built.start)).toBe(DEFAULT_DURATION_MIN * 60_000)
  })

  it('writes to the calendar the adult picked', () => {
    const two = writableCalendars([
      connection({ calendars: [calendar(), calendar({ id: 'sel-2', assignee: { type: 'child', id: IVY } })] }),
    ])
    expect(buildNewEvent(form({ selectionId: 'sel-2' }), two, TZ)!.selectionId).toBe('sel-2')
  })

  it('is null while the form is not ready', () => {
    expect(buildNewEvent(form({ title: '' }), calendars, TZ)).toBeNull()
    expect(buildNewEvent(form(), [], TZ)).toBeNull()
  })

  it('crosses a DST change without losing an hour', () => {
    // The US falls back overnight on 1 November 2026; 9:00 AM is still 9:00 AM.
    const built = buildNewEvent(form({ dateChoice: '2026-11-01', startTime: '09:00', durationMin: 60 }), calendars, TZ)!
    expect(built.start).toBe('2026-11-01T14:00:00.000Z')
    expect(built.end).toBe('2026-11-01T15:00:00.000Z')
  })
})

describe('optimisticRow', () => {
  it('draws the new event in the person’s own color', () => {
    expect(
      optimisticRow(
        { selectionId: 'sel-1', title: 'Swim lesson', startAt: '2026-10-19T20:00:00.000Z', endAt: '2026-10-19T20:45:00.000Z', allDay: false, location: 'YMCA' },
        ivy,
      ),
    ).toEqual({
      title: 'Swim lesson',
      startAt: '2026-10-19T20:00:00.000Z',
      endAt: '2026-10-19T20:45:00.000Z',
      allDay: false,
      location: 'YMCA',
      personType: 'child',
      personId: IVY,
      calendarColor: '#D9A441',
    })
  })
})

describe('addEventFailureMessage', () => {
  it('says what to do about each refusal', () => {
    expect(addEventFailureMessage({ code: 'not_writable' })).toContain('Connect the account again')
    expect(addEventFailureMessage({ code: 'auth_expired' })).toContain('needs reconnecting')
    expect(addEventFailureMessage({ code: 'calendar_gone' })).toContain('Pick another one')
    expect(addEventFailureMessage({ code: 'unreachable' })).toContain('Try again in a moment')
    expect(addEventFailureMessage({ code: 'rate_limited' })).toContain('one hour')
    expect(addEventFailureMessage({ code: 'invalid_request' })).toContain('didn’t look right')
    expect(addEventFailureMessage({ code: 'network' })).toContain('Check the connection')
    expect(addEventFailureMessage({ code: 'forbidden' }, 'pin')).toContain('PIN')
    expect(addEventFailureMessage({ code: 'forbidden' }, 'account')).toContain('Sign in again')
    expect(addEventFailureMessage(new Error('boom'))).toBe('Couldn’t add the event. Try again.')
  })
})
