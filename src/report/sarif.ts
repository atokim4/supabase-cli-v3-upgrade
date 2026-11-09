import { guideLink } from "../rules.ts";
import type { ScanResult } from "../scan.ts";
import type { RuleMeta, Severity } from "../types.ts";
import { REPO_URL, TOOL_NAME, VERSION } from "../version.ts";

export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

/** Minimal typing of the SARIF 2.1.0 parts this tool writes. */
export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: { driver: { name: string; semanticVersion: string; informationUri: string; rules: SarifRule[] } };
    results: SarifResult[];
  }[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  help: { text: string; markdown: string };
  helpUri: string;
  defaultConfiguration: { level: Severity };
  properties: { tags: string[]; precision: "high" | "medium" };
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: Severity;
  message: { text: string };
  locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId: "%SRCROOT%" }; region: { startLine: number } } }[];
}

/** "remote-flag-missing" -> "RemoteFlagMissing": SARIF rule names are conventionally PascalCase. */
const pascal = (id: string) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
/** Backticks are Markdown; in the plain-text fields they only add noise. */
const plain = (s: string) => s.replace(/`/g, "");
/** Code scanning caps short/full descriptions at 1,024 characters. */
const cap = (s: string, max = 1024) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

function sarifRule(rule: RuleMeta): SarifRule {
  return {
    id: rule.id,
    name: pascal(rule.id),
    shortDescription: { text: cap(plain(rule.title)) },
    fullDescription: { text: cap(plain(rule.why)) },
    help: {
      text: `Why: ${plain(rule.why)}\n\nFix: ${plain(rule.fix)}\n\nGuide: ${guideLink(rule.section)}`,
      markdown: `**Why it breaks:** ${rule.why}\n\n**What to write instead:** ${rule.fix}\n\n[Migration guide: this section](${guideLink(rule.section)})`,
    },
    helpUri: guideLink(rule.section),
    defaultConfiguration: { level: rule.severity },
    properties: { tags: ["supabase", "supabase-cli-v3", "ci"], precision: rule.fixable ? "high" : "medium" },
  };
}

/** A relative URI reference: each path segment percent-encoded (spaces, #, ? …), the slashes kept. */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * One SARIF run. Every rule that ran is listed, not only the ones with findings, so code scanning can close
 * alerts a later run no longer reports. `pathPrefix` is the scanned folder relative to the repository root.
 */
export function toSarif(result: ScanResult, pathPrefix = ""): SarifLog {
  const prefix = pathPrefix.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/+$/, "");
  const rules = result.rules.map(sarifRule);
  const index = new Map(rules.map((r, i) => [r.id, i]));
  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: TOOL_NAME, semanticVersion: VERSION, informationUri: REPO_URL, rules } },
        results: result.findings.map((f) => ({
          ruleId: f.rule,
          ruleIndex: index.get(f.rule)!,
          level: f.severity,
          message: { text: plain(f.message) },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: encodePath(prefix ? `${prefix}/${f.file}` : f.file), uriBaseId: "%SRCROOT%" },
                region: { startLine: Math.max(1, f.line) },
              },
            },
          ],
        })),
      },
    ],
  };
}
