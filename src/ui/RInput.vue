<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  label: string
  type?: string
  placeholder?: string
  autocomplete?: string
  inputmode?: 'text' | 'numeric' | 'email'
  maxlength?: number
  /** Hide the characters as dots without type="password" (so browsers don't offer to save it). */
  masked?: boolean
}>()
const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <!-- min-w-0: in a flex row the field shrinks to its share instead of holding the input's intrinsic width. -->
  <div class="flex min-w-0 flex-col gap-2">
    <label :for="id" class="text-[18px] font-medium text-ink-2">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :maxlength="maxlength"
      :class="masked && 'r-masked'"
      :style="masked ? '-webkit-text-security: disc' : undefined"
      class="min-h-[56px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    />
  </div>
</template>

<style scoped>
.r-masked {
  -webkit-text-security: disc;
  text-security: disc;
}
</style>
