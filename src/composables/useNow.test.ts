import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useNow } from './useNow'

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates every intervalMs', () => {
    const scope = effectScope()
    scope.run(() => {
      const now = useNow(1_000)
      const initial = now.value.getTime()
      vi.advanceTimersByTime(1_000)
      expect(now.value.getTime()).toBe(initial + 1_000)
      vi.advanceTimersByTime(2_000)
      expect(now.value.getTime()).toBe(initial + 3_000)
    })
    scope.stop()
  })

  it('stops ticking while hidden and updates immediately + restarts when visible again', () => {
    const scope = effectScope()
    scope.run(() => {
      const now = useNow(1_000)
      const initial = now.value.getTime()

      setVisibility('hidden')
      vi.advanceTimersByTime(5_000)
      expect(now.value.getTime()).toBe(initial)

      vi.setSystemTime(new Date(initial + 5_000))
      setVisibility('visible')
      expect(now.value.getTime()).toBe(initial + 5_000)

      vi.advanceTimersByTime(1_000)
      expect(now.value.getTime()).toBe(initial + 6_000)
    })
    scope.stop()
  })

  it('cleans up the interval and the visibilitychange listener on scope dispose', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const scope = effectScope()
    let now: ReturnType<typeof useNow> | undefined
    scope.run(() => {
      now = useNow(1_000)
    })
    const before = now!.value.getTime()

    scope.stop()
    vi.advanceTimersByTime(5_000)

    expect(now!.value.getTime()).toBe(before)
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    removeSpy.mockRestore()
  })
})
