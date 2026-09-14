import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTabletLocation, roundCoordinate, TabletLocationError } from './tabletLocation'

function mockGeolocation(impl: Geolocation['getCurrentPosition'] | undefined) {
  Object.defineProperty(window.navigator, 'geolocation', {
    value: impl ? { getCurrentPosition: impl } : undefined,
    configurable: true,
  })
}

afterEach(() => mockGeolocation(undefined))

describe('roundCoordinate', () => {
  it('keeps two decimals (about 1 km)', () => {
    expect(roundCoordinate(35.226944)).toBe(35.23)
    expect(roundCoordinate(-80.843124)).toBe(-80.84)
  })
})

describe('getTabletLocation', () => {
  it('resolves the rounded position, asking with a 10-second timeout', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback, _fail?: PositionErrorCallback | null, _options?: PositionOptions) =>
      ok({ coords: { latitude: 35.226944, longitude: -80.843124 } } as GeolocationPosition))
    mockGeolocation(getCurrentPosition)
    await expect(getTabletLocation()).resolves.toEqual({ lat: 35.23, lon: -80.84 })
    expect(getCurrentPosition.mock.calls[0]![2]).toMatchObject({ timeout: 10_000 })
  })

  it('rejects as unavailable when the tablet has no geolocation', async () => {
    mockGeolocation(undefined)
    await expect(getTabletLocation()).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('rejects as failed when the position cannot be read (denied or timed out)', async () => {
    mockGeolocation((_ok, fail) => fail?.({ code: 3, message: 'Timeout' } as GeolocationPositionError))
    const error = await getTabletLocation().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TabletLocationError)
    expect(error).toMatchObject({ reason: 'failed' })
  })
})
