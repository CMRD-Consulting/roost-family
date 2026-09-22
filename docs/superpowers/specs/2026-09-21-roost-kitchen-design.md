# Roost — Kitchen: Shopping Lists, To-dos, Recipes & Meal Plan

**Status:** approved · **Date:** 2026-09-21 · **Extends:** [2026-09-14-roost-design.md](2026-09-14-roost-design.md) §8 (Priority 2 — Kitchen screen), §9 (Recipe library)

## 1. Summary

Three features, one new surface.

1. **Shopping lists** — the single grocery list becomes several named lists (Groceries, Costco, Hardware…). They sync between displays over Realtime and out to a phone through the existing Take List QR, so whoever is at the store sees the latest version.
2. **To-do lists** — household tasks, each either unassigned ("Family") or assigned to one adult, with an optional due date.
3. **Recipe box and meal plan** — recipes with ingredients and steps, a week of dinners, and a one-tap push of a recipe's ingredients onto a shopping list. The meal plan feeds "Tonight's dinner" on the main screen.

All three live on a new full-screen **Kitchen** screen at `/kitchen`, reached from a mode-control button on the main screen.

## 2. Product decisions

| Topic | Decision |
|---|---|
| **Surface** | One new full-screen mode, `/kitchen`, with four tabs: **Shopping · To-do · Meals · Recipes**. In-the-moment surface: 60 pt touch targets, glanceable text ≥ 24 pt, secondary ≥ 18 pt |
| **Authorisation** | No PIN. Everything here is household content, not safety configuration — the same trust level as the grocery list and jots today. Destructive actions (delete a list, delete a recipe) take a second confirming tap, and recipes and lists archive rather than hard-delete |
| **Sitter Mode** | The Kitchen button is hidden while Sitter Mode is active, like the other adult mode controls. A sitter still adds to the shopping list from the Grocery log sheet |
| **Offline** | Shopping items, lists, tasks and meal-plan entries queue offline and replay, like every other log command. Recipes are authored online only |
| **Assignees** | Tasks are assigned to an adult membership or to nobody ("Family"). Children are not assignees — chores stay a Priority 3 growing-up feature |
| **Out of scope** | Cook mode and its timers, recurring tasks, recipe import from a URL, quantities and units on shopping items, nutrition, per-store aisle ordering, lunch and breakfast slots |
| **Per-household limits** | 6 shopping lists · 200 items per list · 200 open tasks · 300 recipes · 50 ingredients and 40 steps per recipe |

## 3. Shopping lists

### 3.1 Model

A household has one or more **shopping lists**; every item belongs to exactly one. The existing `grocery_items` table and the `grocery.*` commands keep their names — only the list dimension is new — so nothing already queued on a display breaks.

- A new household gets one list named **Groceries** from `setup_household`.
- Existing households get the same list in the migration, and every existing item is backfilled onto it.
- The **default list** of a household is its oldest un-archived list. An item inserted with no `list_id` lands there (a `before insert` trigger fills it), which is what keeps a command queued by an older build replayable.
- Lists archive (`archived_at`), they do not delete. Archiving a list hides it and its items everywhere. The last un-archived list cannot be archived.

### 3.2 Screen — Shopping tab

- A row of list chips (`RChips`-style, 60 pt), one per un-archived list, with each list's open-item count, plus a **+ New list** chip.
- The selected list fills the screen: an add field pinned at the top, then unchecked items oldest-first, then items checked in the last 24 hours, struck through, at the bottom. Tapping a row toggles it; a trailing ✕ removes it. This is exactly today's `visibleGroceries` behaviour, per list.
- Header actions for the selected list: **Rename**, **Clear checked**, **Archive list**, and **Take list** (the existing QR sheet).
- Empty list: "Nothing on this list yet."

### 3.3 Take List (phone)

