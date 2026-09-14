<script setup lang="ts">
/**
 * A full sign-in on a temporary adult client (spec §6.3), for Settings actions a PIN isn't enough for: email →
 * 6-digit code → emits `signedIn` with the session, which the parent then owns (and must end). Until then this
 * component owns the client and disposes of it when it goes away. The session module (and so the Supabase
 * client) loads only when a sign-in actually starts.
 */
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { RoostClient } from '@/data/supabase'
import { validateCode, validateEmail } from '@/features/setup/validation'
import type { AdultSession } from '@/session/adultSession'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { useNightHold } from './useNightHold'

const props = withDefaults(
  defineProps<{
    title?: string
    hint?: string
    /** The title's heading element: h1 when this is the whole screen. */
    heading?: 'h1' | 'h3'
    /** Hold Night Mode off while the form shows (a display). A browser that isn't a display has no Night Mode. */
    holdNight?: boolean
    /** Offer Cancel (emits `cancel`). */
    cancellable?: boolean
  }>(),
  { title: 'Sign in', heading: 'h3', holdNight: true, cancellable: true },
)
const emit = defineEmits<{ signedIn: [session: AdultSession]; cancel: [] }>()

type SessionModule = typeof import('@/session/adultSession')

let sessionModule: SessionModule | null = null
let client: RoostClient | null = null
let producedSession = false
let unmounted = false

const phase = ref<'email' | 'code'>('email')
const email = ref('')
const code = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const isDev = import.meta.env.DEV
if (props.holdNight) useNightHold()
const headingEl = useTemplateRef<HTMLElement>('titleHeading')

// A new step (email → code, or back): focus its heading so a screen reader announces where the adult is.
watch(phase, async () => {
  await nextTick()
  headingEl.value?.focus()
})

async function ensureClient(): Promise<{ mod: SessionModule; client: RoostClient }> {
  sessionModule ??= await import('@/session/adultSession')
  client ??= sessionModule.newAdultClient()
  return { mod: sessionModule, client }
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.'
}

async function sendCode(): Promise<void> {
  error.value = validateEmail(email.value)
  if (error.value || busy.value) return
  busy.value = true
  try {
    const { mod, client: c } = await ensureClient()
    await mod.sendEmailCode(c, email.value.trim())
    phase.value = 'code'
  } catch (e) {
    error.value = messageOf(e)
  } finally {
    busy.value = false
  }
}

async function verify(): Promise<void> {
  error.value = validateCode(code.value)
  if (error.value || busy.value) return
  busy.value = true
  try {
    const { mod, client: c } = await ensureClient()
    const session = await mod.verifyEmailCode(c, email.value.trim(), code.value.trim())
    producedSession = true
    if (unmounted) {
      void session.end().catch(() => {})
      return
    }
    emit('signedIn', session)
  } catch (e) {
    error.value = messageOf(e)
  } finally {
    busy.value = false
  }
}

function useDifferentEmail(): void {
  phase.value = 'email'
  code.value = ''
  error.value = null
}

onBeforeUnmount(() => {
  unmounted = true
  if (!producedSession && client && sessionModule) void sessionModule.disposeAdultClient(client)
})
</script>

<template>
  <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5" data-testid="adult-sign-in">
    <component
      :is="heading"
      ref="titleHeading"
      tabindex="-1"
      data-step-heading
      class="font-semibold text-ink outline-none"
      :class="heading === 'h1' ? 'text-[32px]' : 'text-[22px]'"
    >{{ title }}</component>
    <p v-if="hint" class="text-[18px] text-ink-3">{{ hint }}</p>

    <template v-if="phase === 'email'">
      <RInput v-model="email" label="Email" type="email" inputmode="email" autocomplete="off" :maxlength="254" />
      <div class="flex flex-wrap gap-3">
        <RButton v-if="cancellable" variant="secondary" @click="emit('cancel')">Cancel</RButton>
        <RButton :disabled="busy" @click="sendCode">Email me a 6-digit code</RButton>
      </div>
    </template>
    <template v-else>
      <p class="text-[20px] text-ink-2">We sent a code to <strong>{{ email }}</strong>.</p>
      <RInput v-model="code" label="6-digit code" inputmode="numeric" autocomplete="one-time-code" :maxlength="6" />
      <p v-if="isDev" class="break-words text-[18px] text-ink-3">Local dev: read the code at http://127.0.0.1:55324</p>
      <div class="flex flex-wrap gap-3">
        <RButton v-if="cancellable" variant="secondary" @click="emit('cancel')">Cancel</RButton>
        <RButton :disabled="busy" @click="verify">Sign in</RButton>
        <RButton variant="ghost" @click="useDifferentEmail">Use a different email</RButton>
      </div>
    </template>

    <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
  </div>
</template>
