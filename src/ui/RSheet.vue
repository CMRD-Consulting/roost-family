<script setup lang="ts">
/**
 * Modal sheet frame for log sheets (spec §7.4). Bottom-anchored, focus-trapped
 * via a container `tabindex="-1"` that receives focus on open; focus returns to
 * the opener on close. Escape and a tap on the scrim both close it.
 */
import { nextTick, useId, useTemplateRef, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const panel = useTemplateRef<HTMLDivElement>('panel')

let opener: HTMLElement | null = null

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      panel.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      opener?.focus?.()
      opener = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-end justify-center"
    style="background: rgba(43, 33, 28, 0.45)"
    @click.self="emit('close')"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="flex max-h-[90vh] w-full flex-col gap-6 rounded-t-[28px] bg-surface px-6 pt-8 pb-6 outline-none"
      style="max-width: 960px"
    >
      <div class="flex items-center justify-between gap-4">
        <h2 :id="titleId" class="text-[32px] font-semibold text-ink">{{ title }}</h2>
        <button
          type="button"
          aria-label="Close"
          class="flex min-h-[60px] min-w-[60px] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-2 text-[26px] text-ink"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <slot />
      </div>
      <div v-if="$slots.footer" class="sticky bottom-0 -mx-6 -mb-6 border-t border-line bg-surface px-6 pb-6 pt-4">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
