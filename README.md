# supabase-cli-v3-upgrade

**Fix your CI for Supabase CLI v3 in 1 command.**

```bash
npx github:atokim4/supabase-cli-v3-upgrade --fix
```

No install: [check a public repo in the browser](https://upgrade-check-2026.netlify.app) (same engine, runs in the tab, reads up to 60 files; the CLI reads everything).

Supabase CLI v3.0.0 came out on 2026-11-02, and npm, Homebrew, Scoop and `supabase/setup-cli` now install it
by default. A pipeline that installs `latest` already runs v3. Its database commands now target the local stack
unless you pass `--remote`, every hosted change asks for confirmation (and fails in CI without `--yes`), and an
old `[inbucket]` section in `supabase/config.toml` stops `supabase start` from loading at all.

This tool reads the places the CLI gets called from, reports what breaks on v3, and with `--fix` rewrites the
cases that have exactly one correct answer. Every rule comes from a section of Supabase's
[migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) and links to it. The
claims that can be checked without a hosted project were run against the real CLI 3.1.0 and 2.122.1; the
output is in [examples/LOGS.md](examples/LOGS.md).

It is a personal project by Sunnatulla E., not affiliated with Supabase. Node 22+, no runtime dependencies.

## Before and after

From the [sample app](examples/sample-app) (made-up project, wired the way many v2 setups are):

```diff
       - name: Push migrations
-        run: supabase db push --linked --include-all
+        run: supabase db push --include-all --yes --remote

       - name: Generate types
         run: |
-          supabase gen types typescript --project-id "$PROJECT_REF" \
-            --schema public > src/types/database.ts
+          supabase gen types typescript \
+            --schema public --remote="$PROJECT_REF" > src/types/database.ts

       - name: Deploy functions and secrets
         run: |
-          supabase functions deploy --project-ref "$PROJECT_REF"
-          supabase secrets set --env-file supabase/.env.production
-          echo y | supabase config push
+          supabase functions deploy --yes --remote="$PROJECT_REF"
+          supabase secrets set --env-file supabase/.env.production --yes
+          supabase config push --yes
```

```diff
-[inbucket]
+[local_smtp]
 enabled = true
 port = 54324
```

`--remote` goes at the end of the command and before any redirection, which is what the guide asks for
(`supabase migration repair --linked 2024… --status reverted` becomes `… --status reverted --remote`).

## What it reads

| Where | How it runs |
| --- | --- |
| `.github/workflows/*.yml`, `.github/actions/*/action.yml` (`run:`) | CI |
| `.gitlab-ci.yml` (`script:`, `before_script:`, `after_script:`), `bitbucket-pipelines.yml`, `azure-pipelines.yml`, `.circleci/config.yml` | CI |
| `package.json` scripts, `*.sh`, `Makefile`, `Dockerfile` | CI when a CI file reaches them (`npm run release`, `bash scripts/deploy.sh`, `make`), a terminal otherwise |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/*`, `.cursorrules`, `.github/copilot-instructions.md`, `.claude/commands/*.md` | an AI agent (code blocks and inline code only) |
| `supabase/config.toml`, `supabase/config.json`, `.env*` files, `supabase/functions/*/import_map.json` | config |

It finds the CLI behind `npx`, `bunx`, `pnpm exec`, `yarn`, `npx supabase@latest`, env prefixes like
`SUPABASE_YES=1 supabase …`, line continuations and `$(…)`.

Where a command runs decides how bad a finding is. A hosted change without `--yes` is an error in CI (it fails
with `HostedMutationConsentRequiredError`), a warning in an agent doc (agents never get a prompt in v3, and the
CLI tells the agent to ask you first), and a note in a script you run by hand.

## The rules

| Rule | Level | `--fix` | What breaks | Guide section |
| --- | --- | --- | --- | --- |
| `inbucket-section` | error | yes | `[inbucket]` config section is removed | [Rename [inbucket] to [local_smtp]](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#inbucket) |
| `remote-flag-missing` | error | yes | Database command now targets the local stack | [Database commands target the local stack](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#database-commands-target-the-local-stack-by-default) |
| `yes-flag-missing` | error | yes | Hosted change without `--yes` in a run that can't prompt | [Commands that need --yes](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#commands-that-need---yes-in-unattended-runs) |
| `piped-confirmation` | error | yes | Piping y into the CLI no longer confirms | [Hosted changes need confirmation](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#hosted-changes-need-confirmation) |
| `deprecated-target-flag` | warning | yes | Deprecated target flag | [Deprecated target flags](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#deprecated-target-flags) |
| `remote-value-without-equals` | warning | yes | `--remote` value without = | [Use = with --remote](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#use--with---remote) |
| `removed-command` | error | yes | Removed command | [Removed commands and flags](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-commands-and-flags) |
| `removed-flag` | error | yes | Removed flag | [Removed commands and flags](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-commands-and-flags) |
| `secrets-unset-without-names` | error | no | secrets unset with no names | [secrets unset defaults to no](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#secrets-unset-defaults-to-no) |
| `supabase-go-binary` | error | no | supabase-go is no longer installed | [supabase-go is no longer installed](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#supabase-go-is-no-longer-installed) |
| `removed-config-key` | error | no | Removed or stricter config key | [Removed config keys and env vars](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-config-keys-and-environment-variables) |
| `function-import-map` | error | no | Per-function import_map.json is removed | [Removed config keys and env vars](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-config-keys-and-environment-variables) |
| `removed-env-var` | warning | yes | Removed or ignored environment variable | [Removed config keys and env vars](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-config-keys-and-environment-variables) |
| `inbucket-url` | warning | yes | INBUCKET_URL is no longer printed | [Removed config keys and env vars](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#removed-config-keys-and-environment-variables) |
| `password-with-url-target` | error | no | --password with a database URL | [Database passwords](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#database-passwords) |
| `diff-remote-with-from-to` | error | no | db diff with both --remote and --from/--to | [Other target changes](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#other-target-changes) |
| `declarative-diff` | warning | no | db diff no longer reads supabase/schemas | [pg-delta is the default diff engine](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#pg-delta-is-the-default-diff-engine) |
| `project-id-env-target` | warning | no | SUPABASE_PROJECT_ID no longer picks the target | [Database commands target the local stack](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#database-commands-target-the-local-stack-by-default) |
| `env-overrides-remotes` | warning | no | `SUPABASE_*` variables now beat `[remotes.<name>]` blocks | [Flags and env vars override config](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#flags-and-environment-variables-override-config) |
| `sms-confirmations-flip` | warning | no | `[auth.sms] enable_confirmations` now applies as written | [config push applies SMS confirmations as written](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#config-push-applies-sms-confirmations-as-written) |
| `supabase-yes-in-env-file` | warning | no | SUPABASE_YES in an env file doesn't count | [Hosted changes need confirmation](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#hosted-changes-need-confirmation) |
| `cli-version` | note | no | Which CLI version the workflow installs | [GitHub Actions](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#github-actions) |
| `enable-signup-deprecated` | note | yes | `enable_signup` in `[auth.email]` / `[auth.sms]` is deprecated | [deprecated-in-v3](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#deprecated-in-v3) |
| `project-id-missing` | note | no | No `project_id` in config.toml | [Local container names](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#local-container-names) |
| `error-name-renamed` | note | yes | Renamed error name | [Error names and messages](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#error-names-and-messages) |

`node v3check.mjs --list-rules` prints the same list.

## What `--fix` changes, and what it leaves to you

It rewrites only what has one right answer, keeps every other byte of the file, applies a finding's edits all
together or not at all, prints a unified diff, and then scans again so you see what is left:

- deprecated target flags to `--remote` / `--remote=<value>`, moved to the end; `--local` dropped; `--from linked` to `--from=remote`
- `--yes` on hosted changes in CI, and `echo y |` / `yes |` pipes replaced by `--yes`
- bare `db push`, `migration repair`, `db pull`, `db dump`, `inspect`, `storage` in CI get `--remote`, because v2 sent them to the linked project
- `--remote "$X"` to `--remote="$X"` when the value is a variable, a project ref or a Postgres URL
- `[inbucket]` to `[local_smtp]` (also under `[remotes.*]` and in `config.json`), `inbucket.url` to `mailpit.url`
- removed commands and flags that have a 1:1 replacement (`inspect db total-table-sizes`, `db remote commit`, `--legacy-bundle`, `--use-pg-delta` on `db pull`, `--include-raw-output`, `--create-ticket`)
- renamed env vars and error names, `enable_signup` to `enabled` when the section has no `enabled` yet

It only reports:

- `db push` and friends outside CI, or in a CI file that also runs `supabase start` (local or hosted is your call)
- agent instructions (whether an agent may pass `--yes` is your call)
- `secrets unset` with no names (v2 removed every secret; you decide whether you meant `--all`)
- `[auth.external.linkedin]` / `slack` (the OIDC providers need their own app settings), the SMS confirmation flip, `[remotes.*]` env precedence, declarative `db diff`, per-function import maps, `supabase-go`

Use `--diff` to see the changes without writing them.

## Usage

```bash
# from the repo root: report, exit 1 on errors
npx github:atokim4/supabase-cli-v3-upgrade

# rewrite the safe cases and show the diff
npx github:atokim4/supabase-cli-v3-upgrade --fix

# or the single-file build, no install
curl -fsSLO https://raw.githubusercontent.com/atokim4/supabase-cli-v3-upgrade/main/skills/supabase-cli-v3-upgrade/scripts/v3check.mjs
node v3check.mjs . --format markdown
```

Options: `--fix`, `--diff`, `--format text|json|markdown|sarif`, `--output <file>`,
`--fail-on error|warning|note|none` (default `error`), `--exclude <rule,rule>`, `--list-rules`.
Exit codes: 0 clean at the `--fail-on` level, 1 findings, 2 bad usage.

### GitHub Action

```yaml
name: Supabase CLI v3 check
on: [pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  v3-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - id: v3
        uses: atokim4/supabase-cli-v3-upgrade@main
        with:
          fail-on: error
      - uses: github/codeql-action/upload-sarif@v4
        if: always() && steps.v3.outputs.sarif-file != ''
        with:
          sarif_file: ${{ steps.v3.outputs.sarif-file }}
```

It writes annotations, a job summary table and a SARIF 2.1.0 file for code scanning. Inputs: `path`, `fail-on`,
`format` (`sarif` or `markdown`), `exclude`, `fix` (`true` rewrites the checkout so a later step can open a PR),
`sarif-file`. Outputs: `findings-count`, `errors-count`, `fixable-count`, `fixed-count`, `sarif-file`. There is no
tagged release yet, so pin a commit SHA rather than `@main` if you use it in a real pipeline.

### Agent skill

```bash
npx skills add atokim4/supabase-cli-v3-upgrade
```

The skill in [skills/supabase-cli-v3-upgrade](skills/supabase-cli-v3-upgrade/SKILL.md) tells Claude Code, Cursor
and other agents to run the scanner, apply `--fix`, and bring the decisions it can't make back to you.

## Checked against the real CLI

[`examples/cli-check.sh`](examples/cli-check.sh) installs `supabase@3.1.0` and `supabase@2.122.1` into a temp
folder, starts an in-memory Postgres (PGlite) on 127.0.0.1, and runs the commands with no TTY and `CI=true`.
[LOGS.md](examples/LOGS.md) has the output. Among other things it shows:

- `[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.` (exit 1 on v3, a warning on v2)
- every removed command and flag in the guide's table exiting 1 with its replacement
- `db push --remote=<url>` without `--yes`: "Confirmation required … Nothing was changed.", the same with `echo y |`, with `SUPABASE_YES=1` in `supabase/.env`, and with `-o json`; then applied with `--yes`
- the same push from inside an agent session failing with `HostedMutationConsentRequiredError` and "ask the user before re-running with --yes"
- v2 applying the same migration without anyone answering its `[Y/n]`
- bare `db push` on v3 going to `Target: local stack (127.0.0.1:54322)`
- the rewritten forms (`migration repair … --yes --remote=<url>`, `inspect db table-stats --remote=…`, `gen types … --remote=…`) running fine

Anything that needs a hosted project, a login or Docker (linked-project deploys, `secrets unset` without names,
`db diff` engines) is taken from the guide and not run.

## Tried on real repos

I ran it on the commit before the v3 fix in six public repos whose fix PRs I had read (first week of
November 2026). In each one it reported what the PR then changed by hand: `--remote --yes` on `db push`,
`--yes` on `functions deploy` and `secrets set`, `[inbucket]` renamed, `--project-ref` on deploys. Two things
it got differently:

- One repo also called the CLI from a `.mjs` script through `spawnSync`. The scanner doesn't read JavaScript, so
  only the `config.toml` part showed up (see Limits).
- In one repo the PR added `--yes` to two workflow files; the scanner found the same missing `--yes` in nine more.

On two well-known repos that use the CLI it found an `[inbucket]` section in a popular starter template and
otherwise only notes (deprecated `enable_signup`, the SMS confirmation flip, a missing `project_id`).

## Limits

- It reads shell in CI YAML, scripts, Makefiles, Dockerfiles and agent docs. It does not read JavaScript,
  TypeScript or Python that starts the CLI (`spawnSync("npx", ["supabase", …])`), `justfile`, `Taskfile.yml`,
  or composite actions from other repos.
- YAML and TOML are read line by line, not with full parsers. YAML anchors, flow sequences and multi-line
  strings inside `config.toml` arrays can be missed.
- "Does this job start a local stack" and "does this job export `SUPABASE_YES`" are decided per file, not per
  job. A workflow with a test job that runs `supabase start` makes `db push` in its deploy job report-only.
- The `--remote` rewrites only work on v3; v2 has no `--remote` flag. If a job pins v2 (the `cli-version`
  note tells you), upgrade it in the same change. `--yes` and `[local_smtp]` (v2.108.0+) work on both.
- Not covered: changes in the SQL pg-delta generates, seeding prompts under `[remotes.*]`, stricter boolean
  env values, `config.json` vs `config.toml` lookup order, output format changes for scripts that parse them.
- Tests or scripts that assert on the exact text of a workflow will need updating after `--fix`.
- Rules follow the guide at revision `a26ee8b3de` (2026-11-03). Later CLI releases can change the details.

## Develop

```bash
npm ci
npm run check     # tsc, esbuild bundles, vitest
bash examples/cli-check.sh   # real CLI run, rewrites examples/LOGS.md (needs network for npm)
```

`ci/test.yml` is the workflow for this repo (type check, tests, bundle drift, the action on the sample app). It is
not enabled here; copy it to `.github/workflows/` in a fork.

The bundles in `skills/supabase-cli-v3-upgrade/scripts/v3check.mjs` and `action/index.mjs` are committed so the
skill and the action run without an install step. MIT licence.
