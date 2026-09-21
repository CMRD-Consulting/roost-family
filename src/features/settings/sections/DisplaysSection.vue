<script setup lang="ts">
/**
 * Displays (spec §6.3, §6.4, §7.9), owners only: the household's displays with when each last checked in; rename;
 * remove (revoke) with a confirmation. Removing the tablet in use forgets the household on it and shows "This
 * display was removed". Signing the tablet in use out keeps the display (name, history, its place among the 3) for a
 * tablet to reconnect as. Adding or reconnecting a display happens on that tablet. `host` is where the section is shown (see
 * sectionHosts) and how the owner is authorised — the Settings PIN on a display, an email sign-in in a browser;
 * without one it is Settings on this display.
 */
import { computed, ref, watch } from 'vue'
import type { DisplayRow } from '@/data/settingsApi'
import { validateDisplayLabel } from '@/features/setup/validation'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import OwnerOnlyPanel from '../OwnerOnlyPanel.vue'
import { formatLastSeen } from '../ownerForms'
import { useDisplayOwnerHost, type OwnerSectionHost } from '../sectionHosts'
import { ownerActionMessage } from '../useOwnerSignIn'

const props = defineProps<{ host?: OwnerSectionHost }>()
const host = props.host ?? useDisplayOwnerHost()
const { gate, act, offline, thisDisplayId } = host

const householdName = computed(() => host.household.value?.name ?? 'this household')

const rows = ref<DisplayRow[]>([])
const loading = ref(false)
/** The list has loaded at least once for this sign-in (so an empty list means no displays). */
const loaded = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const confirmRemoveId = ref<string | null>(null)
const confirmSignOut = ref(false)

async function load(): Promise<void> {
  if (!gate.membershipId.value || !host.household.value) return
  loading.value = true
  try {
    rows.value = await act.listDisplays()
    loaded.value = true
  } catch (e) {
    error.value = ownerActionMessage(e)
  } finally {
    loading.value = false
  }
}

watch(
  gate.membershipId,
  (membershipId) => {
    rows.value = []
    loaded.value = false
    renamingId.value = null
    confirmRemoveId.value = null
    confirmSignOut.value = false
    if (membershipId) void load()
  },
  { immediate: true },
)

function startRename(row: DisplayRow): void {
  error.value = null
  notice.value = null
  confirmRemoveId.value = null
  confirmSignOut.value = false
  renamingId.value = row.displayId
  renameValue.value = row.name
}

async function saveRename(row: DisplayRow): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = validateDisplayLabel(renameValue.value)
  if (error.value) return
  const name = renameValue.value.trim()
  try {
    await act.renameDisplay(row.displayId, name)
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  renamingId.value = null
  notice.value = `Renamed to ${name}.`
  host.afterDisplayRenamed(row.displayId)
  await load()
}

function startRemove(row: DisplayRow): void {
  error.value = null
  notice.value = null
  renamingId.value = null
  confirmSignOut.value = false
  confirmRemoveId.value = row.displayId
}

function startSignOut(): void {
  error.value = null
  notice.value = null
  renamingId.value = null
  confirmRemoveId.value = null
  confirmSignOut.value = true
}

async function signOut(): Promise<void> {
  if (!act.signOutThisDisplay || gate.busy.value || offline.value) return
  error.value = null
  try {
    await act.signOutThisDisplay()
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  confirmSignOut.value = false
  await host.afterThisDisplaySignedOut()
}

async function remove(row: DisplayRow): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = null
  try {
    await act.revokeDisplay(row.displayId)
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  confirmRemoveId.value = null
  if (row.displayId === thisDisplayId.value) {
    await host.afterThisDisplayRemoved()
    return
  }
  notice.value = `${row.name} was removed from ${householdName.value}.`
  await load()
}
</script>

<template>
  <section aria-labelledby="settings-displays-title" class="flex flex-col gap-5">
    <h2 id="settings-displays-title" class="text-[32px] font-semibold text-ink">Displays</h2>

    <OwnerOnlyPanel v-if="gate.phase.value !== 'ready'" purpose="manage displays" :notice="gate.notice.value" />

    <template v-if="gate.phase.value === 'ready'">
      <p v-if="gate.demo" class="text-[18px] text-ink-3">In the demo you can rename the display. Removing displays is not available in demo.</p>
      <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

      <p v-if="loading && rows.length === 0" role="status" class="text-[20px] text-ink-2">Loading displays…</p>
      <p v-else-if="loaded && rows.length === 0" class="text-[18px] text-ink-2">No displays are set up in {{ householdName }}.</p>
      <ul class="flex flex-col gap-3" aria-label="Displays">
        <li
          v-for="row in rows"
          :key="row.displayId"
          class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-4"
          :data-testid="`display-${row.displayId}`"
        >
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex min-w-0 flex-1 basis-40 flex-col">
              <span class="flex flex-wrap items-center gap-3 text-[22px] font-semibold text-ink">
                {{ row.name }}
                <span
                  v-if="row.displayId === thisDisplayId"
                  class="rounded-full bg-orange-tint px-3 py-0.5 text-[18px] font-medium text-orange-deep"
                >This display</span>
              </span>
              <span class="text-[18px] text-ink-3">{{ row.connected ? formatLastSeen(row.lastSeenAt, new Date()) : 'Signed out' }}</span>
            </div>
            <RButton variant="secondary" :disabled="gate.busy.value || offline" @click="startRename(row)">Rename</RButton>
            <RButton
              v-if="!gate.demo && act.signOutThisDisplay && row.displayId === thisDisplayId"
              variant="secondary"
              :disabled="gate.busy.value || offline"
              @click="startSignOut"
            >Sign out</RButton>
            <RButton v-if="!gate.demo" variant="ghost" :disabled="gate.busy.value || offline" @click="startRemove(row)">Remove</RButton>
          </div>

          <div v-if="renamingId === row.displayId" class="flex flex-col gap-3 border-t border-line pt-3">
            <RInput v-model="renameValue" label="Display name" autocomplete="off" :maxlength="40" />
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :disabled="gate.busy.value" @click="renamingId = null">Cancel</RButton>
              <RButton :disabled="gate.busy.value || offline" @click="saveRename(row)">Save name</RButton>
            </div>
          </div>

          <div v-if="confirmSignOut && row.displayId === thisDisplayId" class="flex flex-col gap-3 border-t border-line pt-3">
            <p class="text-[20px] text-ink">
              Sign this tablet out? {{ row.name }} stays in {{ householdName }} with its name and history, and anything
              saved on this tablet is cleared. To bring it back, on this or another tablet, choose
              <strong>Join a household</strong> and pick {{ row.name }}.
            </p>
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :disabled="gate.busy.value" @click="confirmSignOut = false">Cancel</RButton>
              <RButton variant="danger" :disabled="gate.busy.value || offline" @click="signOut">Sign out {{ row.name }}</RButton>
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
      <h3 class="text-[22px] font-semibold text-ink">Add or reconnect a display</h3>
      <ol class="flex list-decimal flex-col gap-1 pl-6 text-[18px] text-ink-2">
        <li>Open Roost Family on the tablet and choose <strong>Join a household</strong>.</li>
        <li>An owner signs in there and picks {{ householdName }}.</li>
        <li>
          Pick the display the tablet used to be, to reconnect it with its name and history, or add it as a new one and
          name it, like “Kitchen” or “Playroom”.
        </li>
      </ol>
    </div>
  </section>
</template>
