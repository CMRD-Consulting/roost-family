<script setup lang="ts">
/**
 * Manage household (spec §7.10) at /manage: a deliberate surface (44 pt targets) opened in any browser, on a phone or
 * a laptop, that is not a display. The adult signs in with an emailed code; owners manage Displays, Members, Export and
 * Delete household, and adults get My account. It reuses the Settings sections through a browser host
 * (useManageHousehold), never the display's session, stores or Settings PIN session.
 *
 * Wiring for later steps:
 * - `onRequestExport` (prop, or `@request-export`): runs when an owner asks for an export, with the owner's client and
 *   household. Until it's given, Export shows a disabled placeholder.
 * - `#calendars` (slot): the calendar settings, shown in My account for adults and above the owner sections for
 *   owners, with the signed-in adult's client, household and membership.
 * - `?calendar=connected` / `?calendar=error&reason=…` (from the calendar connection callback) shows a dismissible
 *   banner once signed in.
 */
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AdultClient, MemberRow, SettingsApi } from '@/data/settingsApi'
import AdultSignIn from '@/features/settings/AdultSignIn.vue'
import { roleLabel } from '@/features/settings/ownerForms'
import DeleteHouseholdSection from '@/features/settings/sections/DeleteHouseholdSection.vue'
import DisplaysSection from '@/features/settings/sections/DisplaysSection.vue'
import MembersSection from '@/features/settings/sections/MembersSection.vue'
import MyAccountSection from '@/features/settings/sections/MyAccountSection.vue'
import { ownerActionMessage } from '@/features/settings/useOwnerSignIn'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RLogo from '@/ui/RLogo.vue'
import { calendarStatusFromQuery, withoutCalendarStatus } from './manageModel'
import { useManageHousehold } from './useManageHousehold'

export interface ExportTarget {
  client: AdultClient
  householdId: string
  membershipId: string
}

export interface CalendarsSlotProps {
  client: AdultClient
  householdId: string
  membershipId: string
  role: 'owner' | 'adult' | 'caregiver'
}

const props = defineProps<{
  /** The API to use (tests); otherwise loaded for this browser. */
  api?: SettingsApi
  onRequestExport?: (target: ExportTarget) => void | Promise<void>
}>()
defineSlots<{ calendars?: (props: CalendarsSlotProps) => unknown }>()

const route = useRoute()
const router = useRouter()
const manage = useManageHousehold({ api: props.api })
const { phase, adult, memberships, selected, notice, error, signInKey, offline, ownerHost, accountHost } = manage

// ─── Calendar connection status (from the connection callback) ─────────────
const calendarStatus = ref(calendarStatusFromQuery(route.query))

function dismissCalendarStatus(): void {
  calendarStatus.value = null
  void router.replace({ query: withoutCalendarStatus(route.query) })
}

const calendarsSlotProps = computed<CalendarsSlotProps | null>(() => {
  const session = adult.value
  const row = selected.value
  return session && row ? { client: session.client, householdId: row.householdId, membershipId: row.membershipId, role: row.role } : null
})

// ─── Export ──────────────────────────────────────────────────────────────
const exportError = ref<string | null>(null)

async function requestExport(): Promise<void> {
  const host = ownerHost.value
  const handler = props.onRequestExport
  const householdId = host?.household.value?.id
  if (!host || !handler || !householdId || host.gate.busy.value || offline.value) return
  exportError.value = null
  try {
    await host.gate.run(async (o) => {
      await handler({ client: o.client, householdId, membershipId: o.membershipId })
    })
  } catch (e) {
    exportError.value = ownerActionMessage(e)
  }
}

// ─── Demo sign-in ────────────────────────────────────────────────────────
const demoAdults = ref<MemberRow[]>([])
onMounted(async () => {
  if (manage.demo) demoAdults.value = await manage.demoAdults()
})

// ─── Focus: each step's heading ──────────────────────────────────────────
const root = useTemplateRef<HTMLElement>('root')
watch([phase, () => selected.value?.membershipId], async () => {
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-manage-heading], [data-step-heading]')?.focus()
})
</script>

