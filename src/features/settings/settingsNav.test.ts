import { describe, expect, it } from 'vitest'
import { DEFAULT_SECTION_ID, findSection, SETTINGS_SECTIONS } from './settingsNav'

describe('settingsNav', () => {
  it('lists every Settings section in order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Household', 'Children', 'Routines', 'Medicines', 'Stickers', 'Sitter info', 'Photos', 'Logs', 'Inbox',
      'My account', 'Members', 'Displays', 'Delete household', 'About',
    ])
  })

  it('has unique ids', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks only Members, Displays and Delete household as needing an owner sign-in', () => {
    expect(SETTINGS_SECTIONS.filter((s) => s.ownerSignIn).map((s) => s.id)).toEqual(['members', 'displays', 'delete-household'])
  })

  it('finds a section by id and falls back to Household for anything else', () => {
    expect(findSection('sitter-info').label).toBe('Sitter info')
    expect(DEFAULT_SECTION_ID).toBe('household')
    expect(findSection('nope').id).toBe('household')
    expect(findSection(undefined).id).toBe('household')
    expect(findSection(['about']).id).toBe('household')
  })
})
