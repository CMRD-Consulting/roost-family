<script setup lang="ts">
/**
 * What an owner-only Settings section shows until an owner has signed in (spec §6.3): the email-code sign-in,
 * a "checking" state, or the refusal for an account that isn't an owner. Renders nothing once signed in.
 */
import RButton from '@/ui/RButton.vue'
import AdultSignIn from './AdultSignIn.vue'
import type { OwnerSignIn } from './useOwnerSignIn'

defineProps<{ gate: OwnerSignIn; purpose: string }>()
</script>

<template>
  <p v-if="gate.notice.value" role="status" class="text-[18px] font-medium text-ink-2">{{ gate.notice.value }}</p>

  <template v-if="gate.phase.value === 'signIn'">
    <AdultSignIn
      :key="gate.signInKey.value"
      title="Sign in as an owner"
      :hint="`An owner signs in with their email to ${purpose}. The sign-in ends after 5 minutes without a touch.`"
      @signed-in="gate.onSignedIn"
      @cancel="gate.cancelSignIn"
    />
  </template>

  <div v-else-if="gate.phase.value === 'idle'" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
    <p class="text-[18px] text-ink-3">Only an owner can {{ purpose }}, after signing in with their email.</p>
    <div>
      <RButton @click="gate.startSignIn">Sign in as an owner</RButton>
    </div>
  </div>

  <p v-else-if="gate.phase.value === 'checking'" role="status" class="text-[20px] text-ink-2">Checking…</p>

  <div v-else-if="gate.phase.value === 'notOwner'" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
    <p role="alert" class="text-[20px] font-medium text-ink">Only an owner can manage this.</p>
    <div v-if="!gate.demo">
      <RButton variant="secondary" @click="gate.startSignIn">Sign in as a different adult</RButton>
    </div>
  </div>

  <p v-if="gate.error.value && gate.phase.value !== 'ready'" role="alert" class="text-[18px] text-warn-ink">{{ gate.error.value }}</p>
</template>
