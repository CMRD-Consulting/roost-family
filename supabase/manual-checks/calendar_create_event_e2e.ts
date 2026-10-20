/**
 * End-to-end check of `calendar-create-event` against the local stack and a stub provider (spec §5.5).
 *
 * Google and Microsoft cannot be reached without real OAuth credentials, so the only thing faked here is the
 * provider's *host*: a tiny HTTP server answers the token and `events.insert` endpoints, and the `fetch` handed to
 * `deps.ts` rewrites Google's real URLs to it. Everything else is the real thing — the real handler, the real
 * database wiring, real JWTs from the local auth server, the real `my_calendar_caller` /
 * `calendar_pin_membership` checks with a real PIN, the real Vault secret, the real `settings_audit` row and the
 * real `events_changed_at` bump. The request Google would have received is asserted byte for byte.
 *
 * The fixture is built only through paths the app itself uses (the admin API for accounts, the Edge Function's own
 * `svc_create_calendar_connection_with_selections`, and the adult's own `set_my_pin` / `set_calendar_selection`),
 * in a household of its own named "E2E calendar write …", which is deleted again at the end. It never touches an
 * existing household.
 *
 * Usage (needs `supabase start`):
 *   eval "$(supabase status -o env | sed 's/^/export /')" \
 *     && deno run --allow-net --allow-env supabase/manual-checks/calendar_create_event_e2e.ts
 *
 * `SUPABASE_URL` defaults to the local stack; `ANON_KEY` / `SERVICE_ROLE_KEY` (as `supabase status -o env` names
 * them) or `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` must be set. `GOOGLE_CLIENT_ID` and
 * `GOOGLE_CLIENT_SECRET` are set to placeholders here: the stub never checks them.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { FetchLike } from '../functions/_shared/calendarProvider.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:55321'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
if (!ANON_KEY || !SERVICE_KEY) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see `supabase status -o env`).')
  Deno.exit(2)
}

// calendarDeno.ts reads these once per isolate, so they must be in place before it is imported.
Deno.env.set('SUPABASE_URL', SUPABASE_URL)
Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
Deno.env.set('GOOGLE_CLIENT_ID', Deno.env.get('GOOGLE_CLIENT_ID') ?? 'e2e-client-id')
Deno.env.set('GOOGLE_CLIENT_SECRET', Deno.env.get('GOOGLE_CLIENT_SECRET') ?? 'e2e-client-secret')

const { createCreateEventDeps } = await import('../functions/calendar-create-event/deps.ts')
const { createCreateEventHandler } = await import('../functions/calendar-create-event/handler.ts')

const STUB_PORT = Number(Deno.env.get('STUB_PORT') ?? 8787)
const STUB = `http://127.0.0.1:${STUB_PORT}`
const TIME_ZONE = 'America/New_York'
const PIN = '4821'
const WRONG_PIN = '1111'
const PASSWORD = 'e2e-password-0124!'
/** Everything is dated from here, so the horizon checks never go stale. */
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
const NEXT_DAY = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok   ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
  }
}

// ─── The stub provider ────────────────────────────────────────────────────
interface StubCall {
  url: string
  method: string
  authorization: string | null
  body: unknown
}

const calls: StubCall[] = []
/** 200, or an HTTP status the next events.insert should fail with. */
let insertStatus = 200

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const stub = Deno.serve({ port: STUB_PORT, onListen: () => {} }, async (req) => {
  const url = new URL(req.url)
  const text = await req.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  calls.push({ url: `${url.pathname}${url.search}`, method: req.method, authorization: req.headers.get('Authorization'), body })

  if (url.pathname === '/token') {
    // A refresh-token grant, as Google answers one (it does not rotate the refresh token).
    return json(200, {
      access_token: 'stub-access-token',
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar.events',
    })
  }
  if (url.pathname.endsWith('/events')) {
    if (insertStatus === 401) return json(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } })
    if (insertStatus === 404) return json(404, { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } })
    if (insertStatus >= 500) return json(insertStatus, { error: { code: insertStatus, message: 'Backend Error' } })
    return json(200, { id: 'stub-event-1' })
  }
  return json(404, { error: 'unexpected stub path' })
})

