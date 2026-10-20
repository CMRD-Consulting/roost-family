/**
 * Calendars (spec §5.5, §7.2, §7.9, §13).
 *
 * Today's events: the display asks the `calendar-events` Edge Function for the household's events every 5 minutes,
 * when the page becomes visible again, when the connection comes back, and right after midnight in the household
 * zone. The last good answer is kept **in memory only** (never IndexedDB or the device cache: event data is never
 * stored, §11.2), so a failed refresh or a remount keeps showing it with its `updatedAt`.
 *
 * Calendar settings: an adult lists their own connections (explicit columns: the Vault secret id and external calendar
 * ids are not readable), connects a calendar link or starts Google OAuth through the Edge Functions, shows
 * / assigns calendars and disconnects through RPCs. OAuth always returns to Manage household
 * (`/manage?calendar=pending&attempt=…`), where the signed-in adult finishes the attempt (`finishOAuth`).
 *
 * The three changes come in two forms, one per surface (spec §6.3): in a browser at `/manage` the adult's own
 * email-code sign-in authorises them; on a display the `…WithPin` calls run on the display's own client and carry the
 * Settings PIN, which the server checks again on every call. Reading is the same either way — a display may read its
 * household's connections. Google still connects only from `/manage`.
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { msUntilNextHouseholdMidnight } from '@/composables/householdMidnight'
import { startOfHouseholdDay } from '@/domain/time'
import { isDemo } from './householdSource'
import type { AdultClient, SettingsAuth } from './settingsApi'
import type { RoostClient } from './supabase'

// ─── Today's events ────────────────────────────────────────────────────────

export type ConnectionStatus = 'ok' | 'auth_expired' | 'unreachable'

export interface TodayEvent {
  title: string
  startAt: string
  /** Exclusive. For all-day events, midnight in the household zone. */
  endAt: string
  allDay: boolean
  location: string | null
  personType: 'member' | 'child'
  personId: string
  calendarColor: string
}

export interface TodayConnection {
  id: string
  ownerName: string
  status: ConnectionStatus
}

export interface TodayEvents {
  events: TodayEvent[]
  connections: TodayConnection[]
  /** Some events may be missing (a connection failed or was cut off). */
  partial: boolean
  /** When the server produced this answer (`generatedAt`). */
  updatedAt: string
  /** When this device received it: staleness is judged by this clock, not the server's. */
  receivedAt: string
}

/** Displays ask for events this often (spec §5.5). */
export const CALENDAR_REFRESH_MS = 5 * 60_000
/** A mount or a return to the page within this long of the last request doesn't ask again. */
const MIN_GAP_MS = 60_000
/** An Edge Function call that hasn't answered by then is abandoned (and reported as a network failure). */
export const FUNCTION_TIMEOUT_MS = 20_000

export type CalendarErrorCode =
  | 'invalid_request'
  | 'invalid_url'
  | 'forbidden'
  | 'not_found'
  | 'too_large'
  | 'not_a_calendar'
  | 'unreachable'
  | 'invalid_attempt'
  | 'expired'
  | 'rate_limited'
  | 'not_configured'
  | 'network'
  | 'internal'
  /** The account's grant has run out: it must be connected again (adding an event). */
  | 'auth_expired'
  /** The provider no longer has that calendar. */
  | 'calendar_gone'
  /** An ICS subscription, or an account connected before Roost asked for write access. */
  | 'not_writable'

export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode) {
    super(`Calendar request failed: ${code}`)
    this.name = 'CalendarError'
  }
}

const KNOWN_CODES = new Set<string>([
  'invalid_request', 'invalid_url', 'forbidden', 'not_found', 'too_large', 'not_a_calendar', 'unreachable', 'invalid_attempt',
  'expired', 'rate_limited', 'not_configured', 'internal', 'auth_expired', 'calendar_gone', 'not_writable',
])

