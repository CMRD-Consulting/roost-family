<script setup lang="ts">
/**
 * Settings > Children (spec §7.9): profile, night-sleep window and age-based feature overrides. One child's
 * edit panel is open at a time; "Add child" has its own small panel above the list.
 */
import { computed, ref } from 'vue'
import { useNow } from '@/composables/useNow'
import { ageInMonths, isFeatureEnabled } from '@/domain/ageDefaults'
import { householdDate } from '@/domain/time'
import type { Feature } from '@/domain/types'
import { ageLabel } from '@/features/main/mainScreenModel'
import { useHouseholdStore } from '@/stores/householdStore'
import { PERSON_COLORS } from '@/ui/personPalette'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import {
  childEditFormFrom, emptyAddChildForm, toAddChildInput, toUpdateChildInput, validateAddChildForm,
  validateChildEditForm, type AddChildForm, type AddChildFormErrors, type ChildEditForm, type ChildEditFormErrors,
} from '../childForm'
import ColorPicker from '../forms/ColorPicker.vue'
import SaveRow from '../forms/SaveRow.vue'
import TextAreaField from '../forms/TextAreaField.vue'
import TimeField from '../forms/TimeField.vue'
import ToggleField from '../forms/ToggleField.vue'
import TriStateToggle from '../forms/TriStateToggle.vue'
import { useSettingsSave } from '../useSettingsSave'

const MAX_CHILDREN = 8
const NOTE_MAX = 1000

const store = useHouseholdStore()
const now = useNow(60_000)

const today = computed(() => (store.view ? householdDate(now.value, store.view.household.timeZone) : ''))
const children = computed(() => (store.view ? [...store.view.children].sort((a, b) => a.sortOrder - b.sortOrder) : []))

function age(birthday: string): string {
  return today.value ? ageLabel(ageInMonths(birthday, today.value)) : ''
}

// ─── Add child ─────────────────────────────────────────────────────────────
const adding = ref(false)
const addForm = ref<AddChildForm>(emptyAddChildForm(PERSON_COLORS[0]))
const addErrors = ref<AddChildFormErrors>({})
const { saving: addSaving, saved: addSaved, error: addError, offline: addOffline, save: saveAdd } = useSettingsSave()

function startAdding(): void {
  selectedChildId.value = null
  const used = new Set(children.value.map((c) => c.color))
  addForm.value = emptyAddChildForm(PERSON_COLORS.find((c) => !used.has(c)) ?? PERSON_COLORS[0]!)
  addErrors.value = {}
  adding.value = true
}

async function submitAdd(): Promise<void> {
  addErrors.value = validateAddChildForm(addForm.value, today.value)
  if (Object.keys(addErrors.value).length > 0) return
  const ok = await saveAdd((api, auth) => api.addChild(auth, toAddChildInput(addForm.value)))
  if (ok) adding.value = false
}

// ─── Edit child ────────────────────────────────────────────────────────────
const selectedChildId = ref<string | null>(null)
const selectedChild = computed(() => children.value.find((c) => c.id === selectedChildId.value) ?? null)
const editForm = ref<ChildEditForm | null>(null)
const editErrors = ref<ChildEditFormErrors>({})
const { saving: editSaving, saved: editSaved, error: editError, offline: editOffline, save: saveEdit } = useSettingsSave()

function edit(childId: string): void {
  const child = children.value.find((c) => c.id === childId)
  if (!child || !store.view) return
  adding.value = false
  selectedChildId.value = childId
  editForm.value = childEditFormFrom(child, store.view.household.defaultNightSleep)
  editErrors.value = {}
}

function cancelEdit(): void {
  selectedChildId.value = null
  editForm.value = null
}

const FEATURES: Feature[] = ['wakeWindow', 'feeding', 'kidsCorner', 'diaper']

const featureRows = computed<{ feature: Feature; label: string }[]>(() => {
  const rows: { feature: Feature; label: string }[] = [
    { feature: 'wakeWindow', label: 'Wake window & sleep log' },
    { feature: 'feeding', label: 'Feeding' },
    { feature: 'kidsCorner', label: "Kids' Corner" },
  ]
  if (store.view?.household.diaperLogEnabled) rows.push({ feature: 'diaper', label: 'Diaper log' })
  return rows
})

function computedDefault(feature: Feature): boolean {
  if (!selectedChild.value || !store.view) return false
  return isFeatureEnabled(feature, {
    birthday: selectedChild.value.birthday,
    today: today.value,
    overrides: {},
    diaperLogEnabled: store.view.household.diaperLogEnabled,
  })
}

function overrideValue(feature: Feature): boolean | null {
  return editForm.value?.overrides[feature] ?? null
}

function setOverride(feature: Feature, value: boolean | null): void {
  if (!editForm.value) return
  const overrides = { ...editForm.value.overrides }
  if (value === null) delete overrides[feature]
  else overrides[feature] = value
  editForm.value = { ...editForm.value, overrides }
}