/** The real Google client builds the real URLs; this sends them to the stub instead. */
const redirectingFetch: FetchLike = (url, init) =>
  fetch(url.replace('https://oauth2.googleapis.com/token', `${STUB}/token`).replace('https://www.googleapis.com/calendar/v3', `${STUB}/calendar/v3`), init)

// ─── Fixtures ─────────────────────────────────────────────────────────────
const NO_SESSION = { persistSession: false, autoRefreshToken: false }
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: NO_SESSION })
const asAdult = (jwt: string) => createClient(SUPABASE_URL, ANON_KEY, { auth: NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } })

/** Just the slice of a supabase-js client used here, so the generated database types don't have to line up. */
interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

async function rpc<T>(client: unknown, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (client as RpcClient).rpc(fn, args)
  if (error) throw new Error(`${fn} failed: ${error.message} (${error.code ?? '?'})`)
  return data as T
}

const suffix = crypto.randomUUID().slice(0, 8)
const emails = { wren: `e2e-wren-${suffix}@roost.test`, ash: `e2e-ash-${suffix}@roost.test` }
const userIds: string[] = []

async function adminApi(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  })
  const body = res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>)
  if (!res.ok) throw new Error(`admin ${path} failed: ${JSON.stringify(body)}`)
  return body
}

async function createUser(email: string): Promise<string> {
  const body = await adminApi('users', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) })
  const id = body.id as string
  userIds.push(id)
  return id
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = (await res.json()) as { access_token?: string }
  if (!res.ok || !body.access_token) throw new Error(`could not sign in ${email}: ${JSON.stringify(body)}`)
  return body.access_token
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select('id').single()
  if (error) throw new Error(`${table} insert failed: ${error.message}`)
  return (data as { id: string }).id
}

