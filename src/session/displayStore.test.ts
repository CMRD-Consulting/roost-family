import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDisplayStore } from './displayStore'

const { loadDisplayState } = vi.hoisted(() => ({ loadDisplayState: vi.fn() }))

vi.mock('@/data/supabase', () => ({ displayClient: {} }))
vi.mock('./displaySession', () => ({ loadDisplayState }))

const REGISTERED = { kind: 'registered', identity: { displayId: 'd1', householdId: 'h1', name: 'Kitchen' } } as const

beforeEach(() => {
  setActivePinia(createPinia())
  loadDisplayState.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('displayStore', () => {
  it('reports offline instead of throwing when the state cannot be read', async () => {
    loadDisplayState.mockRejectedValue(new Error('Failed to fetch'))
    const store = useDisplayStore()
    expect(await store.ensure()).toEqual({ kind: 'offline' })
    expect(store.lastKnown).toBeNull()
  })

  it('keeps the last known registered identity while offline', async () => {
    loadDisplayState.mockResolvedValueOnce(REGISTERED).mockRejectedValueOnce(new Error('Failed to fetch'))
    const store = useDisplayStore()
    await store.refresh()
    expect(await store.refresh()).toEqual({ kind: 'offline' })
    expect(store.lastKnown).toEqual(REGISTERED)
    expect(store.identity).toEqual(REGISTERED.identity)
  })

  it('ensure caches a good state but retries after offline', async () => {
    loadDisplayState.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(REGISTERED)
    const store = useDisplayStore()
    await store.ensure()
    expect(await store.ensure()).toEqual(REGISTERED)
    await store.ensure()
    expect(loadDisplayState).toHaveBeenCalledTimes(2)
  })

  it('watch refreshes on an interval and when the browser comes online, until stopped', async () => {
    vi.useFakeTimers()
    loadDisplayState.mockResolvedValue(REGISTERED)
    const store = useDisplayStore()
    const stop = store.watch(1000)

    // refresh() loads the Supabase client lazily, so let that dynamic import settle before asserting.
    vi.advanceTimersByTime(1000)
    await vi.dynamicImportSettled()
    expect(loadDisplayState).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('online'))
    await vi.dynamicImportSettled()
    expect(loadDisplayState).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(5000)
    window.dispatchEvent(new Event('online'))
    await vi.dynamicImportSettled()
    expect(loadDisplayState).toHaveBeenCalledTimes(2)
  })

  it('in demo mode reports the demo display as registered without reading Supabase', async () => {
    vi.resetModules()
    vi.doMock('@/data/householdSource', () => ({
      isDemo: true,
      DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'demo-household', name: 'Kitchen' },
    }))
    try {
      const pinia = await import('pinia')
      pinia.setActivePinia(pinia.createPinia())
      const { useDisplayStore: useDemoDisplayStore } = await import('./displayStore')
      const store = useDemoDisplayStore()
      const expected = { kind: 'registered', identity: { displayId: 'demo-display', householdId: 'demo-household', name: 'Kitchen' } }
      expect(await store.ensure()).toEqual(expected)
      expect(store.identity).toEqual(expected.identity)
      expect(loadDisplayState).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('@/data/householdSource')
      vi.resetModules()
    }
  })
})
