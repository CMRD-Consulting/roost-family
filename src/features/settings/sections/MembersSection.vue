<script setup lang="ts">
/**
 * Settings > Members (spec §6.2, §6.4, §7.9), owners only after a full sign-in: the household's adults with
 * their role and join date; change a role (a household always keeps an owner); remove an adult; and add an
 * adult. Adding hands the tablet over: the owner picks a role and an invite is made, the owner's sign-in
 * ends, then the new adult signs in with their own email, agrees to the terms and health-data consent, and
 * chooses a name, color and PIN. Their sign-in ends when they've joined; the Settings PIN session stays open.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import type { MemberRow } from '@/data/settingsApi'
import ConsentChecks from '@/features/setup/ConsentChecks.vue'
import { POLICY_VERSION } from '@/features/setup/wizardState'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RChips, { type ChipOption } from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import AdultSignIn from '../AdultSignIn.vue'
import ColorPicker from '../forms/ColorPicker.vue'
import OwnerSignInPanel from '../OwnerSignInPanel.vue'
import { formatJoined, isOnlyOwner, roleLabel, validateNewMember } from '../ownerForms'
import { loadSettingsApi } from '../settingsApiLoader'
import { ownerActionMessage, useOwnerSignIn } from '../useOwnerSignIn'
import { useSettingsOffline } from '../useSettingsSave'

type InviteRole = 'owner' | 'adult'

const store = useHouseholdStore()
const session = useSettingsSessionStore()
const offline = useSettingsOffline()
const gate = useOwnerSignIn()

const householdName = computed(() => store.view?.household.name ?? 'this household')
const timeZone = computed(() => store.view?.household.timeZone ?? 'UTC')

// ─── Members list ──────────────────────────────────────────────────────────
const rows = ref<MemberRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirmRemoveId = ref<string | null>(null)
/** Picking the role for a new adult, before the invite exists (still signed in as the owner). */
const addingRole = ref<InviteRole | null>(null)

