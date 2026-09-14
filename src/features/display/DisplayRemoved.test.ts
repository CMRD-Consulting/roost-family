import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import DisplayRemoved from './DisplayRemoved.vue'

const { resetDisplay } = vi.hoisted(() => ({ resetDisplay: vi.fn().mockResolvedValue(undefined) }))
const deviceCache = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue(undefined) }))
const offlineQueue = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/data/supabase', () => ({ displayClient: {} }))
vi.mock('@/session/displaySession', () => ({ resetDisplay }))
vi.mock('@/data/deviceCache', () => ({ createDeviceCache: () => deviceCache }))
vi.mock('@/data/offlineQueue', () => ({ createOfflineQueue: () => offlineQueue }))

async function mountRemoved() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/removed', component: DisplayRemoved },
      { path: '/setup', component: { render: () => null } },
    ],
  })
  await router.push('/removed')
  await router.isReady()
  setActivePinia(createPinia())
  return mount(DisplayRemoved, { global: { plugins: [router] } })
}

describe('DisplayRemoved', () => {
  it('clears the device cache and the offline queue on start over, before returning to setup', async () => {
    const wrapper = await mountRemoved()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(deviceCache.clear).toHaveBeenCalledTimes(1)
    expect(offlineQueue.clear).toHaveBeenCalledTimes(1)
    expect(resetDisplay).toHaveBeenCalledTimes(1)
  })
})
