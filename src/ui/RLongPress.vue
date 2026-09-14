<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * A button that emits `complete` only after being held for `duration` ms (spec §7.3 toddler guard).
 * Releasing early, leaving, cancelling or drifting more than 12 px cancels the press. Holding Enter or Space
 * works the same way from a keyboard.
 *
 * A `click` with no pointer or key press on this button in the last 800 ms counts as a completed hold: that is
 * how screen readers and switch controls activate a button, and they can't hold. Clicks that follow a real
 * press (a toddler's quick tap, a cancelled press) are ignored, so the guard still holds for touch.
 *
 * Progress is written to the `--rlp-progress` custom property (0–1) on the button once per animation
 * frame while pressed, without Vue reactivity. Put `class="r-longpress-ring"` on an element inside
 * the slot to draw a fill ring there. With `prefers-reduced-motion`, no frames run: the ring is hidden
 * and a static bar marks the press instead.
 */
const props = withDefaults(defineProps<{ duration?: number }>(), { duration: 600 })
const emit = defineEmits<{ complete: [] }>()

const MOVE_TOLERANCE_PX = 12
/** A click this soon after pointer or key activity on the button came from that press, not from assistive tech. */
const PRESS_CLICK_WINDOW_MS = 800

const root = ref<HTMLButtonElement | null>(null)
const pressing = ref(false)
const reducedMotion = ref(false)

let pointerId: number | null = null
let startX = 0
let startY = 0
let startedAt = 0
/** When the last pointer or activation-key event hit this button. */
let lastPressActivityAt = Number.NEGATIVE_INFINITY
let timer: ReturnType<typeof setTimeout> | undefined
let frame: number | undefined

function setProgress(p: number): void {
  root.value?.style.setProperty('--rlp-progress', String(p))
}

function tick(): void {
  frame = undefined
  if (!pressing.value) return
  setProgress(Math.min(1, (Date.now() - startedAt) / props.duration))
  frame = requestAnimationFrame(tick)
}

function begin(): void {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  pressing.value = true
  startedAt = Date.now()
  setProgress(0)
  timer = setTimeout(finish, props.duration)
  if (!reducedMotion.value) frame = requestAnimationFrame(tick)
}

function finish(): void {
  timer = undefined
  reset()
  emit('complete')
}

function reset(): void {
  if (timer !== undefined) clearTimeout(timer)
  if (frame !== undefined) cancelAnimationFrame(frame)
  timer = undefined
  frame = undefined
  if (pointerId !== null && root.value?.hasPointerCapture?.(pointerId)) root.value.releasePointerCapture(pointerId)
  pointerId = null
  pressing.value = false
  setProgress(0)
}

function notePressActivity(): void {
  lastPressActivityAt = Date.now()
}

function onPointerDown(e: PointerEvent): void {
  notePressActivity()
  if (pressing.value || (e.pointerType === 'mouse' && e.button !== 0)) return
  pointerId = e.pointerId
  startX = e.clientX
  startY = e.clientY
  root.value?.setPointerCapture?.(e.pointerId)
  begin()
}

function onPointerMove(e: PointerEvent): void {
  if (!pressing.value || e.pointerId !== pointerId) return
  if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) reset()
}

function onPointerEnd(e: PointerEvent): void {
  notePressActivity()
  if (e.pointerId === pointerId) reset()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  // Also stops the browser's own click for the key, so the keyboard has to hold like a finger.
  e.preventDefault()
  notePressActivity()
  if (!e.repeat && !pressing.value) begin()
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  notePressActivity()
  reset()
}

function onClick(): void {
  if (pressing.value || Date.now() - lastPressActivityAt < PRESS_CLICK_WINDOW_MS) return
  emit('complete')
}

onBeforeUnmount(reset)
</script>

<template>
  <button
    ref="root"
    type="button"
    class="r-longpress relative select-none"
    :data-pressing="pressing || undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @pointerleave="onPointerEnd"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @click="onClick"
    @blur="reset"
    @contextmenu.prevent
  >
    <slot />
    <span
      v-if="pressing && reducedMotion"
      data-testid="longpress-bar"
      class="pointer-events-none absolute inset-x-3 bottom-2 h-1.5 rounded-full bg-current"
      aria-hidden="true"
    />
  </button>
</template>

<style>
.r-longpress {
  --rlp-progress: 0;
  touch-action: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.r-longpress-ring {
  pointer-events: none;
  border-radius: 9999px;
  opacity: 0;
  background: conic-gradient(currentColor calc(var(--rlp-progress) * 1turn), rgb(43 33 28 / 0.15) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
}
.r-longpress[data-pressing] .r-longpress-ring {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .r-longpress-ring {
    display: none;
  }
}
</style>
