<script setup lang="ts">
/**
 * Settings > Household (spec §5.6, §7.9): name, ZIP, time zone, weather location, leave-by buffer, night windows and
 * the Diaper log. The weather location comes only from this tablet's location (saved on its own, right away); the ZIP
 * code doesn't set it.
 */
import { computed, ref, watch } from 'vue'
import { getTabletLocation, TabletLocationError } from '@/features/setup/tabletLocation'
import { LIMITS } from '@/features/setup/validation'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import SaveRow from '../forms/SaveRow.vue'
import Stepper from '../forms/Stepper.vue'
import TimeField from '../forms/TimeField.vue'
import ToggleField from '../forms/ToggleField.vue'
import {
  householdFormFrom, LEAVE_BY_BUFFER, timeZoneOptions, toHouseholdSettingsInput, validateHouseholdForm,
  type HouseholdForm, type HouseholdFormErrors,
} from '../householdForm'
import { useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()
const { saving, saved, error, offline, save } = useSettingsSave()

const form = ref<HouseholdForm | null>(null)
const errors = ref<HouseholdFormErrors>({})

// Filled once from the household; later realtime reloads don't overwrite what the adult is typing.
watch(
  () => store.view?.household,
  (household) => {
    if (household && form.value === null) form.value = householdFormFrom(household)
  },
  { immediate: true },
)

const zones = computed(() => timeZoneOptions(form.value?.timeZone ?? ''))

// ─── Weather location ──────────────────────────────────────────────────────
const { saving: locationSaving, error: locationSaveError, save: saveLocation } = useSettingsSave()
const locating = ref(false)
const locationError = ref<string | null>(null)
/** Set here and not yet reflected in the household view. */
const locationSavedHere = ref(false)
const locationSet = computed(() => locationSavedHere.value || store.view?.household.hasLocation === true)
watch(() => store.view?.household.hasLocation, () => (locationSavedHere.value = false))

async function useTabletLocation(): Promise<void> {
  if (locating.value || locationSaving.value || offline.value) return
  locationError.value = null
  locating.value = true
  let position: { lat: number; lon: number }
  try {
    position = await getTabletLocation()
  } catch (e) {
    locationError.value = e instanceof TabletLocationError && e.reason === 'unavailable'
      ? 'This tablet can’t share its location.'
      : 'Couldn’t get this tablet’s location. Check that location is allowed and try again.'
    return
  } finally {
    locating.value = false
  }
  if (await saveLocation((api, auth) => api.setHouseholdLocation(auth, position.lat, position.lon))) locationSavedHere.value = true
}

async function submit(): Promise<void> {
  const current = form.value
  if (current === null) return
  errors.value = validateHouseholdForm(current)
  if (Object.keys(errors.value).length > 0) return
  await save((api, auth) => api.updateHouseholdSettings(auth, toHouseholdSettingsInput(current)))
}
</script>

<template>
  <section aria-labelledby="settings-household-title" class="flex flex-col gap-5">
    <h2 id="settings-household-title" class="text-[32px] font-semibold text-ink">Household</h2>

    <template v-if="form">
      <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <div class="flex flex-col gap-2">
            <RInput v-model="form.name" label="Household name" autocomplete="off" :maxlength="LIMITS.householdName" />
            <p v-if="errors.name" class="text-[18px] text-warn-ink">{{ errors.name }}</p>
          </div>
          <div class="flex flex-col gap-2">
            <RInput v-model="form.zip" label="ZIP code" inputmode="numeric" autocomplete="off" :maxlength="LIMITS.zip" />
            <p v-if="errors.zip" class="text-[18px] text-warn-ink">{{ errors.zip }}</p>
          </div>
        </div>
        <label class="flex flex-col gap-2">
          <span class="text-[18px] font-medium text-ink-2">Time zone</span>
          <select
            v-model="form.timeZone"
            class="min-h-[56px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
          >
            <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.label }}</option>
          </select>
          <span v-if="errors.timeZone" class="text-[18px] text-warn-ink">{{ errors.timeZone }}</span>
        </label>
      </div>

      <div data-testid="weather-location" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 class="text-[20px] font-medium text-ink">Weather location</h3>
        <p class="text-[20px] font-medium" :class="locationSet ? 'text-green-deep' : 'text-ink-2'">
          {{ locationSet ? 'Weather location set' : 'Not set — weather hidden' }}
        </p>
        <p class="text-[18px] text-ink-3">Weather uses this tablet’s location, rounded to about 1 km. Changing the ZIP code doesn’t change it.</p>
        <div>
          <RButton variant="secondary" :disabled="locating || locationSaving || offline" @click="useTabletLocation">
            {{ locating ? 'Finding location…' : locationSaving ? 'Saving…' : 'Use this tablet’s location for weather' }}
          </RButton>
        </div>
        <p v-if="locationError || locationSaveError" role="alert" class="text-[18px] text-warn-ink">{{ locationError ?? locationSaveError }}</p>
      </div>

      <div class="rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <Stepper
          v-model="form.leaveByBufferMin"
          label="Leave-by buffer"
          hint="Shown for events with a location in the next 2 hours"
          :min="LEAVE_BY_BUFFER.min"
          :max="LEAVE_BY_BUFFER.max"
          :step="LEAVE_BY_BUFFER.step"
          unit="min"
          :error="errors.leaveByBufferMin"
        />
      </div>

      <fieldset class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <legend class="float-left text-[20px] font-medium text-ink">Default night-sleep window</legend>
        <p class="clear-left text-[18px] text-ink-3">A sleep starting inside this window is logged as Night; anything else is a Nap. Each child can have their own.</p>
        <div class="grid grid-cols-2 gap-4">
          <TimeField v-model="form.nightSleepStart" label="Night from" />
          <TimeField v-model="form.nightSleepEnd" label="To" />
        </div>
        <p v-if="errors.defaultNightSleep" class="text-[18px] text-warn-ink">{{ errors.defaultNightSleep }}</p>
      </fieldset>

      <fieldset class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <legend class="float-left text-[20px] font-medium text-ink">Night Mode schedule</legend>
        <p class="clear-left text-[18px] text-ink-3">The Night screen shows and sounds stay off during these hours.</p>
        <div class="grid grid-cols-2 gap-4">
          <TimeField v-model="form.nightModeStart" label="Starts" />
          <TimeField v-model="form.nightModeEnd" label="Ends" />
        </div>
        <p v-if="errors.nightMode" class="text-[18px] text-warn-ink">{{ errors.nightMode }}</p>
      </fieldset>

      <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
        <ToggleField v-model="form.diaperLogEnabled" label="Diaper log" hint="Adds a Diaper button to the log row" />
      </div>

      <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline" @save="submit" />
    </template>
  </section>
</template>
