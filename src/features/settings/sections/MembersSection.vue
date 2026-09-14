<script setup lang="ts">
/**
 * Members (spec §6.2, §6.4, §7.9), owners only after a full sign-in: the household's adults with their role and
 * join date; remove an adult. On a display (Settings) also change a role (a household always keeps an owner) and
 * add an adult. Adding hands the tablet over: the owner picks a role and an invite is made, then the owner's
 * sign-in and the Settings session end and the new adult joins in the full-screen /join-adult flow (JoinAdultFlow).
 * `host` is where the section is shown (see sectionHosts); without one it is Settings on this display.
 */
import { computed, ref, watch } from 'vue'
import type { MemberRow } from '@/data/settingsApi'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RChips, { type ChipOption } from '@/ui/RChips.vue'
import OwnerSignInPanel from '../OwnerSignInPanel.vue'
import { formatJoined, isOnlyOwner, roleLabel } from '../ownerForms'
import { useDisplayOwnerHost, type OwnerSectionHost } from '../sectionHosts'
import { ownerActionMessage } from '../useOwnerSignIn'

type InviteRole = 'owner' | 'adult'

const props = defineProps<{ host?: OwnerSectionHost }>()
const host = props.host ?? useDisplayOwnerHost()
const { gate, offline } = host

const householdName = computed(() => host.household.value?.name ?? 'this household')
const timeZone = computed(() => host.household.value?.timeZone ?? 'UTC')

// ─── Members list ──────────────────────────────────────────────────────────
const rows = ref<MemberRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirmRemoveId = ref<string | null>(null)
/** Picking the role for a new adult, before the invite exists (still signed in as the owner). */
const addingRole = ref<InviteRole | null>(null)

async function load(): Promise<void> {
  const householdId = host.household.value?.id
  if (!gate.owner.value || !householdId) return
  loading.value = true
  try {
    const api = await host.loadApi()
    rows.value = await gate.run((o) => api.listMembers(o.client, householdId))
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
    confirmRemoveId.value = null
    addingRole.value = null
    if (owner) void load()
  },
  { immediate: true },
)

// ─── Role and removal ──────────────────────────────────────────────────────

async function changeRole(row: MemberRow, role: InviteRole): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = null
  notice.value = null
  const me = gate.owner.value?.membershipId
  try {
    const api = await host.loadApi()
    await gate.run((o) => api.setMemberRole(o.client, row.membershipId, role))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  if (row.membershipId === me && role !== 'owner') {
    gate.signOut(`You’re an adult in ${householdName.value} now. An owner manages members.`)
    return
  }
  notice.value = `${row.displayName} is now ${role === 'owner' ? 'an owner' : 'an adult'}.`
  await load()
}

async function remove(row: MemberRow): Promise<void> {
  if (gate.busy.value || offline.value) return
  error.value = null
  notice.value = null
  try {
    const api = await host.loadApi()
    await gate.run((o) => api.removeMember(o.client, row.membershipId))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  confirmRemoveId.value = null
  if (host.afterMemberRemoved(row.membershipId)) return
  notice.value = `${row.displayName} was removed from ${householdName.value}.`
  await load()
}

// ─── Add adult ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS: ChipOption[] = [
  { value: 'adult', label: 'Adult', detail: 'Everything except members, displays and deletion' },
  { value: 'owner', label: 'Owner', detail: 'Everything, including members, displays and deletion' },
]
const addingRoleChoice = computed<string | null>({
  get: () => addingRole.value,
  set: (value) => {
    if (value === 'owner' || value === 'adult') addingRole.value = value
  },
})

function startAdd(): void {
  error.value = null
  notice.value = null
  addingRole.value = 'adult'
}

