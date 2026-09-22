# Plan — Kitchen: shopping lists, to-dos, recipes, meal plan

Spec: [2026-09-21-roost-kitchen-design.md](../specs/2026-09-21-roost-kitchen-design.md)

Built by parallel agents with disjoint file ownership. Tests and typecheck run once at the end.

## Phase 1 — foundations (parallel)

**Agent A — database.** Owns `supabase/migrations/20260914000018_kitchen.sql`, `supabase/manual-checks/rls_smoke.sql`, `supabase/functions/_shared/exportBuilder.ts`, `supabase/seed.sql`.
- Tables `shopping_lists`, `tasks`, `recipes`, `recipe_ingredients`, `recipe_steps`, `meal_plan_entries` per spec §6, with RLS, grants, indexes, Realtime, full replica identity.
- `grocery_items.list_id` + composite FK + `before insert` trigger filling the household's default list.
- Backfill: one **Groceries** list per household, every existing item onto it; each household's `dinner_tonight` onto today's meal-plan entry in its own time zone. `setup_household` creates the list for new households.
- Recipe-write RPCs are not needed — recipes are member-writable — but limits (6 lists, 200 items, 300 recipes, 50 ingredients, 40 steps) are enforced by `before insert` triggers raising `22023`.
- `create or replace take_list_items` returning `out_list_id`, `out_list_name`.
- `purge_deleted_households`: old meal-plan entries, long-checked grocery items, long-done tasks.
- New rls_smoke checks from `[136]`, and bump the household-scoped table floor.

**Agent B — client data layer.** Owns `src/data/database.types.ts`, `snapshot.ts`, `mappers.ts`, `logCommands.ts`, `applyCommand.ts`, `inverseCommand.ts`, `supabaseLogWriter.ts`, `supabaseSource.ts`, `recipeApi.ts`, `demo/demoFixture.ts`, `demo/demoRecipeApi.ts`, `takeListApi.ts`, `features/takelist/TakeListPage.vue`, and the colocated tests for those.
- Types for every new table and the changed RPC, in the file's hand-maintained shape.
- Snapshot arrays, mappers, load queries and subscriptions.
- Every command kind in spec §7.1, with apply/inverse/writer cases.
- `recipeApi.ts` shaped like `takeListApi.ts`, plus the demo implementation.
- Demo fixture seeds two lists, four tasks, two recipes and three planned days.
- Take List page groups by list name.

## Phase 2 — Kitchen shell (after B)

**Agent C.** Owns `src/features/kitchen/KitchenScreen.vue`, `kitchenModel.ts`, `ShoppingTab.vue`, `shoppingModel.ts`, `TodoTab.vue`, `todoModel.ts`, `TaskSheet.vue`, `ListNameSheet.vue`, `src/router.ts`, and the Kitchen button in `src/features/main/MainScreen.vue`.
- Route `/kitchen`, tab in the query, night/nap holds, `useHouseholdSession`, four tab panels with the Meals and Recipes panels left as named slots for Agent D.
- Shopping and To-do tabs per spec §3.2 and §4.2.
- Main-screen mode button with the due-task badge, hidden in Sitter Mode.

## Phase 3 — kitchen content (parallel, after C)

**Agent D — recipes and meals.** Owns `MealsTab.vue`, `mealsModel.ts`, `RecipesTab.vue`, `recipesModel.ts`, `RecipeEditor.vue`, `AddIngredientsSheet.vue`, `PlanDaySheet.vue`, and fills the two slots in `KitchenScreen.vue`.

**Agent E — main screen.** Owns `src/features/main/mainScreenModel.ts`, `DinnerLine.vue`, `src/features/logs/DinnerSheet.vue` and their tests: the dinner line reads the meal plan, the sheet writes today's entry.

## Phase 4 — verification (me)

`pnpm typecheck`, `pnpm test`, fix fallout, then `bash supabase/manual-checks/validate-local.sh` and `rls_smoke.sql` if Postgres is available.
