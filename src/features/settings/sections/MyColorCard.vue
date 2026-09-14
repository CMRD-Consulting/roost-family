<script setup lang="ts">
/** My account > My color (spec §7.9), saved with the Settings PIN session: a display only. */
import { computed, ref } from 'vue'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import ColorPicker from '../forms/ColorPicker.vue'
import SaveRow from '../forms/SaveRow.vue'
import { useSettingsOffline, useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()
const session = useSettingsSessionStore()
const offline = useSettingsOffline()

const me = computed(() => store.view?.members.find((m) => m.id === session.info?.membershipId) ?? null)
const color = ref<string | null>(me.value?.color ?? null)
const { saving, saved, error, save } = useSettingsSave()

async function submit(): Promise<void> {
  const chosen = color.value
  if (!chosen) return
  await save((api, auth) => api.setMyColor(auth, chosen))
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
    <ColorPicker v-model="color" label="My color" />
    <p class="text-[18px] text-ink-3">Shown with your initial wherever your entries appear.</p>
    <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline || !color" @save="submit" />
  </div>
</template>
