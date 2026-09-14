<script setup lang="ts">
/**
 * Modal sheet frame for log sheets (spec §7.4). Bottom-anchored. The panel takes focus on open and
 * traps Tab/Shift+Tab inside itself; focus returns to the opener on close or unmount (or to the main landmark
 * when the opener is gone). Escape (handled on
 * the panel, so only the topmost of stacked sheets reacts) and a tap on the scrim both close it.
 */
import { nextTick, useId, useTemplateRef, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const panel = useTemplateRef<HTMLDivElement>('panel')

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let opener: HTMLElement | null = null

/**
 * Returns focus to the opener. If the opener has gone (e.g. the Undo toast's button once the undo window ran
 * out), focus moves to the page's main landmark instead of being dropped on <body>.
 */
function restoreFocus(): void {
  const target = opener
  opener = null
  if (!target || target === document.body) return
  if (target.isConnected) {
    target.focus?.()
    return
  }
  const fallback = document.querySelector<HTMLElement>('main h1, main') ?? null
  if (!fallback) return
  if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1')
  fallback.focus()
}

function trapTab(e: KeyboardEvent): void {
  const root = panel.value
  if (!root) return
  const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (focusables.length === 0) {
    e.preventDefault()
    root.focus()
    return
  }
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const active = document.activeElement
  const outside = !(active instanceof Node) || !root.contains(active) || active === root
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault()
    first.focus()
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // Stacked sheets: the innermost panel handles it; outer ones never see it.
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'Tab') {
    e.stopPropagation()
    trapTab(e)
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener = document.activeElement as HTMLElement | null
      await nextTick()
      panel.value?.focus()
    } else {
      restoreFocus()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (props.open) restoreFocus()
})
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
      @keydown="onKeydown"
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
