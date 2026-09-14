import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { createFetchWithTimeout } from './fetchWithTimeout'

/**
 * Clients that never read or write a stored session. Kept apart from `./supabase` (which builds the display's
 * persisted client as soon as it loads) so a page that isn't a display, like Manage household or the Take list
 * phone page, never touches the `roost-display` session just by importing these.
 */

type RoostClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const clientFetch = createFetchWithTimeout()

/** A throwaway client for a temporary adult sign-in. Never persisted. */
export function createAdultClient(): RoostClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      storageKey: `roost-adult-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { fetch: clientFetch },
  })
}

/**
 * A client with no session at all, for public pages that authorize with a token of their own (the Take list
 * phone page). It never reads or writes stored sessions, so it can't pick up or disturb a display's identity.
 */
export function createAnonClient(): RoostClient {
  return createClient<Database>(url, anonKey, {
    auth: { storageKey: 'roost-anon', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: clientFetch },
  })
}
