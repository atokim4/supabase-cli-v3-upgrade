---
name: supabase-cli-v3-upgrade
description: Finds and fixes Supabase CLI v2 usage that breaks on CLI v3 (released 2026-11-02, now the default in npm, Homebrew and supabase/setup-cli). Covers CI workflows, package.json scripts, shell scripts, Makefiles, Dockerfiles, supabase/config.toml and agent instructions. Use when a Supabase CI job, deploy script or `supabase start` started failing after the CLI upgrade, when you see HostedMutationConsentRequiredError, "[inbucket] in supabase/config.toml is no longer supported", "--linked is deprecated" or a removed-command error, or when the user asks to upgrade a project to Supabase CLI v3.
license: MIT
---

# supabase-cli-v3-upgrade

A zero-dependency Node 22+ scanner ships in `scripts/v3check.mjs` next to this file. It reads files only: it
doesn't run the Supabase CLI, touch a database or use the network. Every rule follows a section of
https://supabase.com/docs/guides/local-development/cli/migrating-to-v3 and the report links to it.

## Steps

1. From the project root, see what breaks:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/v3check.mjs . --format json --fail-on none
   ```

   In agents that don't set `${CLAUDE_SKILL_DIR}`, use this skill folder's path. Each finding has `rule`,
   `severity` (error, warning, note), `file`, `line`, `message`, `fixable` and `guide`.

2. Preview and apply the safe rewrites:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/v3check.mjs . --diff
   node ${CLAUDE_SKILL_DIR}/scripts/v3check.mjs . --fix
   ```

   `--fix` only changes what has one right answer (deprecated target flags to `--remote`, `--yes` on hosted
   changes in CI, `echo y |` pipes, `[inbucket]` to `[local_smtp]`, removed commands with a 1:1 replacement). It
   prints the diff and then reports what is left. Show the user the diff.

3. Bring the rest to the user as questions, one line each. Don't decide these yourself:
   - `remote-flag-missing` outside CI, or in a job that starts a local stack: should this command reach the hosted project (`--remote`) or the local stack?
   - `yes-flag-missing` in AGENTS.md / CLAUDE.md / Cursor rules: may an agent pass `--yes` for this command? The v3 CLI refuses hosted changes from agents without it and tells the agent to ask first.
   - `secrets-unset-without-names`: which secrets to remove, or is `--all` really meant?
   - `sms-confirmations-flip`, `env-overrides-remotes`: suggest `supabase config diff` before the first v3 `config push`.
   - `cli-version`: a job that pins v2 needs the v3 rewrites and the version bump in the same change, because v2 has no `--remote`.

4. Run it again until no errors are left, then tell the user which workflow runs to watch.

## Rules for you

- Never run `supabase … --yes` against a hosted project yourself to test a fix. The fixes are text changes; the user's CI runs them.
- Never add `--yes` to agent instructions on your own. That is the user's decision.
- Keep `supabase link --project-ref` as it is: `link` doesn't take `--remote`.
- The scanner doesn't read JavaScript/TypeScript/Python that spawns the CLI (`spawnSync("npx", ["supabase", …])`). Search for those by hand (`grep -rn "supabase" scripts/ --include=*.{js,mjs,ts,py}`) and apply the same rules.

## Exit codes

0 nothing at the `--fail-on` level (default `error`), 1 findings at that level, 2 bad usage.
