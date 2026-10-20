/**
 * Adding an event (spec §5.5, §7.2): the rules behind the Add event sheet, free of Vue and Supabase.
 *
 * Roost writes the event to a connected Google calendar and stores nothing itself, so the form's job is
 * to pick **which** calendar and turn "tomorrow, 4:00 PM, 45 minutes" into the instants the Edge Function takes.
 *
 * Only calendars that can actually show the result are offered: a writable connection that is working (`canWrite`
 * and `ok`), and a calendar of it that is shown on the displays and still exists. Writing to a hidden calendar would
 * succeed and then appear nowhere, which is worse than not offering it.
 */
import type { Assignee, CreatedEvent, MyConnection, NewEvent, TodayEvent } from '@/data/calendarApi'
import { householdDate, householdWallTime, shiftHouseholdDate } from '@/domain/time'
import type { HouseholdDate, HourMinute } from '@/domain/types'

export const MAX_EVENT_TITLE = 200
export const MAX_EVENT_LOCATION = 200
/** How long an event lasts, in minutes; the first is the default. */
export const DURATION_CHOICES = [30, 45, 60, 15, 90, 120] as const
export const DEFAULT_DURATION_MIN = DURATION_CHOICES[0]
/** Start times are offered on the quarter hour, as calendar events usually fall. */
const START_STEP_MIN = 15
export const PICK_A_DATE = 'pick'

export type PersonKey = `member:${string}` | `child:${string}`

/** Someone an event can be for: a member or a child of the household. */
export interface EventPerson extends Assignee {
  name: string
  color: string
}

/** One calendar an event may be written to. */
export interface WritableCalendar {
  selectionId: string
  /** The calendar's own name, e.g. "Family". */
  name: string
  /** The account it belongs to, e.g. "sam@example.com", for telling two "Family" calendars apart. */
  accountLabel: string
  /** Whose calendar it is; always set, because only shown calendars are offered and those have exactly one person. */
  assignee: Assignee
}

/** Why Add event cannot be used now, or null when it can. */
export type AddEventBlock = 'offline' | 'needs_reconnecting' | 'not_shown' | 'no_writable_calendar' | null

export const personKeyOf = (a: Assignee): PersonKey => (a.type === 'member' ? `member:${a.id}` : `child:${a.id}`)

/** `member:<uuid>` / `child:<uuid>` back to an assignee, or null when it is neither. */
export function assigneeOf(key: string | null): Assignee | null {
  if (!key) return null
  const [type, ...rest] = key.split(':')
  const id = rest.join(':')
  return id && (type === 'member' || type === 'child') ? { type, id } : null
}

/**
 * Every calendar an event can be added to: of the adult's own connections that may be written to and are working,
 * shown on the displays and still present at the provider.
 */
export function writableCalendars(connections: readonly MyConnection[]): WritableCalendar[] {
  const out: WritableCalendar[] = []
  for (const connection of connections) {
    if (!connection.canWrite || connection.status !== 'ok') continue
    for (const calendar of connection.calendars) {
      if (!calendar.visible || calendar.gone || !calendar.assignee) continue
      out.push({ selectionId: calendar.id, name: calendar.name, accountLabel: connection.label, assignee: calendar.assignee })
    }
  }
  return out
}

/**
 * Why the entry point is unavailable. The three reasons are kept apart because each asks something different of the
 * adult: wait for the connection, connect the account again, show one of its calendars, or connect an account at all.
 */
export function addEventBlock(connections: readonly MyConnection[], online: boolean): AddEventBlock {
  if (!online) return 'offline'
  if (writableCalendars(connections).length > 0) return null
  if (connections.some((c) => c.canWrite && c.status !== 'ok')) return 'needs_reconnecting'
  // A writable account is connected, but none of its calendars is shown on the displays, so an event written to one
  // would appear nowhere.
  if (connections.some((c) => c.canWrite)) return 'not_shown'
  return 'no_writable_calendar'
}

export function addEventBlockMessage(block: Exclude<AddEventBlock, null>): string {
  switch (block) {
    case 'offline':
      return 'Adding an event needs a connection. Try again once Roost Family is back online.'
    case 'needs_reconnecting':
      return 'That calendar account needs reconnecting before an event can be added to it.'
    case 'not_shown':
      return 'None of that account’s calendars is shown on the displays yet. Show one in Settings → Calendars, and events can be added to it.'
    default:
      return 'No calendar here can be added to yet. Calendar links are one-way, so connect Google from Manage household, then show one of its calendars.'
  }
}

/** The calendar for `person`: their own if one is writable, otherwise none (the adult picks). */
export function calendarFor(person: Assignee | null, calendars: readonly WritableCalendar[]): WritableCalendar | null {
  if (!person) return null
  const key = personKeyOf(person)
  return calendars.find((c) => personKeyOf(c.assignee) === key) ?? null
}

/** The people an event can be for, in the order the household lists them: members, then children. */
export function eventPeople(
  members: ReadonlyArray<{ id: string; displayName: string; color: string }>,
  children: ReadonlyArray<{ id: string; name: string; color: string }>,
): EventPerson[] {
  return [
    ...members.map((m) => ({ type: 'member' as const, id: m.id, name: m.displayName, color: m.color })),
    ...children.map((c) => ({ type: 'child' as const, id: c.id, name: c.name, color: c.color })),
  ]
}

export interface EventForm {
  title: string
  /** `member:<id>` or `child:<id>`; null until someone is chosen. */
  personKey: string | null
  /** The calendar the adult picked, overriding the person's own. */
  selectionId: string | null
  /** A household date, or `pick` with `pickedDate` set. */
  dateChoice: HouseholdDate | typeof PICK_A_DATE
  pickedDate: string
  startTime: string
  durationMin: number
  allDay: boolean
  location: string
}

