<script setup lang="ts">
/** An on/off setting: the whole row is one switch (deliberate surface target ≥ 44 pt). */
import { useId } from 'vue'

defineProps<{ label: string; hint?: string }>()
const model = defineModel<boolean>({ required: true })
const id = useId()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-labelledby="`${id}-label`"
    :aria-describedby="hint ? `${id}-hint` : undefined"
    class="flex min-h-[64px] w-full items-center justify-between gap-6 rounded-[var(--radius-control)] text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    @click="model = !model"
  >
    <span class="flex flex-col gap-1">
      <span :id="`${id}-label`" class="text-[20px] font-medium text-ink">{{ label }}</span>
      <span v-if="hint" :id="`${id}-hint`" class="text-[18px] text-ink-3">{{ hint }}</span>
    </span>
    <span class="flex shrink-0 items-center gap-3">
      <span class="text-[18px] text-ink-2" aria-hidden="true">{{ model ? 'On' : 'Off' }}</span>
      <span
        class="relative h-8 w-14 rounded-full transition-colors"
        :class="model ? 'bg-green-deep' : 'bg-line'"
        aria-hidden="true"
      >
        <span class="absolute top-[3px] size-[26px] rounded-full bg-surface transition-[left]" :class="model ? 'left-[27px]' : 'left-[3px]'" />
      </span>
    </span>
  </button>
</template>
