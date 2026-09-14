<script setup lang="ts">
/** Settings > Sitter info (spec §7.9): the household notes shown on the Care Info panel during Sitter Mode. */
import { ref, watch } from 'vue'
import type { SitterInfo } from '@/data/snapshot'
import { useHouseholdStore } from '@/stores/householdStore'
import SaveRow from '../forms/SaveRow.vue'
import TextAreaField from '../forms/TextAreaField.vue'
import { useSettingsSave } from '../useSettingsSave'

type SitterInfoKey = keyof Required<SitterInfo>

/** Mirrored from the database check on `update_sitter_info`. */
const MAX_LENGTH = 1000

/** Grouped and titled like the Care Info panel's sections (sitterModel.careInfoModel). */
const GROUPS: { title: string; fields: { key: SitterInfoKey; label: string; hint?: string }[] }[] = [
  {
    title: 'Naps & bedtime',
    fields: [
      { key: 'napInstructions', label: 'Nap instructions' },
      { key: 'bedtime', label: 'Bedtime' },
    ],
  },
  {
    title: 'Food & allergies',
    fields: [{ key: 'foodRules', label: 'Household food rules', hint: 'Each child’s allergies and food rules are set in Children.' }],
  },
  { title: 'Emergency contacts', fields: [{ key: 'emergencyContacts', label: 'Emergency contacts' }] },
  { title: 'Pediatrician', fields: [{ key: 'pediatrician', label: 'Pediatrician' }] },
  { title: 'Address', fields: [{ key: 'address', label: 'Address' }] },
  { title: 'Where things are', fields: [{ key: 'whereThings', label: 'Where things are' }] },
]
const KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key))

const store = useHouseholdStore()
const { saving, saved, error, offline, save } = useSettingsSave()

const form = ref<Record<SitterInfoKey, string> | null>(null)

// Filled once; later realtime reloads don't overwrite what the adult is typing.
watch(
  () => store.view?.household.sitterInfo,
  (info) => {
    if (info && form.value === null) {
      form.value = Object.fromEntries(KEYS.map((k) => [k, info[k] ?? ''])) as Record<SitterInfoKey, string>
    }
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  const current = form.value
  if (current === null) return
  const info: SitterInfo = {}
  for (const key of KEYS) {
    const value = current[key].trim()
    if (value) info[key] = value
  }
  await save((api, auth) => api.updateSitterInfo(auth, info))
}
</script>

<template>
  <section aria-labelledby="settings-sitter-title" class="flex flex-col gap-5">
    <div class="flex flex-col gap-2">
      <h2 id="settings-sitter-title" class="text-[32px] font-semibold text-ink">Sitter info</h2>
      <p class="text-[18px] text-ink-3">Shown in the Care Info panel during Sitter Mode.</p>
    </div>

    <template v-if="form">
      <div v-for="group in GROUPS" :key="group.title" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 v-if="group.fields.length > 1 || group.fields[0]!.label !== group.title" class="text-[20px] font-semibold text-ink">
          {{ group.title }}
        </h3>
        <TextAreaField
          v-for="field in group.fields"
          :key="field.key"
          v-model="form[field.key]"
          :label="field.label"
          :hint="field.hint"
          :maxlength="MAX_LENGTH"
        />
      </div>

      <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline" @save="submit" />
    </template>
  </section>
</template>