/** The first start time at or after `now`, on the quarter hour; never past 23:45, which belongs to the next day. */
export function defaultStartTime(now: Date, timeZone: string): HourMinute {
  const wall = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(now)
  const [hours = '0', minutes = '0'] = wall.split(':')
  const total = (Number(hours) % 24) * 60 + Number(minutes)
  const rounded = Math.min(Math.ceil(total / START_STEP_MIN) * START_STEP_MIN, 23 * 60 + 45)
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}` as HourMinute
}

export function newEventForm(now: Date, timeZone: string): EventForm {
  return {
    title: '',
    personKey: null,
    selectionId: null,
    dateChoice: householdDate(now, timeZone),
    pickedDate: '',
    startTime: defaultStartTime(now, timeZone),
    durationMin: DEFAULT_DURATION_MIN,
    allDay: false,
    location: '',
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The household date the form means, or null when "pick a date" has none (or a malformed one). */
export function formDate(form: EventForm): HouseholdDate | null {
  if (form.dateChoice !== PICK_A_DATE) return DATE_RE.test(form.dateChoice) ? form.dateChoice : null
  return DATE_RE.test(form.pickedDate) ? (form.pickedDate as HouseholdDate) : null
}

/** "Today", "Tomorrow", or the weekday and date for any other day. */
export function dateLabel(date: HouseholdDate, today: HouseholdDate, timeZone: string): string {
  if (date === today) return 'Today'
  if (date === shiftHouseholdDate(today, 1)) return 'Tomorrow'
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, day!)),
  )
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export const cleanEventText = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max)

/** Text the provider would refuse: Roost refuses it here first, so the adult is told before the round trip. */
export const hasMarkup = (text: string): boolean => /[<>]/.test(text)

/** What stops the form being saved, worded for the adult, or null when it can be. */
export function formProblem(form: EventForm, calendars: readonly WritableCalendar[]): string | null {
  const title = cleanEventText(form.title, MAX_EVENT_TITLE)
  if (!title) return 'Give the event a name.'
  if (hasMarkup(form.title) || hasMarkup(form.location)) return 'The name and place can’t contain < or >.'
  if (!assigneeOf(form.personKey)) return 'Choose who the event is for.'
  if (!formDate(form)) return 'Choose a date.'
  if (!form.allDay && !TIME_RE.test(form.startTime)) return 'Choose a start time.'
  if (!resolveCalendar(form, calendars)) return 'Choose which calendar to add it to.'
  return null
}

/** The calendar the form will write to: the one picked, else the chosen person's own. */
export function resolveCalendar(form: EventForm, calendars: readonly WritableCalendar[]): WritableCalendar | null {
  if (form.selectionId) return calendars.find((c) => c.selectionId === form.selectionId) ?? null
  return calendarFor(assigneeOf(form.personKey), calendars)
}

/** The request for the Edge Function, or null when the form is not ready (`formProblem` says why). */
export function buildNewEvent(form: EventForm, calendars: readonly WritableCalendar[], timeZone: string): NewEvent | null {
  if (formProblem(form, calendars)) return null
  const calendar = resolveCalendar(form, calendars)!
  const date = formDate(form)!
  const title = cleanEventText(form.title, MAX_EVENT_TITLE)
  const location = cleanEventText(form.location, MAX_EVENT_LOCATION) || null
  if (form.allDay) {
    // End exclusive: one all-day event runs to the next household date.
    return { selectionId: calendar.selectionId, title, start: date, end: shiftHouseholdDate(date, 1), allDay: true, location }
  }
  const start = householdWallTime(date, form.startTime as HourMinute, timeZone)
  const end = new Date(start.getTime() + Math.max(START_STEP_MIN, form.durationMin) * 60_000)
  return { selectionId: calendar.selectionId, title, start: start.toISOString(), end: end.toISOString(), allDay: false, location }
}

/** The row the panel shows until the next refresh confirms it, drawn in the person's own color. */
export function optimisticRow(created: CreatedEvent, person: EventPerson): TodayEvent {
  return {
    title: created.title,
    startAt: created.startAt,
    endAt: created.endAt,
    allDay: created.allDay,
    location: created.location,
    personType: person.type,
    personId: person.id,
    calendarColor: person.color,
  }
}

/** A failed write, worded for the adult. `authorisedBy` points a refusal at the PIN or the email sign-in. */
export function addEventFailureMessage(error: unknown, authorisedBy: 'account' | 'pin' = 'pin'): string {
  const code = (error as { code?: string } | null)?.code ?? null
  switch (code) {
    case 'not_writable':
      return 'That calendar can’t be added to. Connect the account again from Manage household to allow it.'
    case 'auth_expired':
      return 'That calendar account needs reconnecting. Connect it again from Manage household.'
    case 'calendar_gone':
      return 'That calendar isn’t in the account any more. Pick another one.'
    case 'unreachable':
      return 'Couldn’t reach the calendar just now. Try again in a moment.'
    case 'rate_limited':
      return 'That’s a lot of events in one hour. Try again later.'
    case 'invalid_request':
      return 'Something about the event didn’t look right. Check the name, date and time.'
    case 'forbidden':
      return authorisedBy === 'pin'
        ? 'Roost Family didn’t accept your PIN. Close this and try again.'
        : 'Roost Family didn’t accept your sign-in. Sign in again.'
    case 'not_configured':
      return 'That calendar provider isn’t set up on this server yet.'
    case 'network':
      return 'Couldn’t reach Roost Family. Check the connection and try again.'
    default:
      return 'Couldn’t add the event. Try again.'
  }
}
