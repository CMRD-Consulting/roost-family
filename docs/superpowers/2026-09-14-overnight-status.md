# Roost: overnight build status (2026-09-14)

## Contents

1. [What's built](#whats-built)
2. [See it now](#see-it-now)
3. [What needs you](#what-needs-you)
4. [Decisions I made that you should check](#decisions-i-made-that-you-should-check)
5. [Verification](#verification)
6. [Next up](#next-up)

## What's built

Branch `phase-1-foundation` (60 commits on top of the specs and design). Nothing is merged or deployed.

**Phase 1: Foundation** (plan: `plans/2026-09-14-roost-phase-1-foundation.md`)
- Vue 3 + Vite + Tailwind 4 app with design tokens from the Claude Design handoff (Outfit, cream/orange palette, Gable logo)
- Domain rules as tested pure functions:
  - sleep and wake window, with stale "Still sleeping?" detection
  - medicine next-dose, early and two-sided daily-max warnings, offline-dose conflicts
  - age-based feature defaults
  - routines
  - sticker week
  - leave-by countdown
  - sitter summary
- Supabase schema, row-level security and RPCs, hardened after a security review:
  - households are isolated from each other
  - doses can't be edited or deleted, only voided or acknowledged with a PIN
  - foreign keys include the household, so no entry can reference another household's rows
  - helper functions live in a private schema, and anon has no access
  - setting up a household is a single atomic step
- Display identity: the tablet signs in as an anonymous Supabase user bound to a display with a one-time claim token. Adults sign in on a separate, in-memory-only client that ends after 5 minutes idle.
- Setup wizard with invite code, email code, consent, household, kids, you + PIN, and display name. Also Join a household, Display removed, and an Offline screen.

**Phase 2a: Main screen, read path** (plan: `plans/2026-09-14-roost-phase-2a-main-screen.md`)
- Household snapshot data layer (Supabase source with realtime reloads, plus a **demo source**)
- Main screen:
  - clock and date
  - kid cards (wake window, feeding, Now → Next), with compact cards for 5 or more kids
  - dose-conflict banner and medicine status
  - tonight's dinner
  - log-button row with a 0.6 s hold ring
- Holding a log button shows "Logging arrives in Phase 2b". The mode buttons (Nap, Kids' Corner, Sitter, Settings) are placeholders.

## See it now

No backend needed:

```bash
cd ~/www/cmrd/apps/roost && git checkout phase-1-foundation && pnpm install
```

```bash
VITE_DATA_SOURCE=demo pnpm dev
```

Open http://localhost:5173/home. Try `?conflict`, `?manyKids`, or both. On the iPad, use your Mac's LAN IP on port 5173.

## What needs you

1. **Docker Desktop won't start.** Its log says `preparing VM: ensuring disk: Cannot resize`, and it offers only Quit or "Reset to factory defaults". I didn't reset it, because that would delete every container and volume, including Totem's local database. The likely fix is Docker Desktop → Settings → Resources → lower or raise "Virtual disk limit", or free disk space (24 GB free). Until it runs:
   - `supabase start` is unavailable
   - the real sign-in → setup → main screen flow hasn't run end to end
   - the `database.types.ts` file is hand-written (regenerate with `pnpm db:types` once Supabase runs)
   - migrations were validated on plain Postgres 17 with a Supabase stand-in (`supabase/manual-checks/validate-local.sh` + `rls_smoke.sql`, 33 checks)
2. **Register `roost.family`.** It had no DNS records.
3. **Before any outside family** (spec §15): Supabase project, Google OAuth verification, Apple sign-in, custom SMTP (Supabase's default sender allows about 2 emails an hour), lawyer review, and a trademark search.
4. **To re-run the database checks without Docker:** start a throwaway Postgres on port 55432 first. The one I used lived in this session's scratch folder and is now stopped.
   ```bash
   initdb -D /tmp/roost-pg -U postgres --auth=trust && pg_ctl -D /tmp/roost-pg -o "-p 55432 -k /tmp" -l /tmp/roost-pg.log start
   ```
   Use Postgres.app's `bin` directory for `initdb` and `pg_ctl`. Then run `bash supabase/manual-checks/validate-local.sh`.
5. **After Docker works, check once:** a brand-new email completes the email-code flow with `enable_confirmations = true`.

## Decisions I made that you should check

| Decision | Why | Where |
|---|---|---|
| **Person palette is darker jewel tones** (brick, teal, ochre, indigo, forest, umber, denim, plum, pine, berry) | Chosen to pass 4.5:1 white-initial contrast, stay distinct from log-button colors, and stay distinguishable under protanopia and deuteranopia. Lighter colors failed. | `src/ui/personPalette.ts` |
| `orange-deep` darkened `#B8542A` → `#A84B24` | The design's value was 4.498:1, just under AA | `src/styles/app.css` |
| Wake window uses the last 18 h, not "today" | A calendar-day rule showed "Log wake-up" at 12:10 AM | spec §7.4 (updated) |
| Open sleep > 16 h shows "Still sleeping?" | A forgotten End sleep would otherwise show "Sleeping 75h" | spec §7.4 (updated) |
| Routines skip unfinished earlier steps once a later timed step arrives | Otherwise the child is sent back to morning steps after nap | spec §7.5 (updated) |
| Household settings, children, medicines, routines are read-only to clients | Security review: a display token could otherwise change medicine intervals without a PIN. Phase 3 Settings will write through PIN-checked RPCs. | migration 2 |
| Weather location comes from the tablet's geolocation (rounded to ~1 km), not ZIP lookup | Avoided downloading a ZIP-centroid dataset | setup wizard |
| Adding an adult will require the Owner's full sign-in (spec §6.3), not PIN (§6.4 step 1) | The spec contradicts itself; I took the stricter reading | Phase 3 |
| Log labels are dark ink on the orange/green/amber buttons | The design's light text failed contrast | `LogRow.vue` |
| Tonight's dinner moved to the right column; clock shrinks on 768-px-tall screens | Keeps the dose alert and medicine visible without scrolling on a 9.7" iPad | `MainScreen.vue` |

## Verification

- `pnpm test`: 292 tests, 31 files, all passing
- `pnpm typecheck`, `pnpm build`: clean
- `validate-local.sh` + `rls_smoke.sql`: `ALL RLS SMOKE CHECKS PASSED`
- Visual check of the demo main screen at 1024×768, 1112×834, 1366×1024 with and without `?conflict` and `?manyKids`
- Independent reviews after each phase (domain rules, SQL security, frontend sessions, data layer). All findings fixed.

## Next up

**Phase 2b: logging.** Log sheets (Sleep, Feeding, Medicine with warnings, Sticker, Jot, Grocery, Diaper), the "Who?" row, adult PIN pad, Undo toast, offline queue, dose void/acknowledge, dinner edit, and "Still sleeping?" actions.
