/**
 * Today's calendar events for a household (spec §5.5, §7.2, §11.2, §13), independent of Deno and Supabase.
 *
 * For each connection with at least one visible, assigned, not-gone calendar: read its secret with the service role,
 * fetch the day's events (ICS: fetch + parse; Google / Microsoft: refresh the token, then one events request per
 * calendar), and merge everything with `mergeDayEvents`, which rebuilds each event from an allow-list.
 *
 * - Cache: successful results are kept in memory (a module-level Map owned by the caller) for 5 minutes, keyed by
 *   connection, household day and the set of calendars asked for; failures are not cached.
 * - Concurrency: at most 4 connections at once, under one overall deadline (20 s). A connection still running at the
 *   deadline is aborted and reported `unreachable` for this response only (its stored status is not changed).
 * - Status: the connection's stored status is updated only when it changed. A calendar the provider no longer has
 *   (`calendar_gone`) marks that selection gone and leaves the connection `ok`. A rotated refresh token is saved.
 * - Privacy: events are never written anywhere but the response, and logs carry only ids, providers, statuses and
 *   error class names (never titles, locations, URLs or tokens).
 */
import { CalendarProviderError, type ConnectionStatus } from '../_shared/calendarProvider.ts'
import { householdDayWindow, mergeDayEvents, type DayEvent, type DayWindow, type SelectionMeta, type SourceEvent } from '../_shared/events.ts'
import { IcsFetchError } from '../_shared/icsFetch.ts'
import type { CalendarSources } from './sources.ts'

export const EVENTS_CACHE_TTL_MS = 5 * 60_000
export const EVENTS_DEADLINE_MS = 20_000
export const EVENTS_CONCURRENCY = 4
const CACHE_MAX_ENTRIES = 1000

export interface ConnectionRow {
  id: string
  provider: 'ics' | 'google' | 'microsoft'
  status: ConnectionStatus
  ownerName: string
}

/** A visible, not-gone selection. */
export interface SelectionRow {
  id: string
  connectionId: string
  externalCalendarId: string
  assignedMembershipId: string | null
  assignedChildId: string | null
}

export interface HouseholdCalendars {
  timeZone: string
  connections: ConnectionRow[]
  selections: SelectionRow[]
  /** Person colors by membership id and child id. */
  memberColors: Record<string, string>
  childColors: Record<string, string>
}

export interface CalendarStore {
  /** Null when the household does not exist or was deleted. */
  load(householdId: string): Promise<HouseholdCalendars | null>
  /** The connection's secret (ICS URL or refresh token), or null when it can no longer be used. */
  secret(connectionId: string): Promise<string | null>
  updateSecret(connectionId: string, secret: string): Promise<void>
  setStatus(connectionId: string, status: ConnectionStatus): Promise<void>
  setSelectionGone(selectionId: string): Promise<void>
}

export interface ConnectionResult {
  status: ConnectionStatus
  sources: Array<{ selectionId: string; events: SourceEvent[] }>
  /** An ICS expansion cap was hit, or the deadline cut the connection off. */
  partial: boolean
}

export interface CacheEntry {
  expiresAt: number
  result: ConnectionResult
}
export type EventsCache = Map<string, CacheEntry>

export interface EventsResponse {
  events: DayEvent[]
  connections: Array<{ id: string; ownerName: string; status: ConnectionStatus }>
  partial: boolean
  generatedAt: string
}

export interface CollectOptions {
  store: CalendarStore
  sources: CalendarSources
  cache: EventsCache
  now: Date
  deadlineMs?: number
  concurrency?: number
  log?: (message: string) => void
}

interface Outcome {
  result: ConnectionResult
  /** False when the stored status must not change (deadline, or the connection disappeared meanwhile). */
  persistStatus: boolean
}

function failureStatus(e: unknown): ConnectionStatus {
  if (e instanceof CalendarProviderError) return e.status === 'calendar_gone' ? 'unreachable' : e.status
  if (e instanceof IcsFetchError && e.code === 'gone') return 'auth_expired'
  return 'unreachable'
}

function errorKind(e: unknown): string {
  if (e instanceof CalendarProviderError) return `${e.name}:${e.status}`
  if (e instanceof IcsFetchError) return `${e.name}:${e.code}`
  return e instanceof Error ? e.name : 'error'
}

function pruneCache(cache: EventsCache, nowMs: number): void {
  for (const [key, entry] of cache) if (entry.expiresAt <= nowMs) cache.delete(key)
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!)
}

function cacheKey(connection: ConnectionRow, selections: SelectionRow[], window: DayWindow): string {
  const ids = selections.map((s) => s.id).sort().join(',')
  return `${connection.id}|${window.dayStartUtc.toISOString()}|${ids}`
}

