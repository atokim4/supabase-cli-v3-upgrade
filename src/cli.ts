import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { planFixes, unifiedDiff, writeFixes, type FileFix } from "./fix.ts";
import { markdownReport } from "./report/markdown.ts";
import { toSarif } from "./report/sarif.ts";
import { jsonReport, textReport } from "./report/text.ts";
import { GUIDE_URL, guideLink, RULES } from "./rules.ts";
import { failsAt, isDirectory, scan, type ScanResult } from "./scan.ts";
import type { Severity } from "./types.ts";
import { TOOL_NAME, VERSION } from "./version.ts";

const HELP = `${TOOL_NAME} ${VERSION}
Finds Supabase CLI v2 usage that breaks on CLI v3 (CI workflows, package.json scripts, shell scripts,
Makefiles, Dockerfiles, supabase/config.toml, env files, AGENTS.md / CLAUDE.md / Cursor rules).

Usage: supabase-v3-check [folder] [options]

Options:
  --fix                 Rewrite the safe cases in place and print the diff, then report what is left
  --diff                Print the diff --fix would apply, change nothing
  --format <f>          text (default), json, markdown or sarif
  --output <file>       Write the report to a file instead of stdout
  --fail-on <level>     Exit 1 when a finding at this level or above remains: error (default), warning, note, none
  --exclude <ids>       Comma-separated rule ids to skip
  --list-rules          Print the rules and the guide section each one comes from
  --no-color            Plain text output
  -v, --version         Print the version
  -h, --help            Print this help

Exit codes: 0 nothing at the --fail-on level, 1 findings at that level, 2 bad usage.
Guide: ${GUIDE_URL}
`;

class UsageError extends Error {}

const FORMATS = ["text", "json", "markdown", "sarif"] as const;
const LEVELS = ["error", "warning", "note", "none"] as const;

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`--${name} must be one of ${allowed.join(", ")} (got "${value}")`);
}

function render(result: ScanResult, format: (typeof FORMATS)[number], color: boolean): string {
  switch (format) {
    case "json":
      return jsonReport(result);
    case "markdown":
      return markdownReport(result);
    case "sarif":
      return `${JSON.stringify(toSarif(result), null, 2)}\n`;
    default:
      return textReport(result, color);
  }
}

function readAll(root: string, files: Iterable<string>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const f of files) texts.set(f, readFileSync(join(root, f), "utf8"));
  return texts;
}

function diffText(fixes: readonly FileFix[]): string {
  return fixes.map((f) => unifiedDiff(f.file, f.before, f.after)).join("\n") + (fixes.length ? "\n" : "");
}

export function main(argv: string[], out: (s: string) => void, err: (s: string) => void): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        fix: { type: "boolean", default: false },
        diff: { type: "boolean", default: false },
        format: { type: "string", default: "text" },
        output: { type: "string" },
        "fail-on": { type: "string", default: "error" },
        exclude: { type: "string", default: "" },
        "list-rules": { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    err(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const o = parsed.values;
  if (o.help) { out(HELP); return 0; }
  if (o.version) { out(`${VERSION}\n`); return 0; }
  if (o["list-rules"]) {
    for (const r of RULES) out(`${r.id.padEnd(30)} ${r.severity.padEnd(7)} ${r.fixable ? "fix" : "   "}  ${r.title}\n${"".padEnd(30)} ${guideLink(r.section)}\n`);
    return 0;
  }

  try {
    if (parsed.positionals.length > 1) throw new UsageError("give one folder to scan");
    const root = resolve(parsed.positionals[0] ?? ".");
    if (!isDirectory(root)) throw new UsageError(`not a folder: ${root}`);
    const format = oneOf("format", o.format!, FORMATS);
    const failOn = oneOf("fail-on", o["fail-on"]!, LEVELS);
    const exclude = o.exclude!.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = exclude.filter((id) => !RULES.some((r) => r.id === id));
    if (unknown.length) throw new UsageError(`unknown rule id(s) in --exclude: ${unknown.join(", ")} (see --list-rules)`);
    if (o.fix && o.diff) throw new UsageError("use --fix or --diff, not both");

    let result = scan(root, exclude);
    // Diffs go to stderr when stdout carries a machine-readable report, so the two never mix.
    const diffOut = format === "text" && !o.output ? out : err;
    if (o.fix || o.diff) {
      const fixable = result.findings.filter((f) => f.edits);
      const fixes = planFixes(readAll(root, new Set(fixable.map((f) => f.file))), fixable);
      diffOut(diffText(fixes));
      const applied = fixes.reduce((n, f) => n + f.applied.length, 0);
      const files = fixes.length;
      if (o.fix) {
        writeFixes(root, fixes);
        // Rescan: a rewrite can surface what was hidden behind it, and what is left is what matters now.
        result = scan(root, exclude);
        diffOut(`Fixed ${applied} finding(s) in ${files} file(s). Remaining:\n\n`);
      } else {
        diffOut(`--fix would fix ${applied} finding(s) in ${files} file(s).\n\n`);
      }
    }

    const report = render(result, format, !o["no-color"] && !o.output && process.stdout.isTTY === true);
    if (o.output) {
      mkdirSync(dirname(resolve(o.output)), { recursive: true });
      writeFileSync(resolve(o.output), report);
    } else out(report);

    return failOn !== "none" && failsAt(result.findings, failOn as Severity) ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`${TOOL_NAME}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/** True when this file is the entry point, also through npm's bin symlink. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s));
