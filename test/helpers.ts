import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import { planFixes } from "../src/fix.ts";
import { scan } from "../src/scan.ts";
import type { Finding } from "../src/types.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** Writes a throwaway repo from a { path: content } map and returns its folder. */
export function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "v3check-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export function findings(files: Record<string, string>, rule?: string): Finding[] {
  const all = scan(repo(files)).findings;
  return rule ? all.filter((f) => f.rule === rule) : all;
}

/** The text of `file` after --fix, for a repo built from `files`. */
export function fixed(files: Record<string, string>, file: string): string {
  const root = repo(files);
  const result = scan(root);
  const texts = new Map(Object.keys(files).map((p) => [p, readFileSync(join(root, p), "utf8")]));
  const plan = planFixes(texts, result.findings.filter((f) => f.edits));
  return plan.find((p) => p.file === file)?.after ?? files[file]!;
}

/** A GitHub workflow with one `run:` block. */
export const workflow = (run: string, extra = "") => `name: deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest${extra}
    steps:
      - uses: actions/checkout@v5
      - run: |
${run.split("\n").map((l) => `          ${l}`).join("\n")}
`;
