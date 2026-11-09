#!/usr/bin/env bash
set -euo pipefail

# Called from CI through `npm run release`.
supabase inspect db total-table-sizes --linked
yes | supabase functions deploy hello --project-ref "$PROJECT_REF"
supabase secrets unset
URL="$(supabase status -o env | grep INBUCKET_URL)"
echo "$URL"
