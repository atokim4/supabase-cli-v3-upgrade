#!/usr/bin/env bash
# Runs the real Supabase CLI (v3 and v2.stable) against the claims this tool makes that can be checked
# without a hosted project or Docker, and writes examples/LOGS.md.
#
# Needs Node 22+ and network access to npm. The database commands talk to an in-memory Postgres
# (PGlite's socket server) on 127.0.0.1, so nothing outside this machine is touched.
#
#   bash examples/cli-check.sh            # CLI 3.1.0 and 2.122.1 (the versions LOGS.md was made with)
#   V3=latest V2=v2.stable bash examples/cli-check.sh
set -uo pipefail

V3="${V3:-3.1.0}"
V2="${V2:-2.122.1}"
PGLITE_SOCKET="0.2.19"
PORT="${PORT:-55432}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/LOGS.md"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/v3check-cli.XXXXXX")"
trap 'kill "$PG_PID" 2>/dev/null; rm -rf "$WORK"' EXIT

install() { mkdir -p "$WORK/$1" && (cd "$WORK/$1" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund "$2" >/dev/null); }
echo "Installing supabase@$V3, supabase@$V2 and @electric-sql/pglite-socket@$PGLITE_SOCKET into $WORK" >&2
install v3 "supabase@$V3" && install v2 "supabase@$V2" && install pg "@electric-sql/pglite-socket@$PGLITE_SOCKET" || exit 1
S3="$WORK/v3/node_modules/.bin/supabase"
S2="$WORK/v2/node_modules/.bin/supabase"

"$WORK/pg/node_modules/.bin/pglite-server" --port "$PORT" --host 127.0.0.1 >"$WORK/pg.log" 2>&1 &
PG_PID=$!
for _ in $(seq 1 50); do grep -q listening "$WORK/pg.log" && break; sleep 0.2; done
if ! kill -0 "$PG_PID" 2>/dev/null || ! grep -q listening "$WORK/pg.log"; then
  echo "PGlite didn't start on port $PORT (in use?). Set PORT=<free port>." >&2
  cat "$WORK/pg.log" >&2
  exit 1
fi
DB_URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres?sslmode=disable"

# A throwaway project: one migration, config.toml written per check.
PROJ="$WORK/project"
mkdir -p "$PROJ/supabase/migrations"
echo "create table if not exists notes (id int primary key);" >"$PROJ/supabase/migrations/20261101000000_notes.sql"
config() { printf 'project_id = "cli-check"\n\n[%s]\nenabled = true\nport = 54324\n' "$1" >"$PROJ/supabase/config.toml"; }

# A CI-like environment: no TTY, CI=true, no agent variables, telemetry off, a scratch HOME (no login).
ci() { env -i PATH="$PATH" HOME="$WORK/home" CI=true SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 "$@"; }
mkdir -p "$WORK/home"

{
  echo "# Real CLI output"
  echo
  echo "Made by \`examples/cli-check.sh\` on $(date -u +%Y-%m-%d) with supabase $("$S3" --version 2>/dev/null) and $("$S2" --version 2>/dev/null | head -1),"
  echo "Node $(node -v), $(uname -s). Every command runs with no TTY and \`CI=true\`, the way a CI runner calls it."
  echo "Database commands point at an in-memory Postgres on 127.0.0.1 (PGlite), so no hosted project is involved."
  echo "Lines the CLI prints about a newer version being available are dropped."
} >"$OUT"

# section <title> <note>
section() { printf '\n## %s\n\n%s\n' "$1" "$2" >>"$OUT"; }
# run <label> <cli> <args…>: runs in the project folder, records the command, its output and exit code.
run() {
  local label="$1" bin="$2"; shift 2
  local out code
  out="$(cd "$PROJ" && ci "$bin" "$@" </dev/null 2>&1)"; code=$?
  record "$label" "$*" "$out" "$code"
}
record() {
  local shown
  shown="$(printf '%s\n' "$3" | grep -v -e 'A new version of Supabase CLI' -e 'We recommend updating regularly' | sed "s#$WORK#<tmp>#g")"
  printf '\n```console\n$ %s %s\n%s\n[exit %s]\n```\n' "$1" "$2" "$shown" "$4" >>"$OUT"
}

config inbucket
section "[inbucket] breaks every command that loads the config" "Rule \`inbucket-section\`. v2 warns, v3 stops."
run "supabase@$V3" "$S3" status
run "supabase@$V2" "$S2" status
config local_smtp
run "supabase@$V3" "$S3" status

