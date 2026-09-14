<script setup lang="ts">
import { useRouter } from 'vue-router'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { completeSetup } from '../completeSetup'
import type { AdultSession } from '@/session/adultSession'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ back: [] }>()
const router = useRouter()
const displayStore = useDisplayStore()

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
  try {
    await completeSetup(props.state, adult, (token) => claimDisplay(displayClient, token))
    props.state.adult = null
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}
</script>

<template>
  <WizardFrame title="Name this display" :error="state.error" can-go-back @back="emit('back')">
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Kitchen" />
    <div class="rounded-[var(--radius-card)] bg-surface p-6 text-[18px] text-ink-2">
      <p class="font-semibold text-ink">Keep the screen on</p>
      <p><strong>iPad:</strong> Settings → Display &amp; Brightness → Auto-Lock → Never, then turn on Guided Access (Settings → Accessibility).</p>
      <p><strong>Fire tablet:</strong> open Roost Family in Fully Kiosk Browser and turn on “Keep screen on”.</p>
    </div>
    <RButton :disabled="state.busy" @click="finish">{{ state.busy ? 'Setting up…' : 'Finish setup' }}</RButton>
  </WizardFrame>
</template>
