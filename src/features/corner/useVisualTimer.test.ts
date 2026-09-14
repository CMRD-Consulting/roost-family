import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import * as sound from '@/ui/sound'
import { useVisualTimer } from './useVisualTimer'

let scope: EffectScope

function create() {
  scope = effectScope()
  return scope.run(() => useVisualTimer())!
}

describe('useVisualTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
    vi.spyOn(sound, 'playChime').mockImplementation(() => {})
  })

  afterEach(() => {
    scope.stop()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is idle and schedules nothing until started', () => {
    const timer = create()
    expect(timer.phase.value).toBe('idle')
    expect(timer.fraction.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts down while running, updating a few times a second', () => {
    const timer = create()
    timer.start(1)
    expect(timer.phase.value).toBe('running')
    expect(timer.remainingMs.value).toBe(60_000)
    expect(timer.fraction.value).toBe(1)

    vi.advanceTimersByTime(15_000)
    // Updated at most one tick (250 ms plus a frame) behind.
    expect(timer.remainingMs.value).toBeGreaterThanOrEqual(45_000)
    expect(timer.remainingMs.value).toBeLessThanOrEqual(45_300)
    expect(timer.fraction.value).toBeCloseTo(0.75, 1)
    expect(timer.label.value).toBe('0:46')
  })

  it('chimes at zero, stays finished for 5 seconds, then resets', () => {
    const timer = create()
    timer.start(2)
    vi.advanceTimersByTime(119_000)
    expect(sound.playChime).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(timer.phase.value).toBe('finished')
    expect(timer.remainingMs.value).toBe(0)
    expect(sound.playChime).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5_000)
    expect(timer.phase.value).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancel stops the countdown without a chime and leaves nothing scheduled', () => {
    const timer = create()
    timer.start(5)
    vi.advanceTimersByTime(10_000)
    timer.cancel()
    expect(timer.phase.value).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5 * 60_000)
    expect(sound.playChime).not.toHaveBeenCalled()
  })

  describe('after the tablet was in the background', () => {
    function setVisibility(state: DocumentVisibilityState): void {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    afterEach(() => setVisibility('visible'))

    it('finishes (and chimes) as soon as it is visible again if the end time passed while hidden', () => {
      const timer = create()
      timer.start(1)
      setVisibility('hidden')
      // Timers are throttled or frozen in the background: the clock moves on without them firing.
      vi.setSystemTime(Date.now() + 90_000)
      expect(timer.phase.value).toBe('running')

      setVisibility('visible')
      expect(timer.phase.value).toBe('finished')
      expect(timer.remainingMs.value).toBe(0)
      expect(sound.playChime).toHaveBeenCalledTimes(1)

      // The stale end timeout never chimes a second time.
      vi.advanceTimersByTime(120_000)
      expect(sound.playChime).toHaveBeenCalledTimes(1)
      expect(timer.phase.value).toBe('idle')
    })

    it('keeps running, with the remaining time caught up, if the end time has not passed', () => {
      const timer = create()
      timer.start(5)
      setVisibility('hidden')
      vi.setSystemTime(Date.now() + 60_000)
      setVisibility('visible')
      expect(timer.phase.value).toBe('running')
      expect(timer.remainingMs.value).toBe(4 * 60_000)
      expect(sound.playChime).not.toHaveBeenCalled()
    })

    it('does nothing when idle or already finished', () => {
      const timer = create()
      setVisibility('visible')
      expect(timer.phase.value).toBe('idle')
      timer.start(1)
      vi.advanceTimersByTime(60_000)
      setVisibility('visible')
      expect(sound.playChime).toHaveBeenCalledTimes(1)
    })

    it('removes its visibility listener when its scope is disposed', () => {
      const remove = vi.spyOn(document, 'removeEventListener')
      create()
      scope.stop()
      expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    })
  })

  it('stops everything when its scope is disposed', () => {
    const timer = create()
    timer.start(10)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