/** A `functions.invoke` error as a CalendarError: the function's `{ error }` code, or `network` when no response came. */
async function functionError(error: unknown): Promise<CalendarError> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } } | null
  if (e?.name === 'FunctionsFetchError' || e?.name === 'FunctionsRelayError') return new CalendarError('network')
  if (e?.name === 'FunctionsHttpError' && typeof e.context?.json === 'function') {
    try {
      const payload = (await e.context.json()) as { error?: unknown } | null
      if (typeof payload?.error === 'string' && KNOWN_CODES.has(payload.error)) return new CalendarError(payload.error as CalendarErrorCode)
    } catch {
      // Not JSON: fall through to the status.
    }
    const status = e.context.status ?? 0
    if (status === 401 || status === 403) return new CalendarError('forbidden')
    if (status >= 500) return new CalendarError('internal')
    return new CalendarError('invalid_request')
  }
  return new CalendarError('network')
}

async function invoke<T>(client: RoostClient, name: string, body: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: unknown }
  try {
    result = await client.functions.invoke(name, { body, timeout: FUNCTION_TIMEOUT_MS })
  } catch {
    throw new CalendarError('network')
  }
  if (result.error) throw await functionError(result.error)
  return result.data as T
}

/**
 * How many household days the panel asks for: today and tomorrow (spec §7.2). The server defaults to today alone, so
 * asking is what tells it this client knows to keep the two apart.
 */
export const EVENT_DAYS = 2

/** Today's and tomorrow's events for a household, on the given client (a display's or a member's). */
export async function fetchTodayEventsWith(client: RoostClient, householdId: string): Promise<TodayEvents> {
  const data = await invoke<{ events?: unknown; connections?: unknown; partial?: unknown; generatedAt?: unknown } | null>(
    client,
    'calendar-events',
    { householdId, days: EVENT_DAYS },
  )
  if (!data || !Array.isArray(data.events) || !Array.isArray(data.connections) || typeof data.generatedAt !== 'string') {
    throw new CalendarError('internal')
  }
  return {
    events: data.events.map(toTodayEvent).filter((e): e is TodayEvent => e !== null),
    connections: data.connections.map(toTodayConnection).filter((c): c is TodayConnection => c !== null),
    partial: data.partial === true,
    updatedAt: data.generatedAt,
    receivedAt: new Date().toISOString(),
  }
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO_TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v))

/** A well-formed event with only the fields Roost shows, or null (dropped). Nothing else from the response is kept. */
function toTodayEvent(raw: unknown): TodayEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (
    typeof e.title !== 'string' ||
    !isIso(e.startAt) ||
    !isIso(e.endAt) ||
    typeof e.allDay !== 'boolean' ||
    (e.personType !== 'member' && e.personType !== 'child') ||
    typeof e.personId !== 'string' ||
    typeof e.calendarColor !== 'string' ||
    !(e.location === null || typeof e.location === 'string')
  ) {
    return null
  }
  return {
    title: e.title,
    startAt: e.startAt,
    endAt: e.endAt,
    allDay: e.allDay,
    location: e.location,
    personType: e.personType,
    personId: e.personId,
    calendarColor: e.calendarColor,
  }
}

function toTodayConnection(raw: unknown): TodayConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || typeof c.ownerName !== 'string') return null
  if (c.status !== 'ok' && c.status !== 'auth_expired' && c.status !== 'unreachable') return null
  return { id: c.id, ownerName: c.ownerName, status: c.status }
}

const DEMO_MEMBER_SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const DEMO_CHILD_IVY = 'cccccccc-0000-0000-0000-000000000001'
const DEMO_CHILD_THEO = 'cccccccc-0000-0000-0000-000000000002'

/**
 * Events added in the demo, in memory for as long as the page is loaded. The demo has no provider to write to, so
 * "Add event" puts the event here and the panel reads it back like any other (spec §7.2).
 */
const demoAdded: TodayEvent[] = []

export function addDemoEvent(event: TodayEvent): void {
  demoAdded.push(event)
}

export function resetDemoEventsForTests(): void {
  demoAdded.length = 0
}

/** The demo’s calendar, relative to `now`: an all-day event, an event with a leave-by, two later ones, and a couple
 *  tomorrow morning, plus anything added in this session. Events beyond tomorrow are left out. Colors come from the
 *  people (empty `calendarColor`). */
