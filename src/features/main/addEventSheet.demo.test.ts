import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSource } from '@/data/householdSource'
import { createFakeQueue, createFakeWriter } from '@/features/logs/sheetTestHelpers'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import AddEventSheet from './AddEventSheet.vue'

vi.mock('@/data/householdSource', () => ({ isDemo: true, DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' } }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

import { demoTodayEvents, resetDemoEventsForTests } from '@/data/calendarApi'

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const NOW = '2026-09-14T18:07:00Z'
const TZ = 'America/New_York'

let pinia: Pinia
let wrapper: VueWrapper | null = null

const field = (w: VueWrapper, label: string) => {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No field "${label}"`)
  return w.get(`#${CSS.escape(lab.attributes('for')!)}`)
}

const button = (w: VueWrapper, label: string) => {
  const found = w.findAll('button').find((b) => b.text() === label || b.attributes('aria-label') === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}

async function click(el: { trigger: (e: string) => Promise<void> }) {
  await el.trigger('click')
  await flushPromises()
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  resetDemoEventsForTests()
  pinia = createPinia()
  setActivePinia(pinia)
  const snapshot = buildDemoSnapshot(new Date(NOW))
  const source: HouseholdSource = { load: async () => structuredClone(snapshot), subscribe: () => () => {} }
  await useHouseholdStore().start(HOUSEHOLD_ID, source)
  await useLogStore().init(createFakeWriter(), createFakeQueue())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  resetDemoEventsForTests()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('AddEventSheet in the demo', () => {
  it('adds an event to the demo calendar in memory, without a Supabase client', async () => {
    wrapper = mount(AddEventSheet, { props: { open: true }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    const w = wrapper

    // The demo gives every person a calendar of their own, so the PIN pad comes straight up.
    expect(w.text()).toContain('Enter your PIN to add an event')
    await click(button(w, 'Sam'))
    for (const digit of ['1', '2', '3', '4']) await click(button(w, digit))

    await click(w.get(`[data-testid="event-person-${IVY}"]`))
    await field(w, 'What is it?').setValue('Swim lesson')
    await w.get('[data-testid="event-start"]').setValue('16:00')
    await click(w.get('[data-testid="event-save"]'))

    const added = w.emitted('added') as Array<[Record<string, unknown>]>
    expect(added).toHaveLength(1)
    expect(added[0]![0]).toMatchObject({ title: 'Swim lesson', personType: 'child', personId: IVY })
    // And the demo's own calendar reads it back, so a refresh keeps showing it.
    expect(demoTodayEvents(new Date(NOW), TZ).events.some((e) => e.title === 'Swim lesson')).toBe(true)
  })
})
