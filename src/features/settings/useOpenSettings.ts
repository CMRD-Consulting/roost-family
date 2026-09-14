import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'

const useSettingsGateStore = defineStore('settingsGate', () => {
  const open = ref(false)
  return { open }
})

/**
 * Opens Settings from a household screen (plan 3c Decisions): `openSettings()` shows the adult PIN pad
 * rendered by `SettingsPinGate` (mount it once on the screen), which enters the settings session and routes
 * to `/settings` on a correct PIN.
 */
export function useOpenSettings() {
  const store = useSettingsGateStore()
  const { open } = storeToRefs(store)
  return {
    /** Whether the PIN pad is showing. */
    gateOpen: open,
    openSettings(): void {
      store.open = true
    },
    closeSettingsGate(): void {
      store.open = false
    },
  }
}
