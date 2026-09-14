<script setup lang="ts">
/**
 * Settings (spec §7.9), a deliberate surface (§4: 44 pt targets, text ≥ 18 px): a top bar with the signed-in
 * adult and Done, the section nav on the left and the chosen section beside it. Reached only with an open
 * settings session; when that session ends (5 min idle, Night Mode) the tablet goes back to the main screen,
 * and leaving Settings ends the session. Offline, a banner explains that nothing can be saved.
 */
import { computed, onBeforeUnmount, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHouseholdSession } from '@/features/main/useHouseholdSession'
import { useNightPeekTaps } from '@/features/modes/useNightPeekTaps'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RLogo from '@/ui/RLogo.vue'
import AboutSection from './sections/AboutSection.vue'
import ChildrenSection from './sections/ChildrenSection.vue'
import ComingSoonSection from './sections/ComingSoonSection.vue'
import HouseholdSection from './sections/HouseholdSection.vue'
import MedicinesSection from './sections/MedicinesSection.vue'
import SitterInfoSection from './sections/SitterInfoSection.vue'
import StickersSection from './sections/StickersSection.vue'
import { findSection, SETTINGS_SECTIONS, type SettingsSectionId } from './settingsNav'
import { useSettingsOffline } from './useSettingsSave'

const SECTION_COMPONENTS: Partial<Record<SettingsSectionId, Component>> = {
  household: HouseholdSection,
  children: ChildrenSection,
  medicines: MedicinesSection,
  stickers: StickersSection,
  'sitter-info': SitterInfoSection,
  about: AboutSection,
}

const route = useRoute()
const router = useRouter()
const store = useHouseholdStore()
const session = useSettingsSessionStore()
const offline = useSettingsOffline()
const { unreachable } = useHouseholdSession()
// A night peek keeps going while the adult is still tapping here, as on the main screen (spec §7.7).
useNightPeekTaps()

const section = computed(() => findSection(route.params.section))
const sectionComponent = computed(() => SECTION_COMPONENTS[section.value.id] ?? null)

const adult = computed(() => {
  const info = session.info
  if (info === null) return null
  const member = store.view?.members.find((m) => m.id === info.membershipId)
  return { name: info.displayName, color: member?.color ?? 'var(--color-ink-2)' }
})

let leaving = false

// Idle expiry or Night Mode ended the session: back to the main screen.
watch(
  () => session.info,
  (info) => {
    if (info === null && !leaving) void router.replace('/home')
  },
)

function done(): void {
  void router.push('/home')
}

onBeforeUnmount(() => {
  leaving = true
  // About's policy pages keep the session so Back returns here; anywhere else closes Settings.
  if (!router.currentRoute.value.meta.keepsSettingsSession) session.end()
})
</script>

<template>
  <main tabindex="-1" class="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-app text-ink outline-none">
    <header class="flex items-center justify-between gap-6 border-b border-line px-8 py-4">
      <h1 class="text-[32px] font-semibold">Settings</h1>
      <div class="flex items-center gap-5">
        <span v-if="adult" data-testid="settings-adult" class="flex items-center gap-3">
          <RAvatar :name="adult.name" :color="adult.color" :size="44" decorative />
          <span class="text-[18px] font-medium text-ink-2">{{ adult.name }}</span>
        </span>
        <RButton variant="primary" @click="done">Done</RButton>
      </div>
    </header>

    <div class="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" class="overflow-y-auto bg-surface-2 px-3 py-5">
        <ul class="flex flex-col gap-1">
          <li v-for="s in SETTINGS_SECTIONS" :key="s.id">
            <RouterLink
              :to="`/settings/${s.id}`"
              replace
              :aria-current="s.id === section.id ? 'page' : undefined"
              class="flex min-h-[52px] items-center justify-between gap-2 rounded-[var(--radius-control)] px-4 py-2 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              :class="s.id === section.id ? 'bg-ink text-surface' : 'text-ink'"
            >
              <span class="flex flex-col">
                <span class="text-[19px] font-medium leading-tight">{{ s.label }}</span>
                <span v-if="s.ownerSignIn" class="text-[18px] leading-tight" :class="s.id === section.id ? 'text-surface' : 'text-ink-3'">
                  Requires owner sign-in
                </span>
              </span>
              <svg
                v-if="s.ownerSignIn"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="overflow-y-auto px-10 py-8">
        <div class="mx-auto flex max-w-[820px] flex-col gap-6">
          <p
            v-if="offline"
            role="status"
            data-testid="settings-offline"
            class="rounded-[var(--radius-control)] bg-amber-tint px-5 py-4 text-[18px] font-medium text-amber-deep"
          >
            No connection. Connect to change settings.
          </p>

          <template v-if="store.view">
            <component :is="sectionComponent" v-if="sectionComponent" />
            <ComingSoonSection v-else :title="section.label" />
          </template>
          <p v-else-if="unreachable" role="status" class="text-[22px] text-ink-2">Can’t reach Roost Family. Retrying…</p>
          <div v-else class="flex justify-center py-16 text-orange" aria-label="Loading" role="status">
            <RLogo :size="64" />
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
