<script setup lang="ts">
/**
 * Settings > Medicines (spec §7.4, §11.4): per-child tabs, each medicine's timing rule, and the disclaimer
 * that Roost Family only tracks timing and counts — parents enter every number from the label or a doctor.
 */
import { computed, ref, watch } from 'vue'
import type { Medicine } from '@/domain/types'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import SaveRow from '../forms/SaveRow.vue'
import Stepper from '../forms/Stepper.vue'
import ToggleField from '../forms/ToggleField.vue'
import {
  emptyMedicineForm, MAX_DOSES_PER_DAY, medicineFormFrom, medicineSummaryLine, MIN_INTERVAL_HOURS, toMedicineInput,
  validateMedicineForm, type MedicineForm, type MedicineFormErrors,
} from '../medicineForm'
import { useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()

const children = computed(() => (store.view ? [...store.view.children].sort((a, b) => a.sortOrder - b.sortOrder) : []))
const selectedChildId = ref<string | null>(null)

watch(
  children,
  (list) => {
    if (list.length > 0 && (selectedChildId.value === null || !list.some((c) => c.id === selectedChildId.value))) {
      selectedChildId.value = list[0]!.id
    }
  },
  { immediate: true },
)

const medicines = computed<Medicine[]>(() =>
  store.view ? store.view.medicines.filter((m) => m.childId === selectedChildId.value) : [],
)

// ─── Add / edit ────────────────────────────────────────────────────────────
const editingId = ref<string | null>(null) // null while not editing; '' means "adding new"
const form = ref<MedicineForm | null>(null)
const errors = ref<MedicineFormErrors>({})
const { saving, saved, error, offline, save } = useSettingsSave()

function startAdd(): void {
  editingId.value = ''
  form.value = emptyMedicineForm()
  errors.value = {}
}

function startEdit(medicine: Medicine): void {
  editingId.value = medicine.id
  form.value = medicineFormFrom(medicine)
  errors.value = {}
}

function cancelForm(): void {
  editingId.value = null
  form.value = null
}

async function submit(): Promise<void> {
  const childId = selectedChildId.value
  const current = form.value
  if (!childId || !current) return
  errors.value = validateMedicineForm(current)
  if (Object.keys(errors.value).length > 0) return
  const medicineId = editingId.value === '' ? null : editingId.value
  const ok = await save((api, auth) => api.upsertMedicine(auth, toMedicineInput(medicineId, childId, current)))
  if (ok) cancelForm()
}

// ─── Archive ───────────────────────────────────────────────────────────────
const archivingId = ref<string | null>(null)
const { saving: archiving, error: archiveError, save: saveArchive } = useSettingsSave()

async function confirmArchive(medicineId: string): Promise<void> {
  const ok = await saveArchive((api, auth) => api.archiveMedicine(auth, medicineId))
  if (ok) archivingId.value = null
}
</script>

<template>
  <section aria-labelledby="settings-medicines-title" class="flex flex-col gap-5">
    <h2 id="settings-medicines-title" class="text-[32px] font-semibold text-ink">Medicines</h2>
    <p class="text-[18px] text-ink-3">
      Enter intervals and maximums from the label or your doctor. Roost Family doesn’t give dosing advice.
    </p>

    <RChips v-if="children.length > 0" v-model="selectedChildId" label="Child" :options="children.map((c) => ({ value: c.id, label: c.name }))" />

    <template v-if="selectedChildId">
      <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
        <ul class="flex flex-col">
          <li v-for="medicine in medicines" :key="medicine.id" class="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
            <template v-if="archivingId === medicine.id">
              <p class="text-[20px] text-ink">Archive {{ medicine.name }}? It stays in past logs.</p>
              <div class="flex gap-3">
                <RButton variant="secondary" :disabled="archiving" @click="archivingId = null">Cancel</RButton>
                <RButton variant="danger" :disabled="archiving" @click="confirmArchive(medicine.id)">Archive</RButton>
              </div>
              <p v-if="archiveError" role="alert" class="text-[18px] text-warn-ink">{{ archiveError }}</p>
            </template>
            <div v-else class="flex items-center gap-4">
              <div class="flex flex-1 flex-col">
                <span class="text-[22px] font-medium text-ink">{{ medicine.name }}</span>
                <span class="text-[18px] text-ink-3">{{ medicineSummaryLine(medicine) }}</span>
              </div>
              <RButton variant="secondary" @click="startEdit(medicine)">Edit {{ medicine.name }}</RButton>
              <RButton variant="ghost" :aria-label="`Archive ${medicine.name}`" @click="archivingId = medicine.id">Archive</RButton>
            </div>
          </li>
          <li v-if="medicines.length === 0" class="py-3 text-[18px] text-ink-3">No medicines yet for this child.</li>
        </ul>
      </div>

      <RButton v-if="editingId === null" variant="secondary" @click="startAdd">+ Add medicine</RButton>

      <div v-if="form" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 class="text-[20px] font-semibold text-ink">{{ editingId === '' ? 'Add medicine' : 'Edit medicine' }}</h3>
        <div class="flex flex-col gap-2">
          <RInput v-model="form.name" label="Name" autocomplete="off" :maxlength="60" />
          <p v-if="errors.name" class="text-[18px] text-warn-ink">{{ errors.name }}</p>
        </div>
        <Stepper
          v-model="form.minIntervalHours" label="Minimum hours between doses"
          :min="MIN_INTERVAL_HOURS.min" :max="MIN_INTERVAL_HOURS.max" :step="MIN_INTERVAL_HOURS.step" unit="h"
        />
        <ToggleField v-model="form.hasMaxDoses" label="Set a daily maximum" hint="Optional" />
        <Stepper
          v-if="form.hasMaxDoses"
          v-model="form.maxDosesPer24h" label="Maximum doses in 24 hours"
          :min="MAX_DOSES_PER_DAY.min" :max="MAX_DOSES_PER_DAY.max" :step="MAX_DOSES_PER_DAY.step"
        />
        <div class="flex items-center gap-4">
          <RButton variant="secondary" @click="cancelForm">Cancel</RButton>
          <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline" @save="submit" />
        </div>
      </div>
    </template>
  </section>
</template>
