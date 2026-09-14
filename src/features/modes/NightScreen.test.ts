import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { contrastRatio } from '@/ui/contrast'
import { hexToRgb, rgbToHex } from '@/ui/colorMath'
import NightScreen from './NightScreen.vue'
import { NIGHT_DATE_ALPHA, NIGHT_GRADIENT_STOPS, NIGHT_TEXT_RGB, nightText } from './nightColors'

/** The opaque color of the night text drawn at `alpha` over `backgroundHex`. */
function over(alpha: number, backgroundHex: string): string {
  const bg = hexToRgb(backgroundHex)
  return rgbToHex(NIGHT_TEXT_RGB.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]!)) as [number, number, number])
}

/** Every stop of the night gradient, plus points between neighbouring stops. */
function gradientSamples(): string[] {
  const samples: string[] = []
  for (let s = 0; s < NIGHT_GRADIENT_STOPS.length - 1; s++) {
    const a = hexToRgb(NIGHT_GRADIENT_STOPS[s]!)
    const b = hexToRgb(NIGHT_GRADIENT_STOPS[s + 1]!)
    for (let k = 0; k <= 10; k++) samples.push(rgbToHex(a.map((c, i) => Math.round(c + ((b[i]! - c) * k) / 10)) as [number, number, number]))
  }
  return samples
}

describe('NightScreen', () => {
  it('the dim date keeps at least 3:1 contrast everywhere on the night background', () => {
    for (const bg of gradientSamples()) {
      expect(contrastRatio(over(NIGHT_DATE_ALPHA, bg), bg), `date over ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('renders the date in that color', () => {
    const wrapper = mount(NightScreen, { props: { clock: '10:00 PM', date: 'Monday, September 14' } })
    const date = wrapper.get('[data-testid="night-date"]')
    expect(date.text()).toBe('Monday, September 14')
    const [r, g, b] = NIGHT_TEXT_RGB
    expect(date.attributes('style')).toContain(`rgba(${r}, ${g}, ${b}, ${NIGHT_DATE_ALPHA})`)
    expect(nightText(NIGHT_DATE_ALPHA)).toBe(`rgba(${r}, ${g}, ${b}, ${NIGHT_DATE_ALPHA})`)
    // The gradient drawn is the one the contrast check samples (jsdom serialises the stops as rgb()).
    const style = wrapper.get('[data-testid="night-gradient"]').attributes('style')
    for (const stop of NIGHT_GRADIENT_STOPS) expect(style).toContain(`rgb(${hexToRgb(stop).join(', ')})`)
  })
})
