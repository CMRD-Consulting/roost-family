import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'
import { clearReloadHolds, hasReloadHold, holdReload, releaseReload, useReloadHold } from './reloadHolds'

afterEach(() => clearReloadHolds())

describe('reload holds', () => {
  it('tracks holds by kind until they are released', () => {
    expect(hasReloadHold('signIn')).toBe(false)
    holdReload('a', 'signIn')
    holdReload('b', 'photoUpload')
    expect(hasReloadHold('signIn')).toBe(true)
    expect(hasReloadHold('photoUpload')).toBe(true)
    releaseReload('a')
    expect(hasReloadHold('signIn')).toBe(false)
    expect(hasReloadHold('photoUpload')).toBe(true)
  })

  it('useReloadHold follows active() and releases when its scope ends', () => {
    const active = ref(false)
    const scope = effectScope()
    scope.run(() => useReloadHold('photoUpload', () => active.value))
    expect(hasReloadHold('photoUpload')).toBe(false)
    active.value = true
    expect(hasReloadHold('photoUpload')).toBe(true)
    active.value = false
    expect(hasReloadHold('photoUpload')).toBe(false)
    active.value = true
    scope.stop()
    expect(hasReloadHold('photoUpload')).toBe(false)
  })

  it('useReloadHold holds for the whole scope by default', () => {
    const scope = effectScope()
    scope.run(() => useReloadHold('signIn'))
    expect(hasReloadHold('signIn')).toBe(true)
    scope.stop()
    expect(hasReloadHold('signIn')).toBe(false)
  })
})
