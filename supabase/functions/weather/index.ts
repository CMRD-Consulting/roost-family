/**
 * `weather` Edge Function (spec §5.6): refreshes a household's National Weather Service summary into
 * `public.household_weather` when the cached row is older than 30 minutes, and returns it.
 *
 * The caller's own JWT (a display's anonymous session or an adult's) decides membership through
 * `public.is_my_household`; only then does the service role read the household and write the cache.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createWeatherHandler } from './handler.ts'
import { WeatherHttpError, createNwsProvider, refreshWeather, type WeatherRow, type WeatherStore } from './refresh.ts'

const NWS_TIMEOUT_MS = 10_000
// NWS requires an identifying User-Agent.
const NWS_HEADERS = { 'User-Agent': 'RoostFamily (roost.cmrd.dev)', Accept: 'application/geo+json' }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(NWS_TIMEOUT_MS) })
  if (!res.ok) {
    await res.body?.cancel()
    throw new WeatherHttpError(res.status, url)
  }
  return await res.json()
}

const store: WeatherStore = {
  async household(householdId) {
    const { data, error } = await admin
      .from('households')
      .select('time_zone, lat, lon')
      .eq('id', householdId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? { timeZone: data.time_zone, lat: data.lat, lon: data.lon } : null
  },
  async cached(householdId) {
    const { data, error } = await admin
      .from('household_weather')
      .select(
        'household_id, fetched_at, current_temp_f, high_f, low_f, precip_chance, summary, icon, error, points_forecast_url, points_hourly_url',
      )
      .eq('household_id', householdId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data as WeatherRow | null
  },
  async save(row) {
    const { error } = await admin
      .from('household_weather')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'household_id' })
    if (error) throw new Error(error.message)
  },
}

const provider = createNwsProvider(fetchJson)

const handler = createWeatherHandler({
  async isMember(authorization, householdId) {
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data, error } = await caller.rpc('is_my_household', { p_household_id: householdId })
    if (error) {
      // An expired or foreign token is a membership failure, not a server error.
      if (error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501') return false
      throw new Error(error.message)
    }
    return data === true
  },
  refresh: (householdId, now) => refreshWeather(store, provider, householdId, now),
  now: () => new Date(),
})

Deno.serve(handler)
