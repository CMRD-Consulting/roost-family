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
  /** Needs a full sign-in of an owner, not just the PIN session (spec §6.3, §7.9). */
  ownerSignIn: boolean
}

/** Settings sections in nav order (spec §7.9). The URL is `/settings/<id>`. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'household', label: 'Household', ownerSignIn: false },
  { id: 'children', label: 'Children', ownerSignIn: false },
  { id: 'routines', label: 'Routines', ownerSignIn: false },
  { id: 'medicines', label: 'Medicines', ownerSignIn: false },
  { id: 'stickers', label: 'Stickers', ownerSignIn: false },
  { id: 'sitter-info', label: 'Sitter info', ownerSignIn: false },
  { id: 'photos', label: 'Photos', ownerSignIn: false },
  { id: 'logs', label: 'Logs', ownerSignIn: false },
  { id: 'inbox', label: 'Inbox', ownerSignIn: false },
  { id: 'my-account', label: 'My account', ownerSignIn: false },
  { id: 'members', label: 'Members', ownerSignIn: true },
  { id: 'displays', label: 'Displays', ownerSignIn: true },
  { id: 'delete-household', label: 'Delete household', ownerSignIn: true },
  { id: 'about', label: 'About', ownerSignIn: false },
]

export const DEFAULT_SECTION_ID: SettingsSectionId = 'household'

/** The section for a route param; anything unknown (or missing) shows the first section. */
export function findSection(id: unknown): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS.find((s) => s.id === DEFAULT_SECTION_ID)!
}
