<script setup lang="ts">
/**
 * Kitchen (kitchen spec §2, §7.4): one full-screen mode with four tabs — Shopping · To-do · Meals · Recipes.
 * No PIN: this is household content, not safety configuration (§2), so "Done" simply returns to the main
 * screen. The tab lives in the route query (`/kitchen?tab=todo`) so a reload comes back to the same one.
 * Night and Nap Mode apply here as on the main screen (design §7.7); an open sheet holds Night Mode off.
 */
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNow } from '@/composables/useNow'
import { formatClock } from '@/domain/time'
import { formatDateLabel } from '@/features/main/mainScreenModel'
import { useHouseholdSession } from '@/features/main/useHouseholdSession'
import NapOverlay from '@/features/modes/NapOverlay.vue'
import NightPeek from '@/features/modes/NightPeek.vue'
import NightScreen from '@/features/modes/NightScreen.vue'
import { useNightPeekTaps } from '@/features/modes/useNightPeekTaps'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import RLogo from '@/ui/RLogo.vue'
import ShoppingTab from './ShoppingTab.vue'
import TodoTab from './TodoTab.vue'
import { KITCHEN_TABS, KITCHEN_TAB_LABELS, tabFromQuery, type KitchenTab } from './kitchenModel'

const route = useRoute()
const router = useRouter()
const store = useHouseholdStore()
const modes = useModesStore()
const tick = useNow(15_000)
const { unreachable } = useHouseholdSession()

const now = computed(() => new Date(Math.max(tick.value.getTime(), Date.now())))
const view = computed(() => store.view)

const tab = computed<KitchenTab>(() => tabFromQuery(route.query.tab))

function selectTab(next: KitchenTab): void {
  if (next === tab.value) return
  void router.replace({ path: route.path, query: { ...route.query, tab: next } })
}

// Section tabs (WAI-ARIA tabs pattern), as in Kids' Corner: only the selected tab is in the tab order;
// arrow keys, Home and End move to another tab and select it.
const uid = useId()
const PANEL_ID = `${uid}-panel`
const tabId = (id: KitchenTab) => `${uid}-tab-${id}`

function onTabKeydown(e: KeyboardEvent, index: number): void {
  const last = KITCHEN_TABS.length - 1
  const target =
    e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
    : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
    : e.key === 'Home' ? 0
    : e.key === 'End' ? last
    : null
  if (target === null) return
  e.preventDefault()
  const next = KITCHEN_TABS[target]!
  selectTab(next)
  document.getElementById(tabId(next))?.focus()
}

// Night and Nap Mode (design §7.7), as on the main screen.
const nightClock = computed(() => (view.value ? formatClock(now.value, view.value.household.timeZone) : ''))
const nightDate = computed(() => (view.value ? formatDateLabel(now.value, view.value.household.timeZone) : ''))

// Night Mode never interrupts an adult mid-task: each tab reports whether one of its sheets is open, and
// Night Mode takes over once the last one closes. Agent D: add a flag here for the Meals and Recipes sheets.
const shoppingSheet = ref(false)
const todoSheet = ref(false)
const NIGHT_HOLD = 'kitchen-sheet'
const anythingOpen = computed(() => shoppingSheet.value || todoSheet.value)
watch(
  anythingOpen,
  (open) => (open ? modes.holdNight(NIGHT_HOLD) : modes.releaseNight(NIGHT_HOLD)),
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => modes.releaseNight(NIGHT_HOLD))
useNightPeekTaps()
</script>

<template>
  <!-- Focusable so a closing sheet whose opener has gone can return focus here. -->
  <main tabindex="-1" class="relative h-dvh overflow-hidden bg-app text-ink outline-none">
    <NightScreen
      v-if="view && modes.nightActive"
      :clock="nightClock"
      :date="nightDate"
      :photos="view.photos"
      :time-zone="view.household.timeZone"
      @peek="modes.peek()"
    />

    <div v-else-if="view" class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5 px-10 pb-8 pt-8">
      <header class="flex flex-wrap items-center justify-between gap-5">
        <h1 class="text-[32px] font-semibold">Kitchen</h1>

        <div role="tablist" aria-label="Kitchen sections" class="flex flex-wrap items-center gap-3">
          <button
            v-for="(id, i) in KITCHEN_TABS"
            :id="tabId(id)"
            :key="id"
            type="button"
            role="tab"
            :aria-selected="tab === id"
            :aria-controls="PANEL_ID"
            :tabindex="tab === id ? 0 : -1"
            class="min-h-[60px] rounded-2xl px-6 text-[22px] font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            :class="tab === id ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
            @click="selectTab(id)"
            @keydown="onTabKeydown($event, i)"
          >
            {{ KITCHEN_TAB_LABELS[id] }}
          </button>
        </div>

        <!-- No PIN out of the Kitchen (kitchen spec §2): unlike Kids' Corner, anyone may leave. -->
        <button
          type="button"
          data-testid="kitchen-done"
          class="flex min-h-[60px] items-center gap-3 rounded-2xl bg-surface-2 px-5 text-[20px] font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
          @click="router.push('/home')"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Done</span>
        </button>
      </header>

      <!-- One panel for whichever section is shown, labelled by its tab (WAI-ARIA tabs pattern). -->
      <div :id="PANEL_ID" role="tabpanel" :aria-labelledby="tabId(tab)" class="min-h-0 overflow-y-auto pb-4">
        <ShoppingTab v-if="tab === 'shopping'" @sheet-open="shoppingSheet = $event" />
        <TodoTab v-else-if="tab === 'todo'" @sheet-open="todoSheet = $event" />
        <!-- Agent D: replace with <MealsTab /> -->
        <slot v-else-if="tab === 'meals'" name="meals">
          <p class="text-[24px] text-ink-2">The meal plan arrives here.</p>
        </slot>
        <!-- Agent D: replace with <RecipesTab /> -->
        <slot v-else name="recipes">
          <p class="text-[24px] text-ink-2">The recipe box arrives here.</p>
        </slot>
      </div>
    </div>

    <div v-else-if="unreachable" class="flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
      <span class="text-orange"><RLogo :size="64" /></span>
      <p class="text-[24px] text-ink-2" role="status" aria-live="polite">Can’t reach Roost Family. Retrying…</p>
    </div>

    <div v-else class="flex h-full items-center justify-center text-orange" aria-label="Loading" role="status">
      <RLogo :size="64" />
    </div>

    <NightPeek v-if="view && modes.peeking" :until="modes.nightPeekUntil" :now="modes.now" />
    <NapOverlay v-if="view && modes.napActive" />
  </main>
</template>
