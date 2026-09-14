<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    tier?: 'moment' | 'deliberate'
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', tier: 'deliberate', disabled: false, type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-6 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    :class="[
      tier === 'moment' ? 'min-h-[60px] min-w-[60px] text-[22px]' : 'min-h-[44px] min-w-[44px] text-[18px]',
      variant === 'primary' && 'bg-orange-deep text-surface',
      variant === 'secondary' && 'bg-surface-2 text-ink',
      variant === 'ghost' && 'bg-transparent text-ink-2',
      variant === 'danger' && 'bg-warn-ink text-surface',
    ]"
  >
    <slot />
  </button>
</template>
