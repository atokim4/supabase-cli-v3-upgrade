import { counts, type ScanResult } from "../engine.ts";
import { guideLink, ruleMeta } from "../rules.ts";

const ICON = { error: "Error", warning: "Warning", note: "Note" } as const;
const MAX_ROWS = 200;

/** A pipe or a newline would break the table row. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export interface MarkdownOptions {
  /** Prefix for file links, e.g. https://github.com/o/r/blob/<sha>. */
  blobUrl?: string;
  /** Scanned folder relative to the repo root. */
  pathPrefix?: string;
}

export function markdownReport(result: ScanResult, options: MarkdownOptions = {}): string {
  const c = counts(result.findings);
  const out: string[] = ["## Supabase CLI v3 upgrade check", ""];
  if (result.findings.length === 0) {
    out.push("No Supabase CLI v3 breaking changes found.");
    return `${out.join("\n")}\n`;
  }
  const fixable = result.findings.filter((f) => f.edits).length;
  out.push(`**${c.error}** errors, **${c.warning}** warnings, **${c.note}** notes. ${fixable} can be rewritten with \`--fix\`.`, "");
  out.push("| Level | Where | Rule | What to change |", "| --- | --- | --- | --- |");
  for (const f of result.findings.slice(0, MAX_ROWS)) {
    const path = options.pathPrefix ? `${options.pathPrefix}/${f.file}` : f.file;
    const where = options.blobUrl ? `[${cell(path)}:${f.line}](${options.blobUrl}/${path.split("/").map(encodeURIComponent).join("/")}#L${f.line})` : `\`${cell(path)}:${f.line}\``;
    const rule = `[${f.rule}](${guideLink(ruleMeta(f.rule).section)})`;
    out.push(`| ${ICON[f.severity]} | ${where} | ${rule} | ${cell(f.message)} |`);
  }
  if (result.findings.length > MAX_ROWS) out.push("", `${result.findings.length - MAX_ROWS} more findings are in the SARIF / JSON output.`);
  return `${out.join("\n")}\n`;
}
