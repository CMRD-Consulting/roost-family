<script setup lang="ts">
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
</script>

<template>
  <label class="flex flex-col gap-2">
    <span class="text-[18px] font-medium text-ink-2">{{ label }}</span>
    <input
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
  </label>
</template>

<style scoped>
.r-masked {
  -webkit-text-security: disc;
  text-security: disc;
}
</style>
