# Real CLI output

Made by `examples/cli-check.sh` on 2026-11-09 with supabase 3.1.0 and 2.122.1,
Node v22.23.4, Linux. Every command runs with no TTY and `CI=true`, the way a CI runner calls it.
Database commands point at an in-memory Postgres on 127.0.0.1 (PGlite), so no hosted project is involved.
Lines the CLI prints about a newer version being available are dropped.

## [inbucket] breaks every command that loads the config

Rule `inbucket-section`. v2 warns, v3 stops.

```console
$ supabase@3.1.0 status
Not linked.
[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

```console
$ supabase@2.122.1 status
Not linked.
WARN: config section [inbucket] is deprecated and will be removed in v3, use [local_smtp] instead.
failed to inspect container health: docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

```console
$ supabase@3.1.0 status
Not linked.
failed to inspect container health: docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

## Removed commands and flags exit 1 and name the replacement

Rules `removed-command` and `removed-flag`.

```console
$ supabase@3.1.0 db remote commit
supabase db remote commit was removed.
Use `supabase db pull --remote` instead.
[exit 1]
```

```console
$ supabase@3.1.0 db remote changes
supabase db remote changes was removed.
Use `supabase db diff --remote` instead.
[exit 1]
```

```console
$ supabase@3.1.0 gen keys
supabase gen keys was removed.
Use `supabase projects api-keys --remote=<ref>` to read a project's API keys.
[exit 1]
```

```console
$ supabase@3.1.0 db branch list
supabase db branch list was removed.
Local database branches are no longer supported. For hosted preview branches, see `supabase branches --help`.
[exit 1]
```

```console
$ supabase@3.1.0 inspect db total-index-size
supabase inspect db total-index-size was removed.
Use `supabase inspect db index-stats` instead.
[exit 1]
```

```console
$ supabase@3.1.0 inspect db total-table-sizes
supabase inspect db total-table-sizes was removed.
Use `supabase inspect db table-stats` instead.
[exit 1]
```

```console
$ supabase@3.1.0 db diff --use-pg-schema
--use-pg-schema was removed.
Use the default pg-delta engine or --use-migra.
[exit 1]
```

```console
$ supabase@3.1.0 db pull --use-pg-delta
--use-pg-delta was removed.
Use --declarative to pull the declarative schema. The diff engine is chosen with --diff-engine or experimental.pgdelta.enabled in the config file.
[exit 1]
```

```console
$ supabase@3.1.0 functions download hello --legacy-bundle
--legacy-bundle was removed.
Retry with `supabase functions download --use-api hello` to unbundle server-side without Docker. If that also fails and the Function was deployed with a CLI older than 1.120.0, redeploy it with the current CLI.
[exit 1]
```

```console
$ supabase@3.1.0 domains get --include-raw-output
--include-raw-output was removed.
Use -o json instead.
[exit 1]
```

```console
$ supabase@3.1.0 status --create-ticket
--create-ticket was removed.
Report CLI problems with `supabase issue bug`.
[exit 1]
```

## Deprecated target flags still work in v3, with a warning

Rule `deprecated-target-flag`. The errors after the warning come from having no linked project or login here.

```console
$ supabase@3.1.0 migration list --linked
Warning: --linked is deprecated and will be removed in v4. Use --remote instead
Cannot find project ref. Have you run supabase link?
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

```console
$ supabase@3.1.0 gen types typescript --project-id abcdefghijklmnopqrst
Warning: --project-id is deprecated and will be removed in v4. Use --remote=<ref> instead
Target: project abcdefghijklmnopqrst
Access token not provided. Supply an access token by running `supabase login` or setting the SUPABASE_ACCESS_TOKEN environment variable.
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

```console
$ supabase@3.1.0 migration list --db-url postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Warning: --db-url is deprecated and will be removed in v4. Use --remote=<db-url> instead
Target: custom Postgres (127.0.0.1:55432)

  
   Local            | Remote | Time (UTC)            
  ------------------|--------|-----------------------
   `20261101000000` | ` `    | `2026-11-01 00:00:00` 
