<script setup lang="ts">
/**
 * A feature override row (spec §7.9, §7.2): Default (showing the age-based default) / On / Off. `null` means
 * "no override — use the age-based default"; `computedDefault` is that default with no overrides applied, so
 * the adult can see what "Default" currently resolves to.
 */
import { useId } from 'vue'

const props = defineProps<{ label: string; hint?: string; computedDefault: boolean }>()
const model = defineModel<boolean | null>({ required: true })
const id = useId()

type Key = 'default' | 'on' | 'off'
const KEYS: Key[] = ['default', 'on', 'off']

function keyOf(value: boolean | null): Key {
  return value === null ? 'default' : value ? 'on' : 'off'
}
function valueOf(key: Key): boolean | null {
  return key === 'default' ? null : key === 'on'
}
function labelFor(key: Key): string {
  if (key === 'default') return `Default (${props.computedDefault ? 'On' : 'Off'})`
  return key === 'on' ? 'On' : 'Off'
}

function onKeydown(e: KeyboardEvent, index: number): void {
  const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  if (!isNext && !isPrev) return
  e.preventDefault()
  model.value = valueOf(KEYS[(index + (isNext ? 1 : -1) + KEYS.length) % KEYS.length]!)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-col gap-1">
      <span :id="`${id}-label`" class="text-[20px] font-medium text-ink">{{ label }}</span>
      <span v-if="hint" class="text-[18px] text-ink-3">{{ hint }}</span>
    </div>
    <div role="radiogroup" :aria-labelledby="`${id}-label`" class="flex flex-wrap gap-2">
      <button
        v-for="(key, i) in KEYS"
        :key="key"
        type="button"
        role="radio"
        :aria-checked="keyOf(model) === key"
        :tabindex="keyOf(model) === key ? 0 : -1"
        class="min-h-[44px] rounded-[var(--radius-control)] px-5 text-[18px] font-medium transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
        :class="keyOf(model) === key ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
        @click="model = valueOf(key)"
        @keydown="onKeydown($event, i)"
      >
        {{ labelFor(key) }}
      </button>
    </div>
  </div>
</template>
