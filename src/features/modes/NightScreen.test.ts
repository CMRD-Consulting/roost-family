import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { contrastRatio } from '@/ui/contrast'
import { hexToRgb, rgbToHex } from '@/ui/colorMath'
import type { HouseholdPhoto } from '@/data/snapshot'
import NightScreen from './NightScreen.vue'
import NightSlideshow from './NightSlideshow.vue'
import {
  NIGHT_CLOCK_ALPHA, NIGHT_DATE_ALPHA, NIGHT_GRADIENT_STOPS, NIGHT_PHOTO_SCRIM_ALPHA, NIGHT_PHOTO_SCRIM_RGB,
  NIGHT_PHOTO_TEXT_ALPHA, NIGHT_TEXT_RGB, nightText,
} from './nightColors'

vi.mock('@/data/photosApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosApi')>()),
  loadPhotoUrlApi: async () => ({ signedUrls: async () => new Map() }),
}))

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

/** A photo pixel seen through the 60 % night scrim. */
function throughScrim(photoHex: string): string {
  const photo = hexToRgb(photoHex)
  return rgbToHex(
    NIGHT_PHOTO_SCRIM_RGB.map((c, i) => Math.round(NIGHT_PHOTO_SCRIM_ALPHA * c + (1 - NIGHT_PHOTO_SCRIM_ALPHA) * photo[i]!)) as [
      number, number, number,
    ],
  )
}

/** Photo pixels from black to white, plus fully saturated colors. */
function photoSamples(): string[] {
  const samples: string[] = []
  for (let v = 0; v <= 255; v += 15) samples.push(rgbToHex([v, v, v]))
  samples.push('#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff')
  return samples
}

const photo = (id: string, kind: HouseholdPhoto['kind'] = 'slideshow'): HouseholdPhoto => ({
  id, storagePath: `h/${id}.jpg`, kind, addedAt: '2026-09-01T12:00:00Z',
})

describe('NightScreen', () => {
  it('over any slideshow photo, the clock and date keep at least 3:1 contrast through the scrim', () => {
    for (const pixel of photoSamples()) {
      const bg = throughScrim(pixel)
      expect(contrastRatio(over(NIGHT_PHOTO_TEXT_ALPHA, bg), bg), `text over photo ${pixel}`).toBeGreaterThanOrEqual(3)
    }
    // The photo text is never dimmer than the plain night clock.
    expect(NIGHT_PHOTO_TEXT_ALPHA).toBeGreaterThanOrEqual(NIGHT_CLOCK_ALPHA)
  })

  it('with no slideshow photos, shows the clock alone (no slideshow)', () => {
    const wrapper = mount(NightScreen, { props: { clock: '10:00 PM', date: 'Monday', photos: [photo('a', 'step')], timeZone: 'UTC' } })
    expect(wrapper.findComponent(NightSlideshow).exists()).toBe(false)
  })

  it('passes only slideshow photos to the slideshow, and brightens and moves the clock while a photo shows', async () => {
    const photos = [photo('a'), photo('b', 'avatar'), photo('c')]
    const wrapper = mount(NightScreen, { props: { clock: '10:00 PM', date: 'Monday', photos, timeZone: 'America/New_York' } })
    const slideshow = wrapper.getComponent(NightSlideshow)
    expect(slideshow.props('photos').map((p: HouseholdPhoto) => p.id)).toEqual(['a', 'c'])
    expect(slideshow.props('timeZone')).toBe('America/New_York')

    const date = () => wrapper.get('[data-testid="night-date"]').attributes('style')
    expect(date()).toContain(`, ${NIGHT_DATE_ALPHA})`)
    slideshow.vm.$emit('showing', true)
    await wrapper.vm.$nextTick()
    expect(date()).toContain(`, ${NIGHT_PHOTO_TEXT_ALPHA})`)
    expect(wrapper.get('[data-testid="night-text"]').classes()).toContain('items-end')
    slideshow.vm.$emit('showing', false)
    await wrapper.vm.$nextTick()
    expect(date()).toContain(`, ${NIGHT_DATE_ALPHA})`)
  })

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