[exit 0]
```

```console
$ supabase@3.1.0 migration list --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)

  
   Local            | Remote | Time (UTC)            
  ------------------|--------|-----------------------
   `20261101000000` | ` `    | `2026-11-01 00:00:00` 
[exit 0]
```

## A bare db push now targets the local stack

Rule `remote-flag-missing`. v2 went to the linked project (here: none linked).

```console
$ supabase@3.1.0 db push
Target: local stack (127.0.0.1:54322)
failed to connect to postgres: failed to connect to `host=127.0.0.1 user=postgres database=postgres`: dial error (connect ECONNREFUSED 127.0.0.1:54322)
Make sure Docker is running, then run: supabase start
[exit 1]
```

```console
$ supabase@2.122.1 db push
Cannot find project ref. Have you run supabase link?
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

## Hosted changes need --yes when the CLI can't ask

Rules `yes-flag-missing`, `piped-confirmation` and `supabase-yes-in-env-file`. A database URL counts as a hosted target.

```console
$ supabase@3.1.0 db push --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmation required: Apply 1 migration (target: custom Postgres (127.0.0.1:55432)). This run can't ask because stdout is not a terminal. Nothing was changed.
Re-run with --yes to confirm.
[exit 1]
```

```console
$ echo y | supabase@3.1.0 db push --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmation required: Apply 1 migration (target: custom Postgres (127.0.0.1:55432)). This run can't ask because stdout is not a terminal. Nothing was changed.
Re-run with --yes to confirm.
[exit 1]
```

```console
$ supabase@3.1.0 db push --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmation required: Apply 1 migration (target: custom Postgres (127.0.0.1:55432)). This run can't ask because stdout is not a terminal. Nothing was changed.
Re-run with --yes to confirm. SUPABASE_YES in supabase/.env does not confirm hosted changes; pass --yes.
[exit 1]
```

```console
$ supabase@3.1.0 db push --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable -o json
Target: custom Postgres (127.0.0.1:55432)
Confirmation required: Apply 1 migration (target: custom Postgres (127.0.0.1:55432)). This run can't ask because it writes machine-readable -o json output. Nothing was changed.
Re-run with --yes to confirm.
[exit 1]
```

```console
$ supabase@3.1.0 db push --yes --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmed by --yes: Apply 1 migration on custom Postgres (127.0.0.1:55432)
Applying migration 20261101000000_notes.sql...
Finished supabase db push.
[exit 0]
```

```console
$ supabase@3.1.0 migration list --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)

  
   Local            | Remote           | Time (UTC)            
  ------------------|------------------|-----------------------
   `20261101000000` | `20261101000000` | `2026-11-01 00:00:00` 
[exit 0]
```

## The forms --fix writes run on v3

Flags moved to the end as the guide asks, values attached with =.

```console
$ supabase@3.1.0 migration repair 20261101000000 --status reverted --yes --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmed by --yes: Mark 1 migration as reverted on custom Postgres (127.0.0.1:55432)
Repaired migration history: [20261101000000] => reverted
Finished supabase migration repair.
Run supabase migration list --remote=<db-url> to show the updated migration history.
[exit 0]
```

```console
$ supabase@3.1.0 migration repair 20261101000000 --status applied --yes --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
Confirmed by --yes: Mark 1 migration as applied on custom Postgres (127.0.0.1:55432)
Repaired migration history: [20261101000000] => applied
Finished supabase migration repair.
Run supabase migration list --remote=<db-url> to show the updated migration history.
[exit 0]
```

```console
$ supabase@3.1.0 inspect db table-stats --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)

  
   Name         | Table size | Index size | Total size | Estimated row count | Seq scans 
  --------------|------------|------------|------------|---------------------|-----------
   public.notes | 0 bytes    | 8192 bytes | 8192 bytes | 0                   | 1         
[exit 0]
```

```console
$ supabase@3.1.0 gen types typescript --schema public --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable | head -3

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

Target: custom Postgres (127.0.0.1:55432)
Connecting to 127.0.0.1 55432
Generated TypeScript is unformatted. Format it with:
  npx oxfmt <generated-file.ts>
[exit 0]
```