export function demoTodayEvents(now: Date, timeZone: string): TodayEvents {
  const dayStart = startOfHouseholdDay(now, timeZone)
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
  const tomorrowStart = startOfHouseholdDay(new Date(dayEnd.getTime() + 12 * 3_600_000), timeZone)
  /** Tomorrow at a wall-clock hour, near enough for the demo. */
  const tomorrowAt = (hour: number, lengthMin: number, title: string, personType: 'member' | 'child', personId: string, location: string | null = null): TodayEvent => {
    const start = new Date(tomorrowStart.getTime() + hour * 3_600_000)
    return {
      title, startAt: start.toISOString(), endAt: new Date(start.getTime() + lengthMin * 60_000).toISOString(),
      allDay: false, location, personType, personId, calendarColor: '',
    }
  }
  const at = (minutes: number) => {
    // Whole quarter hours, like real calendar events.
    const t = now.getTime() + minutes * 60_000
    return new Date(Math.round(t / 900_000) * 900_000)
  }
  const timed = (title: string, startMin: number, lengthMin: number, location: string | null, personType: 'member' | 'child', personId: string): TodayEvent => {
    const start = at(startMin)
    return {
      title, startAt: start.toISOString(), endAt: new Date(start.getTime() + lengthMin * 60_000).toISOString(),
      allDay: false, location, personType, personId, calendarColor: '',
    }
  }
  const events: TodayEvent[] = [
    {
      title: 'Library books due', startAt: dayStart.toISOString(), endAt: dayEnd.toISOString(), allDay: true,
      location: null, personType: 'child' as const, personId: DEMO_CHILD_IVY, calendarColor: '',
    },
    timed('Swim lesson', 45, 45, 'YMCA Pool', 'child', DEMO_CHILD_IVY),
    timed('Pediatrician checkup', 150, 30, 'Riverside Pediatrics', 'child', DEMO_CHILD_THEO),
    timed('Sam home', 180, 15, null, 'member', DEMO_MEMBER_SAM),
  ].filter((e) => Date.parse(e.startAt) < dayEnd.getTime())
  events.push(
    tomorrowAt(8.5, 45, 'Dentist', 'child', DEMO_CHILD_THEO, 'Riverside Pediatrics'),
    tomorrowAt(17.5, 60, 'Soccer practice', 'child', DEMO_CHILD_IVY, 'Field 3'),
  )
  return { events: [...events, ...demoAdded], connections: [], partial: false, updatedAt: now.toISOString(), receivedAt: now.toISOString() }
}

/** Today's events for a household on this display (loaded lazily so the Supabase client isn't built in tests). */
export async function fetchTodayEvents(householdId: string, timeZone = 'UTC'): Promise<TodayEvents> {
  if (isDemo) return demoTodayEvents(new Date(), timeZone)
  const { displayClient } = await import('./supabase')
  return fetchTodayEventsWith(displayClient, householdId)
}

/** The last good answer per household, kept for as long as the page is loaded. Memory only. */
const lastGood = new Map<string, TodayEvents>()
const lastAttemptAt = new Map<string, number>()

export function resetTodayEventsForTests(): void {
  lastGood.clear()
  lastAttemptAt.clear()
}

export interface TodayEventsOptions {
  householdId: () => string | null
  timeZone: () => string | null
  online?: () => boolean
  /** False while the events aren't shown (e.g. Sitter Mode): no requests. */
  enabled?: () => boolean
  fetchEvents?: (householdId: string) => Promise<TodayEvents>
}

export interface TodayEventsState {
  /**
   * The last good answer for the household, plus any event just added through `addLocal` that it predates, or null
   * before the first answer. The same object as the last answer while nothing has been added locally.
   */
  result: Readonly<Ref<TodayEvents | null>>
  /** The latest request failed (the last good answer is still shown). */
  failed: Ref<boolean>
  refresh: () => Promise<void>
  /**
   * Shows an event the household just added (spec §7.2) and asks for a fresh answer. The row stays until that
   * answer arrives — the event is already in the provider, but the panel's last answer was fetched before it — and
   * is left in place if the refresh fails, so what the adult added never silently disappears.
   */
  addLocal: (event: TodayEvent) => Promise<void>
}

