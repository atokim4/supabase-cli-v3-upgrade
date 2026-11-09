import { describe, expect, it } from "vitest";
import { findings, fixed, workflow } from "./helpers.ts";

const WF = ".github/workflows/deploy.yml";

describe("remote-flag-missing", () => {
  it("is an error in CI and --fix appends --remote", () => {
    const files = { [WF]: workflow("supabase link --project-ref $REF\nsupabase db push") };
    const [f] = findings(files, "remote-flag-missing");
    expect(f).toMatchObject({ severity: "error", line: 10 });
    expect(fixed(files, WF)).toContain("supabase db push --yes --remote\n");
  });

  it("is only reported (no fix) when the job starts a local stack", () => {
    const files = { [WF]: workflow("supabase start\nsupabase db push") };
    const [f] = findings(files, "remote-flag-missing");
    expect(f).toMatchObject({ severity: "warning" });
    expect(f!.edits).toBeUndefined();
  });

  it("is a note in scripts nobody runs from CI, without a fix", () => {
    const [f] = findings({ "package.json": '{"scripts":{"db:push":"supabase db push"}}' }, "remote-flag-missing");
    expect(f).toMatchObject({ severity: "note" });
    expect(f!.edits).toBeUndefined();
  });

  it("treats package scripts that CI runs as CI", () => {
    const files = { [WF]: workflow("npm run db:push"), "package.json": '{\n  "scripts": {\n    "db:push": "supabase db push"\n  }\n}\n' };
    expect(findings(files, "remote-flag-missing")[0]).toMatchObject({ severity: "error", file: "package.json", line: 3 });
    expect(fixed(files, "package.json")).toContain('"db:push": "supabase db push --yes --remote"');
  });

  it("does not fire with an explicit target or for bare gen types", () => {
    expect(findings({ [WF]: workflow("supabase db push --remote --yes\nsupabase gen types typescript > t.ts") }, "remote-flag-missing")).toHaveLength(0);
  });
});

describe("yes-flag-missing", () => {
  it("fires for hosted-only commands in CI, with a fix", () => {
    const files = { [WF]: workflow("supabase functions deploy\nsupabase secrets set --env-file .env.production\nsupabase config push") };
    expect(findings(files, "yes-flag-missing").map((f) => f.severity)).toEqual(["error", "error", "error"]);
    expect(fixed(files, WF)).toContain("supabase secrets set --env-file .env.production --yes");
  });

  it("is satisfied by SUPABASE_YES exported in the job env or as a prefix", () => {
    expect(findings({ [WF]: workflow("supabase functions deploy", "\n    env:\n      SUPABASE_YES: 1") }, "yes-flag-missing")).toHaveLength(0);
    expect(findings({ [WF]: workflow("SUPABASE_YES=1 supabase functions deploy") }, "yes-flag-missing")).toHaveLength(0);
  });

  it("asks agents' docs to say whether --yes is allowed, without rewriting them", () => {
    const [f] = findings({ "AGENTS.md": "Deploy with `supabase functions deploy hello`.\n" }, "yes-flag-missing");
    expect(f).toMatchObject({ severity: "warning", file: "AGENTS.md" });
    expect(f!.edits).toBeUndefined();
  });

  it("flags machine-readable output in scripts", () => {
    const [f] = findings({ "deploy.sh": "supabase config push -o json\n" }, "yes-flag-missing");
    expect(f).toMatchObject({ severity: "warning" });
  });

  it("skips dry runs", () => {
    expect(findings({ [WF]: workflow("supabase db push --remote --dry-run\nsupabase secrets unset --all --dry-run") }, "yes-flag-missing")).toHaveLength(0);
  });

  it("skips db reset against the local stack and db query --read-only", () => {
    expect(findings({ [WF]: workflow("supabase db reset\nsupabase db query --read-only --remote 'select 1'") }, "yes-flag-missing")).toHaveLength(0);
  });
});

describe("piped-confirmation", () => {
  it("drops the pipe and adds --yes", () => {
    const files = { "scripts/release.sh": "#!/bin/sh\nyes | supabase functions deploy --project-ref \"$REF\"\necho \"y\" | npx supabase db push --linked\n" };
    expect(findings(files, "piped-confirmation")).toHaveLength(2);
    expect(fixed(files, "scripts/release.sh")).toBe('#!/bin/sh\nsupabase functions deploy --yes --remote="$REF"\nnpx supabase db push --yes --remote\n');
  });
});

