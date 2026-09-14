/**
 * The `ical.js` module for Edge Functions (Deno). See the header of `ics.ts` for why the parser takes the module
 * as an argument: Vitest imports `ical.js` from node_modules instead. Keep this version in step with the
 * `ical.js` devDependency in package.json. Typing the export as `IcalApi` makes `deno check` verify that the real
 * library still matches the slice `ics.ts` relies on.
 */
import ICAL from 'npm:ical.js@2.2.1'
import type { IcalApi } from './ics.ts'

export const ical: IcalApi = ICAL