/** Keeps today's events for the household current while the calling component is mounted. */
export function useTodayEvents(optionsRef: TodayEventsOptions): TodayEventsState {
  const online = optionsRef.online ?? (() => true)
  const enabled = optionsRef.enabled ?? (() => true)
  const fetchEvents = optionsRef.fetchEvents ?? ((id: string) => fetchTodayEvents(id, optionsRef.timeZone() ?? 'UTC'))
  const initialId = optionsRef.householdId()
  const fetched = shallowRef<TodayEvents | null>(initialId ? (lastGood.get(initialId) ?? null) : null)
  const failed = ref(false)
  /** Events added here that the last answer predates, each with when it was added and a sequence number. */
  const localRows = ref<Array<{ seq: number; at: string; event: TodayEvent }>>([])
  let localSeq = 0
  /** The fetched answer, with locally added events on top; the answer itself while there are none. */
  const result = computed<TodayEvents | null>(() => {
    const answer = fetched.value
    if (localRows.value.length === 0) return answer
    const events = localRows.value.map((r) => r.event)
    const at = localRows.value[localRows.value.length - 1]!.at
    if (!answer) return { events, connections: [], partial: false, updatedAt: at, receivedAt: at }
    return { ...answer, events: [...answer.events, ...events] }
  })
  let disposed = false
  /** Bumped at the household's midnight: an answer asked for before it belongs to the previous day. */
  let generation = 0
  /** The request running now: for which household and day. */
  let running: { id: string; generation: number; promise: Promise<void> } | null = null
  let interval: ReturnType<typeof setInterval> | undefined
  let midnight: ReturnType<typeof setTimeout> | undefined

  const canAsk = (): string | null => {
    const id = optionsRef.householdId()
    return id && online() && enabled() && !disposed ? id : null
  }

  /**
   * One request at a time. A refresh for the household and day already being asked for joins that request; one for
   * another household (or after midnight) runs once the current request settles, whose answer is then discarded.
   */
  async function refresh(options: { force?: boolean } = {}): Promise<void> {
    const id = canAsk()
    if (!id) return
    if (running) {
      // `force` never joins a request already in flight: it was sent before the event was added, so its answer
      // cannot contain it.
      if (!options.force && running.id === id && running.generation === generation) return running.promise
      return running.promise.then(() => refresh(options))
    }
    const asked = { id, generation }
    lastAttemptAt.set(id, Date.now())
    const promise = (async () => {
      try {
        const next = await fetchEvents(id)
        if (disposed || asked.generation !== generation) return
        lastGood.set(id, next)
        if (optionsRef.householdId() !== id) return
        fetched.value = next
        failed.value = false
      } catch (e) {
        if (disposed || asked.generation !== generation || optionsRef.householdId() !== id) return
        failed.value = true
        console.warn('Calendar refresh failed', e instanceof CalendarError ? e.code : 'error')
      } finally {
        running = null
      }
    })()
    running = { ...asked, promise }
    return promise
  }

  function refreshUnlessRecent(): void {
    const id = canAsk()
    if (!id) return
    const last = lastAttemptAt.get(id)
    if (last !== undefined && Date.now() - last < MIN_GAP_MS) return
    void refresh()
  }

  function scheduleMidnight(): void {
    clearTimeout(midnight)
    const tz = optionsRef.timeZone()
    if (!tz) return
    midnight = setTimeout(() => {
      generation += 1
      void refresh()
      scheduleMidnight()
    }, msUntilNextHouseholdMidnight(new Date(), tz) + 1_000)
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible') refreshUnlessRecent()
  }

  interval = setInterval(() => void refresh(), CALENDAR_REFRESH_MS)
  document.addEventListener('visibilitychange', onVisibility)

  watch(
    optionsRef.householdId,
    (id, previous) => {
      if (previous !== undefined && id !== previous) {
        fetched.value = id ? (lastGood.get(id) ?? null) : null
        // Another household's panel never shows what was added to this one.
        localRows.value = []
        failed.value = false
      }
    },
    { flush: 'sync' },
  )
  watch(optionsRef.timeZone, scheduleMidnight, { immediate: true })
  // First load, and again whenever asking becomes possible (online again, Sitter Mode over, another household).
  watch(canAsk, (id) => {
    if (id) refreshUnlessRecent()
  }, { immediate: true })

  const dispose = () => {
    disposed = true
    clearInterval(interval)
    interval = undefined
    clearTimeout(midnight)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  async function addLocal(event: TodayEvent): Promise<void> {
    const mine = ++localSeq
    localRows.value = [...localRows.value, { seq: mine, at: new Date().toISOString(), event }]
    await refresh({ force: true })
    // Only a fresh answer clears the row; a failed refresh leaves it, so the adult still sees what they added.
    if (!failed.value && !disposed) localRows.value = localRows.value.filter((r) => r.seq > mine)
  }

  return { result, failed, refresh: () => refresh(), addLocal }
}

// ─── Calendar settings ─────────────────────────────────────────────────────

/**
 * Microsoft is switched off (`CALENDAR_PROVIDERS` in supabase/functions/_shared/oauthProviders.ts): nothing
 * connects one any more, but a connection made before that is still listed and still read, so it stays in the union.
 */
export type CalendarProvider = 'ics' | 'google' | 'microsoft'
export type Assignee = { type: 'member' | 'child'; id: string }

export interface MyCalendar {
  id: string
  name: string
  visible: boolean
  /** The provider no longer has this calendar. */
  gone: boolean
  assignee: Assignee | null
}

export interface MyConnection {
  id: string
  provider: CalendarProvider
  label: string
  status: ConnectionStatus
  /**
   * Whether events can be added to this account's calendars (spec §5.5). False for every ICS subscription (a link
   * is one-way) and for an account connected before Roost asked for write access: it must be connected again.
   */
  canWrite: boolean
  calendars: MyCalendar[]
}

/** An event an adult is adding. `allDay` decides how `start` and `end` are read, as the Edge Function reads them. */
export interface NewEvent {
  selectionId: string
  title: string
  /** An instant (timed), or a `YYYY-MM-DD` household date (all-day). */
  start: string
  /** Exclusive: the instant it ends, or the household date after the last all-day one. */
  end: string
  allDay: boolean
  location?: string | null
}

/** The event as the provider has it, for the optimistic row on the Today panel. */
export interface CreatedEvent {
  selectionId: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  location: string | null
}

export interface CalendarPerson extends Assignee {
  name: string
  color: string
}

/** A connection as the whole household may read it, with the adult it belongs to. */
export interface HouseholdConnection extends MyConnection {
  membershipId: string
}

export interface CalendarSettingsApi {
  listMyConnections(client: AdultClient, householdId: string, membershipId: string): Promise<MyConnection[]>
  /**
   * Every connection of the household, whoever's it is (a display may read these). The Add event entry point needs
   * them before anyone has typed a PIN, to say why it cannot be used when nothing can be written to.
   */
  listHouseholdConnections(client: RoostClient, householdId: string): Promise<HouseholdConnection[]>
  /** Active members, then children, who a calendar can belong to. */
  listPeople(client: AdultClient, householdId: string): Promise<CalendarPerson[]>
  /** `alreadyConnected`: this adult had already connected that link; nothing new was created. */
  connectIcs(
    client: AdultClient,
    householdId: string,
    url: string,
  ): Promise<{ connectionId: string; selectionId: string; name: string; alreadyConnected: boolean }>
  /** The provider's consent page (the browser comes back to /manage), or not configured on this server. */
  startOAuth(client: AdultClient, householdId: string, provider: 'google'): Promise<{ url: string } | { notConfigured: true }>
  /** Creates the connection for a returned OAuth attempt, as the adult who started it. */
  finishOAuth(client: AdultClient, attempt: string): Promise<{ connectionId: string; calendars: number; label: string }>
  setSelection(client: AdultClient, selectionId: string, visible: boolean, assignee: Assignee | null): Promise<void>
  disconnect(client: AdultClient, connectionId: string): Promise<void>
  /** Writes one event to the provider; the event itself is never stored by Roost (spec §11.2). */
  createEvent(client: AdultClient, householdId: string, event: NewEvent): Promise<CreatedEvent>

  /** The same three changes on a display, authorised by the open Settings PIN session instead (spec §6.3). */
  connectIcsWithPin(
    client: RoostClient,
    householdId: string,
    auth: SettingsAuth,
    url: string,
  ): Promise<{ connectionId: string; selectionId: string; name: string; alreadyConnected: boolean }>
  setSelectionWithPin(
    client: RoostClient,
    auth: SettingsAuth,
    selectionId: string,
    visible: boolean,
    assignee: Assignee | null,
  ): Promise<void>
  disconnectWithPin(client: RoostClient, auth: SettingsAuth, connectionId: string): Promise<void>
  createEventWithPin(client: RoostClient, householdId: string, auth: SettingsAuth, event: NewEvent): Promise<CreatedEvent>
}

/** The display's own client, for Calendars on a tablet. Loaded lazily so tests and the browser never build it. */
export async function loadCalendarClient(): Promise<RoostClient> {
  const { displayClient } = await import('./supabase')
  return displayClient
}

type ConnectIcsResponse = { connectionId?: unknown; selectionId?: unknown; name?: unknown; alreadyConnected?: unknown } | null

function toConnectResult(data: ConnectIcsResponse) {
  if (typeof data?.connectionId !== 'string') throw new CalendarError('internal')
  return {
    connectionId: data.connectionId,
    selectionId: typeof data.selectionId === 'string' ? data.selectionId : '',
    name: typeof data.name === 'string' ? data.name : '',
    alreadyConnected: data.alreadyConnected === true,
  }
}

/** Explicit columns only: vault_secret_id and external_calendar_id are not readable by clients. */
const CONNECTION_COLUMNS =
  'id, provider, label, status, can_write, created_at, calendar_selections(id, name, visible, gone, assigned_membership_id, assigned_child_id, created_at)'

interface ConnectionSelectionRow {
  id: string
  name: string
  visible: boolean
  gone: boolean
  assigned_membership_id: string | null
  assigned_child_id: string | null
  created_at: string
}

interface ConnectionRow {
  id: string
  provider: CalendarProvider
  label: string
  status: ConnectionStatus
  can_write: boolean
  membership_id?: string
  calendar_selections: ConnectionSelectionRow[] | null
}

/** Calendars in the order they were discovered, each with the one person it belongs to (or none). */
function toMyConnection(row: ConnectionRow): MyConnection {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    canWrite: row.can_write === true,
    calendars: [...(row.calendar_selections ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        visible: s.visible,
        gone: s.gone,
        assignee: s.assigned_membership_id
          ? { type: 'member' as const, id: s.assigned_membership_id }
          : s.assigned_child_id
            ? { type: 'child' as const, id: s.assigned_child_id }
            : null,
      })),
  }
}