describe("deprecated-target-flag", () => {
  it("rewrites --db-url, --project-id and --local, keeping redirections last", () => {
    const files = {
      [WF]: workflow('supabase db push --db-url "$DB_URL" --yes\nsupabase gen types typescript --project-id "$REF" > src/db.ts\nsupabase gen types typescript --local > local.ts'),
    };
    const out = fixed(files, WF);
    expect(out).toContain('supabase db push --yes --remote="$DB_URL"');
    expect(out).toContain('supabase gen types typescript --remote="$REF" > src/db.ts');
    expect(out).toContain("supabase gen types typescript > local.ts");
  });

  it("moves --linked to the end, as the guide asks", () => {
    const files = { "Makefile": "repair:\n\tsupabase migration repair --linked 20240101000000 --status reverted\n" };
    expect(fixed(files, "Makefile")).toContain("supabase migration repair 20240101000000 --status reverted --remote");
  });

  it("leaves words that aren't CLI commands alone", () => {
    expect(findings({ "x.sh": "supabase sql --linked -f x.sql\n" })).toHaveLength(0);
  });

  it("leaves link --project-ref alone", () => {
    expect(findings({ [WF]: workflow("supabase link --project-ref $REF") }, "deprecated-target-flag")).toHaveLength(0);
  });

  it("rewrites db diff --from linked", () => {
    expect(fixed({ "x.sh": "supabase db diff --from linked --to=local\n" }, "x.sh")).toBe("supabase db diff --from=remote --to=local\n");
  });

  it("reports conflicting target flags without touching them", () => {
    const [f] = findings({ "x.sh": "supabase db push --db-url $A --project-ref $B\n" }, "deprecated-target-flag");
    expect(f!.edits).toBeUndefined();
    expect(f!.message).toContain("conflicting");
  });
});

describe("remote-value-without-equals", () => {
  it("attaches a variable value with =", () => {
    const files = { [WF]: workflow('supabase functions deploy api --remote "$SUPABASE_PROJECT_ID" --no-verify-jwt --yes') };
    expect(fixed(files, WF)).toContain('supabase functions deploy api --remote="$SUPABASE_PROJECT_ID" --no-verify-jwt --yes');
  });

  it("only reports a plain word, which may be an argument", () => {
    const [f] = findings({ "x.sh": "supabase db pull --remote add_profiles\n" }, "remote-value-without-equals");
    expect(f!.edits).toBeUndefined();
  });
});

describe("removed commands and flags", () => {
  it("renames inspect commands and db remote commit", () => {
    const files = { "x.sh": "supabase inspect db total-table-sizes --remote\nsupabase db remote commit\n" };
    expect(findings(files, "removed-command")).toHaveLength(2);
    expect(fixed(files, "x.sh")).toBe("supabase inspect db table-stats --remote\nsupabase db pull --remote\n");
  });

  it("reports gen keys and db branch without a fix", () => {
    const list = findings({ "x.sh": "supabase gen keys --project-ref abc\nsupabase db branch create dev\n" }, "removed-command");
    expect(list).toHaveLength(2);
    expect(list.every((f) => !f.edits)).toBe(true);
  });

  it("replaces removed flags", () => {
    const files = { "x.sh": "supabase db pull --use-pg-delta --remote\nsupabase functions download hello --legacy-bundle\nsupabase db diff --use-pg-schema -f x\nsupabase domains get --include-raw-output --create-ticket\n" };
    expect(fixed(files, "x.sh")).toBe("supabase db pull --declarative --remote\nsupabase functions download hello --use-api\nsupabase db diff -f x\nsupabase domains get -o json\n");
  });

  it("reports db pull --experimental without --declarative", () => {
    expect(findings({ "x.sh": "supabase db pull --experimental --remote\n" }, "removed-flag")).toHaveLength(1);
  });
});

