<script setup lang="ts">
/**
 * Full-screen sticker celebration (spec §7.4): pop animation + chime; dismisses on tap or after 1.8 s.
 * It covers the "Saved" toast, so a dismissing tap never reaches Undo (it dismisses on `click`, after the
 * pointer is up, so no click lands on what's underneath); the sheet restarts the undo window when it ends.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { playChime } from '@/ui/sound'

defineProps<{ childName: string }>()
const emit = defineEmits<{ done: [] }>()

const CELEBRATION_MS = 1_800

let timer: ReturnType<typeof setTimeout> | null = null
let finished = false

function finish(): void {
  if (finished) return
  finished = true
  if (timer !== null) clearTimeout(timer)
  emit('done')
}

onMounted(() => {
  playChime()
  timer = setTimeout(finish, CELEBRATION_MS)
})

onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer)
})
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    data-testid="sticker-celebration"
    class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5"
    style="background: rgba(245, 230, 196, 0.92)"
    @click="finish"
  >
    <div
      class="flex size-[220px] items-center justify-center rounded-full bg-amber"
      style="animation: roost-pop 600ms ease-out both; box-shadow: 0 20px 60px rgba(217, 164, 65, 0.5)"
      aria-hidden="true"
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FBF6EE"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
      </svg>
    </div>
    <p class="text-[44px] font-semibold text-amber-deep">Sticker for {{ childName }}!</p>
  </div>
</template>
