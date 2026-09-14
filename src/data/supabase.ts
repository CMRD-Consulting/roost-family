import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { clientFetch } from './sessionlessClients'

export type RoostClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** The tablet's own identity (anonymous user bound to a display). Persisted. */
export const displayClient: RoostClient = createClient<Database>(url, anonKey, {
  auth: { storageKey: 'roost-display', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: clientFetch },
})

// The session-less clients live in their own module so importing them never builds `displayClient`.
export { createAdultClient, createAnonClient } from './sessionlessClients'
