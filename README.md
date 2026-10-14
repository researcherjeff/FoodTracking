# FoodTracker Cloud Edition — Android parity update

FoodTracker is a static HTML/CSS/JavaScript web app backed by Supabase Auth and PostgreSQL. This update brings the main functionality from Android FoodTracker v1.11.7 into the website while keeping the same account and Supabase data model.

## Included website features

- Supabase account creation, login/logout, password reset, and password update.
- Daily food diary with date navigation, portion-based logging, editing/deleting entries, quick log, favorites/recent foods, copying meals or a full day, and reusable saved meals.
- Food library with search by name and serving size, All/Favorites/Recent filters, sorting by name/calories/protein/carbs, food duplication, edit/delete, saved-food CSV import/export, and a downloadable CSV template. Imports require Name and Calories; Serving Size and macro columns are optional and default to `1 serving` / `0` when omitted.
- Optional USDA FoodData Central search through the Supabase `food-search` Edge Function. Its API key stays on the server.
- Recipe builder, nutrition estimate per serving, and recipe logging.
- Weekly meal planner with Monday–Sunday navigation, portion multipliers, planned calorie/protein estimates, readiness status, and logging/removing planned meals.
- Weekly grocery list generated from planned meals, saved-recipe ingredient snapshots, manual items, category filters, checked state, editing/removal, share/copy, and print-to-PDF.
- Dedicated Goals & Progress screen with daily goal editor, progress bars, and 7-day goal-consistency summary.
- History with 7-/30-day averages, this-week vs previous-week averages, and clickable diary dates.
- Full JSON backup export/import (account/project validated; import merges rather than deleting existing cloud records), diary CSV export, saved-food CSV export, daily nutrition print/PDF report, weekly nutrition print/PDF report.
- Responsive layout, swipe navigation, PWA manifest, and service worker.

## Keep the existing configuration

`config.js` is retained from the supplied website ZIP. It must contain the Supabase Project URL and a **publishable** (or legacy `anon`) browser key:

```js
window.FOODTRACKER_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_BROWSER_SAFE_KEY"
};
```

Never put a Supabase `service_role` or secret key in browser code. The USDA API key must also remain a Supabase Edge Function secret.

## Supabase database setup

### If this is a brand-new Supabase project

1. Open **Supabase Dashboard → SQL Editor**.
2. Run `supabase/schema.sql` to create the base FoodTracker tables and user-scoped Row Level Security policies.
3. Run both migration files listed below, in date order.

### If the Android app already uses this Supabase project

Do **not** rerun the base schema just for this update. The Android app may already have its base tables. Check whether the following migrations were previously run, and only run the ones that are still missing:

- `supabase/migrations/20261012_planned_meals_sync.sql` — cross-device weekly meal planner.
- `supabase/migrations/20261013_grocery_list_cloud_sync.sql` — synced manual groceries, recipe ingredient snapshots, and checkbox state.

These tables are needed for planner/grocery parity. The website detects missing tables and shows a setup notice instead of preventing the food diary from opening.

## Optional USDA food-database search

The supplied Edge Function is at `supabase/functions/food-search/index.ts`. If it is not already deployed in your Supabase project:

1. Deploy the `food-search` Edge Function using the Supabase CLI or your usual Supabase workflow.
2. Add `USDA_API_KEY` as an Edge Function secret in Supabase.
3. Open Foods → **Search Food Database**.

Do not include the USDA API key in `config.js` or commit it to GitHub.

## Run locally

From this folder, run a local HTTP server (ES modules and service workers need HTTP rather than `file://`):

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to GitHub Pages

Publish the contents of `FoodTracking-main` (the folder containing `index.html`) as the site root. `index.html`, `styles.css`, `app.js`, `config.js`, `manifest.json`, `sw.js`, and `assets/` must all remain together. The website is static; Supabase credentials are the only site-specific configuration.

For Supabase Auth email confirmation and password recovery, set the exact deployed site URL in **Authentication → URL Configuration**, include the redirect URL in the allowlist, and make sure the confirmation email uses Supabase's `{{ .ConfirmationURL }}` template link.

## Backup notes

Full backup JSON files contain diary, foods, recipes, saved meals, goals, and (when enabled) planner/grocery data. The website can import Android `FoodTracker.FullBackup` JSON files as well as its own web backup format. Keep backups private. Restore validates the account and Supabase project when that metadata is present, then merges records into the current account; it does not delete existing cloud records. CSV diary export includes totals calculated from each entry's servings. Nutrition reports can be printed or saved to PDF from the browser print dialog.
