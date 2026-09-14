import type { LogCommand } from './logCommands'

export class LogWriteError extends Error {
  constructor(
    message: string,
    readonly network: boolean,
    readonly code: string | null,
  ) {
    super(message)
  }
}

export interface LogWriter {
  /** Execute a command. Throws LogWriteError (network=true when the request never reached the server). */
  execute(cmd: LogCommand): Promise<void>
  verifyPin(membershipId: string, pin: string): Promise<boolean>
}