async function createInvite(): Promise<void> {
  const role = addingRole.value
  const householdId = host.household.value?.id
  if (!role || !householdId || gate.busy.value || offline.value) return
  error.value = null
  let token: string
  try {
    const api = await host.loadApi()
    token = (await gate.run((o) => api.createMemberInvite(o.client, householdId, role))).token
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  await host.handOffToNewAdult({ token, role })
}
</script>

<template>
  <section aria-labelledby="settings-members-title" class="flex flex-col gap-5">
    <h2 id="settings-members-title" class="text-[32px] font-semibold text-ink">Members</h2>

    <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>

    <OwnerSignInPanel :gate="gate" purpose="manage members" />

    <template v-if="gate.phase.value === 'ready'">
      <p v-if="gate.demo" class="text-[18px] text-ink-3">
        <template v-if="host.canManageRoles">In the demo you can change roles. Adding and removing adults is not available in demo.</template>
        <template v-else>Removing adults is not available in demo.</template>
      </p>
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

      <p v-if="loading && rows.length === 0" role="status" class="text-[20px] text-ink-2">Loading members…</p>
      <ul class="flex flex-col gap-3" aria-label="Members">
        <li
          v-for="row in rows"
          :key="row.membershipId"
          class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-4"
          :data-testid="`member-${row.membershipId}`"
        >
          <div class="flex flex-wrap items-center gap-4">
            <RAvatar :name="row.displayName" :color="row.color" :size="48" decorative />
            <div class="flex min-w-0 flex-1 basis-40 flex-col">
              <span class="text-[22px] font-semibold text-ink">
                {{ row.displayName }}<span v-if="row.membershipId === gate.owner.value?.membershipId" class="text-ink-3"> (you)</span>
              </span>
              <span class="text-[18px] text-ink-3">
                {{ roleLabel(row.role) }}<template v-if="formatJoined(row.joinedAt, timeZone)"> · {{ formatJoined(row.joinedAt, timeZone) }}</template>
              </span>
            </div>
            <template v-if="host.canManageRoles && row.role !== 'caregiver'">
              <RButton
                variant="secondary"
                :disabled="gate.busy.value || offline || isOnlyOwner(rows, row.membershipId)"
                @click="changeRole(row, row.role === 'owner' ? 'adult' : 'owner')"
              >
                {{ row.role === 'owner' ? 'Make adult' : 'Make owner' }}
              </RButton>
            </template>
            <RButton
              v-if="!gate.demo && row.membershipId !== gate.owner.value?.membershipId"
              variant="ghost"
              :disabled="gate.busy.value || offline || isOnlyOwner(rows, row.membershipId)"
              @click="confirmRemoveId = row.membershipId"
            >
              Remove
            </RButton>
          </div>
          <p v-if="host.canManageRoles && isOnlyOwner(rows, row.membershipId)" class="text-[18px] text-ink-2">
            The only owner. Make another adult an owner before changing this.
          </p>
          <div v-if="confirmRemoveId === row.membershipId" class="flex flex-col gap-3 border-t border-line pt-3">
            <p class="text-[20px] text-ink">
              Remove {{ row.displayName }} from {{ householdName }}? Their PIN stops working. Past entries stay, shown
              as “{{ row.displayName }} (former member)”.
            </p>
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :disabled="gate.busy.value" @click="confirmRemoveId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="gate.busy.value || offline" @click="remove(row)">Remove {{ row.displayName }}</RButton>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="!gate.demo && host.canAddAdults" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <template v-if="addingRole">
          <h3 class="text-[22px] font-semibold text-ink">Add an adult as</h3>
          <RChips v-model="addingRoleChoice" :options="ROLE_OPTIONS" label="Role for the new adult" />
          <div class="flex flex-wrap gap-3">
            <RButton variant="secondary" :disabled="gate.busy.value" @click="addingRole = null">Cancel</RButton>
            <RButton :disabled="gate.busy.value || offline" @click="createInvite">Continue</RButton>
          </div>
        </template>
        <template v-else>
          <p class="text-[18px] text-ink-3">The new adult signs in on this tablet with their own email.</p>
          <div>
            <RButton :disabled="gate.busy.value || offline" @click="startAdd">Add adult</RButton>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>
