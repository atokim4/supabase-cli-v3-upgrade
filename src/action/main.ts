import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { planFixes, unifiedDiff, writeFixes } from "../fix.ts";
import { markdownReport } from "../report/markdown.ts";
import { toSarif } from "../report/sarif.ts";
import { textReport } from "../report/text.ts";
import { RULES } from "../rules.ts";
import { counts, failsAt, isDirectory, scan, type ScanResult } from "../scan.ts";
import type { Severity } from "../types.ts";
import { TOOL_NAME } from "../version.ts";
import { annotation, appendSummary, getInput, setOutput } from "./github.ts";

class InputError extends Error {}

type FailOn = Severity | "none";

interface Inputs {
  workspace: string;
  root: string;
  /** `root` relative to the workspace, forward slashes, "" for the workspace itself. */
  prefix: string;
  failOn: FailOn;
  format: "sarif" | "markdown";
  exclude: string[];
  sarifFile: string;
  fix: boolean;
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new InputError(`input "${name}" must be one of ${allowed.join(", ")} (got "${value}")`);
}

const toPosix = (p: string) => p.split(sep).join("/");

function readInputs(env: NodeJS.ProcessEnv): Inputs {
  const workspace = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const root = resolve(workspace, getInput("path", env) || ".");
  const prefix = toPosix(relative(workspace, root));
  if (prefix.startsWith("..") || isAbsolute(prefix)) throw new InputError(`input "path" must be inside the workspace (${workspace}), got ${root}`);
  if (!isDirectory(root)) throw new InputError(`input "path" is not a folder: ${root}`);
  const exclude = getInput("exclude", env).split(/[\s,]+/).filter(Boolean);
  const unknown = exclude.filter((id) => !RULES.some((r) => r.id === id));
  if (unknown.length) throw new InputError(`unknown rule id(s) in "exclude": ${unknown.join(", ")}`);
  return {
    workspace,
    root,
    prefix,
    failOn: oneOf("fail-on", getInput("fail-on", env) || "error", ["error", "warning", "note", "none"] as const),
    format: oneOf("format", getInput("format", env) || "sarif", ["sarif", "markdown"] as const),
    exclude,
    sarifFile: getInput("sarif-file", env) || "supabase-cli-v3.sarif",
    fix: oneOf("fix", getInput("fix", env) || "false", ["true", "false"] as const) === "true",
  };
}

function blobUrl(env: NodeJS.ProcessEnv): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = env;
  return server && repo && sha ? `${server}/${repo}/blob/${sha}` : undefined;
}

function writeSarif(result: ScanResult, inputs: Inputs): string {
  const file = resolve(inputs.workspace, inputs.sarifFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(toSarif(result, inputs.prefix), null, 2)}\n`);
  const rel = toPosix(relative(inputs.workspace, file));
  return rel.startsWith("..") || isAbsolute(rel) ? file : rel;
}

/** Applies the safe rewrites in the checkout (a later step can open a PR with them). Returns how many. */
function applyFixes(result: ScanResult, inputs: Inputs, log: (line: string) => void): number {
  const fixable = result.findings.filter((f) => f.edits);
  const texts = new Map([...new Set(fixable.map((f) => f.file))].map((f) => [f, readFileSync(join(inputs.root, f), "utf8")]));
  const fixes = planFixes(texts, fixable);
  writeFixes(inputs.root, fixes);
  for (const f of fixes) log(unifiedDiff(inputs.prefix ? `${inputs.prefix}/${f.file}` : f.file, f.before, f.after));
  return fixes.reduce((n, f) => n + f.applied.length, 0);
}

const LEVEL = { error: "error", warning: "warning", note: "notice" } as const;

/** Runs the action and returns the exit code. Everything it needs comes from `env`, so it can run outside a runner. */
export function run(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): number {
  let inputs: Inputs;
  try {
    inputs = readInputs(env);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    log(annotation("error", `${TOOL_NAME}: ${error.message}`));
    return 1;
  }

  let result = scan(inputs.root, inputs.exclude);
  let fixed = 0;
  if (inputs.fix) {
    fixed = applyFixes(result, inputs, log);
    log(`Rewrote ${fixed} finding(s). Remaining:`);
    result = scan(inputs.root, inputs.exclude);
  }
  log(textReport(result).trimEnd());

  for (const f of result.findings) {
    const file = inputs.prefix ? `${inputs.prefix}/${f.file}` : f.file;
    log(annotation(LEVEL[f.severity], f.message.replace(/`/g, ""), { file, line: f.line, title: `Supabase CLI v3: ${f.rule}` }));
  }

  const summary = markdownReport(result, { pathPrefix: inputs.prefix, blobUrl: blobUrl(env) });
  if (!appendSummary(summary, env) && inputs.format === "markdown") log(summary);

  const sarifFile = inputs.format === "sarif" ? writeSarif(result, inputs) : "";
  if (sarifFile) log(`SARIF written to ${sarifFile}`);
  const c = counts(result.findings);
  setOutput("findings-count", String(result.findings.length), env);
  setOutput("errors-count", String(c.error), env);
  setOutput("fixable-count", String(result.findings.filter((f) => f.edits).length), env);
  setOutput("fixed-count", String(fixed), env);
  setOutput("sarif-file", sarifFile, env);

  if (inputs.failOn !== "none" && failsAt(result.findings, inputs.failOn)) {
    log(annotation("error", `${TOOL_NAME}: failing because of findings at "${inputs.failOn}" level or above (set fail-on: none to only report)`));
    return 1;
  }
  return 0;
}
