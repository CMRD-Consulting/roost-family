<script setup lang="ts">
/**
 * Settings > Delete household (spec §11.3), owners only after a full sign-in and a typed confirmation of the
 * household name. Every display (this one included) is removed at once and every adult loses access; the data
 * is purged within 30 days. This tablet then forgets the household and shows "This display was removed".
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import OwnerSignInPanel from '../OwnerSignInPanel.vue'
import { confirmsHouseholdName } from '../ownerForms'
import { loadSettingsApi } from '../settingsApiLoader'
import { ownerActionMessage, useOwnerSignIn } from '../useOwnerSignIn'
import { useSettingsOffline } from '../useSettingsSave'

const store = useHouseholdStore()
const display = useDisplayStore()
const router = useRouter()
const offline = useSettingsOffline()
const gate = useOwnerSignIn()

const householdName = computed(() => store.view?.household.name ?? '')
const typedName = ref('')
const error = ref<string | null>(null)
const confirmed = computed(() => confirmsHouseholdName(typedName.value, householdName.value))

async function deleteHousehold(): Promise<void> {
  const householdId = store.view?.household.id
  if (!householdId || !confirmed.value || gate.busy.value || offline.value) return
  error.value = null
  const confirmName = typedName.value.trim()
  try {
    const api = await loadSettingsApi()
    await gate.run((o) => api.deleteHousehold(o.client, householdId, confirmName))
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  gate.signOut()
  await display.markRemoved()
  await router.replace('/removed')
}
</script>

<template>
  <section aria-labelledby="settings-delete-household-title" class="flex flex-col gap-5">
    <h2 id="settings-delete-household-title" class="text-[32px] font-semibold text-ink">Delete household</h2>

    <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <p class="text-[20px] text-ink">Deleting {{ householdName }}:</p>
      <ul class="flex list-disc flex-col gap-1 pl-6 text-[18px] text-ink-2">
        <li>Removes every display right away, including this one.</li>
        <li>Ends access for every adult, and every PIN stops working.</li>
        <li>
          Erases the children’s profiles, logs, medicines, routines and all other household data within 30 days,
          including backups.
        </li>
      </ul>
      <p class="text-[18px] font-medium text-ink">This can’t be undone.</p>
    </div>

    <p v-if="gate.demo" role="status" class="text-[18px] font-medium text-ink-2">Not available in demo.</p>

    <template v-else>
      <OwnerSignInPanel :gate="gate" purpose="delete the household" />

      <div v-if="gate.phase.value === 'ready'" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <RInput v-model="typedName" :label="`Type ${householdName} to confirm`" autocomplete="off" :maxlength="80" />
        <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
        <div>
          <RButton variant="danger" :disabled="!confirmed || gate.busy.value || offline" @click="deleteHousehold">
            {{ gate.busy.value ? 'Deleting…' : `Delete ${householdName}` }}
          </RButton>
        </div>
      </div>
    </template>
  </section>
</template>