/** A connection with its one calendar, created the way the Edge Functions do, then shown by its own adult. */
async function connect(
  householdId: string,
  membershipId: string,
  jwt: string,
  provider: 'google' | 'ics',
  label: string,
  secret: string,
  canWrite: boolean,
  calendarId: string,
): Promise<{ connectionId: string; selectionId: string }> {
  const rows = await rpc<Array<{ connection_id: string; selection_ids: string[] }>>(admin, 'svc_create_calendar_connection_with_selections', {
    p_household_id: householdId,
    p_membership_id: membershipId,
    p_provider: provider,
    p_label: label,
    p_secret: secret,
    p_vault_secret_id: null,
    p_fingerprint: `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '').slice(0, 64),
    p_calendars: [{ id: calendarId, name: label }],
    p_can_write: canWrite,
  })
  const connectionId = rows[0]!.connection_id
  const selectionId = rows[0]!.selection_ids[0]!
  // Shown on the displays and assigned to its own adult, through the adult's own RPC, as Settings does.
  await rpc<void>(asAdult(jwt), 'set_calendar_selection', {
    p_selection_id: selectionId,
    p_visible: true,
    p_assigned_membership_id: membershipId,
    p_assigned_child_id: null,
  })
  return { connectionId, selectionId }
}

interface Fixture {
  householdId: string
  membershipId: string
  jwt: string
  otherJwt: string
  writableConnectionId: string
  writableSelectionId: string
  readOnlySelectionId: string
  icsSelectionId: string
}

async function setUp(): Promise<Fixture> {
  const wrenUser = await createUser(emails.wren)
  const ashUser = await createUser(emails.ash)
  const householdId = await insert('households', { name: `E2E calendar write ${suffix}`, time_zone: TIME_ZONE })
  const membershipId = await insert('memberships', {
    household_id: householdId, user_id: wrenUser, role: 'owner', display_name: 'Wren', color: '#2F86A6',
  })
  await insert('memberships', {
    household_id: householdId, user_id: ashUser, role: 'adult', display_name: 'Ash', color: '#653437',
  })
  const jwt = await signIn(emails.wren)
  const otherJwt = await signIn(emails.ash)
  // The adult's own PIN, set the way the app sets it.
  await rpc<void>(asAdult(jwt), 'set_my_pin', { p_household_id: householdId, p_pin: PIN })

  const writable = await connect(householdId, membershipId, jwt, 'google', `e2e-${suffix}@example.com`, 'stub-refresh-token', true, 'w-cal')
  const readOnly = await connect(householdId, membershipId, jwt, 'google', `e2e-ro-${suffix}@example.com`, 'stub-refresh-token', false, 'ro-cal')
  const ics = await connect(householdId, membershipId, jwt, 'ics', `E2E link ${suffix}`, `https://calendar.test/${suffix}.ics`, false, 'ics')

  return {
    householdId,
    membershipId,
    jwt,
    otherJwt,
    writableConnectionId: writable.connectionId,
    writableSelectionId: writable.selectionId,
    readOnlySelectionId: readOnly.selectionId,
    icsSelectionId: ics.selectionId,
  }
}

async function tearDown(householdId: string | null): Promise<void> {
  // Deleting the household cascades to its memberships and connections, whose trigger deletes the Vault secrets.
  if (householdId) await admin.from('households').delete().eq('id', householdId)
  for (const id of userIds) await adminApi(`users/${id}`, { method: 'DELETE' }).catch(() => undefined)
}

// ─── The checks ───────────────────────────────────────────────────────────
const handler = createCreateEventHandler(createCreateEventDeps(redirectingFetch))

const post = (jwt: string, body: Record<string, unknown>) =>
  handler(
    new Request(`${SUPABASE_URL}/functions/v1/calendar-create-event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

async function answer(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const connectionStatus = async (id: string) =>
  (await admin.from('calendar_connections').select('status, events_changed_at').eq('id', id).single()).data as
    | { status: string; events_changed_at: string }
    | null

let household: string | null = null
try {
  const f = await setUp()
  household = f.householdId

  const event = (over: Record<string, unknown> = {}) => ({
    householdId: f.householdId,
    selectionId: f.writableSelectionId,
    title: 'E2E swim lesson',
    allDay: false,
    start: `${DAY}T20:00:00Z`,
    end: `${DAY}T20:45:00Z`,
    ...over,
  })

  const before = await connectionStatus(f.writableConnectionId)
  const auditsBefore = (await admin.from('settings_audit').select('id').eq('household_id', f.householdId)).data?.length ?? 0

  // 1. The adult's own email sign-in (the /manage path).
  calls.length = 0
  const ok = await answer(await post(f.jwt, event({ location: 'YMCA Pool' })))
  check('a signed-in adult writes a timed event', ok.status === 200 && ok.body.created === true, ok)
  check(
    'the answer carries the event for the panel',
    ok.body.startAt === `${DAY}T20:00:00.000Z` && ok.body.endAt === `${DAY}T20:45:00.000Z` && ok.body.location === 'YMCA Pool',
    ok.body,
  )
  check('the token was refreshed first', calls[0]?.url === '/token' && calls[0]?.method === 'POST', calls[0])
  check(
    'Google would have received events.insert on that calendar, carrying only what Roost sends',
    calls[1]?.url === '/calendar/v3/calendars/w-cal/events?fields=id' &&
      calls[1]?.method === 'POST' &&
      calls[1]?.authorization === 'Bearer stub-access-token' &&
      JSON.stringify(calls[1]?.body) ===
        JSON.stringify({
          summary: 'E2E swim lesson',
          location: 'YMCA Pool',
          start: { dateTime: `${DAY}T20:00:00.000Z`, timeZone: TIME_ZONE },
          end: { dateTime: `${DAY}T20:45:00.000Z`, timeZone: TIME_ZONE },
        }),
    calls[1],
  )

  const after = await connectionStatus(f.writableConnectionId)
  check(
    'the events cache token moved, so every isolate refetches that connection',
    Date.parse(after!.events_changed_at) > Date.parse(before!.events_changed_at),
    { before: before?.events_changed_at, after: after?.events_changed_at },
  )
  const audits = (await admin.from('settings_audit').select('change').eq('household_id', f.householdId).order('id', { ascending: false })).data ?? []
  const change = audits[0]?.change as Record<string, unknown> | undefined
  check(
    'the write is audited by calendar only, with no event detail',
    audits.length === auditsBefore + 1 &&
      change?.section === 'calendars' &&
      change?.action === 'create_event' &&
      change?.target_id === f.writableSelectionId &&
      !JSON.stringify(change).toLowerCase().includes('swim'),
    change,
  )

  // 2. An all-day event: date-only values, end exclusive.
  calls.length = 0
  const allDay = await answer(await post(f.jwt, event({ allDay: true, start: DAY, end: NEXT_DAY, title: 'E2E library books' })))
  check('an all-day event is written', allDay.status === 200, allDay)
  check(
    'as date-only values with an exclusive end, answered as the household zone’s midnights',
    JSON.stringify(calls[1]?.body) === JSON.stringify({ summary: 'E2E library books', start: { date: DAY }, end: { date: NEXT_DAY } }) &&
      typeof allDay.body.startAt === 'string' &&
      (allDay.body.startAt as string).endsWith('T04:00:00.000Z'),
    { sent: calls[1]?.body, answered: allDay.body },
  )

  // 3. The display path: the caller's own JWT plus the Settings PIN.
  calls.length = 0
  const withPin = await answer(await post(f.jwt, event({ membershipId: f.membershipId, pin: PIN, title: 'E2E dentist' })))
  check('the Settings PIN authorises the write', withPin.status === 200, withPin)
  check('and it reached the provider', calls.length === 2, calls.map((c) => c.url))

  calls.length = 0
  const badPin = await answer(await post(f.jwt, event({ membershipId: f.membershipId, pin: WRONG_PIN })))
  check('a wrong PIN is refused', badPin.status === 403 && badPin.body.error === 'forbidden', badPin)
  check('and nothing reached the provider', calls.length === 0, calls)

  // 4. What may not be written to.
  calls.length = 0
  const readOnly = await answer(await post(f.jwt, event({ selectionId: f.readOnlySelectionId })))
  check('a read-only account answers not_writable', readOnly.status === 403 && readOnly.body.error === 'not_writable', readOnly)
  const ics = await answer(await post(f.jwt, event({ selectionId: f.icsSelectionId })))
  check('an ICS subscription answers not_writable', ics.status === 403 && ics.body.error === 'not_writable', ics)
  const other = await answer(await post(f.otherJwt, event()))
  check('another adult of the household is refused', other.status === 403 && other.body.error === 'forbidden', other)
  const elsewhere = await answer(await post(f.jwt, event({ householdId: crypto.randomUUID() })))
  check('a calendar named with another household is refused', elsewhere.status === 403, elsewhere)
  check('and none of those reached the provider', calls.length === 0, calls)

  // 5. Input.
  const markup = await answer(await post(f.jwt, event({ title: '<b>no</b>' })))
  check('markup in the title is refused', markup.status === 400 && markup.body.error === 'invalid_request', markup)
  const backwards = await answer(await post(f.jwt, event({ end: `${DAY}T19:00:00Z` })))
  check('an end before the start is refused', backwards.status === 400, backwards)
  const farOff = await answer(await post(f.jwt, event({ start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' })))
  check('a date years away is refused', farOff.status === 400, farOff)

  // 6. Provider failures.
  insertStatus = 500
  const down = await answer(await post(f.jwt, event()))
  check('a provider 5xx answers unreachable', down.status === 502 && down.body.error === 'unreachable', down)
  check('and leaves the connection alone', (await connectionStatus(f.writableConnectionId))?.status === 'ok')

  insertStatus = 404
  const gone = await answer(await post(f.jwt, event()))
  check('a calendar the provider lost answers calendar_gone', gone.status === 410 && gone.body.error === 'calendar_gone', gone)

  insertStatus = 401
  const expired = await answer(await post(f.jwt, event()))
  check('an expired grant answers auth_expired', expired.status === 422 && expired.body.error === 'auth_expired', expired)
  check('and the connection is marked for reconnecting', (await connectionStatus(f.writableConnectionId))?.status === 'auth_expired')
  insertStatus = 200
  await rpc<void>(admin, 'svc_set_calendar_status', { p_connection_id: f.writableConnectionId, p_status: 'ok' })

  // 7. The hourly limit (30 a member); some writes have already been counted above.
  let refusedAt = 0
  for (let i = 0; i < 40 && refusedAt === 0; i++) {
    const res = await answer(await post(f.jwt, event({ title: `E2E filler ${i}` })))
    if (res.status === 429) refusedAt = i + 1
  }
  check('a member is rate-limited within 30 events an hour', refusedAt > 0 && refusedAt <= 30, { refusedAt })
} catch (e) {
  failures += 1
  console.log(`FAIL the check could not run: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  await tearDown(household)
  await stub.shutdown()
}

console.log(failures === 0 ? '\nALL CALENDAR WRITE E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) Deno.exit(1)