type CreatedEventResponse =
  | { created?: unknown; selectionId?: unknown; title?: unknown; startAt?: unknown; endAt?: unknown; allDay?: unknown; location?: unknown }
  | null

/** The request body `calendar-create-event` takes; an absent location is left out rather than sent as null. */
function eventBody(householdId: string, event: NewEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    householdId,
    selectionId: event.selectionId,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
  }
  const location = event.location?.trim()
  if (location) body.location = location
  return body
}

function toCreatedEvent(data: CreatedEventResponse): CreatedEvent {
  if (
    data?.created !== true ||
    typeof data.selectionId !== 'string' ||
    typeof data.title !== 'string' ||
    !isIso(data.startAt) ||
    !isIso(data.endAt) ||
    typeof data.allDay !== 'boolean'
  ) {
    throw new CalendarError('internal')
  }
  return {
    selectionId: data.selectionId,
    title: data.title,
    startAt: data.startAt,
    endAt: data.endAt,
    allDay: data.allDay,
    location: typeof data.location === 'string' ? data.location : null,
  }
}

/** A selection's two assignee columns, as the RPCs take them. */
const assigneeArgs = (assignee: Assignee | null) => ({
  p_assigned_membership_id: (assignee?.type === 'member' ? assignee.id : null) as string,
  p_assigned_child_id: (assignee?.type === 'child' ? assignee.id : null) as string,
})

