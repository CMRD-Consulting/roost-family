<script setup lang="ts">
/**
 * Nap Mode's dimming layer (spec §7.7). Sits over the main screen at 45% opacity but lets every touch
 * pass through (`pointer-events: none`) — the main screen stays fully usable while napping (logging
 * "End sleep" is the most common action). Only the moon button or the automatic rules in `modesStore`
 * end Nap Mode; a tap on this overlay does nothing on its own.
 */
</script>

<template>
  <div data-testid="nap-overlay" class="pointer-events-none absolute inset-0 z-10 flex justify-center pt-9">
    <div class="absolute inset-0" style="background: rgba(43, 33, 28, 0.45)" aria-hidden="true" />
    <div
      role="status"
      class="relative flex h-[60px] items-center gap-3 rounded-full px-6 text-[18px] font-medium text-app"
      style="background: rgba(43, 33, 28, 0.85)"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
      </svg>
      Nap Mode · sounds off
    </div>
  </div>
</template>
