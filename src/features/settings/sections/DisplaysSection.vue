<script setup lang="ts">
/**
 * Settings > Displays (spec §6.3, §6.4, §7.9), owners only after a full sign-in: the household's displays with
 * when each last checked in; rename; remove (revoke) with a confirmation. Removing the tablet in use forgets
 * the household on it and shows "This display was removed". Adding a display happens on the new tablet.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { DisplayRow } from '@/data/settingsApi'
import { validateDisplayLabel } from '@/features/setup/validation'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import OwnerSignInPanel from '../OwnerSignInPanel.vue'
import { formatLastSeen } from '../ownerForms'
import { loadSettingsApi } from '../settingsApiLoader'
import { ownerActionMessage, useOwnerSignIn } from '../useOwnerSignIn'
import { useSettingsOffline } from '../useSettingsSave'

const store = useHouseholdStore()
const display = useDisplayStore()
const router = useRouter()
const offline = useSettingsOffline()
const gate = useOwnerSignIn()

const householdName = computed(() => store.view?.household.name ?? 'this household')
const thisDisplayId = computed(() => display.identity?.displayId ?? null)

const rows = ref<DisplayRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const confirmRemoveId = ref<string | null>(null)

async function load(): Promise<void> {
  const householdId = store.view?.household.id
  if (!gate.owner.value || !householdId) return
  loading.value = true
  try {
    const api = await loadSettingsApi()
    rows.value = await gate.run((o) => api.listDisplays(o.client, householdId))
  } catch (e) {
    error.value = ownerActionMessage(e)
  } finally {
    loading.value = false
  }
}

watch(
  gate.owner,
  (owner) => {
    rows.value = []
    renamingId.value = null
    confirmRemoveId.value = null
    if (owner) void load()
  },
  { immediate: true },
)

function startRename(row: DisplayRow): void {
  error.value = null
  notice.value = null
  confirmRemoveId.value = null
  renamingId.value = row.displayId
  renameValue.value = row.name
}

async function saveRename(row: DisplayRow): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = validateDisplayLabel(renameValue.value)
  if (error.value) return
  const name = renameValue.value.trim()
  try {
    const api = await loadSettingsApi()
    await gate.run((o) => api.renameDisplay(o.client, row.displayId, name))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  renamingId.value = null
  notice.value = `Renamed to ${name}.`
  // This tablet's own name shows elsewhere; pick the new one up now rather than at the next check-in.
  if (row.displayId === thisDisplayId.value && !gate.demo) void display.refresh()
  await load()
}

function startRemove(row: DisplayRow): void {
  error.value = null
  notice.value = null
  renamingId.value = null
  confirmRemoveId.value = row.displayId
}

async function remove(row: DisplayRow): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = null
  try {
    const api = await loadSettingsApi()
    await gate.run((o) => api.revokeDisplay(o.client, row.displayId))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  confirmRemoveId.value = null
  if (row.displayId === thisDisplayId.value) {
    gate.signOut()
    await display.markRemoved()
    await router.replace('/removed')
    return
  }
  notice.value = `${row.name} was removed from ${householdName.value}.`
  await load()
}
</script>

<template>
  <section aria-labelledby="settings-displays-title" class="flex flex-col gap-5">
    <h2 id="settings-displays-title" class="text-[32px] font-semibold text-ink">Displays</h2>

    <OwnerSignInPanel :gate="gate" purpose="manage displays" />

    <template v-if="gate.phase.value === 'ready'">
      <p v-if="gate.demo" class="text-[18px] text-ink-3">In the demo you can rename the display. Removing displays is not available in demo.</p>
      <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

      <p v-if="loading && rows.length === 0" role="status" class="text-[20px] text-ink-2">Loading displays…</p>
      <ul class="flex flex-col gap-3" aria-label="Displays">
        <li
          v-for="row in rows"
          :key="row.displayId"
          class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-4"
          :data-testid="`display-${row.displayId}`"
        >
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="flex flex-wrap items-center gap-3 text-[22px] font-semibold text-ink">
                {{ row.name }}
                <span
                  v-if="row.displayId === thisDisplayId"
                  class="rounded-full bg-orange-tint px-3 py-0.5 text-[18px] font-medium text-orange-deep"
                >This display</span>
              </span>
              <span class="text-[18px] text-ink-3">{{ formatLastSeen(row.lastSeenAt, new Date()) }}</span>
            </div>
            <RButton variant="secondary" :disabled="gate.busy.value || offline" @click="startRename(row)">Rename</RButton>
            <RButton v-if="!gate.demo" variant="ghost" :disabled="gate.busy.value || offline" @click="startRemove(row)">Remove</RButton>
          </div>

          <div v-if="renamingId === row.displayId" class="flex flex-col gap-3 border-t border-line pt-3">
            <RInput v-model="renameValue" label="Display name" autocomplete="off" :maxlength="40" />
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :disabled="gate.busy.value" @click="renamingId = null">Cancel</RButton>
              <RButton :disabled="gate.busy.value || offline" @click="saveRename(row)">Save name</RButton>
            </div>
          </div>

          <div v-if="confirmRemoveId === row.displayId" class="flex flex-col gap-3 border-t border-line pt-3">
            <p class="text-[20px] text-ink">
              <template v-if="row.displayId === thisDisplayId">
                This is the display you’re using. It stops showing {{ householdName }} right away, and anything saved
                on it is cleared.
              </template>
              <template v-else>Remove {{ row.name }}? It stops showing {{ householdName }} right away.</template>
              It can be set up again with Join a household.
            </p>
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :disabled="gate.busy.value" @click="confirmRemoveId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="gate.busy.value || offline" @click="remove(row)">Remove {{ row.name }}</RButton>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[22px] font-semibold text-ink">Add a display</h3>
      <ol class="flex list-decimal flex-col gap-1 pl-6 text-[18px] text-ink-2">
        <li>Open Roost Family on the new tablet and choose <strong>Join a household</strong>.</li>
        <li>An owner signs in there and picks {{ householdName }}.</li>
        <li>Name the display, like “Kitchen” or “Playroom”.</li>
      </ol>
    </div>
  </section>
</template>
