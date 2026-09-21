import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { TodayEvent, TodayEvents } from '@/data/calendarApi'
import TodayPanel from './TodayPanel.vue'

const NOW = new Date('2026-09-14T19:00:00Z') // 3:00 PM in New York

const event = (over: Partial<TodayEvent>): TodayEvent => ({
  title: 'Swim lesson',
  startAt: '2026-09-14T20:00:00Z',
  endAt: '2026-09-14T21:00:00Z',
  allDay: false,
  location: null,
  personType: 'child',
  personId: 'ivy',
  calendarColor: '#D9A441',
  ...over,
})

function mountPanel(events: TodayEvents | null, extra: Record<string, unknown> = {}) {
  return mount(TodayPanel, {
    props: {
      events,
      failed: false,
      timeZone: 'America/New_York',
      leaveByBufferMin: 20,
      members: [{ id: 'sam', displayName: 'Sam', color: '#5B6ACF' }],
      children: [{ id: 'ivy', name: 'Ivy', color: '#D9A441' }],
      ...extra,
    },
  })
}

const result = (list: TodayEvent[], over: Partial<TodayEvents> = {}): TodayEvents => ({
  events: list, connections: [], partial: false, updatedAt: NOW.toISOString(), receivedAt: NOW.toISOString(), ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('TodayPanel', () => {
  it('shows all-day events first, then timed events by start, each with a decorative avatar', () => {
    const w = mountPanel(result([
      event({ title: 'Dinner out', startAt: '2026-09-14T22:30:00Z', endAt: '2026-09-14T23:30:00Z', personType: 'member', personId: 'sam' }),
      event({ title: 'Swim lesson', location: 'YMCA Pool', startAt: '2026-09-14T19:45:00Z', endAt: '2026-09-14T20:30:00Z' }),
      event({ title: 'Library books due', allDay: true, startAt: '2026-09-14T04:00:00Z', endAt: '2026-09-15T04:00:00Z' }),
    ]))
    expect(w.find('h2').text()).toBe('Today')
    const rows = w.findAll('[data-testid="today-event"]')
    expect(rows.map((r) => r.find('[data-testid="today-event-title"]').text())).toEqual(['Library books due', 'Swim lesson', 'Dinner out'])
    expect(rows.map((r) => r.find('[data-testid="today-event-time"]').text())).toEqual(['All day', '3:45 – 4:30 PM', '6:30 – 7:30 PM'])
    const avatar = rows[2]!.find('[aria-hidden="true"].rounded-full.font-bold')
    expect(avatar.text()).toBe('S')
    expect(rows[1]!.text()).toContain('YMCA Pool')
    const leave = rows[1]!.find('[data-testid="today-event-leave"]')
    expect(leave.text()).toBe('Leave in 25 min')
    expect(leave.classes()).toEqual(expect.arrayContaining(['text-[24px]', 'text-orange-deep']))
    expect(rows[0]!.find('[data-testid="today-event-leave"]').exists()).toBe(false)
  })

  it('counts the leave-by down as the screen’s clock moves, and drops events once they end', async () => {
    const w = mountPanel(result([
      event({ title: 'Swim lesson', location: 'YMCA Pool', startAt: '2026-09-14T19:45:00Z', endAt: '2026-09-14T20:30:00Z' }),
      event({ title: 'Snack', startAt: '2026-09-14T18:30:00Z', endAt: '2026-09-14T19:10:00Z' }),
    ]))
    expect(w.findAll('[data-testid="today-event-time"]').map((x) => x.text())).toEqual(['Now · until 3:10 PM', '3:45 – 4:30 PM'])
    await w.setProps({ now: new Date('2026-09-14T19:15:00Z') })
    expect(w.findAll('[data-testid="today-event"]')).toHaveLength(1)
    expect(w.find('[data-testid="today-event-leave"]').text()).toBe('Leave in 10 min')
  })

  it('ticks every minute on its own without a clock from the screen', async () => {
    const w = mountPanel(result([event({ title: 'Swim lesson', location: 'YMCA Pool', startAt: '2026-09-14T19:45:00Z', endAt: '2026-09-14T20:30:00Z' })]))
    expect(w.find('[data-testid="today-event-leave"]').text()).toBe('Leave in 25 min')
    vi.advanceTimersByTime(60_000)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="today-event-leave"]').text()).toBe('Leave in 24 min')
  })

  it('runs no timer of its own when the screen supplies the clock', () => {
    const w = mountPanel(result([]), { now: NOW })
    expect(vi.getTimerCount()).toBe(0)
    w.unmount()
    const own = mountPanel(result([]))
    expect(vi.getTimerCount()).toBe(1)
    own.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows one stale line: the household’s "Updated…" note replaces the calendar’s', () => {
    const old = result([], { receivedAt: new Date(NOW.getTime() - 45 * 60_000).toISOString() })
    const w = mountPanel(old, { updatedNote: 'Updated 7 min ago' })
    expect(w.find('[data-testid="today-stale"]').exists()).toBe(false)
    expect(w.get('[data-testid="today-updated"]').text()).toBe('Updated 7 min ago')
    expect(mountPanel(old, { updatedNote: null }).get('[data-testid="today-stale"]').text()).toBe('Calendar updated 45 min ago')
  })

  it('shows tomorrow’s events under their own heading, below today’s', () => {
    const w = mountPanel(
      result([
        event({ title: 'Swim lesson' }),
        event({ title: 'Dentist', startAt: '2026-09-15T12:30:00Z', endAt: '2026-09-15T13:15:00Z' }),
      ]),
    )
    expect(w.findAll('[data-testid="today-event"]').map((r) => r.text())).toHaveLength(1)
    expect(w.get('[data-testid="tomorrow-heading"]').text()).toBe('Tomorrow · Tue')
    const tomorrow = w.findAll('[data-testid="tomorrow-event"]')
    expect(tomorrow).toHaveLength(1)
    expect(tomorrow[0]!.text()).toContain('Dentist')
    expect(w.find('[data-testid="tomorrow-more"]').exists()).toBe(false)
    w.unmount()
  })

  it('has no tomorrow heading when there is nothing tomorrow', () => {
    const w = mountPanel(result([event({})]))
    expect(w.find('[data-testid="tomorrow-heading"]').exists()).toBe(false)
    w.unmount()
  })

  it('still says "Nothing else today" above tomorrow’s events, and counts what did not fit', () => {
    const many = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      event({ title: `Tomorrow ${i}`, startAt: `2026-09-15T1${i}:00:00Z`, endAt: `2026-09-15T1${i}:30:00Z` }),
    )
    const w = mountPanel(result(many))
    expect(w.text()).toContain('Nothing else today')
    expect(w.findAll('[data-testid="tomorrow-event"]')).toHaveLength(6)
    expect(w.get('[data-testid="tomorrow-more"]').text()).toBe('+1 more tomorrow')
    w.unmount()
  })

  it('says "Nothing else today" when nothing is left', () => {
    expect(mountPanel(result([])).text()).toContain('Nothing else today')
    expect(mountPanel(null).text()).not.toContain('Nothing else today')
  })

  it('notes a calendar more than 30 minutes old', () => {
    const w = mountPanel(result([], { receivedAt: new Date(NOW.getTime() - 45 * 60_000).toISOString() }))
    expect(w.find('[data-testid="today-stale"]').text()).toBe('Calendar updated 45 min ago')
    expect(mountPanel(result([])).find('[data-testid="today-stale"]').exists()).toBe(false)
  })

  it('asks for reconnecting an expired calendar, and says so when no calendar could be reached', () => {
    const w = mountPanel(result([event({})], {
      connections: [
        { id: '1', ownerName: 'Sam', status: 'auth_expired' },
        { id: '2', ownerName: 'Alex', status: 'unreachable' },
      ],
    }))
    expect(w.findAll('[data-testid="today-reconnect"]').map((x) => x.text())).toEqual(['Sam’s calendar needs reconnecting'])
    expect(w.text()).not.toContain('couldn’t be reached')

    const down = mountPanel(result([], { connections: [{ id: '2', ownerName: 'Alex', status: 'unreachable' }] }))
    expect(down.text()).toContain('Calendar couldn’t be reached')
    expect(down.text()).not.toContain('Nothing else today')
  })
})
