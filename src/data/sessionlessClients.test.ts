import { beforeEach, describe, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => [] as Array<{ url: string; key: string; options: { auth: Record<string, unknown> } }>)

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url: string, key: string, options: { auth: Record<string, unknown> }) => {
    created.push({ url, key, options })
    return { options }
  }),
}))
// Importing the session-less clients must never build (or load) the display's persisted client.
vi.mock('@/data/supabase', () => {
  throw new Error('display client module loaded')
})
vi.mock('./supabase', () => {
  throw new Error('display client module loaded')
})

const { createAdultClient, createAnonClient } = await import('./sessionlessClients')

beforeEach(() => {
  created.length = 0
})

describe('sessionlessClients', () => {
  it('builds no client just by loading', () => {
    expect(created).toEqual([])
  })

  it('makes each adult client non-persisted under its own random storage key', () => {
    createAdultClient()
    createAdultClient()
    const [a, b] = created.map((c) => c.options.auth)
    expect(a).toMatchObject({ persistSession: false, detectSessionInUrl: false })
    expect(String(a!.storageKey)).toMatch(/^roost-adult-[0-9a-f-]{36}$/)
    expect(a!.storageKey).not.toBe(b!.storageKey)
    expect(a!.storageKey).not.toBe('roost-display')
  })

  it('makes the anon client with no session at all', () => {
    createAnonClient()
    expect(created[0]!.options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, storageKey: 'roost-anon' })
  })
})
