import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { RULES } from "../src/rules.ts";
import { repo, workflow } from "./helpers.ts";

const SAMPLE = join(import.meta.dirname, "..", "examples", "sample-app");

function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = main(args, (s) => (stdout += s), (s) => (stderr += s));
  return { code, stdout, stderr };
}

describe("cli", () => {
  it("exits 1 on errors, 0 with --fail-on none, 2 on bad usage", () => {
    const root = repo({ ".github/workflows/d.yml": workflow("supabase functions deploy") });
    expect(run([root]).code).toBe(1);
    expect(run([root, "--fail-on", "none"]).code).toBe(0);
    expect(run([root, "--format", "xml"]).code).toBe(2);
    expect(run([root, "--exclude", "no-such-rule"]).code).toBe(2);
    expect(run([join(root, "missing")]).code).toBe(2);
  });

  it("passes a clean repo", () => {
    const root = repo({ ".github/workflows/d.yml": workflow("supabase link --project-ref $REF\nsupabase db push --yes --remote") });
    const r = run([root]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No Supabase CLI v3 breaking changes found.");
  });

  it("keeps diffs off stdout for machine-readable formats", () => {
    const root = repo({ "x.sh": "supabase db push --linked\n" });
    const r = run([root, "--diff", "--format", "json", "--fail-on", "none"]);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr).toContain("+supabase db push --remote");
  });

  it("--fix rewrites the sample app, and a second run has nothing left to fix", () => {
    const root = repo({});
    cpSync(SAMPLE, root, { recursive: true });
    const first = run([root, "--fix", "--fail-on", "none"]);
    expect(first.stdout).toMatch(/Fixed 22 finding\(s\) in 7 file\(s\)/);
    expect(readFileSync(join(root, "supabase/config.toml"), "utf8")).toContain("[local_smtp]");
    expect(readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8")).toContain("supabase config push --yes\n");
    const second = run([root, "--diff", "--format", "json", "--fail-on", "none"]);
    const report = JSON.parse(second.stdout) as { findings: { fixable: boolean; rule: string }[] };
    expect(report.findings.filter((f) => f.fixable)).toEqual([]);
    expect(report.findings.map((f) => f.rule)).toContain("secrets-unset-without-names");
  });

  it("writes SARIF 2.1.0 with every rule and guide links", () => {
    const r = run([SAMPLE, "--format", "sarif", "--fail-on", "none"]);
    const sarif = JSON.parse(r.stdout);
    expect(sarif.version).toBe("2.1.0");
    const run0 = sarif.runs[0];
    expect(run0.tool.driver.rules).toHaveLength(RULES.length);
    for (const res of run0.results) {
      expect(run0.tool.driver.rules[res.ruleIndex].id).toBe(res.ruleId);
      expect(res.locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
    }
    expect(run0.tool.driver.rules[0].helpUri).toMatch(/^https:\/\/supabase\.com\/docs\/guides\/local-development\/cli\/migrating-to-v3#/);
  });

  it("renders a Markdown table", () => {
    const r = run([SAMPLE, "--format", "markdown", "--fail-on", "none"]);
    expect(r.stdout).toContain("| Level | Where | Rule | What to change |");
    expect(r.stdout).toContain("[inbucket-section](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3#inbucket)");
  });
});

describe("rule catalog", () => {
  it("every rule points at a section of the guide that exists", () => {
    // Anchors of the guide's headings at revision a26ee8b3de (h2/h3 ids on the rendered page).
    const anchors = new Set([
      "before-you-upgrade", "installing-v3", "github-actions", "staying-on-v2", "quick-reference-for-ci",
      "database-commands-target-the-local-stack-by-default", "use--with---remote", "deprecated-target-flags", "other-target-changes",
      "gen-types-and-declarative-schemas", "hosted-changes-need-confirmation", "commands-that-need---yes-in-unattended-runs",
      "other-confirmation-changes", "output-changes", "secrets-unset-defaults-to-no", "flags-and-environment-variables-override-config",
      "seeding", "database-passwords", "stricter-validation", "local-container-names", "finding-the-project-directory",
      "config-push-applies-sms-confirmations-as-written", "pg-delta-is-the-default-diff-engine", "removed-commands-and-flags",
      "removed-config-keys-and-environment-variables", "inbucket", "error-names-and-messages", "deprecated-in-v3",
      "supabase-go-is-no-longer-installed",
    ]);
    for (const r of RULES) expect(anchors, r.id).toContain(r.section);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});