The Take List link stays **household-wide** — one active link, 24 hours, as today ([design §7.8](2026-09-14-roost-design.md#78-take-list-grocery-qr)). The phone page now groups items under their list's name, so one scan covers every stop. `take_list_items` returns the list id and name alongside each item; `take_list_set_checked` is unchanged. The page still shows groceries only, still cannot add or delete, and still polls every 10 s.

## 4. To-do lists

### 4.1 Model

A **task** is: text (1–100 chars), an optional assignee (an adult membership of the household), an optional due date (a household-local `date`), `created_at`, and `done_at`. Tasks are household-owned and member-writable, like jots.

A task is "open" while `done_at is null`. The snapshot carries open tasks plus tasks completed in the last 24 hours, so a completion can be undone and seen on the other displays.

### 4.2 Screen — To-do tab

- Filter chips: **All · Family · &lt;each adult&gt;**, each with its open count. "Family" is the unassigned tasks.
- Add field at the top; a new task takes the current filter's assignee (none under All or Family).
- Rows are grouped **Overdue · Today · Later · No date**, each row showing the assignee's `RAvatar` (person colour, never colour alone) and the due date. Tapping the row's checkbox completes it; completed-in-the-last-24-h tasks sit at the bottom, struck through.
- Tapping a row's body opens an edit sheet: text, assignee chips, due date (Today / Tomorrow / This weekend / Pick a date / None), and **Delete**.
- The Kitchen button on the main screen carries a count badge of tasks overdue or due today.

## 5. Recipes and meal plan

### 5.1 Model

- **Recipe:** title (1–80), optional source URL (≤ 500), optional servings (1–99), optional notes (≤ 2000), `archived_at`.
- **Ingredient:** free text (1–100), ordered. Deliberately the same shape as a shopping item, so pushing one onto a list is a copy.
- **Step:** free text (1–500), ordered.
- **Meal-plan entry:** one per household per day (`unique (household_id, day)`), holding **either** a `recipe_id` **or** free text (≤ 80). `day` is a household-local date.

### 5.2 Screen — Recipes tab

- A grid of recipe cards (title, ingredient count, servings), newest first, with a search field when there are more than 12.
- **+ New recipe** and, on a card, **Open**.
- Recipe view: title, servings, source link (shown as text, never opened on the display), ingredients, steps — all at ≥ 18 pt, steps at ≥ 24 pt so they read from across the kitchen. Actions: **Add ingredients to a list**, **Plan this** (choose a day), **Edit**, **Archive** (second tap confirms).
- Edit view: title/servings/source/notes fields, and ingredient and step lines that add, edit, reorder (↑/↓) and remove. Recipe editing requires a connection; offline it shows "Recipes need a connection."

### 5.3 Add ingredients to a list

A sheet: list chips (defaulting to the household's default list), then one checkbox per ingredient, all checked. **Add 7 items** emits one `grocery.add` command per checked ingredient onto the chosen list, then closes with the standard saved toast. Items are copied as plain text; duplicates are allowed.

### 5.4 Screen — Meals tab

- Seven day cards for the current household week (today first, then the next six days), each showing the weekday, the date, and the planned dinner (recipe title or free text) or "Not planned".
- Tapping a day opens a sheet: **Choose a recipe** (searchable list), **Type it** (free text ≤ 80), or **Clear**.

### 5.5 Tonight's dinner on the main screen

The meal plan becomes the source of truth for the main screen's dinner line.

- `DinnerLine` shows today's meal-plan entry — the recipe's title, or the free text — and "Not planned" when there is none.
- The long-press edit opens the existing `DinnerSheet`, which now reads and writes **today's meal-plan entry** as free text. Where the day is planned from a recipe, the sheet shows the recipe title and offers **Clear** only, with a line: "Planned from the recipe box. Change it on the Kitchen screen."
- The migration copies each household's `dinner_tonight` onto today's meal-plan entry (today in that household's own time zone) and nothing writes `households.dinner_tonight` again. The `dinner.set` command stays in the command union so anything already queued still replays, but no screen emits it.
- The plan rolls over at household midnight on its own, because the day is read from the tablet's clock — the bug that a stale free-text dinner could linger for days goes away.

## 6. Data model

New tables, all household-owned, all under `private.is_household_member(household_id)` RLS with a `for all to authenticated` policy, all published to Realtime with full replica identity.

| Entity | Key fields |
|---|---|
| **ShoppingList** | id, householdId, name (1–40), createdAt, archivedAt · `unique (id, household_id)` for composite FKs |
| **GroceryItem** *(existing, extended)* | + listId (not null, composite FK `(list_id, household_id)`, filled by a `before insert` trigger when absent) |
| **Task** | id, householdId, text (1–100), assignedMembershipId (nullable, composite FK), dueOn (date, nullable), displayId, createdAt, doneAt |
| **Recipe** | id, householdId, title (1–80), sourceUrl (nullable, ≤ 500), servings (nullable, 1–99), notes (nullable, ≤ 2000), createdAt, archivedAt |
| **RecipeIngredient** | id, householdId, recipeId (composite FK), text (1–100), sort (0–199) |
| **RecipeStep** | id, householdId, recipeId (composite FK), text (1–500), sort (0–199) |
| **MealPlanEntry** | id, householdId, day (date), recipeId (nullable, composite FK), text (nullable, ≤ 80), createdAt · `unique (household_id, day)` · `check (recipe_id is not null or text is not null)` |

Retention: meal-plan entries older than 60 days and grocery items checked more than 30 days ago are removed by the existing purge job. Tasks completed more than 90 days ago are removed the same way.

Export: every new table joins `EXPORT_TABLES` in `supabase/functions/_shared/exportBuilder.ts`.

## 7. Client architecture

### 7.1 Commands (offline-capable)

New `LogCommand` kinds, each with an `applyCommand` case, an `inverseCommand` case, a `supabaseLogWriter` case and, where a rule must be enforced, an RPC:

| Kind | Payload | Inverse |
|---|---|---|
| `list.add` | list | `list.archive` |
| `list.rename` | listId, name, previousName | `list.rename` (swapped) |
| `list.archive` | listId, previousArchivedAt | `list.restore` |
| `list.restore` | listId | `list.archive` |
| `grocery.add` *(extended)* | item (now carries `listId`) | `grocery.delete` |
| `task.add` | task | `task.delete` |
| `task.check` | taskId, doneAt, previousDoneAt | `task.check` (swapped) |
| `task.update` | taskId, text, assignedMembershipId, dueOn, previous{…} | `task.update` (swapped) |
| `task.delete` | task | `task.add` |
| `meal.set` | day, recipeId, text, previous{recipeId, text} \| null | `meal.set` / `meal.clear` |
| `meal.clear` | day, previous{recipeId, text} | `meal.set` |

Every command carries client-generated UUIDs and every write is idempotent by id, as the offline queue requires.

### 7.2 Recipe authoring API (online only)

Recipes, ingredients and steps are authored through a new `src/data/recipeApi.ts`, shaped exactly like `takeListApi.ts`: a `RecipeError` with a `'denied' | 'invalid' | 'network' | 'other'` code union, a `RecipeApi` interface, `createSupabaseRecipeApi(client)`, a demo implementation, and a lazy `loadRecipeApi()`. Reads come from the snapshot; only writes go through the API.

### 7.3 Snapshot

`HouseholdSnapshot` grows four **optional** arrays (optional so a device-cached snapshot from an older build still loads): `shoppingLists?`, `tasks?`, `recipes?` (each with its ingredients and steps), `mealPlan?`. `supabaseSource` loads them in the existing `Promise.all` and subscribes to the new tables through `HOUSEHOLD_FILTERED_TABLES`.

Load windows: lists where `archived_at is null`; grocery items unchanged (unchecked, or checked in the last 24 h); tasks where `done_at is null or done_at >= now() - 24h`; recipes where `archived_at is null`, with all their ingredients and steps; meal-plan entries for the 14 days around today.

### 7.4 Screens

```
src/features/kitchen/
  KitchenScreen.vue        tabs, night/nap participation, session, route guard
  kitchenModel.ts          pure: tab state, per-tab derivation from the snapshot
  ShoppingTab.vue          shoppingModel.ts
  TodoTab.vue              todoModel.ts
  MealsTab.vue             mealsModel.ts
  RecipesTab.vue           recipesModel.ts
  TaskSheet.vue            add/edit a task
  ListNameSheet.vue        new list / rename list
  RecipeEditor.vue         create and edit a recipe
  AddIngredientsSheet.vue  push ingredients onto a list
  PlanDaySheet.vue         set or clear a day's dinner
```

Each `*Model.ts` is pure (no Vue import) with a colocated test; the `.vue` files are a `computed` over the model plus the template, as `mainScreenModel.ts` / `MainScreen.vue` do today.

Routing: `/kitchen` with `meta: { requires: 'registered' }`, lazily imported. The tab is in the query (`/kitchen?tab=todo`) so a reload comes back to the same tab.

## 8. Error and empty states

| Situation | Behavior |
|---|---|
| **Offline on the Kitchen screen** | Shopping, To-do and Meals keep working from local data and queue; the Recipes tab shows "Recipes need a connection" in place of its editing actions |
| **Last list archived** | "A household keeps at least one list." The Archive action is disabled |
| **Limit reached** | "This list holds 200 items." / "6 lists is the maximum." / "A recipe holds 50 ingredients." — inline, never a blocking dialog |
| **Recipe planned then archived** | The meal-plan entry keeps the day and shows the recipe's title; archiving never empties a plan |
| **Empty states** | Shopping: "Nothing on this list yet." To-do: "Nothing to do." Meals: "Not planned." Recipes: "No recipes yet — add the first one." |

## 9. Testing

- **Pure models** — `kitchenModel`, `shoppingModel`, `todoModel`, `mealsModel`, `recipesModel`: grouping, sorting, counts, filters, limits, the meal-plan-to-dinner resolution.
- **Data layer** — `applyCommand` / `inverseCommand` / `mappers` / `supabaseLogWriter` cases for every new command, each asserted idempotent as the existing tests do.
- **Screens** — `KitchenScreen.test.ts` mounting against the demo source: add and check an item on a second list, complete a task and see the badge fall, push three ingredients onto a list, plan a day and see the main screen's dinner line follow.
- **Main screen** — `DinnerLine` renders the plan, falls back to "Not planned", and the sheet edits today's entry.
- **RLS** — `supabase/manual-checks/rls_smoke.sql` gains checks per new table: cross-household blindness, policy shape, realtime and replica identity, privileges, and the `before insert` list-default trigger. It must still print `ALL RLS SMOKE CHECKS PASSED`.

## 10. Launch gate for this work

`pnpm typecheck` and `pnpm test` pass; `bash supabase/manual-checks/validate-local.sh` applies the new migration; `rls_smoke.sql` passes.
