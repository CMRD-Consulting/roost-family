import { defineStore } from 'pinia'
import { ref } from 'vue'
import { displayClient } from '@/data/supabase'
import { loadDisplayState, type DisplayState } from './displaySession'

export const useDisplayStore = defineStore('display', () => {
  const state = ref<DisplayState | null>(null)

  async function refresh(): Promise<DisplayState> {
    state.value = await loadDisplayState(displayClient)
    return state.value
  }

  async function ensure(): Promise<DisplayState> {
    return state.value ?? refresh()
  }

  return { state, refresh, ensure }
})
