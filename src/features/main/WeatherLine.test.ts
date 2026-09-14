import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { HouseholdWeather, WeatherIcon } from '@/data/snapshot'
import WeatherLine from './WeatherLine.vue'

const weather = (over: Partial<HouseholdWeather> = {}): HouseholdWeather => ({
  fetchedAt: '2026-09-14T18:45:00.000Z',
  currentTempF: 74,
  highF: 78,
  lowF: 61,
  precipChance: 20,
  summary: 'Partly Sunny',
  icon: 'partly',
  ...over,
})

describe('WeatherLine', () => {
  it('shows the icon, the current temperature at 40 px and the details at 18 px', () => {
    const w = mount(WeatherLine, { props: { weather: weather() } })
    expect(w.get('[data-testid="weather-temp"]').text()).toBe('74°')
    expect(w.get('[data-testid="weather-temp"]').classes()).toContain('text-[40px]')
    const details = w.get('[data-testid="weather-details"]')
    expect(details.text()).toBe('H 78° · L 61° · 20% rain')
    expect(details.classes()).toContain('text-[18px]')
    expect(w.get('[data-testid="weather-icon"]').attributes('data-icon')).toBe('partly')
    // One accessible sentence rather than fragments.
    expect(w.get('[data-testid="weather"]').attributes('aria-label')).toBe('Partly Sunny, 74 degrees. High 78, low 61, 20% chance of rain.')
  })

  it('leaves out missing details', () => {
    const w = mount(WeatherLine, { props: { weather: weather({ highF: null, precipChance: null }) } })
    expect(w.get('[data-testid="weather-details"]').text()).toBe('L 61°')
    const none = mount(WeatherLine, { props: { weather: weather({ highF: null, lowF: null, precipChance: null }) } })
    expect(none.find('[data-testid="weather-details"]').exists()).toBe(false)
  })

  it('shows a 0% chance of rain', () => {
    const w = mount(WeatherLine, { props: { weather: weather({ precipChance: 0 }) } })
    expect(w.get('[data-testid="weather-details"]').text()).toBe('H 78° · L 61° · 0% rain')
  })

  it('renders nothing without weather', () => {
    const w = mount(WeatherLine, { props: { weather: null } })
    expect(w.find('[data-testid="weather"]').exists()).toBe(false)
    expect(w.text()).not.toContain('unavailable')
  })

  it('has an icon for each of the 8 kinds', () => {
    const icons: WeatherIcon[] = ['sun', 'partly', 'cloud', 'rain', 'snow', 'storm', 'fog', 'wind']
    for (const icon of icons) {
      const svg = mount(WeatherLine, { props: { weather: weather({ icon }) } }).get('[data-testid="weather-icon"]')
      expect(svg.attributes('data-icon')).toBe(icon)
      expect(svg.findAll('path, circle').length).toBeGreaterThan(0)
    }
  })
})
