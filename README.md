# FoodTracker Cloud Edition — Android parity website

FoodTracker is a static HTML/CSS/JavaScript app backed by Supabase Auth and PostgreSQL. The website uses the same Supabase project and account as the Android app. Website account creation and password changes require at least 8 characters, matching Android. Updates made on the website are written directly to the cloud; unlike Android's Room database, the website has no separate local database or offline write queue.

## Android features implemented in the website

- **Today / food diary:** date navigation, diary entries grouped by Breakfast/Lunch/Dinner/Snack, per-day nutrition totals, macro progress, quick log favorites/recent foods, serving/portion adjustment, editing/deleting entries, copy a meal or an entire day, and save/log reusable meals.
- **Food library:** search by name or serving size; All/Favorites/Recent filters; sort by name, calories, protein, or carbs; duplicate/edit/delete/favorite foods; CSV import with validation and duplicate detection; saved-food CSV export and a starter template.
- **USDA food database:** search USDA FoodData Central; review brand/source and serving size; preview estimated nutrition for the number of servings; select a destination meal; save to My Foods or Save & Log Today. USDA's per-100 g/ml nutrient values are scaled to a returned gram/ml serving when one is provided; when it is not, the app explicitly uses a 100 g basis.
- **Recipes:** create/edit/delete recipes, add saved foods as ingredients, adjust ingredient quantities, see estimated nutrition per serving, and log a recipe to a chosen meal and serving count.
- **Saved meals:** search by meal name or meal type; expand ingredient details; inspect calories, protein, carbs, fat and fiber; choose a destination meal; choose 0.5×, 1×, 1.5× or 2× portions; log or delete a saved meal.
- **History:** 7-/30-day calorie chart, daily averages, current-week vs previous-week comparisons, goal consistency, and clickable logged days to return to the diary.
- **Goals:** edit calorie/protein/carbs/fat/fiber targets; view progress and remaining/over-goal context; review last-seven-days consistency using logged days.
- **Weekly planner:** Monday–Sunday navigation; planned meal templates and portion multipliers; planned calorie/protein estimates; day readiness status; quick-add by meal slot; log due planned meals or remove them.
- **Groceries:** generate a checklist from the selected week, combine matching foods, add recipe-ingredient snapshots and manual items, categorize, edit/remove, check off/uncheck, clear checks, share/copy, and print/save as PDF.
- **Data portability:** JSON full backup export/import (including Android `FoodTracker.FullBackup` files), diary CSV, food-library CSV import/export, and daily/weekly nutrition reports that can be saved as PDFs.
- **Quality-of-life behavior:** remembers food-library search/filter/sort, expanded Quick Log and macro details, and the last-used meal on this browser; an Undo action appears after deleting a diary entry; Escape closes dialogs; and a clear warning appears when the browser goes offline because cloud edits are not queued locally.
- Responsive layout, seven-tab bottom navigation, swipe navigation on touch screens, PWA manifest and service worker.

For the detailed feature-by-feature comparison, validation scope and remaining platform/setup differences, see [`PARITY_AUDIT.md`](PARITY_AUDIT.md).

## Configuration

`config.js` must contain your Supabase project URL and a **publishable** (or legacy `anon`) browser key:

```js
window.FOODTRACKER_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_BROWSER_SAFE_KEY"
};
```

The included `config.js` retains the values from the supplied project. Publishable/anon keys are intended for browser clients when Row Level Security is configured correctly. **Never put a Supabase `service_role`/secret key or the USDA API key into `config.js`, `app.js`, or any public repository.**

## Enable USDA FoodData Central search

The UI, server-side Edge Function source and deployment scripts are included. The external service still requires a USDA API key and permission to deploy to your Supabase project; the key cannot safely be bundled into a static website ZIP.

### Windows (PowerShell)

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and obtain a USDA FoodData Central API key from [FoodData Central](https://fdc.nal.usda.gov/api-key-signup.html).
2. Open PowerShell in the extracted `FoodTracking-main` folder and sign in to the CLI if needed:

   ```powershell
   supabase login
   .\scripts\deploy-food-search.ps1
   ```

3. The script reads the project reference from `config.js`, lets you confirm it, prompts for the USDA key without echoing it, sets `USDA_API_KEY` as a Supabase Edge Function secret, deploys `food-search`, and deletes its temporary secret file. Confirm the project reference before accepting the default.
4. Sign in to FoodTracker and open **Foods → Search Food Database**. Search for a food, choose **Review Food**, then save it or save and log it to today's diary.

### macOS / Linux

Install the Supabase CLI, run `supabase login`, then from `FoodTracking-main` run:

```bash
bash scripts/deploy-food-search.sh
```

The `food-search` function is configured with JWT verification enabled in `supabase/config.toml`; it requires a signed-in FoodTracker session. The USDA key remains server-side. If the search panel reports that the function is missing or the key is not configured, rerun the deployment script and check its CLI output.

## Supabase tables and migrations

### Brand-new Supabase project

1. Open **Supabase Dashboard → SQL Editor**.
2. Run `supabase/schema.sql`.
3. Run the migrations below in date order.

### Existing project already used by Android

Do not rerun the base schema on a populated database. Check whether these migrations were already applied, and run only missing ones:

- `supabase/migrations/20261012_planned_meals_sync.sql` — cross-device weekly planner assignments.
- `supabase/migrations/20261013_grocery_list_cloud_sync.sql` — manual grocery items, recipe ingredient snapshots, and grocery check states.

The website detects missing planner/grocery tables and displays a setup notice rather than blocking diary functionality. These SQL files are included; a static ZIP cannot apply database schema changes to your live Supabase project without your authenticated admin action.

## Run locally

Serve the folder over HTTP (not `file://`, because ES modules and service workers require HTTP):

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to GitHub Pages

Publish the **contents of `FoodTracking-main`** (the folder containing `index.html`) as the site root. Keep `index.html`, `styles.css`, `app.js`, `config.js`, `manifest.json`, `sw.js`, `assets/`, `supabase/`, and `scripts/` together. The static site can be hosted on GitHub Pages; the Edge Function is deployed separately to Supabase using the script above.

For email confirmation and password recovery, set the deployed site URL in **Supabase → Authentication → URL Configuration**, add the deployed URL to the redirect allowlist, and configure email templates to return users to FoodTracker.

## Backup and import notes

- Website backup import validates account/project ownership when the backup includes that metadata and merges records rather than deleting existing cloud data. This is intentionally safer for a shared website/Android cloud account than replacing all remote records.
- Android backup `cloud_sync_map` rows are not copied into the web database; the website writes directly to Supabase and uses cloud IDs, not Android Room IDs.
- A backup contains personal diary, recipe, planner and grocery information. Keep it private. Authentication sessions, passwords, Supabase keys and USDA API keys are not included.
- CSV import accepts Name and Calories as required headers. Serving Size and nutrition columns are optional; absent serving size defaults to `1 serving` and absent macros default to `0`. Duplicate food name + serving-size pairs are skipped.
