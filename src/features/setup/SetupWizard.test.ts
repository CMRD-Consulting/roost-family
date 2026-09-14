import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import SetupWizard from './SetupWizard.vue'

// The wizard never reaches SignInStep in this test, but that step creates a
// Supabase client on mount, so stub the module to guarantee no real client
// (and no network) is ever constructed while these tests run.
vi.mock('@/data/supabase', () => ({
  displayClient: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
  createAdultClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
      stopAutoRefresh: vi.fn(),
    },
    rpc: vi.fn(),
  })),
}))

function mountWizard() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/join', component: { template: '<div />' } },
    ],
  })
  return mount(SetupWizard, {
    global: { plugins: [router, createPinia()] },
  })
}

describe('SetupWizard', () => {
  it('shows the Welcome screen first', () => {
    const wrapper = mountWizard()
    expect(wrapper.text()).toContain('Set up a household')
  })

  it('advances to the invite code screen after choosing to set up a household', async () => {
    const wrapper = mountWizard()
    const start = wrapper.findAll('button').find((b) => b.text() === 'Set up a household')
    expect(start).toBeTruthy()

    await start!.trigger('click')

    expect(wrapper.text()).toContain('Enter your invite code')
  })
})