type PgResult = { data: unknown; error: { message: string; code?: string } | null }

async function pg<T>(op: () => PromiseLike<PgResult>): Promise<T> {
  let r: PgResult
  try {
    r = await op()
  } catch {
    throw new CalendarError('network')
  }
  if (r.error) {
    if (r.error.code === '42501') throw new CalendarError('forbidden')
    if (r.error.code === '22023') throw new CalendarError('invalid_request')
    throw new CalendarError(r.error.code ? 'internal' : 'network')
  }
  return r.data as T
}

export function createCalendarSettingsApi(): CalendarSettingsApi {
  return {
    async listMyConnections(client, householdId, membershipId) {
      const rows = await pg<ConnectionRow[] | null>(() =>
        client
          .from('calendar_connections')
          .select(CONNECTION_COLUMNS)
          .eq('household_id', householdId)
          .eq('membership_id', membershipId)
          .order('created_at', { ascending: true }) as unknown as PromiseLike<PgResult>,
      )
      return (rows ?? []).map(toMyConnection)
    },

    async listHouseholdConnections(client, householdId) {
      const rows = await pg<ConnectionRow[] | null>(() =>
        client
          .from('calendar_connections')
          .select(`membership_id, ${CONNECTION_COLUMNS}`)
          .eq('household_id', householdId)
          .order('created_at', { ascending: true }) as unknown as PromiseLike<PgResult>,
      )
      return (rows ?? []).map((r) => ({ ...toMyConnection(r), membershipId: r.membership_id as string }))
    },

    async listPeople(client, householdId) {
      const [members, children] = await Promise.all([
        pg<{ id: string; display_name: string; color: string }[] | null>(() =>
          client
            .from('memberships')
            .select('id, display_name, color')
            .eq('household_id', householdId)
            .is('left_at', null)
            .order('joined_at', { ascending: true }) as unknown as PromiseLike<PgResult>,
        ),
        pg<{ id: string; name: string; color: string }[] | null>(() =>
          client
            .from('children')
            .select('id, name, color, sort_order, child_households!inner(household_id)')
            .eq('child_households.household_id', householdId)
            .order('sort_order', { ascending: true }) as unknown as PromiseLike<PgResult>,
        ),
      ])
      return [
        ...(members ?? []).map((m) => ({ type: 'member' as const, id: m.id, name: m.display_name, color: m.color })),
        ...(children ?? []).map((c) => ({ type: 'child' as const, id: c.id, name: c.name, color: c.color })),
      ]
    },

    async connectIcs(client, householdId, url) {
      return toConnectResult(await invoke<ConnectIcsResponse>(client, 'calendar-connect-ics', { householdId, url }))
    },

    async startOAuth(client, householdId, provider) {
      const data = await invoke<{ url?: unknown; error?: unknown } | null>(client, 'calendar-oauth-start', { householdId, provider, returnTo: 'manage' })
      if (data?.error === 'not_configured') return { notConfigured: true }
      if (typeof data?.url !== 'string') throw new CalendarError('internal')
      return { url: data.url }
    },

    async finishOAuth(client, attempt) {
      const data = await invoke<{ connectionId?: unknown; calendars?: unknown; label?: unknown } | null>(client, 'calendar-oauth-finish', { attempt })
      if (typeof data?.connectionId !== 'string') throw new CalendarError('internal')
      return {
        connectionId: data.connectionId,
        calendars: typeof data.calendars === 'number' ? data.calendars : 0,
        label: typeof data.label === 'string' ? data.label : '',
      }
    },

    async setSelection(client, selectionId, visible, assignee) {
      await pg(() =>
        client.rpc('set_calendar_selection', {
          p_selection_id: selectionId,
          p_visible: visible,
          ...assigneeArgs(assignee),
        }) as unknown as PromiseLike<PgResult>,
      )
    },

    async disconnect(client, connectionId) {
      await pg(() => client.rpc('disconnect_calendar', { p_connection_id: connectionId }) as unknown as PromiseLike<PgResult>)
    },

    async createEvent(client, householdId, event) {
      return toCreatedEvent(await invoke<CreatedEventResponse>(client, 'calendar-create-event', eventBody(householdId, event)))
    },

    // ─── The same three, on a display's own client with the Settings PIN ──
    async connectIcsWithPin(client, householdId, auth, url) {
      return toConnectResult(
        await invoke<ConnectIcsResponse>(client, 'calendar-connect-ics', {
          householdId,
          url,
          membershipId: auth.membershipId,
          pin: auth.pin,
        }),
      )
    },

    async setSelectionWithPin(client, auth, selectionId, visible, assignee) {
      await pg(() =>
        client.rpc('set_calendar_selection_pin', {
          p_membership_id: auth.membershipId,
          p_pin: auth.pin,
          p_selection_id: selectionId,
          p_visible: visible,
          ...assigneeArgs(assignee),
        }) as unknown as PromiseLike<PgResult>,
      )
    },

    async disconnectWithPin(client, auth, connectionId) {
      await pg(() =>
        client.rpc('disconnect_calendar_pin', {
          p_membership_id: auth.membershipId,
          p_pin: auth.pin,
          p_connection_id: connectionId,
        }) as unknown as PromiseLike<PgResult>,
      )
    },

    async createEventWithPin(client, householdId, auth, event) {
      return toCreatedEvent(
        await invoke<CreatedEventResponse>(client, 'calendar-create-event', {
          ...eventBody(householdId, event),
          membershipId: auth.membershipId,
          pin: auth.pin,
        }),
      )
    },
  }
}

