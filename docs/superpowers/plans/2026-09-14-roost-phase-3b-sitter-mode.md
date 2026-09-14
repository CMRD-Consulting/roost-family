# Roost Phase 3b: Sitter Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An adult hands the tablet to a sitter: PIN + optional sitter name starts Sitter Mode on every display; the sitter sees care info instead of the family calendar, logs are attributed to the sitter, personal lists are hidden; an adult PIN ends it and shows the "While You Were Out" summary.

**Architecture:** Sitter sessions become server-authoritative through PIN-checked RPCs (start, end, mark summary shown), exposed to the app as online-only log commands so they flow through the existing log store and overlay. The active session in the household snapshot drives a sitter layout on the main screen and sitter attribution in every log sheet. The summary is a pure view model over the snapshot using the existing `sitterSummary` domain function.

**Spec:** `docs/superpowers/specs/2026-09-14-roost-design.md` §6.5 (attribution), §7.3 (PIN guard), §7.6 (Sitter Mode), §11.
**Design reference:** `docs/design/handoff/project/Roost Family App v2.dc.html` lines ~60–66 (exit control), ~140–150 (Care Info panel), ~296–306 (sitter name prompt), ~408–426 (While You Were Out).

## Contents

- [Decisions](#decisions)
- [File structure](#file-structure)
- Tasks 1–5

## Decisions

| Topic | Decision |
|---|---|
| Who can start/end | Any owner/adult with a valid PIN, via RPC (not a direct table write) |
| Online requirement | Start and end need a connection (PIN is verified server-side). Offline, the exit button shows "Connect to end Sitter Mode" |
| Scope | Household-wide: every display switches layout from the shared `activeSitterSession` |
| Summary delivery | The display that ends the session shows the summary and marks it shown. Other displays show a banner "Sitter session ended — see summary" (for 12 h) until someone opens it (adult PIN) |
| Night carry-over | Sitter Mode stays on through Night Mode; the summary appears when an adult ends the session |
| Kids' Corner | Available during Sitter Mode (the sitter can use it with the kids; its exit still requires the adult PIN or offline pattern) |

## File structure

```
supabase/migrations/20260914000002_rls_and_rpcs.sql   start_sitter_session, end_sitter_session, mark_sitter_summary_shown; revoke direct writes
supabase/manual-checks/rls_smoke.sql                   sitter checks
src/data/logCommands.ts / applyCommand.ts / inverseCommand.ts / supabaseLogWriter.ts   sitter.start / sitter.end / sitter.summaryShown
src/data/snapshot.ts / mappers.ts / supabaseSource.ts / demo/demoFixture.ts            recentlyEndedSitterSession; summaryShownAt; sitterInfo typing
src/features/sitter/
  sitterModel.ts            care info model, summary model, pending-summary rule (+ test)
  CareInfoPanel.vue
  SitterStartSheet.vue      PIN → name → start
  SitterExitDialog.vue      PIN → end → summary
  SitterSummary.vue         full-screen "While You Were Out"
  sitter.test.ts
src/features/logs/useLogSheet.ts, logSheetModel.ts, WhoRow usage in sheets   sitter attribution
src/features/main/MainScreen.vue                        sitter layout + flows
```

---

### Task 1: Sitter RPCs (database)

**Files:** `supabase/migrations/20260914000002_rls_and_rpcs.sql`, `supabase/manual-checks/rls_smoke.sql`, `src/data/database.types.ts` (regenerate with `pnpm db:types` after `supabase db reset`).

- `start_sitter_session(p_household_id uuid, p_membership_id uuid, p_pin text, p_sitter_name text, p_display_id uuid) returns uuid` — security definer: caller is a member of the household; membership belongs to the household with role owner/adult and PIN verifies (`private.pin_ok`); display (nullable) belongs to the household; name trimmed, empty → null, ≤ 40 chars; fails with `23505`-style clear error `a sitter session is already active` if one is open (partial unique index exists); inserts and returns id.
- `end_sitter_session(p_session_id uuid, p_membership_id uuid, p_pin text) returns timestamptz` — member of the session's household; PIN verifies; session open; sets `ended_at = now()`; returns it.
- `mark_sitter_summary_shown(p_session_id uuid) returns void` — member of the household; session ended; sets `summary_shown_at = coalesce(summary_shown_at, now())`.
- Revoke INSERT/UPDATE/DELETE on `sitter_sessions` from `authenticated`; drop its member write policy (keep SELECT). Grant execute on the three RPCs to authenticated only (and `revoke … from public, anon`).
- Smoke checks: start with right PIN works; wrong PIN `42501`; second start rejected while one is open; other household's member rejected; end with PIN works; direct insert/update denied; dose logged with `sitter_session_id` still passes the attribution check and `logged_by_name` = `'<name> (sitter)'`; mark summary shown idempotent.
- Commit — `feat(db): PIN-checked sitter session RPCs`

### Task 2: Sitter commands and snapshot

**Files:** `src/data/logCommands.ts`, `applyCommand.ts` (+test), `inverseCommand.ts` (+test), `supabaseLogWriter.ts` (+test), `src/data/demo/demoLogWriter.ts` (+test), `src/data/snapshot.ts`, `mappers.ts` (+test), `supabaseSource.ts` (+test), `src/data/demo/demoFixture.ts` (+test).

- Commands (all `requiresOnline`): `{ kind: 'sitter.start'; householdId; sessionId (client uuid, informational); membershipId; pin; sitterName: string | null; displayId: string | null; startedAt }`, `{ kind: 'sitter.end'; householdId; sessionId; membershipId; pin; endedAt }`, `{ kind: 'sitter.summaryShown'; householdId; sessionId }`. The writer calls the RPCs (for start, the server id replaces the client id — the store reloads after success; `applyCommand` sets `activeSitterSession` optimistically with the client id).
- `applyCommand`: start → `activeSitterSession = { id, sitterName, startedAt, endedAt: null, summaryShownAt: null }`; end → move it to `recentSitterSession` with `endedAt`; summaryShown → set `summaryShownAt` on `recentSitterSession`. `inverseCommand` → null for all three.
- Snapshot: add `summaryShownAt` to `SitterSession`; add `recentSitterSession: SitterSession | null` = the latest session ended within the last 12 h (source query: `ended_at >= now − 12h`, order `ended_at desc`, limit 1). Type `household.sitterInfo` as `SitterInfo { napInstructions?: string; bedtime?: string; foodRules?: string; emergencyContacts?: string; pediatrician?: string; address?: string; whereThings?: string }` with a mapper that keeps only string fields.
- Demo writer: PIN check for start/end like `dose.void`; demo fixture gains optional `?sitter` URL flag that starts with an active session named "Jess" 2 h ago with a few sitter-attributed logs.
- Commit — `feat(sitter): sitter session commands and snapshot fields`

### Task 3: Sitter models and presentational components

**Files:** `src/features/sitter/sitterModel.ts` (+test), `CareInfoPanel.vue`, `SitterSummary.vue`, `sitter.test.ts`.

- `careInfoModel(snapshot, now)` → `{ sections: { title: string; body: string }[] }` in this order, skipping empty: "Today's routine" (per child: child name + current step label or "No routine today"), "Naps & bedtime" (napInstructions + bedtime), "Food & allergies" (each child's allergies and food rules, then household foodRules), "Emergency contacts", "Pediatrician", "Address", "Where things are".
- `sitterAttribution(session)` → `{ sitterSessionId, loggedByName: session.sitterName ? \`${name} (sitter)\` : 'Sitter' }`.
- `summaryModel(snapshot, session, now)` → `{ title: 'While you were out', sitterName, rangeLabel: '5:30 PM – 9:10 PM', children: { childId, name, color, lines: { time: string; icon: 'sleep'|'feeding'|'medicine'|'sticker'|'diaper'; text: string; flag?: 'warningConfirmed'|'voided'|'offline' }[] }[] }` using `sitterSummary`. Line texts: sleep "Nap 1:05–2:20 PM (1h 15m)" / "Night sleep from 7:40 PM" (open), feeding "Milk · 6 oz", medicine "Infant ibuprofen · 2.5 ml" with flags (warnings confirmed → "Given despite a timing warning"; voided; logged offline), sticker "Sticker: Potty", diaper "Diaper: Wet". Children with no lines show "Nothing logged". Ordered by time.
- `pendingSummary(snapshot, now)` → the `recentSitterSession` if `summaryShownAt === null`, else null.
- **CareInfoPanel** (props `model`): replaces the Today panel; title "Care info" 16 px uppercase; section titles 18 px 600; bodies 20 px, `whitespace-pre-line`; scrolls within its panel.
- **SitterSummary** (props `model`, emits `close`): full-screen `bg-app`, title 44 px, sitter name + range 22 px, one card per child (avatar decorative + name), lines with time 18 px `ink-3` and text 22 px; flags as `text-warn-ink` 18 px with an icon; a 60 px "Done" button.
- Tests for all model functions (sleep ranges, open sleeps, dose flags, empty children, care info ordering/skipping) and component rendering.
- Commit — `feat(sitter): care info and While You Were Out models and components`

### Task 4: Sitter attribution in log sheets

**Files:** `src/features/logs/useLogSheet.ts`, `logSheetModel.ts` (+test), `SleepSheet.vue`, `FeedingSheet.vue`, `MedicineSheet.vue`, `StickerSheet.vue`, `DiaperSheet.vue`, `sheets.test.ts`, `medicine.test.ts`.

- When `view.activeSitterSession` is set: every kid-log attribution uses `sitterAttribution(session)` (display id kept); the `WhoRow` is replaced by a 18 px line "Logged by Jess (sitter)"; the Medicine sheet's Who requirement is satisfied by the sitter.
- Undo of a sitter's dose still requires an adult PIN (unchanged).
- Tests: sitter attribution in commands for each kid log; medicine saves without Who during Sitter Mode; Who row returns after the session ends.
- Commit — `feat(sitter): attribute logs to the sitter during Sitter Mode`

### Task 5: Main screen sitter layout and flows

**Files:** `src/features/sitter/SitterStartSheet.vue`, `SitterExitDialog.vue`, `src/features/main/MainScreen.vue` (+test), `src/features/main/LogRow.vue` if needed, `src/features/main/mainScreenModel.ts` (+test).

- **Start** (header Sitter button, 60 px, when no session): `RLongPress` 600 ms → `SitterStartSheet`: step 1 `RPinPad` (adults) "Start Sitter Mode"; step 2 optional name `RInput` "Sitter's name (optional)" + primary "Start Sitter Mode"; submit `sitter.start` with the verified membership + PIN. Offline → "Connect to start Sitter Mode."
- **Sitter layout** (when `activeSitterSession`):
  - Header shows a pill "Sitter Mode · Jess" (22 px) and the Sitter button becomes "End Sitter Mode" (60 px, `RLongPress` 600 ms).
  - `mainScreenModel.logButtons` excludes `jot` and `grocery` when a sitter session is active (model flag `sitterActive`); Settings button hidden (it's a placeholder today; keep hidden).
  - Right column: `CareInfoPanel` replaces Tonight + Today.
  - Kids' Corner button stays.
- **End:** `SitterExitDialog`: `RPinPad` "End Sitter Mode" → `sitter.end` → on success show `SitterSummary` for that session → Done → `sitter.summaryShown`. Offline → "Connect to end Sitter Mode."
- **Other displays:** when `pendingSummary(view, now)` exists and this display didn't just end it, show a 60 px banner "Sitter session with Jess ended at 9:10 PM · See summary" → PIN → summary → Done → `sitter.summaryShown`.
- Night Mode: an active sitter session does not change Night Mode behavior; the sitter pill remains visible in the dimmed peek.
- Tests: start flow with PIN + name → pill + care info + jot/grocery hidden; sheets attribute to sitter; end flow → summary → Done marks shown; pending banner on another display; offline messages.
- Commit — `feat(sitter): Sitter Mode on the main screen with start, care info, exit and summary`
- **Controller verification** on local Supabase: start as Sam with name "Jess"; second display (new browser context) switches layout via realtime; log feeding/medicine as sitter (DB `logged_by_name = 'Jess (sitter)'`); end with Alex's PIN → summary lists the logs; other display shows the pending banner.
