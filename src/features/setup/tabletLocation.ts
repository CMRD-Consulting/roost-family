/** Why the tablet's location couldn't be read: no geolocation at all, or it failed (denied, timed out, unavailable). */
export class TabletLocationError extends Error {
  constructor(readonly reason: 'unavailable' | 'failed') {
    super(reason === 'unavailable' ? 'This tablet can’t share its location' : 'Couldn’t get this tablet’s location')
  }
}

const GEOLOCATION_OPTIONS: PositionOptions = { timeout: 10_000, maximumAge: 600_000 }

/** Two decimals (about 1 km) is plenty for weather and avoids storing a precise home location. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

/** The tablet's position for the household's weather (spec §5.6), rounded to 2 decimals. Gives up after 10 s. */
export function getTabletLocation(): Promise<{ lat: number; lon: number }> {
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
  if (!geolocation) return Promise.reject(new TabletLocationError('unavailable'))
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (pos) => resolve({ lat: roundCoordinate(pos.coords.latitude), lon: roundCoordinate(pos.coords.longitude) }),
      () => reject(new TabletLocationError('failed')),
      GEOLOCATION_OPTIONS,
    )
  })
}
