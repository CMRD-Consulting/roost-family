<script setup lang="ts">
/** Settings > About (spec §7.9): app version and this display, with links to the privacy policy and terms. */
import { computed } from 'vue'
import { DEMO_DISPLAY, isDemo } from '@/data/householdSource'
import { useDisplayStore } from '@/session/displayStore'

const APP_VERSION = __APP_VERSION__

const displayStore = useDisplayStore()
const displayName = computed(() => (isDemo ? DEMO_DISPLAY.name : (displayStore.identity?.name ?? null)))
</script>

<template>
  <section aria-labelledby="settings-about-title" class="flex flex-col gap-5">
    <h2 id="settings-about-title" class="text-[32px] font-semibold text-ink">About</h2>

    <dl class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <div class="flex flex-col gap-1">
        <dt class="text-[18px] font-medium text-ink-3">App</dt>
        <dd class="text-[22px] font-semibold text-ink">Roost Family</dd>
      </div>
      <div class="flex flex-col gap-1">
        <dt class="text-[18px] font-medium text-ink-3">Version</dt>
        <dd data-testid="app-version" class="text-[22px] text-ink tabular-nums">{{ APP_VERSION }}</dd>
      </div>
      <div v-if="displayName" class="flex flex-col gap-1">
        <dt class="text-[18px] font-medium text-ink-3">This display</dt>
        <dd class="text-[22px] text-ink">{{ displayName }}</dd>
      </div>
    </dl>

    <nav aria-label="Policies" class="flex flex-wrap gap-3">
      <RouterLink
        to="/privacy"
        class="flex min-h-[44px] items-center rounded-[var(--radius-control)] bg-surface-2 px-6 text-[18px] font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
      >
        Privacy policy
      </RouterLink>
      <RouterLink
        to="/terms"
        class="flex min-h-[44px] items-center rounded-[var(--radius-control)] bg-surface-2 px-6 text-[18px] font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
      >
        Terms
      </RouterLink>
    </nav>
  </section>
</template>
