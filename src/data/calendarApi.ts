/**
 * Calendars (spec §5.5, §7.2, §7.9, §13).
 *
 * Today's events: the display asks the `calendar-events` Edge Function for the household's events every 5 minutes,
 * when the page becomes visible again, when the connection comes back, and right after midnight in the household
 * zone. The last good answer is kept **in memory only** (never IndexedDB or the device cache: event data is never
 * stored, §11.2), so a failed refresh or a remount keeps showing it with its `updatedAt`.
 *
 * Calendar settings: an adult with a full sign-in lists their own connections (explicit columns: the Vault secret id
 * and external calendar ids are not readable), connects a calendar link or starts Google / Microsoft OAuth through
 * the Edge Functions, shows / assigns calendars and disconnects through RPCs. OAuth always returns to Manage household
 * (`/manage?calendar=pending&attempt=…`), where the signed-in adult finishes the attempt (`finishOAuth`).
 */
import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { msUntilNextHouseholdMidnight } from '@/composables/householdMidnight'
import { startOfHouseholdDay } from '@/domain/time'
import { isDemo } from './householdSource'
import type { AdultClient } from './settingsApi'
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
}

/** Displays ask for events this often (spec §5.5). */
export const CALENDAR_REFRESH_MS = 5 * 60_000
/** A mount or a return to the page within this long of the last request doesn't ask again. */
const MIN_GAP_MS = 60_000

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
  | 'network'
  | 'internal'

export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode) {
    super(`Calendar request failed: ${code}`)
    this.name = 'CalendarError'
  }
}

const KNOWN_CODES = new Set<string>([
  'invalid_request', 'invalid_url', 'forbidden', 'not_found', 'too_large', 'not_a_calendar', 'unreachable', 'invalid_attempt',
  'expired', 'internal',
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
    result = await client.functions.invoke(name, { body })
  } catch {
    throw new CalendarError('network')
  }
  if (result.error) throw await functionError(result.error)
  return result.data as T
}

/** Today's events for a household, on the given client (a display's or a member's). */
export async function fetchTodayEventsWith(client: RoostClient, householdId: string): Promise<TodayEvents> {
  const data = await invoke<{ events?: unknown; connections?: unknown; partial?: unknown; generatedAt?: unknown } | null>(
    client,
    'calendar-events',
    { householdId },
  )
  if (!data || !Array.isArray(data.events) || !Array.isArray(data.connections) || typeof data.generatedAt !== 'string') {
    throw new CalendarError('internal')
  }
  return {
    events: data.events as TodayEvent[],
    connections: data.connections as TodayConnection[],
    partial: data.partial === true,
    updatedAt: data.generatedAt,
  }
}

const DEMO_MEMBER_SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const DEMO_CHILD_IVY = 'cccccccc-0000-0000-0000-000000000001'
const DEMO_CHILD_THEO = 'cccccccc-0000-0000-0000-000000000002'

/** The demo’s calendar, relative to `now`: an all-day event, an event with a leave-by, and two later ones.
 *  Events that would start after today are left out. Colors come from the people (empty `calendarColor`). */
export function demoTodayEvents(now: Date, timeZone: string): TodayEvents {
  const dayStart = startOfHouseholdDay(now, timeZone)
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
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
  return { events, connections: [], partial: false, updatedAt: now.toISOString() }
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
  /** The last good answer for the household, or null before the first one. */
  result: ShallowRef<TodayEvents | null>
  /** The latest request failed (the last good answer is still shown). */
  failed: Ref<boolean>
  refresh: () => Promise<void>
}

