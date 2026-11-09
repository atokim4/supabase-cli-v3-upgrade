import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/action/main.ts";
import { repo, workflow } from "./helpers.ts";

function action(files: Record<string, string>, inputs: Record<string, string> = {}) {
  const workspace = repo(files);
  const out = mkdtempSync(join(tmpdir(), "v3check-gh-"));
  const env: NodeJS.ProcessEnv = { GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: join(out, "output"), GITHUB_STEP_SUMMARY: join(out, "summary") };
  writeFileSync(env.GITHUB_OUTPUT!, "");
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const lines: string[] = [];
  const code = run(env, (l) => lines.push(l));
  const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
  return { code, log: lines.join("\n"), outputs: read(env.GITHUB_OUTPUT!), summary: read(env.GITHUB_STEP_SUMMARY!), workspace };
}

const WF = ".github/workflows/deploy.yml";

describe("action", () => {
  it("annotates, writes SARIF, outputs and the summary, and fails on errors", () => {
    const r = action({ [WF]: workflow("supabase functions deploy") });
    expect(r.code).toBe(1);
    expect(r.log).toContain("::error file=.github/workflows/deploy.yml,line=9,title=Supabase CLI v3%3A yes-flag-missing::");
    expect(r.outputs).toContain("errors-count=1\n");
    expect(r.outputs).toContain("sarif-file=supabase-cli-v3.sarif\n");
    expect(JSON.parse(readFileSync(join(r.workspace, "supabase-cli-v3.sarif"), "utf8")).version).toBe("2.1.0");
    expect(r.summary).toContain("## Supabase CLI v3 upgrade check");
  });

  it("fix: true rewrites the checkout and passes when nothing is left", () => {
    const r = action({ [WF]: workflow("supabase link --project-ref $REF\nsupabase db push --linked") }, { fix: "true" });
    expect(r.code).toBe(0);
    expect(readFileSync(join(r.workspace, WF), "utf8")).toContain("supabase db push --yes --remote\n");
    expect(r.outputs).toContain("fixed-count=2\n");
    expect(r.log).toContain("+          supabase db push --yes --remote");
  });

  it("notes become ::notice and don't fail by default", () => {
    const r = action({ "supabase/config.toml": "[api]\nport = 54321\n" }, { format: "markdown" });
    expect(r.code).toBe(0);
    expect(r.log).toContain("::notice file=supabase/config.toml,line=1");
  });

  it("rejects bad inputs", () => {
    expect(action({}, { "fail-on": "sometimes" }).code).toBe(1);
    expect(action({}, { path: "../outside" }).code).toBe(1);
    expect(action({}, { exclude: "nope" }).code).toBe(1);
  });
});
