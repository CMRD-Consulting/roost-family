export type SettingsSectionId =
  | 'household'
  | 'children'
  | 'routines'
  | 'medicines'
  | 'stickers'
  | 'sitter-info'
  | 'photos'
  | 'logs'
  | 'inbox'
  | 'my-account'
  | 'members'
  | 'displays'
  | 'delete-household'
  | 'about'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
}

/** Settings sections in nav order (spec §7.9). The URL is `/settings/<id>`. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'household', label: 'Household' },
  { id: 'children', label: 'Children' },
  { id: 'routines', label: 'Routines' },
  { id: 'medicines', label: 'Medicines' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'sitter-info', label: 'Sitter info' },
  { id: 'photos', label: 'Photos' },
  { id: 'logs', label: 'Logs' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'my-account', label: 'My account' },
  { id: 'members', label: 'Members' },
  { id: 'displays', label: 'Displays' },
  { id: 'delete-household', label: 'Delete household' },
  { id: 'about', label: 'About' },
]

export const DEFAULT_SECTION_ID: SettingsSectionId = 'household'

/** The section for a route param; anything unknown (or missing) shows the first section. */
export function findSection(id: unknown): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS.find((s) => s.id === DEFAULT_SECTION_ID)!
}
