import type { LogCommand } from './logCommands'

export class LogWriteError extends Error {
  constructor(
    message: string,
    /** True when retrying later can succeed (no connection, expired session, server trouble, row not synced yet). */
    readonly network: boolean,
    readonly code: string | null,
    /** HTTP status of the failed request, when one came back. */
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

export interface LogWriter {
  /** Execute a command. Throws LogWriteError (network=true when the failure is worth retrying later). */
  execute(cmd: LogCommand): Promise<void>
  verifyPin(membershipId: string, pin: string): Promise<boolean>
  /** Whether queued commands can be sent now (e.g. a user session exists). Absent means always ready. */
  ready?(): Promise<boolean>
}
