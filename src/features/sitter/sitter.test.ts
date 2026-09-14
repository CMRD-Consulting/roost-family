import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CareInfoPanel from './CareInfoPanel.vue'
import SitterSummary from './SitterSummary.vue'
import type { CareInfoModel, SummaryModel } from './sitterModel'

describe('CareInfoPanel', () => {
  const model: CareInfoModel = {
    sections: [
      { title: "Today's routine", body: 'Ivy: Nap\nTheo: No routine today' },
      { title: 'Where things are', body: 'Spare diapers: hall closet' },
    ],
  }

  it('shows a "Care info" heading and each section with its body kept on separate lines', () => {
    const w = mount(CareInfoPanel, { props: { model } })
    const heading = w.get('h2')
    expect(heading.text()).toBe('Care info')
    expect(heading.classes()).toEqual(expect.arrayContaining(['text-[16px]', 'uppercase']))

    const sections = w.findAll('[data-testid="care-info-section"]')
    expect(sections.map((s) => s.get('h3').text())).toEqual(["Today's routine", 'Where things are'])
    expect(sections[0]!.get('h3').classes()).toEqual(expect.arrayContaining(['text-[18px]', 'font-semibold']))
    const body = sections[0]!.get('p')
    expect(body.text()).toBe('Ivy: Nap\nTheo: No routine today')
    expect(body.classes()).toEqual(expect.arrayContaining(['text-[20px]', 'whitespace-pre-line']))
    expect(w.get('[data-testid="care-info"]').classes()).toContain('overflow-y-auto')
  })

  it('says so when there is nothing to show', () => {
    const w = mount(CareInfoPanel, { props: { model: { sections: [] } } })
    expect(w.text()).toContain('No care notes yet')
  })
})

describe('SitterSummary', () => {
  const model: SummaryModel = {
    title: 'While you were out',
    sitterName: 'Jess',
    rangeLabel: '5:30 PM – 9:10 PM',
    children: [
      {
        childId: 'ivy',
        name: 'Ivy',
        color: '#C2477A',
        lines: [
          { time: '6:00 PM', icon: 'sticker', text: 'Sticker: Potty' },
          {
            time: '7:10 PM', icon: 'medicine', text: "Children's ibuprofen · 5 ml",
            flags: [{ kind: 'voided', text: 'Voided: Wrong child' }, { kind: 'warningConfirmed', text: 'Given despite a timing warning' }],
          },
        ],
      },
      { childId: 'theo', name: 'Theo', color: '#3F7CAC', lines: [] },
    ],
  }

  it('shows the title, sitter and range, and a card per child with its lines', () => {
    const w = mount(SitterSummary, { props: { model } })
    const title = w.get('h1')
    expect(title.text()).toBe('While you were out')
    expect(title.classes()).toContain('text-[44px]')
    expect(w.get('[data-testid="summary-sitter"]').text()).toBe('Jess · 5:30 PM – 9:10 PM')

    const cards = w.findAll('[data-testid="summary-child"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.get('h2').text()).toBe('Ivy')
    // The avatar is decorative next to the visible name.
    expect(cards[0]!.find('[aria-hidden="true"]').text()).toBe('I')

    const lines = cards[0]!.findAll('[data-testid="summary-line"]')
    expect(lines.map((l) => l.get('[data-testid="summary-time"]').text())).toEqual(['6:00 PM', '7:10 PM'])
    expect(lines[0]!.get('[data-testid="summary-time"]').classes()).toEqual(expect.arrayContaining(['text-[18px]', 'text-ink-3']))
    expect(lines[0]!.get('[data-testid="summary-text"]').classes()).toContain('text-[22px]')
    expect(lines[0]!.find('[data-testid="summary-flag"]').exists()).toBe(false)
    const flags = lines[1]!.findAll('[data-testid="summary-flag"]')
    expect(flags.map((f) => f.text())).toEqual(['Voided: Wrong child', 'Given despite a timing warning'])
    expect(flags[0]!.classes()).toEqual(expect.arrayContaining(['text-warn-ink', 'text-[18px]']))
    expect(flags[0]!.find('svg').exists()).toBe(true)
    expect(lines[1]!.get('[data-testid="summary-text"]').classes()).toContain('line-through')
    expect(lines[0]!.get('[data-testid="summary-text"]').classes()).not.toContain('line-through')

    expect(cards[1]!.text()).toContain('Nothing logged')
  })

  it('emits close from the 60 px Done button', async () => {
    const w = mount(SitterSummary, { props: { model } })
    const done = w.findAll('button').find((b) => b.text() === 'Done')!
    expect(done.classes()).toContain('min-h-[60px]')
    await done.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