/** Keeps today's events for the household current while the calling component is mounted. */
export function useTodayEvents(options: TodayEventsOptions): TodayEventsState {
  const online = options.online ?? (() => true)
  const enabled = options.enabled ?? (() => true)
  const fetchEvents = options.fetchEvents ?? ((id: string) => fetchTodayEvents(id, options.timeZone() ?? 'UTC'))
  const initialId = options.householdId()
  const result = shallowRef<TodayEvents | null>(initialId ? (lastGood.get(initialId) ?? null) : null)
  const failed = ref(false)
  let disposed = false
  let inFlight: Promise<void> | null = null
  let interval: ReturnType<typeof setInterval> | undefined
  let midnight: ReturnType<typeof setTimeout> | undefined

  const canAsk = (): string | null => {
    const id = options.householdId()
    return id && online() && enabled() && !disposed ? id : null
  }

  async function refresh(): Promise<void> {
    const id = canAsk()
    if (!id) return
    if (inFlight) return inFlight
    lastAttemptAt.set(id, Date.now())
    inFlight = (async () => {
      try {
        const next = await fetchEvents(id)
        lastGood.set(id, next)
        if (disposed || options.householdId() !== id) return
        result.value = next
        failed.value = false
      } catch (e) {
        if (disposed || options.householdId() !== id) return
        failed.value = true
        console.warn('Calendar refresh failed', e instanceof CalendarError ? e.code : e)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
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
    const tz = options.timeZone()
    if (!tz) return
    midnight = setTimeout(() => {
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
    options.householdId,
    (id, previous) => {
      if (previous !== undefined && id !== previous) {
        result.value = id ? (lastGood.get(id) ?? null) : null
        failed.value = false
      }
    },
    { flush: 'sync' },
  )
  watch(options.timeZone, scheduleMidnight, { immediate: true })
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

  return { result, failed, refresh }
}

// ─── Calendar settings ─────────────────────────────────────────────────────

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
  calendars: MyCalendar[]
}

export interface CalendarPerson extends Assignee {
  name: string
  color: string
}

export interface CalendarSettingsApi {
  listMyConnections(client: AdultClient, householdId: string, membershipId: string): Promise<MyConnection[]>
  /** Active members, then children, who a calendar can belong to. */
  listPeople(client: AdultClient, householdId: string): Promise<CalendarPerson[]>
  /** `alreadyConnected`: this adult had already connected that link; nothing new was created. */
  connectIcs(
    client: AdultClient,
    householdId: string,
    url: string,
  ): Promise<{ connectionId: string; selectionId: string; name: string; alreadyConnected?: boolean }>
  /** The provider's consent page (the browser comes back to /manage), or not configured on this server. */
  startOAuth(client: AdultClient, householdId: string, provider: 'google' | 'microsoft'): Promise<{ url: string } | { notConfigured: true }>
  /** Creates the connection for a returned OAuth attempt, as the adult who started it. */
  finishOAuth(client: AdultClient, attempt: string): Promise<{ connectionId: string; calendars: number; label: string }>
  setSelection(client: AdultClient, selectionId: string, visible: boolean, assignee: Assignee | null): Promise<void>
  disconnect(client: AdultClient, connectionId: string): Promise<void>
}

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
      type SelectionRow = {
        id: string; name: string; visible: boolean; gone: boolean
        assigned_membership_id: string | null; assigned_child_id: string | null; created_at: string
      }
      type Row = { id: string; provider: CalendarProvider; label: string; status: ConnectionStatus; calendar_selections: SelectionRow[] | null }
      // Explicit columns only: vault_secret_id and external_calendar_id are not readable by clients.
      const rows = await pg<Row[] | null>(() =>
        client
          .from('calendar_connections')
          .select('id, provider, label, status, created_at, calendar_selections(id, name, visible, gone, assigned_membership_id, assigned_child_id, created_at)')
          .eq('household_id', householdId)
          .eq('membership_id', membershipId)
          .order('created_at', { ascending: true }) as unknown as PromiseLike<PgResult>,
      )
      return (rows ?? []).map((r) => ({
        id: r.id,
        provider: r.provider,
        label: r.label,
        status: r.status,
        calendars: [...(r.calendar_selections ?? [])]
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
      }))
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

    connectIcs: (client, householdId, url) => invoke(client, 'calendar-connect-ics', { householdId, url }),

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
          p_assigned_membership_id: (assignee?.type === 'member' ? assignee.id : null) as string,
          p_assigned_child_id: (assignee?.type === 'child' ? assignee.id : null) as string,
        }) as unknown as PromiseLike<PgResult>,
      )
    },

    async disconnect(client, connectionId) {
      await pg(() => client.rpc('disconnect_calendar', { p_connection_id: connectionId }) as unknown as PromiseLike<PgResult>)
    },
  }
}

/** A failed calendar connection or change, worded for the adult. */
export function calendarConnectMessage(error: unknown): string {
  const code = error instanceof CalendarError ? error.code : null
  switch (code) {
    case 'invalid_url':
    case 'invalid_request':
      return 'That doesn’t look like a calendar link. Paste the whole link, starting with https:// or webcal://.'
    case 'not_a_calendar':
      return 'That link isn’t a calendar. Copy the secret iCal address (it usually ends in .ics) and try again.'
    case 'too_large':
      return 'That calendar is too big to show. Try a calendar with fewer events.'
    case 'unreachable':
      return 'We couldn’t reach that calendar link. Check the link and try again.'
    case 'forbidden':
      return 'Roost Family didn’t accept your sign-in. Sign in again.'
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
