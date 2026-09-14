<script setup lang="ts">
defineProps<{ label: string; type?: string; placeholder?: string; autocomplete?: string; inputmode?: 'text' | 'numeric' | 'email' }>()
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
      class="min-h-[56px] rounded-[var(--radius-control)] border border-line bg-surface px-4 text-[22px] text-ink outline-none focus:border-orange"
    />
  </label>
</template>