describe("config.toml", () => {
  const base = 'project_id = "app"\n\n';
  it("renames [inbucket] and [remotes.<name>.inbucket]", () => {
    const files = { "supabase/config.toml": `${base}[inbucket]\nenabled = true\nport = 54324\n\n[remotes.production.inbucket]\nenabled = false\n` };
    expect(findings(files, "inbucket-section")).toHaveLength(2);
    expect(fixed(files, "supabase/config.toml")).toBe(`${base}[local_smtp]\nenabled = true\nport = 54324\n\n[remotes.production.local_smtp]\nenabled = false\n`);
  });

  it("renames inbucket in config.json", () => {
    expect(fixed({ "supabase/config.json": '{ "inbucket": { "port": 54324 } }' }, "supabase/config.json")).toBe('{ "local_smtp": { "port": 54324 } }');
  });

  it("reports removed keys and leading-zero ports", () => {
    const list = findings({ "supabase/config.toml": `${base}[db]\nport = 054322\n[experimental]\norioledb_version = "15.1"\n[auth.external.slack]\nenabled = false\n[experimental.inspect.rules]\nquery = "x"\n` }, "removed-config-key");
    expect(list.map((f) => f.line)).toEqual([4, 6, 7, 9]);
  });

  it("renames enable_signup only when enabled isn't already set", () => {
    const files = { "supabase/config.toml": `${base}[auth.email]\nenable_signup = true\n[auth.sms]\nenabled = true\nenable_signup = false\n` };
    const list = findings(files, "enable-signup-deprecated");
    expect(list).toHaveLength(2);
    expect(list[1]!.edits).toBeUndefined();
    expect(fixed(files, "supabase/config.toml")).toContain("[auth.email]\nenabled = true\n");
  });

  it("warns about the SMS flip when the repo runs config push", () => {
    const files = { "supabase/config.toml": `${base}[auth.sms]\nenable_confirmations = false\n`, [WF]: workflow("supabase config push --yes") };
    expect(findings(files, "sms-confirmations-flip")[0]).toMatchObject({ severity: "warning" });
    expect(findings({ "supabase/config.toml": `${base}[auth.sms]\nenable_confirmations = false\n` }, "sms-confirmations-flip")[0]).toMatchObject({ severity: "note" });
  });

  it("lists SUPABASE_* overrides that now beat [remotes.*]", () => {
    const files = { "supabase/config.toml": `${base}[remotes.production]\nproject_id = "abc"\n`, ".env.local": "SUPABASE_AUTH_SITE_URL=http://localhost:3000\nSUPABASE_URL=x\n" };
    const [f] = findings(files, "env-overrides-remotes");
    expect(f).toMatchObject({ severity: "warning" });
    expect(f!.message).toContain("SUPABASE_AUTH_SITE_URL (.env.local)");
    expect(f!.message).not.toContain("SUPABASE_URL ");
  });

  it("notes a missing project_id", () => {
    expect(findings({ "supabase/config.toml": "[api]\nport = 54321\n" }, "project-id-missing")).toHaveLength(1);
  });
});