<template>
  <main
    ref="root"
    class="min-h-dvh bg-app px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),32px)] text-ink sm:px-8"
  >
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div class="flex items-center gap-2 py-2">
        <RLogo :size="26" />
        <span class="text-[20px] font-medium">roost family</span>
      </div>

      <p v-if="offline" role="status" class="rounded-[var(--radius-control)] bg-amber-tint px-4 py-3 text-[18px] text-ink">
        You’re offline. Nothing can be changed until the connection is back.
      </p>

      <!-- Sign-in -->
      <template v-if="phase === 'signIn'">
        <p v-if="notice" role="status" class="text-[18px] font-medium text-ink-2">{{ notice }}</p>
        <AdultSignIn
          v-if="!manage.demo"
          :key="signInKey"
          heading="h1"
          title="Manage household"
          hint="Sign in with your email to manage your household from this browser. You’re signed out after 5 minutes without a touch."
          :hold-night="false"
          :cancellable="false"
          @signed-in="manage.onSignedIn"
        />
        <div v-else class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
          <h1 tabindex="-1" data-manage-heading class="text-[32px] font-semibold text-ink outline-none">Manage household</h1>
          <p class="text-[18px] text-ink-3">The demo has no accounts. Choose who signs in.</p>
          <div class="flex flex-wrap gap-3">
            <RButton v-for="m in demoAdults" :key="m.membershipId" variant="secondary" @click="manage.demoSignIn(m.membershipId)">
              <RAvatar :name="m.displayName" :color="m.color" :size="32" decorative />
              {{ m.displayName }} ({{ roleLabel(m.role) }})
            </RButton>
          </div>
        </div>
      </template>

      <p v-else-if="phase === 'loading'" role="status" tabindex="-1" data-manage-heading class="text-[20px] text-ink-2 outline-none">
        Loading your households…
      </p>

      <div v-else-if="phase === 'loadFailed'" class="flex flex-col gap-4">
        <h1 tabindex="-1" data-manage-heading class="text-[32px] font-semibold text-ink outline-none">Manage household</h1>
        <p role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
        <div class="flex flex-wrap gap-3">
          <RButton @click="manage.retry">Try again</RButton>
          <RButton variant="secondary" @click="manage.signOut()">Sign out</RButton>
        </div>
      </div>

      <template v-else>
        <div
          v-if="calendarStatus"
          data-testid="calendar-status"
          :role="calendarStatus.kind === 'error' ? 'alert' : 'status'"
          class="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] px-5 py-3"
          :class="calendarStatus.kind === 'error' ? 'bg-amber-tint' : 'bg-green-tint'"
        >
          <p class="min-w-0 flex-1 text-[18px] font-medium" :class="calendarStatus.kind === 'error' ? 'text-warn-ink' : 'text-green-deep'">
            {{ calendarStatus.message }}
          </p>
          <RButton variant="ghost" @click="dismissCalendarStatus">Dismiss</RButton>
        </div>

        <!-- Several households: pick one -->
        <div v-if="phase === 'pick'" class="flex flex-col gap-4">
          <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
          <h1 tabindex="-1" data-manage-heading class="text-[32px] font-semibold text-ink outline-none">Which household?</h1>
          <ul class="flex flex-col gap-3" aria-label="Your households">
            <li v-for="m in memberships" :key="m.membershipId">
              <button
                type="button"
                class="flex min-h-[64px] w-full flex-col items-start justify-center rounded-[var(--radius-card)] bg-surface px-5 py-3 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="manage.pick(m)"
              >
                <span class="text-[22px] font-semibold break-words text-ink">{{ m.householdName }}</span> <span class="text-[18px] text-ink-3">{{ roleLabel(m.role) }}</span>
              </button>
            </li>
          </ul>
          <div>
            <RButton variant="secondary" @click="manage.signOut()">Sign out</RButton>
          </div>
        </div>

        <!-- No households -->
        <div v-else-if="phase === 'none'" class="flex flex-col gap-4">
          <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
          <h1 tabindex="-1" data-manage-heading class="text-[32px] font-semibold text-ink outline-none">No households</h1>
          <p class="text-[18px] text-ink-2">This account isn’t a member of any household.</p>
          <div>
            <RButton variant="secondary" @click="manage.signOut()">Sign out</RButton>
          </div>
        </div>

        <!-- One household open -->
        <div v-else-if="phase === 'ready' && selected && adult" :key="selected.membershipId" class="flex flex-col gap-10">
          <header class="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] bg-surface px-5 py-4">
            <RAvatar :name="selected.displayName" :color="selected.color" :size="48" />
            <div class="flex min-w-0 flex-1 basis-[11rem] flex-col">
              <h1 tabindex="-1" data-manage-heading class="text-[28px] font-semibold break-words text-ink outline-none">{{ selected.householdName }}</h1>
              <p class="text-[18px] text-ink-2">Signed in as {{ selected.displayName }} · {{ roleLabel(selected.role) }}</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <RButton v-if="memberships.length > 1" variant="secondary" @click="manage.switchHousehold">Switch household</RButton>
              <RButton variant="secondary" @click="manage.signOut()">Sign out</RButton>
            </div>
          </header>

          <p v-if="notice" role="status" class="-mt-6 text-[18px] font-medium text-green-deep">{{ notice }}</p>

          <template v-if="ownerHost">
            <slot v-if="calendarsSlotProps" name="calendars" v-bind="calendarsSlotProps" />
            <DisplaysSection :host="ownerHost" />
            <MembersSection :host="ownerHost" />

            <section aria-labelledby="manage-export-title" class="flex flex-col gap-5">
              <h2 id="manage-export-title" class="text-[32px] font-semibold text-ink">Export</h2>
              <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
                <p class="text-[18px] text-ink-2">
                  A copy of everything in {{ selected.householdName }}: one spreadsheet file per log, plus all data and photos. The
                  download link is emailed to you.
                </p>
                <p v-if="exportError" role="alert" class="text-[18px] text-warn-ink">{{ exportError }}</p>
                <div>
                  <RButton
                    variant="secondary"
                    :disabled="!onRequestExport || ownerHost.gate.busy.value || offline"
                    @click="requestExport"
                  >
                    {{ onRequestExport ? 'Export household data' : 'Export household data — coming in the next step' }}
                  </RButton>
                </div>
              </div>
            </section>

            <DeleteHouseholdSection :host="ownerHost" />
          </template>

          <MyAccountSection v-else-if="accountHost" :host="accountHost">
            <template #calendars>
              <slot v-if="calendarsSlotProps" name="calendars" v-bind="calendarsSlotProps" />
            </template>
          </MyAccountSection>
        </div>
      </template>
    </div>
  </main>
</template>
