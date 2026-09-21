<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RCodeInput from '@/ui/RCodeInput.vue'
import RInput from '@/ui/RInput.vue'
import { useReloadHold } from '@/app/reloadHolds'
import { disposeAdultClient, newAdultClient, sendEmailCode, verifyEmailCode } from '@/session/adultSession'
import { validateCode, validateEmail } from '../validation'
import type { WizardState } from '../wizardState'

const props = withDefaults(defineProps<{ state: WizardState; title?: string; canGoBack?: boolean }>(), {
  title: 'Sign in',
  canGoBack: true,
})
const emit = defineEmits<{ next: []; back: [] }>()

const client = newAdultClient()
// Once a session is produced, the wizard owns the client (and ends it); until then this step does.
let producedSession = false
const phase = ref<'email' | 'code'>('email')
const code = ref('')
const isDev = import.meta.env.DEV
// Waiting for an emailed code can take minutes without a touch; even a critical app update waits (spec §5.8).
useReloadHold('signIn')

async function sendCode() {
  props.state.error = validateEmail(props.state.email)
  if (props.state.error) return
  props.state.busy = true
  try {
    await sendEmailCode(client, props.state.email.trim())
    phase.value = 'code'
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}

async function verify() {
  props.state.error = validateCode(code.value)
  if (props.state.error) return
  props.state.busy = true
  try {
    props.state.adult = await verifyEmailCode(client, props.state.email.trim(), code.value.trim())
    producedSession = true
    emit('next')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}

onBeforeUnmount(() => {
  if (!producedSession) void disposeAdultClient(client)
})
</script>

<template>
  <WizardFrame :title="title" :error="state.error" :can-go-back="canGoBack" @back="emit('back')">
    <template v-if="phase === 'email'">
      <div class="flex flex-col gap-3">
        <RButton variant="secondary" disabled>Continue with Apple</RButton>
        <RButton variant="secondary" disabled>Continue with Google</RButton>
        <p class="text-[16px] text-ink-3">Apple and Google sign-in turn on before launch.</p>
      </div>
      <RInput v-model="state.email" label="Email" type="email" inputmode="email" autocomplete="off" :maxlength="254" />
      <RButton :disabled="state.busy" @click="sendCode">Email me a 6-digit code</RButton>
    </template>
    <template v-else>
      <p class="text-[20px] text-ink-2">We sent a code to <strong>{{ state.email }}</strong>.</p>
      <RCodeInput v-model="code" label="6-digit code" autocomplete="one-time-code" @submit="verify" />
      <p v-if="isDev" class="text-[16px] text-ink-3">Local dev: read the code at http://127.0.0.1:55324</p>
      <div class="flex gap-3">
        <RButton :disabled="state.busy" @click="verify">Sign in</RButton>
        <RButton variant="ghost" @click="phase = 'email'">Use a different email</RButton>
      </div>
    </template>
  </WizardFrame>
</template>
