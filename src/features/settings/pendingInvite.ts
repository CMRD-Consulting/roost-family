/**
 * The member invite an owner just created in Settings > Members, handed to the /join-adult flow in memory only
 * (never in the URL or storage): the token is a one-time secret for the next 10 minutes.
 */
export interface PendingInvite {
  token: string
  role: 'owner' | 'adult'
}

let pending: PendingInvite | null = null

export function setPendingInvite(invite: PendingInvite): void {
  pending = invite
}

export function hasPendingInvite(): boolean {
  return pending !== null
}

/** Returns the pending invite and forgets it, so going back to /join-adult later can't reuse it. */
export function takePendingInvite(): PendingInvite | null {
  const invite = pending
  pending = null
  return invite
}
