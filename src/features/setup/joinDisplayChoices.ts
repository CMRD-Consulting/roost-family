/**
 * Join a household, "Which display is this?" (spec §6.4): the household's displays a tablet can reconnect as, before
 * "Add as a new display". Reconnecting takes the display from whatever tablet holds it, so one that checked in
 * moments ago gets a warning first.
 */
import { formatLastSeen } from '@/features/settings/ownerForms'

/** A connected display that checked in within this long may still be in use on another tablet. */
export const RECENTLY_ACTIVE_MS = 10 * 60_000

export interface JoinDisplayRow {
  id: string
  name: string
  lastSeenAt: string | null
  /** A device holds it. False after Sign out this display, or a reconnect that was never finished. */
  connected: boolean
}

export interface JoinDisplayChoice {
  displayId: string
  name: string
  /** "Last seen 3 days ago", "Never checked in" or "Signed out". */
  detail: string
  recentlyActive: boolean
}

export function buildJoinDisplayChoices(rows: ReadonlyArray<JoinDisplayRow>, now: Date): JoinDisplayChoice[] {
  return rows.map((r) => ({
    displayId: r.id,
    name: r.name,
    detail: r.connected ? formatLastSeen(r.lastSeenAt, now) : 'Signed out',
    recentlyActive: r.connected && r.lastSeenAt !== null && now.getTime() - Date.parse(r.lastSeenAt) <= RECENTLY_ACTIVE_MS,
  }))
}

/** Shown before reconnecting as a recently active display. */
export function reconnectWarning(choice: JoinDisplayChoice): string {
  const when = choice.detail.replace(/^Last seen /, '')
  return `${choice.name} checked in ${when}, so a tablet may still be using it. Reconnecting signs that tablet out.`
}
