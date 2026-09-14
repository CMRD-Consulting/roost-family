import { describe, expect, it } from 'vitest'
import {
  mapShortForecastToIcon,
  parsePoints,
  summarize,
  type NwsForecastResponse,
  type NwsPointsResponse,
} from './nws'

const TZ = 'America/New_York'

describe('parsePoints', () => {
  it('extracts the forecast and forecastHourly URLs', () => {
    const json: NwsPointsResponse = {
      properties: {
        forecast: 'https://api.weather.gov/gridpoints/RAH/64,68/forecast',
        forecastHourly: 'https://api.weather.gov/gridpoints/RAH/64,68/forecast/hourly',
      },
    }
    expect(parsePoints(json)).toEqual({
      forecastUrl: 'https://api.weather.gov/gridpoints/RAH/64,68/forecast',
      forecastHourlyUrl: 'https://api.weather.gov/gridpoints/RAH/64,68/forecast/hourly',
    })
  })

  it('throws when the response is missing the forecast URLs', () => {
    expect(() => parsePoints({ properties: {} } as unknown as NwsPointsResponse)).toThrow()
  })
})

describe('mapShortForecastToIcon', () => {
  const cases: Array<[string, string]> = [
    ['Sunny', 'sun'],
    ['Clear', 'sun'],
    ['Mostly Sunny', 'partly'],
    ['Partly Cloudy', 'partly'],
    ['Mostly Cloudy', 'cloud'],
    ['Cloudy', 'cloud'],
    ['Overcast', 'cloud'],
    ['Chance Showers', 'rain'],
    ['Rain Likely', 'rain'],
    ['Snow Showers Likely', 'snow'],
    ['Blizzard', 'snow'],
    ['Thunderstorms Likely', 'storm'],
    ['Areas Fog', 'fog'],
    ['Breezy', 'wind'],
    ['Some Unrecognized Text', 'cloud'],
  ]

  it.each(cases)('maps %s to %s', (shortForecast, icon) => {
    expect(mapShortForecastToIcon(shortForecast)).toBe(icon)
  })
})

