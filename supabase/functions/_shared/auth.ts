/**
 * Who is calling a calendar Edge Function (spec §5.5, §6.3), decided by the database with the caller's own JWT.
 *
 * The gateway has already verified the JWT (`verify_jwt = true`). These helpers then call RPCs through a client that
 * carries the caller's Authorization header, so the SQL rules stay the single source of truth:
 *   - `callerHousehold` → `public.my_calendar_caller`: a member (any role) or an active display of the household.
 *   - `requireFullSignInAdult` → `public.my_calendar_membership`: a full sign-in (not a display, not anonymous) owner
 *     or adult; returns their membership id. Functions that create connections must use this id, never one from the
 *     request body.
 *
 * Plain TypeScript with an injected client factory, so Vitest runs it; the Edge Functions pass a supabase-js client.
 */

export interface RpcError {
  code?: string
  message: string
}

/** The slice of a supabase-js client used here. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>
}

/** Builds a client that acts as the caller identified by `authorization` (the raw `Authorization` header). */
export type CallerClientFactory = (authorization: string) => RpcClient

export interface Caller {
  userId: string
  householdId: string
  kind: 'display' | 'member'
  /** Set for members. */
  membershipId?: string
}

/** 401: no usable JWT. 403: a valid caller who may not do this. Messages are safe to return. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// PostgREST: PGRST301 (JWT invalid or expired), PGRST302 (anonymous access not allowed), PGRST303 (JWT claims invalid).
const JWT_ERRORS = new Set(['PGRST301', 'PGRST302', 'PGRST303'])

function authorizationOf(req: Request): string {
  const authorization = req.headers.get('Authorization')
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new AuthError(401, 'sign-in required')
  return authorization
}

function rethrow(error: RpcError): never {
  if (error.code && JWT_ERRORS.has(error.code)) throw new AuthError(401, 'sign-in required')
  if (error.code === '42501') throw new AuthError(403, 'forbidden')
  throw new Error(`auth check failed (${error.code ?? 'unknown'})`)
}

export interface CallerAuth {
  callerHousehold(req: Request, householdId: string): Promise<Caller>
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
}

export function createCallerAuth(callerClient: CallerClientFactory): CallerAuth {
  return {
    async callerHousehold(req, householdId) {
      const client = callerClient(authorizationOf(req))
      const { data, error } = await client.rpc('my_calendar_caller', { p_household_id: householdId })
      if (error) rethrow(error)
      const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
      if (!row || typeof row.user_id !== 'string' || (row.kind !== 'member' && row.kind !== 'display')) {
        throw new AuthError(403, 'forbidden')
      }
      const caller: Caller = { userId: row.user_id, householdId, kind: row.kind }
      if (row.kind === 'member' && typeof row.membership_id === 'string') caller.membershipId = row.membership_id
      return caller
    },

    async requireFullSignInAdult(req, householdId) {
      const client = callerClient(authorizationOf(req))
      const { data, error } = await client.rpc('my_calendar_membership', { p_household_id: householdId })
      if (error) rethrow(error)
      if (typeof data !== 'string' || !data) throw new AuthError(403, 'forbidden')
      return data
    },
  }
}
