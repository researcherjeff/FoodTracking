# FoodTracker Android ↔ Website Parity Audit

**Compared against:** the supplied Android FoodTracker v1.11.7 project and the website ZIP in this conversation.

## Feature-by-feature mapping

| Android experience / capability | Website counterpart | Audit result |
|---|---|---|
| Account sign-in, create account, password reset/update | Supabase Auth screens and recovery form | Form behavior checked; signup and password-change minimum aligned to Android's 8 characters. Live auth was not tested. |
| Today diary with date navigation | Today view, previous/next day, date picker, Today shortcut | Browser interaction checked. |
| Four meal sections and Add Food for a chosen meal | Breakfast, Lunch, Dinner, Snack cards with preselected meal | Browser interaction checked. |
| Per-meal nutrition summary | Meal calorie total, item count, and empty state | Present and checked. |
| Calories/protein progress, remaining/over-goal context, extra macros | Nutrition summary with details toggle and goal screen shortcut | Present; integer/sub-one-unit wording aligned to Android. |
| Quick Log Favorites and Recent | Separate Favorites and Recent groups; Recent uses recently logged food items | Present and checked. |
| Food library search, All/Favorites/Recent, sorting | Search by name/serving size, three filters, calorie/protein/carb sorts, sort scroll-to-top | Present; query retention across filter changes checked. |
| Favorite, log, edit, duplicate, delete saved foods | Food-card actions | Present. Foods-screen Log targets today, matching Android. |
| USDA food database | Supabase Edge Function, search results, review step, serving preview, meal selection, save-only and save-and-log | Browser flow and Edge Function logic tested with mocks. Live USDA calls require deployment and an API key secret. |
| Recipes and ingredient picker | Create/edit/delete, ingredient search and quantity, per-serving nutrition, log with chosen meal/servings | Creation and logging flow checked; recipe Log targets today like Android. |
| Reusable saved meals | Search, ingredient details, nutrition, destination meal, 0.5×/1×/1.5×/2× portions, log/delete | Destination and portion behavior checked. |
| Copy a meal or an entire diary day | Copy dialogs that preserve source entries and add to a destination date | Implemented; live account behavior not tested. |
| History charts, averages, goal consistency, open a logged day | 7-/30-day trends, comparisons, clickable logged days, entry deletion | Present in code; main interaction reviewed. |
| Goals and progress | Goal editor, today's progress, seven-day consistency, PDF report | Goal persistence checked against mocked Supabase. |
| Weekly planner | Week/day selection, searchable saved-meal chooser, multipliers, estimated nutrition, readiness status, log/remove planned meals | Add/search/portion and planned-meal logging checked. |
| Grocery list | Generate from plans, recipe ingredient snapshots, manual items, categories, checkbox state, edit/remove, clear checked, share/print | Generation, checked-state persistence and manual-item creation checked. |
| CSV food import/export and template | Preview rows, validate, skip duplicates/invalid rows, import/export/template | Import preview, duplicate/invalid handling and import tested. |
| Diary CSV and nutrition reports | Diary CSV export and daily/weekly print-to-PDF reports | Present in code; external download/print dialogs depend on the browser. |
| Full backup and restore | JSON backup export/import; Android `FoodTracker.FullBackup` reader; account/project checks; merge behavior | Android-backup import tested with a fixture covering diary, foods, recipes, meals, goals, planner and groceries. Website import merges instead of deleting existing cloud data. |
| Refresh/sync data | Settings → Refresh Cloud Data; shared Supabase account | Refresh flow checked against a mocked cloud. Live sync was not tested. |

## Validation performed

- JavaScript syntax checks for `app.js` and `sw.js`.
- Browser interaction suite with mocked Supabase authentication/database.
- Food database review, serving calculations, destination-meal selection, save and log.
- Recipe create/ingredient/preserve-form/log flows; saved-meal search, details, destination and portion multiplier.
- CSV import preview and Android full-backup import/merge.
- Diary date jump, per-meal totals, Quick Log grouping, food search persistence, Today date for Foods/Recipes logging.
- Goal edits, weekly planner search/portion/logging, grocery checklist state and manual item creation.
- Edge Function mock tests for per-100g serving conversion, short-query validation, missing-secret handling and CORS preflight.
- Mobile viewport smoke test at 390 px wide, including horizontal-overflow checks for the Today, Planner and Goals screens.

All of the above simulated checks passed. They are not a substitute for a live authenticated Supabase session.

## Differences and required setup still to be aware of

1. **Browser offline behavior:** Android uses Room/local-first data and its own sync repository. The website reads and writes account data directly to Supabase and does not have an offline write queue; internet is required for user data and cloud operations. The service worker caches the website shell, not an editable offline database. Android changes show in the browser after Refresh Cloud Data or a page reload.
2. **Live USDA search:** deploy `supabase/functions/food-search` and set `USDA_API_KEY` as a Supabase Edge Function secret. The key must not be put into browser files or a public GitHub repository.
3. **Planner/grocery cloud tables:** apply `supabase/migrations/20261012_planned_meals_sync.sql` and `supabase/migrations/20261013_grocery_list_cloud_sync.sql` only if not already applied to the existing Supabase project.
4. **Restore semantics:** website backup import intentionally merges records into the current cloud account to avoid silently deleting records shared with Android. Android's full-backup restore replaces local Room tables. The website does not write Android's local `cloud_sync_map` table because it operates directly on cloud IDs.
5. **Live verification:** credentials and production data were not used for these tests. Successful login, real cloud syncing and deployed USDA requests must still be confirmed in your own deployed environment.
