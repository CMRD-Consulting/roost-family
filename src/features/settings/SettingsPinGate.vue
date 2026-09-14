<script setup lang="ts">
/**
 * The adult PIN pad in front of Settings (plan 3c Decisions). Mount once on a household screen and open it with
 * `useOpenSettings().openSettings()`. A correct PIN opens the settings session and routes to /settings.
 * While it's open, Night Mode waits (spec §7.7: it never interrupts a PIN pad).
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { SettingsError } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'
import { prepareSettingsSession } from './settingsApiLoader'
import { useOpenSettings } from './useOpenSettings'

const router = useRouter()
const store = useHouseholdStore()
const modes = useModesStore()
const { gateOpen, closeSettingsGate } = useOpenSettings()

const adults = computed(() => store.view?.members ?? [])

/** RPinPad's contract: true/false for a right/wrong PIN; a throw means the PIN couldn't be checked. */
async function verify(membershipId: string, pin: string): Promise<boolean> {
  const session = await prepareSettingsSession()
  try {
    await session.enter(membershipId, pin)
    return true
  } catch (e) {
    if (e instanceof SettingsError && e.code === 'auth') return false
    throw e
  }
}

function onVerified(): void {
  closeSettingsGate()
  void router.push('/settings')
}

const NIGHT_HOLD = 'settings-pin-gate'
watch(gateOpen, (open) => (open ? modes.holdNight(NIGHT_HOLD) : modes.releaseNight(NIGHT_HOLD)), { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  modes.releaseNight(NIGHT_HOLD)
  closeSettingsGate()
})
</script>

<template>
  <RSheet title="Settings" :open="gateOpen" @close="closeSettingsGate">
    <RPinPad :members="adults" :verify="verify" title="Open Settings" @verified="onVerified" @cancel="closeSettingsGate" />
  </RSheet>
</template>
