import type { RoostClient } from '@/data/supabase'

export type DisplaySessionClient = Pick<RoostClient, 'auth' | 'rpc'>

export interface DisplayIdentity {
  displayId: string
  householdId: string
  name: string
}

export type DisplayState =
  | { kind: 'unregistered' }
  | { kind: 'registered'; identity: DisplayIdentity }
  | { kind: 'revoked' }

/** Throws when the session or the server can't be read; callers treat that as offline, not unregistered. */
export async function loadDisplayState(client: DisplaySessionClient): Promise<DisplayState> {
  const { data, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  if (!data.session) return { kind: 'unregistered' }

  const { data: rows, error } = await client.rpc('my_display')
  if (error) throw error
  const row = rows?.[0]
  if (!row) return { kind: 'unregistered' }
  if (row.out_revoked) return { kind: 'revoked' }
  return {
    kind: 'registered',
    identity: { displayId: row.out_display_id, householdId: row.out_household_id, name: row.out_name },
  }
}

/**
 * Signs in anonymously if needed, then binds this tablet to the display registered with `token`.
 * If an earlier attempt's claim reached the server but its response was lost, the tablet is already
 * registered; that identity is returned instead of claiming again.
 */
export async function claimDisplay(client: DisplaySessionClient, token: string): Promise<DisplayIdentity> {
  const { data, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  if (data.session) {
    const current = await loadDisplayState(client)
    if (current.kind === 'registered') return current.identity
  } else {
    const { error } = await client.auth.signInAnonymously()
    if (error) throw error
  }
  const { error } = await client.rpc('claim_display', { p_token: token })
  if (error) throw error

  const state = await loadDisplayState(client)
  if (state.kind !== 'registered') throw new Error('Display claim did not register this tablet')
  return state.identity
}

/**
 * Records a heartbeat and reports whether this tablet is still an active display.
 * `'revoked'` covers a removed display, a deleted household and a device that is no longer bound.
 * Throws on network or server errors.
 */
export async function checkStillRegistered(client: DisplaySessionClient): Promise<'active' | 'revoked'> {
  const { data, error } = await client.rpc('display_heartbeat')
  if (error) throw error
  return data === true ? 'active' : 'revoked'
}

/** Forget this tablet's identity (after revocation, or to start over). */
export async function resetDisplay(client: DisplaySessionClient): Promise<void> {
  await client.auth.signOut({ scope: 'local' })
}
