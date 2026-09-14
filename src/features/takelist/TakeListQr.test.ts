import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSource } from '@/data/householdSource'
import { TakeListError, type TakeListDisplayApi } from '@/data/takeListApi'
import { useHouseholdStore } from '@/stores/householdStore'
import TakeListQr from './TakeListQr.vue'

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const TOKEN_1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP1'
const TOKEN_2 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP2'

interface FakeDisplayApi extends TakeListDisplayApi {
  calls: string[]
  tokens: string[]
  failNext: Partial<Record<'createLink' | 'revoke', TakeListError>>
}

function fakeApi(): FakeDisplayApi {
  const api: FakeDisplayApi = {
    calls: [],
    tokens: [TOKEN_1, TOKEN_2],
    failNext: {},
    async createLink(householdId) {
      api.calls.push(`create:${householdId}`)
      const e = api.failNext.createLink
      if (e) {
        delete api.failNext.createLink
        throw e
      }
      return { token: api.tokens.shift()!, expiresAt: '2026-09-15T19:00:00.000Z' }
    },
    async revoke(householdId) {
      api.calls.push(`revoke:${householdId}`)
      const e = api.failNext.revoke
      if (e) {
        delete api.failNext.revoke
        throw e
      }
    },
  }
  return api
}

let pinia: Pinia
let wrapper: VueWrapper | null = null

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function mountQr(api: TakeListDisplayApi, open = true) {
  wrapper = mount(TakeListQr, { props: { open, api }, global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

/** The QR code library is loaded lazily, which can take longer than a microtask flush. */
async function waitForQr(w: VueWrapper) {
  await vi.waitFor(() => expect(w.find('[data-testid="take-list-qr"]').exists()).toBe(true))
  return w.get('[data-testid="take-list-qr"]')
}

const buttonNamed = (w: VueWrapper, label: string) => {
  const b = w.findAll('button').find((x) => x.text() === label)
  if (!b) throw new Error(`No button "${label}"`)
  return b
}

describe('TakeListQr', () => {
  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    const snapshot = buildDemoSnapshot(new Date())
    const source: HouseholdSource = { load: async () => structuredClone(snapshot), subscribe: () => () => {} }
    setOnline(true)
    await useHouseholdStore().start(HOUSEHOLD_ID, source)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    useHouseholdStore().stop()
    setOnline(true)
  })

  it('creates a link when opened and shows its QR code with the instructions', async () => {
    const api = fakeApi()
    const w = await mountQr(api)

    expect(api.calls).toEqual([`create:${HOUSEHOLD_ID}`])
    const qr = await waitForQr(w)
    expect(qr.attributes('aria-label')).toBe('QR code for the grocery list link')
    expect(qr.find('svg').exists()).toBe(true)
    expect(w.get('[data-testid="take-list-qr"]').attributes('data-url')).toBe(`${window.location.origin}/list/${TOKEN_1}`)
    expect(w.text()).toContain("Scan with your phone's camera")
    expect(w.text()).toContain('Expires in 24 hours')
  })

  it('makes a new link each time it opens, and none while closed', async () => {
    const api = fakeApi()
    const w = await mountQr(api, false)
    expect(api.calls).toEqual([])

    await w.setProps({ open: true })
    await waitForQr(w)
    await w.setProps({ open: false })
    await flushPromises()
    await w.setProps({ open: true })
    await flushPromises()
    expect(api.calls).toEqual([`create:${HOUSEHOLD_ID}`, `create:${HOUSEHOLD_ID}`])
    expect((await waitForQr(w)).attributes('data-url')).toBe(`${window.location.origin}/list/${TOKEN_2}`)
  })

  it('Done closes and keeps the link', async () => {
    const api = fakeApi()
    const w = await mountQr(api)
    await buttonNamed(w, 'Done').trigger('click')
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
    expect(api.calls).toEqual([`create:${HOUSEHOLD_ID}`])
  })

  it('"Done shopping — end link" revokes the link and closes', async () => {
    const api = fakeApi()
    const w = await mountQr(api)
    await waitForQr(w)
    await buttonNamed(w, 'Done shopping — end link').trigger('click')
    await flushPromises()
    expect(api.calls).toEqual([`create:${HOUSEHOLD_ID}`, `revoke:${HOUSEHOLD_ID}`])
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('stays open with an error when ending the link fails', async () => {
    const api = fakeApi()
    const w = await mountQr(api)
    await waitForQr(w)
    api.failNext.revoke = new TakeListError('fetch failed', 'network')
    await buttonNamed(w, 'Done shopping — end link').trigger('click')
    await flushPromises()
    expect(w.emitted('close')).toBeUndefined()
    expect(w.get('[role="alert"]').text()).toContain("Couldn't end the link")
  })

  it('asks for a connection while offline and creates the link once back online', async () => {
    setOnline(false)
    const api = fakeApi()
    const w = await mountQr(api)
    expect(w.text()).toContain('Connect to share the list.')
    expect(w.find('[data-testid="take-list-qr"]').exists()).toBe(false)
    expect(api.calls).toEqual([])

    setOnline(true)
    await flushPromises()
    expect(api.calls).toEqual([`create:${HOUSEHOLD_ID}`])
    await waitForQr(w)
  })

  it('asks for a connection when creating the link fails on the network, and offers a retry for other errors', async () => {
    const api = fakeApi()
    api.failNext.createLink = new TakeListError('fetch failed', 'network')
    const w = await mountQr(api)
    expect(w.text()).toContain('Connect to share the list.')

    await w.setProps({ open: false })
    api.failNext.createLink = new TakeListError('boom', 'other')
    await w.setProps({ open: true })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain("Couldn't make a link")
    await buttonNamed(w, 'Try again').trigger('click')
    await waitForQr(w)
  })
})
