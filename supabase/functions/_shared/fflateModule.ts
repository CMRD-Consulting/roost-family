/**
 * The `fflate` module for Edge Functions (Deno). See the header of `exportBuilder.ts` for why `zipExport` takes the
 * module as an argument: Vitest imports `fflate` from node_modules instead. Keep this version in step with the
 * `fflate` devDependency in package.json. Typing the export as `FflateApi` makes `deno check` verify that the real
 * library still matches the slice `exportBuilder.ts` relies on.
 */
import * as fflateLib from 'npm:fflate@0.8.3'
import type { FflateApi } from './exportBuilder.ts'

export const fflate: FflateApi = fflateLib
