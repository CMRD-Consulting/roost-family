<script setup lang="ts">
/** Icon choice from the routine icon library (spec §7.9): a radiogroup of icon swatches, used for routine
 *  steps and sticker categories. */
import RoutineIcon from '@/ui/RoutineIcon.vue'
import { useRovingRadio } from '@/ui/useRovingRadio'
import { ICON_KEYS } from './iconKeys'

function iconLabel(key: string): string {
  return key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const props = withDefaults(defineProps<{ label: string; icons?: readonly string[] }>(), { icons: () => ICON_KEYS })
const model = defineModel<string | null>({ required: true })

const { optionRefs, tabindexFor, onKeydown } = useRovingRadio(() => [...props.icons], model)
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-[18px] font-medium text-ink-2">{{ label }}</span>
    <div role="radiogroup" :aria-label="label" class="flex flex-wrap gap-3">
      <button
        v-for="(icon, i) in icons"
        :key="icon"
        ref="optionRefs"
        type="button"
        role="radio"
        :aria-checked="model === icon"
        :aria-label="iconLabel(icon)"
        :tabindex="tabindexFor(i)"
        class="flex size-14 items-center justify-center rounded-[var(--radius-control)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
        :class="model === icon ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
        @click="model = icon"
        @keydown="onKeydown($event, i)"
      >
        <RoutineIcon :icon-key="icon" :size="28" />
      </button>
    </div>
  </div>
</template>
