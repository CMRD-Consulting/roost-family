<script setup lang="ts">
/** Person color choice (spec §4.6): a radiogroup of swatches, each named for assistive tech. */
import { PERSON_COLORS, personColorName } from '@/ui/personPalette'
import { useRovingRadio } from '@/ui/useRovingRadio'

const props = withDefaults(defineProps<{ label: string; colors?: readonly string[] }>(), { colors: () => PERSON_COLORS })
const model = defineModel<string | null>({ required: true })

const { optionRefs, tabindexFor, onKeydown } = useRovingRadio(() => [...props.colors], model)
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-[18px] font-medium text-ink-2">{{ label }}</span>
    <div role="radiogroup" :aria-label="label" class="flex flex-wrap gap-3">
      <button
        v-for="(color, i) in colors"
        :key="color"
        ref="optionRefs"
        type="button"
        role="radio"
        :aria-checked="model === color"
        :aria-label="personColorName(color)"
        :tabindex="tabindexFor(i)"
        class="size-12 rounded-full focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-orange-deep"
        :class="model === color && 'outline-3 outline-offset-3 outline-ink'"
        :style="{ background: color }"
        @click="model = color"
        @keydown="onKeydown($event, i)"
      />
    </div>
  </div>
</template>