async function load(): Promise<void> {
  const householdId = store.view?.household.id
  if (!gate.owner.value || !householdId) return
  loading.value = true
  try {
    const api = await loadSettingsApi()
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
    const api = await loadSettingsApi()
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
    const api = await loadSettingsApi()
    await gate.run((o) => api.removeMember(o.client, row.membershipId))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  confirmRemoveId.value = null
  // The adult who opened Settings was just removed: their PIN no longer works, so Settings closes.
  if (row.membershipId === session.info?.membershipId) {
    session.end()
    return
  }
  notice.value = `${row.displayName} was removed from ${householdName.value}.`
  await load()
}

// ─── Add adult ─────────────────────────────────────────────────────────────
type Step = 'handoff' | 'signIn' | 'consent' | 'details'

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
const invite = shallowRef<{ token: string; role: InviteRole } | null>(null)
const step = ref<Step>('handoff')
const newAdult = shallowRef<AdultSession | null>(null)
const flowBusy = ref(false)
const flowError = ref<string | null>(null)

const agreeTerms = ref(false)
const agreeHealth = ref(false)
const newName = ref('')
const usedColors = computed(() => new Set(store.view?.members.map((m) => m.color) ?? []))
const newColor = ref<string | null>(null)
const newPin = ref('')
const newPinAgain = ref('')

function endNewAdult(): void {
  const current = newAdult.value
  newAdult.value = null
  if (current) void current.end().catch(() => {})
}

useAdultSessionIdle({
  session: () => newAdult.value,
  busy: () => flowBusy.value,
  onExpired: () => {
    newAdult.value = null
    invite.value = null
    notice.value = 'The new adult was signed out after 5 minutes without a touch. An owner can start again.'
  },
})

function startAdd(): void {
  error.value = null
  notice.value = null
  addingRole.value = 'adult'
}

async function createInvite(): Promise<void> {
  const role = addingRole.value
  const householdId = store.view?.household.id
  if (!role || !householdId || gate.busy.value || offline.value) return
  error.value = null
  let token: string
  try {
    const api = await loadSettingsApi()
    token = (await gate.run((o) => api.createMemberInvite(o.client, householdId, role))).token
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  // The owner's part is done: their sign-in ends before the new adult signs in on the same tablet.
  gate.signOut()
  addingRole.value = null
  agreeTerms.value = false
  agreeHealth.value = false
  newName.value = ''
  newColor.value = PERSON_COLORS.find((c) => !usedColors.value.has(c)) ?? PERSON_COLORS[0]
  newPin.value = ''
  newPinAgain.value = ''
  flowError.value = null
  step.value = 'handoff'
  invite.value = { token, role }
}

function cancelInvite(): void {
  endNewAdult()
  invite.value = null
  flowError.value = null
}

function onNewAdultSignedIn(signedIn: AdultSession): void {
  newAdult.value = signedIn
  flowError.value = null
  step.value = 'consent'
}

async function acceptConsent(): Promise<void> {
  const adult = newAdult.value
  if (!adult || !agreeTerms.value || !agreeHealth.value || flowBusy.value || offline.value) return
  flowError.value = null
  flowBusy.value = true
  try {
    const api = await loadSettingsApi()
    await api.recordConsent(adult.client, POLICY_VERSION)
    step.value = 'details'
  } catch (e) {
    flowError.value = ownerActionMessage(e)
  } finally {
    flowBusy.value = false
  }
}

async function join(): Promise<void> {
  const adult = newAdult.value
  const current = invite.value
  if (!adult || !current || flowBusy.value || offline.value) return
  flowError.value = validateNewMember({ name: newName.value, color: newColor.value, pin: newPin.value, pinAgain: newPinAgain.value })
  if (flowError.value) return
  const name = newName.value.trim()
  flowBusy.value = true
  try {
    const api = await loadSettingsApi()
    await api.acceptMemberInvite(adult.client, { token: current.token, displayName: name, color: newColor.value!, pin: newPin.value })
  } catch (e) {
    flowError.value = ownerActionMessage(e)
    return
  } finally {
    flowBusy.value = false
  }
  endNewAdult()
  invite.value = null
  newPin.value = ''
  newPinAgain.value = ''
  notice.value = `${name} joined ${householdName.value}.`
}
</script>

<template>
  <section aria-labelledby="settings-members-title" class="flex flex-col gap-5">
    <h2 id="settings-members-title" class="text-[32px] font-semibold text-ink">Members</h2>

    <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>

    <!-- Adding an adult: the tablet is in the new adult's hands -->
    <div v-if="invite" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5" data-testid="add-adult-flow">
      <template v-if="step === 'handoff'">
        <h3 class="text-[26px] font-semibold text-ink">Hand the tablet to the new adult</h3>
        <p class="text-[20px] text-ink-2">
          They’ll sign in with their own email, agree to the terms, and choose a name, color and PIN to join
          {{ householdName }} as {{ invite.role === 'owner' ? 'an owner' : 'an adult' }}. The invite works for 10 minutes.
        </p>
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" @click="cancelInvite">Cancel</RButton>
          <RButton @click="step = 'signIn'">I’m the new adult</RButton>
        </div>
      </template>

      <AdultSignIn
        v-else-if="step === 'signIn'"
        :title="`Sign in to join ${householdName}`"
        hint="Use your own email. You’ll be signed out when you’ve joined."
        @signed-in="onNewAdultSignedIn"
        @cancel="cancelInvite"
      />

      <template v-else-if="step === 'consent'">
        <h3 class="text-[26px] font-semibold text-ink">Your family’s information</h3>
        <ConsentChecks v-model:terms="agreeTerms" v-model:health="agreeHealth" />
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" :disabled="flowBusy" @click="cancelInvite">Cancel</RButton>
          <RButton :disabled="!agreeTerms || !agreeHealth || flowBusy || offline" @click="acceptConsent">Agree and continue</RButton>
        </div>
      </template>

      <template v-else>
        <h3 class="text-[26px] font-semibold text-ink">About you</h3>
        <RInput v-model="newName" label="Your name" autocomplete="off" :maxlength="40" />
        <ColorPicker v-model="newColor" label="Your color" />
        <RInput v-model="newPin" label="Choose a 4-digit PIN" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
        <RInput v-model="newPinAgain" label="PIN again" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" :disabled="flowBusy" @click="cancelInvite">Cancel</RButton>
          <RButton :disabled="flowBusy || offline" @click="join">{{ flowBusy ? 'Joining…' : `Join ${householdName}` }}</RButton>
        </div>
      </template>

      <p v-if="flowError && step !== 'signIn'" role="alert" class="text-[18px] text-warn-ink">{{ flowError }}</p>
    </div>

    <template v-else>
      <OwnerSignInPanel :gate="gate" purpose="manage members" />

      <template v-if="gate.phase.value === 'ready'">
        <p v-if="gate.demo" class="text-[18px] text-ink-3">In the demo you can change roles. Adding and removing adults is not available in demo.</p>
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
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-[22px] font-semibold text-ink">
                  {{ row.displayName }}<span v-if="row.membershipId === gate.owner.value?.membershipId" class="text-ink-3"> (you)</span>
                </span>
                <span class="text-[18px] text-ink-3">
                  {{ roleLabel(row.role) }}<template v-if="formatJoined(row.joinedAt, timeZone)"> · {{ formatJoined(row.joinedAt, timeZone) }}</template>
                </span>
              </div>
              <template v-if="row.role !== 'caregiver'">
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
            <p v-if="isOnlyOwner(rows, row.membershipId)" class="text-[18px] text-ink-2">
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

        <div v-if="!gate.demo" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
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
    </template>
  </section>
</template>
