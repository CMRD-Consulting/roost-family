import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import type { HouseholdSource } from '@/data/householdSource'
import { useHouseholdStore } from './householdStore'

function fakeSource(loadImpl?: (id: string, now: Date) => Promise<HouseholdSnapshot>) {
  let onChangeCb: (() => void) | null = null
  const unsubscribe = vi.fn()
  const load = vi.fn(loadImpl ?? (async (_id: string, now: Date) => buildDemoSnapshot(now)))
  const subscribe = vi.fn((_id: string, cb: () => void) => {
    onChangeCb = cb
    return unsubscribe
  })
  const source: HouseholdSource = { load, subscribe }
  return { source, load, subscribe, unsubscribe, triggerChange: () => onChangeCb?.() }
}

describe('useHouseholdStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loads and subscribes on start', async () => {
    const { source, load, subscribe } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)

    expect(load).toHaveBeenCalledWith('h1', expect.any(Date))
    expect(subscribe).toHaveBeenCalledWith('h1', expect.any(Function))
    expect(store.status).toBe('ready')
    expect(store.snapshot).not.toBeNull()
    expect(store.error).toBeNull()
  })

  it('is idempotent for the same household', async () => {
    const { source, load, subscribe } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)
    await store.start('h1', source)

    expect(load).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('reloads when the source signals a change', async () => {
    const { source, load, triggerChange } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)
    load.mockClear()

    triggerChange()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('keeps the previous snapshot on reload failure and only errors status when there was none', async () => {
    let shouldFail = false
    const { source } = fakeSource(async (_id, now) => {
      if (shouldFail) throw new Error('offline')
      return buildDemoSnapshot(now)
    })
    const store = useHouseholdStore()
    await store.start('h1', source)
    const firstSnapshot = store.snapshot
    expect(store.status).toBe('ready')

    shouldFail = true
    await store.reload()

    expect(store.snapshot).toBe(firstSnapshot)
    expect(store.status).toBe('ready')
    expect(store.error).toBe('offline')
  })

  it('sets status to error when the initial load fails with no prior snapshot', async () => {
    const { source } = fakeSource(async () => {
      throw new Error('down')
    })
    const store = useHouseholdStore()
    await store.start('h1', source)

    expect(store.snapshot).toBeNull()
    expect(store.status).toBe('error')
    expect(store.error).toBe('down')
  })

  it('unsubscribes and removes listeners on stop', async () => {
    const { source, unsubscribe } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)

    store.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reloads when connectivity returns online', async () => {
    const { source, load } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)
    load.mockClear()

    window.dispatchEvent(new Event('online'))
    expect(store.online).toBe(true)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('sets online to false on an offline event', async () => {
    const { source } = fakeSource()
    const store = useHouseholdStore()
    await store.start('h1', source)

    window.dispatchEvent(new Event('offline'))
    expect(store.online).toBe(false)
  })

  it('staleMinutes is 0 with no snapshot and minutes since loadedAt otherwise', async () => {
    const store = useHouseholdStore()
    expect(store.staleMinutes(new Date())).toBe(0)

    const now = new Date('2026-09-14T19:00:00Z')
    const { source } = fakeSource(async () => buildDemoSnapshot(now))
    await store.start('h1', source)

    expect(store.staleMinutes(new Date(now.getTime() + 7 * 60_000))).toBe(7)
  })
})
