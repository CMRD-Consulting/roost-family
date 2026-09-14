import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { playChime } from '@/ui/sound'

export type TimerPhase = 'idle' | 'running' | 'finished'

export interface VisualTimer {
  phase: Ref<TimerPhase>
  totalMs: Ref<number>
  remainingMs: Ref<number>
  /** Share of the time still left, 1 → 0 while running; 0 when idle or finished. */
  fraction: ComputedRef<number>
  /** "4:59", for the adults. */
  label: ComputedRef<string>
  start(minutes: number): void
  cancel(): void
}

/** How often the disc and digits update while running. */
const TICK_MS = 250
/** How long the finished timer pulses before resetting. */
const RESET_AFTER_MS = 5_000

/**
 * The Kids' Corner visual timer (spec §7.5). Nothing runs while idle; while running it updates about four
 * times a second (each update lands on an animation frame), and a separate timeout fires the chime exactly
 * at zero. Owned by the Corner shell so the countdown survives switching tabs.
 */
export function useVisualTimer(): VisualTimer {
  const phase = ref<TimerPhase>('idle')
  const totalMs = ref(0)
  const remainingMs = ref(0)

  let endsAt = 0
  let tickTimer: ReturnType<typeof setTimeout> | undefined
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined

  function clearAll(): void {
    clearTimeout(tickTimer)
    clearTimeout(endTimer)
    clearTimeout(resetTimer)
    if (frame !== undefined) cancelAnimationFrame(frame)
    tickTimer = endTimer = resetTimer = frame = undefined
  }

  function scheduleTick(): void {
    tickTimer = setTimeout(() => {
      tickTimer = undefined
      // One pending frame at most, even if frames are paused (e.g. a hidden page) while timeouts still fire.
      frame ??= requestAnimationFrame(() => {
        frame = undefined
        if (phase.value === 'running') remainingMs.value = Math.max(0, endsAt - Date.now())
      })
      if (phase.value === 'running') scheduleTick()
    }, TICK_MS)
  }

  function finish(): void {
    clearAll()
    phase.value = 'finished'
    remainingMs.value = 0
    playChime()
    resetTimer = setTimeout(cancel, RESET_AFTER_MS)
  }

  function start(minutes: number): void {
    clearAll()
    totalMs.value = minutes * 60_000
    remainingMs.value = totalMs.value
    endsAt = Date.now() + totalMs.value
    phase.value = 'running'
    endTimer = setTimeout(finish, totalMs.value)
    scheduleTick()
  }

  function cancel(): void {
    clearAll()
    phase.value = 'idle'
    remainingMs.value = 0
  }

  onScopeDispose(clearAll)

  const fraction = computed(() => (phase.value === 'running' && totalMs.value > 0 ? remainingMs.value / totalMs.value : 0))
  const label = computed(() => {
    const totalSeconds = Math.ceil(remainingMs.value / 1000)
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  })

  return { phase, totalMs, remainingMs, fraction, label, start, cancel }
}
