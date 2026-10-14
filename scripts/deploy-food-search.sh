#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v supabase >/dev/null 2>&1 || {
  echo "Supabase CLI was not found. Install it first: https://supabase.com/docs/guides/cli" >&2
  exit 1
}

DEFAULT_REF="$(sed -nE 's/.*https:\/\/([a-z0-9-]+)\.supabase\.co.*/\1/p' "$ROOT/config.js" | head -n1 || true)"
if [[ -n "$DEFAULT_REF" ]]; then
  read -r -p "Supabase project ref [$DEFAULT_REF]: " PROJECT_REF
  PROJECT_REF="${PROJECT_REF:-$DEFAULT_REF}"
else
  read -r -p "Supabase project ref: " PROJECT_REF
fi
[[ "$PROJECT_REF" =~ ^[a-z0-9]{20,30}$ ]] || {
  echo "Invalid project ref. Use the subdomain before .supabase.co in your Supabase URL." >&2
  exit 1
}

read -r -s -p "USDA FoodData Central API key: " USDA_API_KEY
echo
[[ -n "$USDA_API_KEY" && "$USDA_API_KEY" != *$'\n'* ]] || {
  echo "A valid USDA API key is required." >&2
  exit 1
}
TEMP_ENV="$ROOT/.food-search-secret.tmp.env"
cleanup() { rm -f "$TEMP_ENV"; unset USDA_API_KEY; }
trap cleanup EXIT
printf 'USDA_API_KEY=%s\n' "$USDA_API_KEY" > "$TEMP_ENV"
chmod 600 "$TEMP_ENV"
cd "$ROOT"
supabase secrets set --project-ref "$PROJECT_REF" --env-file "$TEMP_ENV"
supabase functions deploy food-search --project-ref "$PROJECT_REF"
echo "Food database search deployed. Open FoodTracker → Foods → Search Food Database to test it."
