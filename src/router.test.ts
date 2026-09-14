import { describe, it, expect, vi } from 'vitest'
import { isPublicRoute, resolveDisplayRoute, resolveSettingsRoute, router } from './router'

vi.mock('@/data/supabase', () => ({ displayClient: {} }))

const REGISTERED = { kind: 'registered', identity: { displayId: 'd1', householdId: 'h1', name: 'Kitchen' } } as const
const at = (requires?: 'unregistered' | 'registered' | 'revoked' | 'offline') => ({ meta: requires ? { requires } : {} })

describe('resolveDisplayRoute', () => {
  it('sends each state to its home', () => {
    expect(resolveDisplayRoute(at('registered'), { kind: 'unregistered' }, 'unregistered')).toBe('/setup')
    expect(resolveDisplayRoute(at('unregistered'), REGISTERED, 'registered')).toBe('/home')
    expect(resolveDisplayRoute(at('registered'), { kind: 'revoked' }, 'revoked')).toBe('/removed')
    expect(resolveDisplayRoute(at('registered'), REGISTERED, 'registered')).toBe(true)
  })

  it('sends an offline tablet with no known state to /offline', () => {
    expect(resolveDisplayRoute(at('registered'), { kind: 'offline' }, null)).toBe('/offline')
    expect(resolveDisplayRoute(at('unregistered'), { kind: 'offline' }, null)).toBe('/offline')
    expect(resolveDisplayRoute(at('offline'), { kind: 'offline' }, null)).toBe(true)
  })

  it('keeps a registered tablet on its screens while offline', () => {
    expect(resolveDisplayRoute(at('registered'), { kind: 'offline' }, 'registered')).toBe(true)
    expect(resolveDisplayRoute(at('unregistered'), { kind: 'offline' }, 'registered')).toBe('/offline')
  })

  it('leaves /offline once back online', () => {
    expect(resolveDisplayRoute(at('offline'), REGISTERED, 'registered')).toBe('/home')
  })
})

describe('resolveSettingsRoute', () => {
  const settings = { meta: { requires: 'registered', settingsSession: true } } as const

  it('lets /settings through only with an open settings session', () => {
    expect(resolveSettingsRoute(settings, true)).toBe(true)
    expect(resolveSettingsRoute(settings, false)).toBe('/home')
  })

  it('ignores routes that do not need a settings session', () => {
    expect(resolveSettingsRoute(at('registered'), false)).toBe(true)
    expect(resolveSettingsRoute(at(), false)).toBe(true)
  })
})

describe('public routes', () => {
  it('serves the Take list phone page at /list/:token without display guards', () => {
    const route = router.resolve('/list/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')
    expect(route.matched).toHaveLength(1)
    expect(route.params.token).toBe('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')
    expect(isPublicRoute(route)).toBe(true)
    expect(route.meta.requires).toBeUndefined()
  })

  it('treats the household screens as guarded', () => {
    expect(isPublicRoute(router.resolve('/home'))).toBe(false)
    expect(isPublicRoute(router.resolve('/setup'))).toBe(false)
  })
})