## An AI agent never gets a prompt

A db push with a new migration and `CLAUDECODE=1` set the way Claude Code sets it. The CLI's `--agent` flag overrides the detection.

```console
$ CLAUDECODE=1 supabase@3.1.0 db push --remote=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Target: custom Postgres (127.0.0.1:55432)
{"target":{"kind":"db-url","host":"127.0.0.1","port":55432},"_tag":"Error","error":{"code":"HostedMutationConsentRequiredError","message":"Confirmation required: Apply 1 migration (target: custom Postgres (127.0.0.1:55432)). This run can't ask because it is running in agent mode. Nothing was changed.","suggestion":"This is an agent run: ask the user before re-running with --yes."}}
[exit 1]
```

## v2 pushed the same migration without asking

For comparison: v2 with `--db-url` in the same non-interactive run.

```console
$ supabase@2.122.1 db push --db-url postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20261102000000_tags.sql
 [Y/n] 
Applying migration 20261102000000_tags.sql...
Finished supabase db push.
[exit 0]
```

## --remote takes its value only with =

Rule `remote-value-without-equals`.

```console
$ supabase@3.1.0 db pull --remote add_profiles
Cannot find project ref. Have you run supabase link?
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

```console
$ supabase@3.1.0 db pull add_profiles --remote
Cannot find project ref. Have you run supabase link?
Try rerunning the command with --debug to troubleshoot the error.
[exit 1]
```

## secrets unset and the --remote / --yes help text

Rule `secrets-unset-without-names` needs a login to reach the check, so only the help is shown.

```console
$ supabase@3.1.0 db push --help | grep
  Local by default. Pass --remote for the linked project, or --remote=<ref|branch|url>.
  --remote[=<ref|branch|url>]    Target a remote database: the linked project, or --remote=<ref|branch|url>.
  --password, -p string          Database password for the project selected with --remote. Not used for the local database or a database URL.
  --yes                                                               answer yes to all prompts; hosted changes only accept this flag or SUPABASE_YES exported in your shell, never supabase/.env or another .env file
    May be required (with --remote, without --password):
    May be required (with --remote):
    Optional, with --remote, without --password (command still runs without these):
    Optional, with --remote (command still runs without these):
[exit 0]
```

```console
$ supabase@3.1.0 functions deploy --help | grep
  Remote only. Uses the linked project; pass --remote=<ref|branch> for another.
  --remote[=<ref|branch>]    Target another project: --remote=<ref|branch>. Defaults to the linked project.
  --yes                                                               answer yes to all prompts; hosted changes only accept this flag or SUPABASE_YES exported in your shell, never supabase/.env or another .env file
  supabase functions deploy --remote=abcdefghijklmnopqrst
[exit 0]
```

```console
$ supabase@3.1.0 secrets unset --help | grep
  Remote only. Uses the linked project; pass --remote=<ref|branch> for another.
  --remote[=<ref|branch>]    Target another project: --remote=<ref|branch>. Defaults to the linked project.
  --all                      Unset every secret except SUPABASE_ ones. Required when no names are given.
  --yes                                                               answer yes to all prompts; hosted changes only accept this flag or SUPABASE_YES exported in your shell, never supabase/.env or another .env file
  supabase secrets unset --all
  # Preview which secrets --all would unset
  supabase secrets unset --all --dry-run
    Required with --all:
[exit 0]
```

```console
$ supabase@3.1.0 gen types --help | grep
  Local by default. Pass --remote for the linked project, or --remote=<ref|branch|url>.
  --remote[=<ref|branch|url>]      Target a remote database: the linked project, or --remote=<ref|branch|url>.
  --yes                                                               answer yes to all prompts; hosted changes only accept this flag or SUPABASE_YES exported in your shell, never supabase/.env or another .env file
  supabase gen types --lang=go --remote
  supabase gen types --schema public --schema private --remote=abcdefghijklmnopqrst
  supabase gen types --schema public --schema auth --remote='postgresql://...'
  Only needed with --remote.
[exit 0]
```