async function submitEdit(): Promise<void> {
  const child = selectedChild.value
  const form = editForm.value
  if (!child || !form) return
  editErrors.value = validateChildEditForm(form, today.value)
  if (Object.keys(editErrors.value).length > 0) return
  const ok = await saveEdit((api, auth) => api.updateChild(auth, toUpdateChildInput(child.id, form)))
  if (!ok) return
  for (const feature of FEATURES) {
    const next = form.overrides[feature] ?? null
    const prev = child.overrides[feature] ?? null
    if (next !== prev) await saveEdit((api, auth) => api.setFeatureOverride(auth, child.id, feature, next))
  }
}
</script>

<template>
  <section aria-labelledby="settings-children-title" class="flex flex-col gap-5">
    <div class="flex items-center justify-between gap-4">
      <h2 id="settings-children-title" class="text-[32px] font-semibold text-ink">Children</h2>
      <RButton v-if="!adding && children.length < MAX_CHILDREN" variant="primary" @click="startAdding">+ Add child</RButton>
    </div>

    <div v-if="adding" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[20px] font-semibold text-ink">Add a child</h3>
      <div class="flex flex-col gap-2">
        <RInput v-model="addForm.name" label="Name" autocomplete="off" :maxlength="40" />
        <p v-if="addErrors.name" class="text-[18px] text-warn-ink">{{ addErrors.name }}</p>
      </div>
      <div class="flex flex-col gap-2">
        <RInput v-model="addForm.birthday" label="Birthday" type="date" />
        <p v-if="addErrors.birthday" class="text-[18px] text-warn-ink">{{ addErrors.birthday }}</p>
      </div>
      <ColorPicker v-model="addForm.color" label="Color" />
      <div class="flex items-center gap-4">
        <RButton variant="secondary" @click="adding = false">Cancel</RButton>
        <SaveRow :saving="addSaving" :saved="addSaved" :error="addError" :disabled="addOffline" @save="submitAdd" />
      </div>
    </div>

    <ul class="flex flex-col gap-3">
      <li v-for="child in children" :key="child.id" class="flex items-center gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-4">
        <RAvatar :name="child.name" :color="child.color" :size="56" decorative />
        <div class="flex flex-1 flex-col">
          <span class="text-[22px] font-medium text-ink">{{ child.name }}</span>
          <span class="text-[18px] text-ink-3">{{ age(child.birthday) }}</span>
        </div>
        <RButton variant="secondary" @click="edit(child.id)">Edit {{ child.name }}</RButton>
      </li>
    </ul>

    <div v-if="editForm && selectedChild" class="flex flex-col gap-5 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[24px] font-semibold text-ink">Edit {{ selectedChild.name }}</h3>

      <div class="flex flex-col gap-2">
        <RInput v-model="editForm.name" label="Name" autocomplete="off" :maxlength="40" />
        <p v-if="editErrors.name" class="text-[18px] text-warn-ink">{{ editErrors.name }}</p>
      </div>
      <div class="flex flex-col gap-2">
        <RInput v-model="editForm.birthday" label="Birthday" type="date" />
        <p v-if="editErrors.birthday" class="text-[18px] text-warn-ink">{{ editErrors.birthday }}</p>
      </div>
      <ColorPicker v-model="editForm.color" label="Color" />
      <TextAreaField v-model="editForm.allergies" label="Allergies" :maxlength="NOTE_MAX" />
      <TextAreaField v-model="editForm.foodRules" label="Food rules" :maxlength="NOTE_MAX" />

      <fieldset class="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4">
        <legend class="float-left text-[20px] font-medium text-ink">Night-sleep window</legend>
        <ToggleField v-model="editForm.useHouseholdNightSleep" label="Use the household default" />
        <div v-if="!editForm.useHouseholdNightSleep" class="clear-left grid grid-cols-2 gap-4">
          <TimeField v-model="editForm.nightSleepStart" label="Night from" />
          <TimeField v-model="editForm.nightSleepEnd" label="To" />
        </div>
        <p v-if="editErrors.nightSleep" class="clear-left text-[18px] text-warn-ink">{{ editErrors.nightSleep }}</p>
      </fieldset>

      <fieldset class="flex flex-col gap-4 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4">
        <legend class="float-left text-[20px] font-medium text-ink">Feature overrides</legend>
        <p class="clear-left text-[18px] text-ink-3">
          Defaults are based on {{ selectedChild.name }}’s age. An override sticks until you clear it.
        </p>
        <div v-for="row in featureRows" :key="row.feature" :data-testid="`override-${row.feature}`">
          <TriStateToggle
            :label="row.label"
            :computed-default="computedDefault(row.feature)"
            :model-value="overrideValue(row.feature)"
            @update:model-value="setOverride(row.feature, $event)"
          />
        </div>
      </fieldset>

      <div class="flex items-center gap-4">
        <RButton variant="secondary" @click="cancelEdit">Cancel</RButton>
        <SaveRow :saving="editSaving" :saved="editSaved" :error="editError" :disabled="editOffline" @save="submitEdit" />
      </div>
    </div>
  </section>
</template>