section "Removed commands and flags exit 1 and name the replacement" "Rules \`removed-command\` and \`removed-flag\`."
for args in "db remote commit" "db remote changes" "gen keys" "db branch list" "inspect db total-index-size" "inspect db total-table-sizes" \
  "db diff --use-pg-schema" "db pull --use-pg-delta" "functions download hello --legacy-bundle" "domains get --include-raw-output" "status --create-ticket"; do
  # shellcheck disable=SC2086
  run "supabase@$V3" "$S3" $args
done

section "Deprecated target flags still work in v3, with a warning" "Rule \`deprecated-target-flag\`. The errors after the warning come from having no linked project or login here."
run "supabase@$V3" "$S3" migration list --linked
run "supabase@$V3" "$S3" gen types typescript --project-id abcdefghijklmnopqrst
run "supabase@$V3" "$S3" migration list --db-url "$DB_URL"
run "supabase@$V3" "$S3" migration list --remote="$DB_URL"

section "A bare db push now targets the local stack" "Rule \`remote-flag-missing\`. v2 went to the linked project (here: none linked)."
run "supabase@$V3" "$S3" db push
run "supabase@$V2" "$S2" db push

section "Hosted changes need --yes when the CLI can't ask" "Rules \`yes-flag-missing\`, \`piped-confirmation\` and \`supabase-yes-in-env-file\`. A database URL counts as a hosted target."
run "supabase@$V3" "$S3" db push --remote="$DB_URL"
out="$(cd "$PROJ" && echo y | ci "$S3" db push --remote="$DB_URL" 2>&1)"; record "echo y | supabase@$V3" "db push --remote=$DB_URL" "$out" "$?"
echo "SUPABASE_YES=1" >"$PROJ/supabase/.env"
run "supabase@$V3" "$S3" db push --remote="$DB_URL"
rm "$PROJ/supabase/.env"
out="$(cd "$PROJ" && ci "$S3" db push --remote="$DB_URL" -o json </dev/null 2>&1)"; record "supabase@$V3" "db push --remote=$DB_URL -o json" "$out" "$?"
run "supabase@$V3" "$S3" db push --yes --remote="$DB_URL"
run "supabase@$V3" "$S3" migration list --remote="$DB_URL"

section "The forms --fix writes run on v3" "Flags moved to the end as the guide asks, values attached with =."
run "supabase@$V3" "$S3" migration repair 20261101000000 --status reverted --yes --remote="$DB_URL"
run "supabase@$V3" "$S3" migration repair 20261101000000 --status applied --yes --remote="$DB_URL"
run "supabase@$V3" "$S3" inspect db table-stats --remote="$DB_URL"
out="$(cd "$PROJ" && ci "$S3" gen types typescript --schema public --remote="$DB_URL" </dev/null 2>"$WORK/err" | head -3; cat "$WORK/err")"; record "supabase@$V3" "gen types typescript --schema public --remote=$DB_URL | head -3" "$out" 0

section "An AI agent never gets a prompt" "A db push with a new migration and \`CLAUDECODE=1\` set the way Claude Code sets it. The CLI's \`--agent\` flag overrides the detection."
echo "create table if not exists tags (id int primary key);" >"$PROJ/supabase/migrations/20261102000000_tags.sql"
out="$(cd "$PROJ" && ci CLAUDECODE=1 "$S3" db push --remote="$DB_URL" </dev/null 2>&1)"; record "CLAUDECODE=1 supabase@$V3" "db push --remote=$DB_URL" "$out" "$?"

section "v2 pushed the same migration without asking" "For comparison: v2 with \`--db-url\` in the same non-interactive run."
run "supabase@$V2" "$S2" db push --db-url "$DB_URL"

section "--remote takes its value only with =" "Rule \`remote-value-without-equals\`."
run "supabase@$V3" "$S3" db pull --remote add_profiles
run "supabase@$V3" "$S3" db pull add_profiles --remote

section "secrets unset and the --remote / --yes help text" "Rule \`secrets-unset-without-names\` needs a login to reach the check, so only the help is shown."
help() { local out; out="$(cd "$PROJ" && ci "$S3" "$@" --help 2>&1 | grep -E -e '--(remote|yes|all)\b' -e 'Local by default' -e 'Remote only')"; record "supabase@$V3" "$* --help | grep" "$out" 0; }
help db push
help functions deploy
help secrets unset
help gen types

echo "Wrote $OUT" >&2
