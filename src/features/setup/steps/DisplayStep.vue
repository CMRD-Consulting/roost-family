<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { adultOwnsHousehold, completeSetup, isInvalidInviteError } from '../completeSetup'
import type { AdultSession } from '@/session/adultSession'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ back: [] }>()
const router = useRouter()
const displayStore = useDisplayStore()
const alreadyOwner = ref(false)

async function finish() {
  // Reactive proxies of class instances (the Supabase client inside AdultSession)
  // lose their private members in Vue's UnwrapRef type, so re-assert the plain
  // interface here rather than relying on narrowing through the reactive property.
  const adult = props.state.adult as AdultSession | null
  if (!adult) return
  if (!props.state.displayLabel.trim()) {
    props.state.error = 'Name this display.'
    return
  }
  props.state.busy = true
  props.state.error = null
  alreadyOwner.value = false
  try {
    await completeSetup(props.state, adult, (token) => claimDisplay(displayClient, token))
    props.state.adult = null
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    if (isInvalidInviteError(e) && (await adultOwnsHousehold(adult).catch(() => false))) {
      alreadyOwner.value = true
    } else {
      props.state.error = (e as Error).message
    }
  } finally {
    props.state.busy = false
  }
}

async function goToJoin() {
  const adult = props.state.adult as AdultSession | null
  props.state.adult = null
  await adult?.end()
  await router.replace('/join')
}
</script>

<template>
  <WizardFrame title="Name this display" :error="state.error" can-go-back @back="emit('back')">
    <div v-if="alreadyOwner" role="alert" class="flex flex-col gap-4 rounded-[18px] bg-orange-tint px-5 py-4 text-[18px] text-warn-ink">
      <p>You already set up a household. Use Join a household to add this tablet.</p>
      <RButton @click="goToJoin">Join a household</RButton>
    </div>
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Kitchen" />
    <div class="rounded-[var(--radius-card)] bg-surface p-6 text-[18px] text-ink-2">
      <p class="font-semibold text-ink">Keep the screen on</p>
      <p><strong>iPad:</strong> Settings → Display &amp; Brightness → Auto-Lock → Never, then turn on Guided Access (Settings → Accessibility).</p>
      <p><strong>Fire tablet:</strong> open Roost Family in Fully Kiosk Browser and turn on “Keep screen on”.</p>
    </div>
    <RButton :disabled="state.busy" @click="finish">{{ state.busy ? 'Setting up…' : 'Finish setup' }}</RButton>
  </WizardFrame>
</template>
