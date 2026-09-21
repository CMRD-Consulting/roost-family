<script setup lang="ts">
/**
 * Delete household (spec §11.3), owners only, after a typed confirmation of the household name. Every display is
 * removed at once and every adult loses access; the data is purged within 30 days. On a display this tablet then
 * forgets the household and shows "This display was removed". `host` is where the section is shown (see
 * sectionHosts) and how the owner is authorised — the Settings PIN on a display, an email sign-in in a browser;
 * without one it is Settings on this display.
 */
import { computed, ref } from 'vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import OwnerOnlyPanel from '../OwnerOnlyPanel.vue'
import OwnerSignInPanel from '../OwnerSignInPanel.vue'
import { confirmsHouseholdName } from '../ownerForms'
import { useDisplayOwnerHost, type OwnerSectionHost } from '../sectionHosts'
import { ownerActionMessage } from '../useOwnerSignIn'

const props = defineProps<{ host?: OwnerSectionHost }>()
const host = props.host ?? useDisplayOwnerHost()
const { gate, act, offline } = host

const householdName = computed(() => host.household.value?.name ?? '')
const typedName = ref('')
const error = ref<string | null>(null)
const confirmed = computed(() => confirmsHouseholdName(typedName.value, householdName.value))

async function deleteHousehold(): Promise<void> {
  if (!host.household.value || !confirmed.value || gate.busy.value || offline.value) return
  error.value = null
  const confirmName = typedName.value.trim()
  try {
    await act.deleteHousehold(confirmName)
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  }
  await host.afterHouseholdDeleted()
}
</script>

<template>
  <section aria-labelledby="settings-delete-household-title" class="flex flex-col gap-5">
    <h2 id="settings-delete-household-title" class="text-[32px] font-semibold text-ink">Delete household</h2>

    <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <p class="text-[20px] text-ink">Deleting {{ householdName }}:</p>
      <ul class="flex list-disc flex-col gap-1 pl-6 text-[18px] text-ink-2">
        <li>Removes every display right away<template v-if="host.surface === 'display'">, including this one</template>.</li>
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
      <OwnerSignInPanel v-if="gate.signIn" :gate="gate.signIn" purpose="delete the household" />
      <OwnerOnlyPanel v-else-if="gate.phase.value !== 'ready'" purpose="delete the household" :notice="gate.notice.value" />

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
