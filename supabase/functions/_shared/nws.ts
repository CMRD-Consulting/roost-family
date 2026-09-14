/**
 * Pure parsing helpers for the National Weather Service API (api.weather.gov), spec §5.6.
 *
 * Plain TypeScript only: no Deno or browser globals (beyond the universally-available `Intl`), so this
 * module can be imported both by Vitest (Node) and by the `weather` Supabase Edge Function (Deno).
 */

export type WeatherIcon = 'sun' | 'partly' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' | 'wind'

export interface NwsPointsResponse {
  properties: {
    forecast: string
    forecastHourly: string
  }
}

export interface NwsForecastUrls {
  forecastUrl: string
  forecastHourlyUrl: string
}

export interface NwsProbabilityOfPrecipitation {
  value: number | null
  unitCode?: string
}

export interface NwsForecastPeriod {
  number: number
  name: string
  startTime: string
  endTime: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
  probabilityOfPrecipitation?: NwsProbabilityOfPrecipitation | null
  shortForecast: string
}

export interface NwsForecastResponse {
  properties: {
    periods: NwsForecastPeriod[]
  }
}

/** Same shape as the daily forecast; kept as a separate alias for callers' clarity. */
export type NwsHourlyResponse = NwsForecastResponse

export interface WeatherSummary {
  currentTempF: number | null
  highF: number | null
  lowF: number | null
  /** Max chance of precipitation (0-100) over the next 12 hours; 0 when no data is available. */
  precipChance: number
  summary: string
  icon: WeatherIcon
}

/** Extracts the per-location forecast URLs from a `/points/{lat},{lon}` response. */
export function parsePoints(json: NwsPointsResponse): NwsForecastUrls {
  const { forecast, forecastHourly } = json.properties ?? {}
  if (!forecast || !forecastHourly) {
    throw new Error('NWS points response is missing properties.forecast or properties.forecastHourly')
  }
  return { forecastUrl: forecast, forecastHourlyUrl: forecastHourly }
}

/** `now`'s calendar date in `timeZone`, as `YYYY-MM-DD` (no dependency on a date library). */
function dateKeyInTimeZone(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares like an ISO date.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

const ICON_RULES: Array<{ pattern: RegExp; icon: WeatherIcon }> = [
  { pattern: /thunderstorm|t-storm/, icon: 'storm' },
  { pattern: /snow|sleet|flurries|blizzard/, icon: 'snow' },
  { pattern: /rain|shower|drizzle/, icon: 'rain' },
  { pattern: /fog|mist|haze/, icon: 'fog' },
  { pattern: /partly|mostly sunny|mostly clear/, icon: 'partly' },
  { pattern: /sunny|clear/, icon: 'sun' },
  { pattern: /cloudy|overcast/, icon: 'cloud' },
  { pattern: /wind|breezy|gusty/, icon: 'wind' },
]

/** Maps an NWS `shortForecast` string (e.g. "Partly Cloudy", "Chance Showers") to one of our 8 icons. */
export function mapShortForecastToIcon(shortForecast: string): WeatherIcon {
  const lower = shortForecast.toLowerCase()
  for (const rule of ICON_RULES) {
    if (rule.pattern.test(lower)) return rule.icon
  }
  return 'cloud'
}

/** The period whose [startTime, endTime) contains `at`; falls back to the closest period, or undefined if empty. */
function periodCovering(periods: NwsForecastPeriod[], at: Date): NwsForecastPeriod | undefined {
  const t = at.getTime()
  const covering = periods.find((p) => Date.parse(p.startTime) <= t && t < Date.parse(p.endTime))
  if (covering) return covering
  if (periods.length === 0) return undefined
  return t < Date.parse(periods[0]!.startTime) ? periods[0] : periods[periods.length - 1]
}

/**
 * Summarizes today's weather from the daily (`dailyJson`) and hourly (`hourlyJson`) forecast responses.
 *
 * - `highF` is today's daytime period's temperature; `lowF` is tonight's. Late in the day, NWS may no
 *   longer list a daytime period for today (it already passed) — in that case `highF` is `null` and only
 *   `lowF` (tonight) is shown; the next day's daytime high is deliberately not substituted.
 * - `currentTempF` and `summary`/`icon` come from the hourly period covering `now`.
 * - `precipChance` is the max `probabilityOfPrecipitation.value` across hourly periods overlapping the
 *   next 12 hours, treating `null` values as absent (not as 0) unless every value in the window is null.
 */
export function summarize(
  dailyJson: NwsForecastResponse,
  hourlyJson: NwsHourlyResponse,
  now: Date,
  timeZone: string,
): WeatherSummary {
  const dailyPeriods = dailyJson.properties?.periods ?? []
  const hourlyPeriods = hourlyJson.properties?.periods ?? []
  const today = dateKeyInTimeZone(now, timeZone)

  const todayHigh = dailyPeriods.find((p) => p.isDaytime && dateKeyInTimeZone(new Date(p.startTime), timeZone) === today)
  const tonightLow = dailyPeriods.find((p) => !p.isDaytime && dateKeyInTimeZone(new Date(p.startTime), timeZone) === today)

  const currentPeriod = periodCovering(hourlyPeriods, now)

  const twelveHoursLater = now.getTime() + 12 * 60 * 60_000
  const precipValues = hourlyPeriods
    .filter((p) => Date.parse(p.endTime) > now.getTime() && Date.parse(p.startTime) < twelveHoursLater)
    .map((p) => p.probabilityOfPrecipitation?.value)
    .filter((v): v is number => v !== null && v !== undefined)

  return {
    currentTempF: currentPeriod?.temperature ?? null,
    highF: todayHigh?.temperature ?? null,
    lowF: tonightLow?.temperature ?? null,
    precipChance: precipValues.length > 0 ? Math.max(...precipValues) : 0,
    summary: currentPeriod?.shortForecast ?? '',
    icon: currentPeriod ? mapShortForecastToIcon(currentPeriod.shortForecast) : 'cloud',
  }
}