describe("repo-level rules", () => {
  it("flags setup-cli without a version and v2.stable on @v1", () => {
    const wf = "jobs:\n  a:\n    steps:\n      - uses: supabase/setup-cli@v1\n      - uses: supabase/setup-cli@v1\n        with:\n          version: v2.stable\n      - uses: supabase/setup-cli@v3\n        with:\n          version: 3.1.0\n";
    const list = findings({ [WF]: wf }, "cli-version");
    expect(list.map((f) => [f.line, f.severity])).toEqual([[4, "note"], [5, "error"]]);
  });

  it("mentions a root lockfile pin", () => {
    const files = { [WF]: "jobs:\n  a:\n    steps:\n      - uses: supabase/setup-cli@v1\n", "package-lock.json": '{"packages":{"node_modules/supabase":{"version":"2.98.0"}}}' };
    expect(findings(files, "cli-version")[0]!.message).toContain("package-lock.json pins supabase 2.98.0");
  });

  it("flags SUPABASE_PROJECT_ID as the only target", () => {
    const files = { [WF]: workflow("supabase db push --remote --yes", "\n    env:\n      SUPABASE_PROJECT_ID: ${{ secrets.REF }}") };
    expect(findings(files, "project-id-env-target")).toHaveLength(1);
    expect(findings({ [WF]: workflow("supabase link --project-ref $SUPABASE_PROJECT_ID\nsupabase db push --remote --yes", "\n    env:\n      SUPABASE_PROJECT_ID: x") }, "project-id-env-target")).toHaveLength(0);
  });

  it("finds per-function import maps but not the shared one", () => {
    const list = findings({ "supabase/functions/hello/import_map.json": "{}", "supabase/functions/import_map.json": "{}" }, "function-import-map");
    expect(list.map((f) => f.file)).toEqual(["supabase/functions/hello/import_map.json"]);
  });

  it("renames ignored env vars and error names", () => {
    const files = { "ci.sh": "export SUPABASE_EXPERIMENTAL_PG_DELTA=true\ngrep -q MigrationPasswordFlagsError out.json\n" };
    expect(fixed(files, "ci.sh")).toBe("export SUPABASE_EXPERIMENTAL_PGDELTA_ENABLED=true\ngrep -q DbPasswordFlagsError out.json\n");
  });

  it("renames INBUCKET_URL only next to supabase status", () => {
    expect(fixed({ "a.sh": 'eval "$(supabase status -o env)"\ncurl "$INBUCKET_URL"\n' }, "a.sh")).toContain("$MAILPIT_URL");
    expect(findings({ "b.sh": 'curl "$INBUCKET_URL"\n' }, "inbucket-url")[0]!.edits).toBeUndefined();
  });

  it("flags SUPABASE_YES in env files", () => {
    expect(findings({ "supabase/.env": "SUPABASE_YES=1\n" }, "supabase-yes-in-env-file")).toHaveLength(1);
    expect(findings({ "supabase/.env.example": "SUPABASE_YES=1\n" }, "supabase-yes-in-env-file")).toHaveLength(0);
  });
});

describe("smaller command rules", () => {
  it("secrets unset with no names", () => {
    expect(findings({ "x.sh": "supabase secrets unset --yes\n" }, "secrets-unset-without-names")).toHaveLength(1);
    expect(findings({ "x.sh": "supabase secrets unset --all --yes\nsupabase secrets unset OLD_KEY --yes\n" }, "secrets-unset-without-names")).toHaveLength(0);
  });

  it("--password with a database URL", () => {
    expect(findings({ "x.sh": "supabase db dump --remote=postgresql://u@h/db -p secret\n" }, "password-with-url-target")).toHaveLength(1);
  });

  it("db diff --remote with --from", () => {
    expect(findings({ "x.sh": "supabase db diff --remote --from=local\n" }, "diff-remote-with-from-to")).toHaveLength(1);
  });

  it("db diff with declarative schemas", () => {
    expect(findings({ "x.sh": "supabase db diff -f new\n", "supabase/schemas/users.sql": "create table u();" }, "declarative-diff")).toHaveLength(1);
    expect(findings({ "x.sh": "supabase db diff -f new\n", "supabase/schemas/users.sql": "", "supabase/config.toml": 'project_id="a"\n[experimental.pgdelta]\nenabled = false\n' }, "declarative-diff")).toHaveLength(0);
  });

  it("supabase-go calls", () => {
    expect(findings({ "x.sh": "supabase-go db remote commit\n" }, "supabase-go-binary")).toHaveLength(1);
  });

  it("--override-name inbucket.url", () => {
    expect(fixed({ "x.sh": "supabase status --override-name inbucket.url=SMTP_UI\n" }, "x.sh")).toBe("supabase status --override-name mailpit.url=SMTP_UI\n");
  });
});

describe("CI YAML shapes", () => {
  it("reads GitLab list items, quoted or not", () => {
    const files = { ".gitlab-ci.yml": 'deploy:\n  script:\n    - supabase db push --db-url $DATABASE_URL\n    - "supabase functions deploy"\n' };
    const out = fixed(files, ".gitlab-ci.yml");
    expect(out).toContain("- supabase db push --yes --remote=$DATABASE_URL\n");
    expect(out).toContain('- "supabase functions deploy --yes"\n');
  });

  it("reads inline run: values", () => {
    const files = { [WF]: "jobs:\n  a:\n    steps:\n      - run: supabase db push --linked --include-all\n" };
    expect(fixed(files, WF)).toContain("- run: supabase db push --include-all --yes --remote\n");
  });
});