/**
 * A failed calendar connection or change, worded for the adult. `context`: a calendar link, or a Google account.
 * `authorisedBy` is what the surface used, so a refusal points at the right thing to try again: the email sign-in at
 * /manage, or the Settings PIN on a display.
 */
export function calendarConnectMessage(
  error: unknown,
  context: 'ics' | 'oauth' = 'ics',
  authorisedBy: 'account' | 'pin' = 'account',
): string {
  const code = error instanceof CalendarError ? error.code : null
  switch (code) {
    case 'rate_limited':
      return context === 'oauth'
        ? 'Too many connection attempts. Try again in a few minutes.'
        : 'Too many calendar links added recently. Try again in an hour.'
    case 'not_configured':
      return context === 'oauth' ? 'That calendar provider isn’t set up on this server yet.' : 'Calendar links aren’t set up on this server yet.'
    case 'invalid_url':
    case 'invalid_request':
      return 'That doesn’t look like a calendar link. Paste the whole link, starting with https:// or webcal://.'
    case 'not_a_calendar':
      return 'That link isn’t a calendar. Copy the secret iCal address (it usually ends in .ics) and try again.'
    case 'too_large':
      // Size alone no longer stops a calendar working: the feed is reduced to today's events while it downloads,
      // and this is only reached when the server declares more than the whole 20 MB download budget.
      return 'That calendar is unusually large. Try a link with fewer calendars in it.'
    case 'unreachable':
      return 'We couldn’t reach that calendar link. Check the link and try again.'
    case 'forbidden':
      return authorisedBy === 'pin'
        ? 'Roost Family didn’t accept your PIN. Close Settings and open it again.'
        : 'Roost Family didn’t accept your sign-in. Sign in again.'
    case 'expired':
      return 'That took too long. Connect again.'
    case 'invalid_attempt':
      return 'That calendar connection didn’t finish. Connect again.'
    case 'network':
      return 'Couldn’t reach Roost Family. Check the connection and try again.'
    default:
      return 'Something went wrong. Try again.'
  }
}
