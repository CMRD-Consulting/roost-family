import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type RoostClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** The tablet's own identity (anonymous user bound to a display). Persisted. */
export const displayClient: RoostClient = createClient<Database>(url, anonKey, {
  auth: { storageKey: 'roost-display', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
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
  })
}
