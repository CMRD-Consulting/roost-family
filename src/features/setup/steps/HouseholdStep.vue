<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { LIMITS, validateHousehold } from '../validation'
import { detectedTimeZone, initialTimeZone, US_TIME_ZONES } from '../timeZones'
import { getTabletLocation, TabletLocationError } from '../tabletLocation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const locating = ref(false)
const showPickNote = !initialTimeZone(detectedTimeZone()).matched

async function useLocation() {
  locating.value = true
  error.value = null
  try {
    const { lat, lon } = await getTabletLocation()
    props.state.lat = lat
    props.state.lon = lon
  } catch (e) {
    error.value = e instanceof TabletLocationError && e.reason === 'unavailable'
      ? 'This tablet can’t share its location. Weather can be set up later.'
      : 'Couldn’t get this tablet’s location. Weather can be set up later.'
  } finally {
    locating.value = false
  }
}

function submit() {
  error.value = validateHousehold(props.state)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Your household" :error="error" can-go-back @back="emit('back')">
    <RInput v-model="state.householdName" label="Household name" placeholder="The Riveras" autocomplete="off" :maxlength="LIMITS.householdName" />
    <RInput v-model="state.zip" label="ZIP code" inputmode="numeric" placeholder="28202" autocomplete="off" :maxlength="LIMITS.zip" />
    <label class="flex flex-col gap-2">
      <span class="text-[18px] font-medium text-ink-2">Time zone</span>
      <span v-if="showPickNote" class="text-[18px] text-warn-ink">Pick your time zone.</span>
      <select
        v-model="state.timeZone"
        class="min-h-[56px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
      >
        <option v-for="z in US_TIME_ZONES" :key="z.id" :value="z.id">{{ z.label }}</option>
      </select>
    </label>
    <div class="flex items-center gap-4">
      <RButton variant="secondary" :disabled="locating" @click="useLocation">
        {{ locating ? 'Finding location…' : 'Use this tablet’s location for weather' }}
      </RButton>
      <span v-if="state.lat !== null" class="text-[18px] text-green-deep">Location saved</span>
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
