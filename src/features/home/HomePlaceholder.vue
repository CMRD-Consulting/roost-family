<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import RAvatar from '@/ui/RAvatar.vue'
import RLogo from '@/ui/RLogo.vue'
import { displayClient } from '@/data/supabase'
import { useDisplayStore } from '@/session/displayStore'
import { formatClock } from '@/domain/time'

const displayStore = useDisplayStore()
const householdName = ref('')
const timeZone = ref('UTC')
const kids = ref<{ id: string; name: string; color: string }[]>([])
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  tick = setInterval(() => (now.value = new Date()), 15_000)
  const state = displayStore.state
  if (state?.kind !== 'registered') return
  const [{ data: household }, { data: children }] = await Promise.all([
    displayClient.from('households').select('name, time_zone').eq('id', state.identity.householdId).single(),
    displayClient.from('children').select('id, name, color').order('sort_order'),
  ])
  householdName.value = household?.name ?? ''
  timeZone.value = household?.time_zone ?? 'UTC'
  kids.value = children ?? []
  await displayClient.rpc('display_heartbeat')
})

onBeforeUnmount(() => clearInterval(tick))
</script>

<template>
  <main class="flex min-h-dvh flex-col gap-10 bg-app px-10 py-9">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-3"><RLogo /><span class="text-[24px] font-medium">roost family</span></div>
      <span class="text-[18px] text-ink-3">{{ displayStore.state?.kind === 'registered' ? displayStore.state.identity.name : '' }}</span>
    </header>
    <p class="text-[132px] leading-none font-semibold tracking-tight tabular-nums">{{ formatClock(now, timeZone) }}</p>
    <h1 class="text-[32px] font-semibold">{{ householdName }} household</h1>
    <ul class="flex flex-wrap gap-6">
      <li v-for="kid in kids" :key="kid.id" class="flex items-center gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <RAvatar :name="kid.name" :color="kid.color" :size="64" />
        <span class="text-[28px] font-medium">{{ kid.name }}</span>
      </li>
    </ul>
    <p class="text-[18px] text-ink-3">The main screen arrives in Phase 2.</p>
  </main>
</template>
