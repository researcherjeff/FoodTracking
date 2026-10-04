# FoodTracker Cloud Edition

This is the cloud-backed version of the FoodTracker web app. It uses a static HTML/CSS/JavaScript front end, Supabase Auth for accounts, and Supabase Postgres for synchronized data.

## What is included

- Account creation, login, logout, password reset, and password update flow
- Cloud-synced foods
- Favorites and recent foods
- Portion-based food logging
- Date navigation
- Copy meal / copy entire day
- Edit and delete meal entries
- Recipes and recipe ingredients
- Saved meal templates
- Daily nutrition goals
- 7-day averages and goal progress
- History with clickable dates
- JSON backup/export and import
- Responsive phone/tablet/desktop layout
- PWA manifest and service worker

## Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase/schema.sql` in full.
4. In Supabase, open your project's Connect/API settings and copy the Project URL and browser-safe publishable key. The legacy `anon` key also works with this client if your project still exposes it.
5. Copy `config.example.js` to `config.js`.
6. Put your real values into `config.js`:

```js
window.FOODTRACKER_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_BROWSER_SAFE_KEY"
};
```

Do not put a Supabase `service_role` or secret key in `config.js` or in any browser code. Access is protected by Postgres Row Level Security policies tied to the signed-in user's `auth.uid()`.

## Email confirmation / password reset

Supabase Auth can send confirmation and password-reset emails. For local testing, the site's current URL needs to be allowed in the Auth redirect URL settings. If email confirmation is enabled, a new account may need to click the email before logging in.

## Run locally

Because the app uses ES modules and a service worker, run it through a local HTTP server rather than opening `index.html` directly with `file://`.

From the project folder:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

## Deploy

This is a static site. It can be deployed to any static hosting provider that serves the files over HTTPS. Update `config.js` with your Supabase project values before publishing.

## Data model

The cloud schema mirrors the app's core Android data model:

- `foods`
- `meal_entries`
- `daily_goals`
- `recipes`
- `recipe_ingredients`
- `meal_templates`
- `meal_template_entries`

Every user-owned row contains `user_id`, and the SQL enables Row Level Security and grants authenticated users access only to rows belonging to their own `auth.uid()`.

## Backup

The Settings page has Export Backup and Import Backup. The backup is JSON and is useful as a portability/safety copy even though the main data now lives in the cloud.
