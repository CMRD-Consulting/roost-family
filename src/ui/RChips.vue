<script setup lang="ts">
/** Single-select chip group (spec §7.4): a radiogroup with roving-tabindex arrow-key navigation. */
import { ref } from 'vue'

export interface ChipOption {
  value: string
  label: string
  disabled?: boolean
}

const props = defineProps<{
  options: ChipOption[]
  label: string
  /** Tapping the selected chip again clears the selection (for optional choices). */
  deselectable?: boolean
}>()
const model = defineModel<string | null>({ required: true })

const chipRefs = ref<HTMLButtonElement[]>([])

function focusableIndex(): number {
  const selected = props.options.findIndex((o) => o.value === model.value && !o.disabled)
  if (selected !== -1) return selected
  return props.options.findIndex((o) => !o.disabled)
}

function select(option: ChipOption): void {
  if (option.disabled) return
  model.value = props.deselectable && model.value === option.value ? null : option.value
}

function onKeydown(e: KeyboardEvent, index: number): void {
  const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  if (!isNext && !isPrev) return
  e.preventDefault()
  const enabled = props.options.map((o, i) => ({ ...o, i })).filter((o) => !o.disabled)
  if (enabled.length === 0) return
  const pos = enabled.findIndex((o) => o.i === index)
  const from = pos === -1 ? 0 : pos
  const dir = isNext ? 1 : -1
  const next = enabled[(from + dir + enabled.length) % enabled.length]!
  model.value = next.value
  chipRefs.value[next.i]?.focus()
}
</script>

<template>
  <div role="radiogroup" :aria-label="label" class="flex flex-wrap gap-3">
    <button
      v-for="(option, i) in options"
      :key="option.value"
      ref="chipRefs"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :disabled="option.disabled"
      :tabindex="i === focusableIndex() ? 0 : -1"
      class="min-h-[60px] rounded-[var(--radius-control)] px-6 text-[22px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      :class="model === option.value ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
      @click="select(option)"
      @keydown="onKeydown($event, i)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
