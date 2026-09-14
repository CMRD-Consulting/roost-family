<script setup lang="ts">
import { computed, ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { validateHousehold } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const locating = ref(false)
const zones = computed(() => Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Pacific/Honolulu')))

function useLocation() {
  if (!navigator.geolocation) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      props.state.lat = Math.round(pos.coords.latitude * 1000) / 1000
      props.state.lon = Math.round(pos.coords.longitude * 1000) / 1000
      locating.value = false
    },
    () => {
      error.value = 'Couldn’t get this tablet’s location. Weather can be set up later.'
      locating.value = false
    },
  )
}

function submit() {
  error.value = validateHousehold(props.state)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Your household" :error="error" can-go-back @back="emit('back')">
    <RInput v-model="state.householdName" label="Household name" placeholder="The Riveras" />
    <RInput v-model="state.zip" label="ZIP code" inputmode="numeric" placeholder="28202" />
    <label class="flex flex-col gap-2">
      <span class="text-[18px] font-medium text-ink-2">Time zone</span>
      <select v-model="state.timeZone" class="min-h-[56px] rounded-[var(--radius-control)] border border-line bg-surface px-4 text-[22px]">
        <option v-for="z in zones" :key="z" :value="z">{{ z.replace('_', ' ') }}</option>
      </select>
    </label>
    <div class="flex items-center gap-4">
      <RButton variant="secondary" :disabled="locating" @click="useLocation">Use this tablet’s location for weather</RButton>
      <span v-if="state.lat !== null" class="text-[18px] text-green-deep">Location saved</span>
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
