import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { createFetchWithTimeout } from './fetchWithTimeout'

export type RoostClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const global = { fetch: createFetchWithTimeout() }

/** The tablet's own identity (anonymous user bound to a display). Persisted. */
export const displayClient: RoostClient = createClient<Database>(url, anonKey, {
  auth: { storageKey: 'roost-display', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global,
})

/** A throwaway client for a temporary adult sign-in. Never persisted. */
export function createAdultClient(): RoostClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      storageKey: `roost-adult-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global,
  })
}

/**
 * A client with no session at all, for public pages that authorize with a token of their own (the Take list
 * phone page). It never reads or writes stored sessions, so it can't pick up or disturb a display's identity.
 */
export function createAnonClient(): RoostClient {
  return createClient<Database>(url, anonKey, {
    auth: { storageKey: 'roost-anon', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global,
  })
}
