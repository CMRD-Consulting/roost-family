import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDisplayStore } from './displayStore'

const { loadDisplayState } = vi.hoisted(() => ({ loadDisplayState: vi.fn() }))
const deviceCache = vi.hoisted(() => ({
  loadIdentity: vi.fn(),
  saveIdentity: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/data/supabase', () => ({ displayClient: {} }))
vi.mock('./displaySession', () => ({ loadDisplayState }))
vi.mock('@/data/deviceCache', () => ({ createDeviceCache: () => deviceCache }))
const offlineQueue = vi.hoisted(() => ({ clear: vi.fn() }))
vi.mock('@/data/offlineQueue', () => ({ createOfflineQueue: () => offlineQueue }))

const REGISTERED = { kind: 'registered', identity: { displayId: 'd1', householdId: 'h1', name: 'Kitchen' } } as const

beforeEach(() => {
  setActivePinia(createPinia())
  loadDisplayState.mockReset()
  deviceCache.loadIdentity.mockReset().mockResolvedValue(null)
  deviceCache.saveIdentity.mockReset().mockResolvedValue(undefined)
  deviceCache.clear.mockReset().mockResolvedValue(undefined)
  offlineQueue.clear.mockReset().mockResolvedValue(undefined)
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

  it('seeds lastKnown from the device cache before the first network attempt', async () => {
    deviceCache.loadIdentity.mockResolvedValue(REGISTERED.identity)
    loadDisplayState.mockRejectedValue(new Error('Failed to fetch'))
    const store = useDisplayStore()

    expect(await store.ensure()).toEqual(REGISTERED)
    expect(store.lastKnown).toEqual(REGISTERED)
    expect(store.identity).toEqual(REGISTERED.identity)
    await vi.waitFor(() => expect(store.state).toEqual({ kind: 'offline' }))
    expect(store.lastKnown).toEqual(REGISTERED)
    expect(store.identity).toEqual(REGISTERED.identity)
  })

  it('with a cached registered identity, ensure resolves at once without waiting for the network', async () => {
    deviceCache.loadIdentity.mockResolvedValue(REGISTERED.identity)
    loadDisplayState.mockReturnValue(new Promise(() => {})) // the network never answers
    const store = useDisplayStore()

    expect(await store.ensure()).toEqual(REGISTERED)
    expect(store.identity).toEqual(REGISTERED.identity)
    // The refresh is still running in the background; a second navigation doesn't start another.
    await vi.dynamicImportSettled()
    expect(loadDisplayState).toHaveBeenCalledTimes(1)
    expect(await store.ensure()).toEqual(REGISTERED)
    await vi.dynamicImportSettled()
    expect(loadDisplayState).toHaveBeenCalledTimes(1)
  })

  it('a background refresh that finds the display revoked updates the state', async () => {
    deviceCache.loadIdentity.mockResolvedValue(REGISTERED.identity)
    let answer!: (s: unknown) => void
    loadDisplayState.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const store = useDisplayStore()

    expect(await store.ensure()).toEqual(REGISTERED)
    await vi.dynamicImportSettled()
    answer({ kind: 'revoked' })
    await vi.waitFor(() => expect(store.state).toEqual({ kind: 'revoked' }))
    expect(store.identity).toBeNull()
    expect(deviceCache.clear).toHaveBeenCalled()
  })

  it('never lets a hung device cache read block the network for more than 1 s', async () => {
    vi.useFakeTimers()
    deviceCache.loadIdentity.mockReturnValue(new Promise(() => {}))
    loadDisplayState.mockResolvedValue(REGISTERED)
    const store = useDisplayStore()

    let result: unknown = null
    void store.ensure().then((s) => (result = s))
    await vi.advanceTimersByTimeAsync(999)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await vi.dynamicImportSettled()
    await vi.waitFor(() => expect(result).toEqual(REGISTERED))
  })

  it('reads the device cache at most once', async () => {
    deviceCache.loadIdentity.mockResolvedValue(REGISTERED.identity)
    loadDisplayState.mockResolvedValue(REGISTERED)
    const store = useDisplayStore()

    await store.ensure()
    await store.refresh()
    await store.ensure()
    expect(deviceCache.loadIdentity).toHaveBeenCalledTimes(1)
  })

  it('saves the identity to the device cache once registered', async () => {
    loadDisplayState.mockResolvedValue(REGISTERED)
    const store = useDisplayStore()

    await store.refresh()
    expect(deviceCache.saveIdentity).toHaveBeenCalledWith(REGISTERED.identity)
    expect(deviceCache.clear).not.toHaveBeenCalled()
  })

  it('clears the device cache when the display is revoked', async () => {
    loadDisplayState.mockResolvedValue({ kind: 'revoked' })
    const store = useDisplayStore()

    await store.refresh()
    expect(deviceCache.clear).toHaveBeenCalledTimes(1)
    expect(deviceCache.saveIdentity).not.toHaveBeenCalled()
  })

  it('clears the device cache when the display is unregistered', async () => {
    loadDisplayState.mockResolvedValue({ kind: 'unregistered' })
    const store = useDisplayStore()

    await store.refresh()
    expect(deviceCache.clear).toHaveBeenCalledTimes(1)
  })

  it.each(['revoked', 'unregistered'] as const)('clears the offline queue when the display is %s', async (kind) => {
    loadDisplayState.mockResolvedValue({ kind })
    const store = useDisplayStore()

    await store.refresh()
    // Pending logs belong to a household this tablet no longer has access to; they must never replay.
    await vi.waitFor(() => expect(offlineQueue.clear).toHaveBeenCalledTimes(1))
  })

  it('keeps the offline queue while registered or offline', async () => {
    loadDisplayState.mockResolvedValueOnce(REGISTERED).mockRejectedValueOnce(new Error('Failed to fetch'))
    const store = useDisplayStore()

    await store.refresh()
    await store.refresh()
    await vi.dynamicImportSettled()
    expect(offlineQueue.clear).not.toHaveBeenCalled()
  })

  it('a failure clearing the offline queue does not break the refresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    offlineQueue.clear.mockRejectedValue(new Error('IndexedDB unavailable'))
    loadDisplayState.mockResolvedValue({ kind: 'revoked' })
    const store = useDisplayStore()

    expect(await store.refresh()).toEqual({ kind: 'revoked' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
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
      expect(deviceCache.loadIdentity).not.toHaveBeenCalled()
      expect(deviceCache.saveIdentity).not.toHaveBeenCalled()
      expect(deviceCache.clear).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('@/data/householdSource')
      vi.resetModules()
    }
  })
})