async function fetchConnection(
  connection: ConnectionRow,
  selections: SelectionRow[],
  window: DayWindow,
  timeZone: string,
  signal: AbortSignal,
  options: CollectOptions,
): Promise<Outcome> {
  const { store, sources, now } = options
  const log = options.log ?? (() => {})
  const failed = (e: unknown): Outcome => {
    log(`calendar-events: connection ${connection.id} (${connection.provider}) failed: ${errorKind(e)}`)
    return { result: { status: failureStatus(e), sources: [], partial: false }, persistStatus: !signal.aborted }
  }

  const secret = await store.secret(connection.id)
  if (secret === null) return { result: { status: connection.status, sources: [], partial: false }, persistStatus: false }

  if (connection.provider === 'ics') {
    try {
      const { events, partial } = await sources.ics.dayEvents(secret, window, timeZone, signal)
      if (partial) log(`calendar-events: connection ${connection.id} (ics) hit an expansion cap`)
      return { result: { status: 'ok', sources: selections.map((s) => ({ selectionId: s.id, events })), partial }, persistStatus: true }
    } catch (e) {
      return failed(e)
    }
  }

  const source = sources[connection.provider]
  if (!source) return failed(new Error(`${connection.provider} is not configured`))
  let accessToken: string
  try {
    const token = await source.refresh(secret, now, signal)
    accessToken = token.accessToken
    if (token.refreshToken && token.refreshToken !== secret && !signal.aborted) {
      try {
        await store.updateSecret(connection.id, token.refreshToken)
      } catch (e) {
        log(`calendar-events: connection ${connection.id} could not save its rotated token: ${errorKind(e)}`)
      }
    }
  } catch (e) {
    return failed(e)
  }

  const collected: ConnectionResult['sources'] = []
  for (const selection of selections) {
    try {
      collected.push({ selectionId: selection.id, events: await source.dayEvents(accessToken, selection.externalCalendarId, window, timeZone, signal) })
    } catch (e) {
      if (e instanceof CalendarProviderError && e.status === 'calendar_gone') {
        log(`calendar-events: selection ${selection.id} of connection ${connection.id} is gone`)
        if (!signal.aborted) {
          try {
            await store.setSelectionGone(selection.id)
          } catch (err) {
            log(`calendar-events: could not mark selection ${selection.id} gone: ${errorKind(err)}`)
          }
        }
        continue
      }
      return failed(e)
    }
  }
  return { result: { status: 'ok', sources: collected, partial: false }, persistStatus: true }
}

/** Null when the household does not exist. */
export async function collectDayEvents(householdId: string, options: CollectOptions): Promise<EventsResponse | null> {
  const { store, cache, now } = options
  const log = options.log ?? (() => {})
  const deadlineMs = options.deadlineMs ?? EVENTS_DEADLINE_MS
  const concurrency = Math.max(1, options.concurrency ?? EVENTS_CONCURRENCY)

  const data = await store.load(householdId)
  if (!data) return null
  const window = householdDayWindow(now, data.timeZone)
  pruneCache(cache, now.getTime())

  // Who each selection belongs to; a selection without a known person is not shown.
  const meta = new Map<string, SelectionMeta>()
  for (const s of data.selections) {
    if (s.assignedMembershipId && data.memberColors[s.assignedMembershipId]) {
      meta.set(s.id, { personType: 'member', personId: s.assignedMembershipId, calendarColor: data.memberColors[s.assignedMembershipId]! })
    } else if (s.assignedChildId && data.childColors[s.assignedChildId]) {
      meta.set(s.id, { personType: 'child', personId: s.assignedChildId, calendarColor: data.childColors[s.assignedChildId]! })
    }
  }
  const work = data.connections
    .map((connection) => ({ connection, selections: data.selections.filter((s) => s.connectionId === connection.id && meta.has(s.id)) }))
    .filter((w) => w.selections.length > 0)

  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), deadlineMs)
  const deadlineReached = new Promise<null>((resolve) => deadline.signal.addEventListener('abort', () => resolve(null), { once: true }))
  const outcomes = new Map<string, Outcome>()
  const timedOut: Outcome = { result: { status: 'unreachable', sources: [], partial: true }, persistStatus: false }

  let next = 0
  const worker = async () => {
    while (next < work.length) {
      const { connection, selections } = work[next++]!
      const key = cacheKey(connection, selections, window)
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now.getTime()) {
        outcomes.set(connection.id, { result: cached.result, persistStatus: true })
        continue
      }
      if (deadline.signal.aborted) {
        outcomes.set(connection.id, timedOut)
        continue
      }
      const running = fetchConnection(connection, selections, window, data.timeZone, deadline.signal, options).catch((e): Outcome => {
        log(`calendar-events: connection ${connection.id} (${connection.provider}) errored: ${errorKind(e)}`)
        return { result: { status: 'unreachable', sources: [], partial: false }, persistStatus: false }
      })
      const outcome = (await Promise.race([running, deadlineReached])) ?? timedOut
      if (outcome === timedOut) log(`calendar-events: connection ${connection.id} (${connection.provider}) missed the deadline`)
      if (outcome !== timedOut && outcome.result.status === 'ok' && outcome.persistStatus) {
        cache.set(key, { expiresAt: now.getTime() + EVENTS_CACHE_TTL_MS, result: outcome.result })
      }
      outcomes.set(connection.id, outcome)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker))
  } finally {
    clearTimeout(timer)
  }

  await Promise.all(
    work.map(async ({ connection }) => {
      const outcome = outcomes.get(connection.id)!
      if (!outcome.persistStatus || outcome.result.status === connection.status) return
      try {
        await store.setStatus(connection.id, outcome.result.status)
      } catch (e) {
        log(`calendar-events: could not record status of connection ${connection.id}: ${errorKind(e)}`)
      }
    }),
  )

  const merged = mergeDayEvents(
    work.flatMap(({ connection }) =>
      outcomes.get(connection.id)!.result.sources.map((s) => ({ selection: meta.get(s.selectionId)!, events: s.events })),
    ),
    window,
  )
  const connections = work.map(({ connection }) => ({
    id: connection.id,
    ownerName: connection.ownerName,
    status: outcomes.get(connection.id)!.result.status,
  }))
  return {
    events: merged,
    connections,
    partial: work.some(({ connection }) => {
      const r = outcomes.get(connection.id)!.result
      return r.partial || r.status !== 'ok'
    }),
    generatedAt: now.toISOString(),
  }
}
