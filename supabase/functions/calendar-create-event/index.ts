/**
 * `calendar-create-event` Edge Function (spec §5.5, §6.3, §7.2, §11.2): an adult adds one event, and it is written
 * to their connected Google calendar — signed in with an email code at /manage, or on a display with
 * the PIN that opened Settings. Roost stores no event data; the normal feed shows the event afterwards.
 * See handler.ts for the request and response contract and deps.ts for the database and provider wiring.
 */
import { createCreateEventDeps, timedFetch } from './deps.ts'
import { createCreateEventHandler } from './handler.ts'

Deno.serve(createCreateEventHandler(createCreateEventDeps(timedFetch)))
