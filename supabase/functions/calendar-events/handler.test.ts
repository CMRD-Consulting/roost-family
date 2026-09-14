import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import type { EventsResponse } from './collect.ts'
import { createEventsHandler, type EventsHandlerDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-events'
const NOW = new Date('2026-09-14T16:00:00Z')

const RESPONSE: EventsResponse = {
  events: [
    {
      title: 'Swim lesson',
      startAt: '2026-09-14T21:00:00.000Z',
      endAt: '2026-09-14T22:00:00.000Z',
      allDay: false,
      location: 'Y pool',
      personType: 'child',
      personId: 'cccccccc-0000-0000-0000-000000000001',
      calendarColor: '#982A5D',
    },
  ],
  connections: [{ id: 'conn-1', ownerName: 'Sam', status: 'ok' }],
  partial: false,
  generatedAt: NOW.toISOString(),
}

function deps(overrides: Partial<EventsHandlerDeps> = {}): EventsHandlerDeps {
  return {
    callerHousehold: vi.fn(async () => ({ userId: 'u', householdId: HOUSEHOLD, kind: 'display' as const })),
    collect: vi.fn(async () => RESPONSE),
    now: () => NOW,
    ...overrides,
  }
}

const auth = { Authorization: 'Bearer display-jwt' }

describe('calendar-events handler', () => {
  it('answers preflight for GET and POST', async () => {
    const res = await createEventsHandler(deps())(new Request(ENDPOINT, { method: 'OPTIONS' }))
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
    expect((await createEventsHandler(deps())(new Request(ENDPOINT, { method: 'PUT' }))).status).toBe(405)
  })

  it('returns the day\'s events for GET ?householdId with no-store', async () => {
    const d = deps()
    const res = await createEventsHandler(d)(new Request(`${ENDPOINT}?householdId=${HOUSEHOLD}`, { headers: auth }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual(RESPONSE)
    expect(d.callerHousehold).toHaveBeenCalledWith(expect.any(Request), HOUSEHOLD)
    expect(d.collect).toHaveBeenCalledWith(HOUSEHOLD, NOW)
  })

  it('accepts POST { householdId }', async () => {
    const d = deps()
    const res = await createEventsHandler(d)(
      new Request(ENDPOINT, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ householdId: HOUSEHOLD }) }),
    )
    expect(res.status).toBe(200)
  })

  it('rejects a missing or malformed household id', async () => {
    const d = deps()
    for (const req of [
      new Request(ENDPOINT, { headers: auth }),
      new Request(`${ENDPOINT}?householdId=nope`, { headers: auth }),
      new Request(ENDPOINT, { method: 'POST', headers: auth, body: '{bad' }),
    ]) {
      const res = await createEventsHandler(d)(req)
      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(d.callerHousehold).not.toHaveBeenCalled()
  })

  it('refuses callers outside the household before collecting', async () => {
    for (const status of [401, 403] as const) {
      const d = deps({ callerHousehold: vi.fn(async () => { throw new AuthError(status, 'forbidden') }) })
      const res = await createEventsHandler(d)(new Request(`${ENDPOINT}?householdId=${HOUSEHOLD}`, { headers: auth }))
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: 'forbidden' })
      expect(d.collect).not.toHaveBeenCalled()
    }
  })

  it('404 for an unknown household, generic 500 otherwise', async () => {
    let res = await createEventsHandler(deps({ collect: vi.fn(async () => null) }))(new Request(`${ENDPOINT}?householdId=${HOUSEHOLD}`, { headers: auth }))
    expect(res.status).toBe(404)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    res = await createEventsHandler(deps({ collect: vi.fn(async () => { throw new Error('Swim lesson at Y pool') }) }))(
      new Request(`${ENDPOINT}?householdId=${HOUSEHOLD}`, { headers: auth }),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('Swim')
    log.mockRestore()
  })
})