describe('summarize', () => {
  // Charlotte-style daily forecast: "Today" (daytime, high 78) then "Tonight" (low 61), spanning
  // real NWS-shaped 12h day/night periods so date-in-timezone matching is exercised for real.
  const dailyMidday: NwsForecastResponse = {
    properties: {
      periods: [
        {
          number: 1,
          name: 'Today',
          startTime: '2026-09-14T06:00:00-04:00',
          endTime: '2026-09-14T18:00:00-04:00',
          isDaytime: true,
          temperature: 78,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 10 },
          shortForecast: 'Sunny',
        },
        {
          number: 2,
          name: 'Tonight',
          startTime: '2026-09-14T18:00:00-04:00',
          endTime: '2026-09-15T06:00:00-04:00',
          isDaytime: false,
          temperature: 61,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 5 },
          shortForecast: 'Clear',
        },
        {
          number: 3,
          name: 'Tomorrow',
          startTime: '2026-09-15T06:00:00-04:00',
          endTime: '2026-09-15T18:00:00-04:00',
          isDaytime: true,
          temperature: 80,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 20 },
          shortForecast: 'Partly Cloudy',
        },
      ],
    },
  }

  // Hourly periods from 13:00 to 02:00 (next day) local time, one per hour.
  const hourlyMidday: NwsForecastResponse = {
    properties: {
      periods: [
        {
          number: 1,
          name: '',
          startTime: '2026-09-14T13:00:00-04:00',
          endTime: '2026-09-14T14:00:00-04:00',
          isDaytime: true,
          temperature: 76,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 10 },
          shortForecast: 'Sunny',
        },
        {
          number: 2,
          name: '',
          startTime: '2026-09-14T14:00:00-04:00',
          endTime: '2026-09-14T15:00:00-04:00',
          isDaytime: true,
          temperature: 77,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: null },
          shortForecast: 'Sunny',
        },
        {
          number: 3,
          name: '',
          startTime: '2026-09-14T15:00:00-04:00',
          endTime: '2026-09-14T16:00:00-04:00',
          isDaytime: true,
          temperature: 78,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 20 },
          shortForecast: 'Partly Cloudy',
        },
        {
          number: 4,
          name: '',
          startTime: '2026-09-14T22:00:00-04:00',
          endTime: '2026-09-14T23:00:00-04:00',
          isDaytime: false,
          temperature: 65,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 45 },
          shortForecast: 'Chance Showers',
        },
        {
          number: 5,
          name: '',
          startTime: '2026-09-14T23:00:00-04:00',
          endTime: '2026-09-15T00:00:00-04:00',
          isDaytime: false,
          temperature: 63,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: null },
          shortForecast: 'Mostly Cloudy',
        },
        {
          number: 6,
          name: '',
          startTime: '2026-09-15T01:00:00-04:00',
          endTime: '2026-09-15T02:00:00-04:00',
          isDaytime: false,
          temperature: 61,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: 30 },
          shortForecast: 'Clear',
        },
      ],
    },
  }

  it('picks today\'s daytime high, tonight\'s low, and the current hour from the covering period', () => {
    // 2026-09-14T18:00:00Z = 14:00 EDT (America/New_York is UTC-4 in September).
    const now = new Date('2026-09-14T18:00:00Z')
    const result = summarize(dailyMidday, hourlyMidday, now, TZ)
    expect(result.highF).toBe(78)
    expect(result.lowF).toBe(61)
    expect(result.currentTempF).toBe(77)
    expect(result.summary).toBe('Sunny')
    expect(result.icon).toBe('sun')
  })

  it('takes the max precipitation chance over the next 12 hours, ignoring nulls', () => {
    const now = new Date('2026-09-14T18:00:00Z') // 14:00 local
    const result = summarize(dailyMidday, hourlyMidday, now, TZ)
    // Window is [14:00, 02:00 next day): periods at 15:00 (20), 22:00 (45, max), 23:00 (null), 01:00 (30).
    expect(result.precipChance).toBe(45)
  })

  it('returns 0 precipitation chance when every value in the window is null', () => {
    const allNullHourly: NwsForecastResponse = {
      properties: {
        periods: hourlyMidday.properties.periods.map((p) => ({
          ...p,
          probabilityOfPrecipitation: { value: null },
        })),
      },
    }
    const now = new Date('2026-09-14T18:00:00Z')
    expect(summarize(dailyMidday, allNullHourly, now, TZ).precipChance).toBe(0)
  })

  it('shows only tonight\'s low, not the next day\'s high, once today\'s daytime period has passed', () => {
    // Late in the day: NWS no longer lists a "Today" period, only "Tonight" onward.
    const dailyLate: NwsForecastResponse = {
      properties: {
        periods: [
          {
            number: 1,
            name: 'Tonight',
            startTime: '2026-09-14T18:00:00-04:00',
            endTime: '2026-09-15T06:00:00-04:00',
            isDaytime: false,
            temperature: 60,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 5 },
            shortForecast: 'Clear',
          },
          {
            number: 2,
            name: 'Wednesday',
            startTime: '2026-09-15T06:00:00-04:00',
            endTime: '2026-09-15T18:00:00-04:00',
            isDaytime: true,
            temperature: 82,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 15 },
            shortForecast: 'Sunny',
          },
        ],
      },
    }
    const hourlyLate: NwsForecastResponse = {
      properties: {
        periods: [
          {
            number: 1,
            name: '',
            startTime: '2026-09-14T22:00:00-04:00',
            endTime: '2026-09-14T23:00:00-04:00',
            isDaytime: false,
            temperature: 62,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 5 },
            shortForecast: 'Clear',
          },
        ],
      },
    }
    // 2026-09-15T03:00:00Z = 23:00 EDT on the 14th: still "today" in America/New_York.
    const now = new Date('2026-09-15T03:00:00Z')
    const result = summarize(dailyLate, hourlyLate, now, TZ)
    expect(result.lowF).toBe(60)
    expect(result.highF).toBeNull()
  })

  it('handles an empty hourly forecast without throwing', () => {
    const now = new Date('2026-09-14T18:00:00Z')
    const empty: NwsForecastResponse = { properties: { periods: [] } }
    const result = summarize(dailyMidday, empty, now, TZ)
    expect(result.currentTempF).toBeNull()
    expect(result.summary).toBe('')
    expect(result.icon).toBe('cloud')
    expect(result.precipChance).toBe(0)
  })
})
