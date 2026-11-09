// src/action/main.ts
import { mkdirSync, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, isAbsolute, join as join4, relative, resolve, sep } from "node:path";

// src/fix.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
var overlaps = (a, b) => {
  if (a.start === a.end || b.start === b.end) return a.start > b.start && a.start < b.end || b.start > a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
};
var same = (a, b) => a.start === b.start && a.end === b.end && a.text === b.text;
function planFixes(texts, findings) {
  const byFile = /* @__PURE__ */ new Map();
  for (const f of findings) if (f.edits?.length) byFile.set(f.file, [...byFile.get(f.file) ?? [], f]);
  const result = [];
  for (const [file, list] of byFile) {
    const before = texts.get(file);
    if (before === void 0) continue;
    const accepted = [];
    const applied = [];
    const skipped = [];
    for (const f of list) {
      const fresh = f.edits.filter((e) => !accepted.some((a) => same(a, e)));
      if (fresh.some((e) => accepted.some((a) => overlaps(a, e)))) {
        skipped.push(f);
        continue;
      }
      accepted.push(...fresh);
      applied.push(f);
    }
    const after = applyEdits(before, accepted);
    if (after !== before) result.push({ file, before, after, applied, skipped });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
function applyEdits(text, edits) {
  const isInsert = (e) => e.start === e.end ? 1 : 0;
  const sorted = [...edits].sort((a, b) => b.start - a.start || isInsert(a) - isInsert(b) || (b.order ?? 0) - (a.order ?? 0));
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
function writeFixes(root, fixes) {
  for (const f of fixes) writeFileSync(join(root, f.file), f.after);
}
function unifiedDiff(file, before, after, context = 3) {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = diffLines(a, b);
  const out = [`--- a/${file}`, `+++ b/${file}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "=") {
      i++;
      continue;
    }
    const start = Math.max(0, i - context);
    let end = i;
    for (let j = i; j < ops.length; j++) {
      if (ops[j].kind !== "=") end = j;
      else if (j - end > context * 2) break;
    }
    end = Math.min(ops.length - 1, end + context);
    const hunk = ops.slice(start, end + 1);
    const aStart = hunk[0].ai + 1;
    const bStart = hunk[0].bi + 1;
    const aLen = hunk.filter((o) => o.kind !== "+").length;
    const bLen = hunk.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    for (const o of hunk) out.push(`${o.kind === "=" ? " " : o.kind}${o.text}`);
    i = end + 1;
  }
  return out.join("\n");
}
function diffLines(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const n = am.length;
  const m = bm.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) for (let j2 = m - 1; j2 >= 0; j2--) lcs[i2][j2] = am[i2] === bm[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
  const ops = [];
  for (let k = 0; k < head; k++) ops.push({ kind: "=", text: a[k], ai: k, bi: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      ops.push({ kind: "=", text: am[i], ai: head + i, bi: head + j });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push({ kind: "-", text: am[i], ai: head + i, bi: head + j });
      i++;
    } else {
      ops.push({ kind: "+", text: bm[j], ai: head + i, bi: head + j });
      j++;
    }
  }
  for (let k = 0; k < tail; k++) ops.push({ kind: "=", text: a[a.length - tail + k], ai: a.length - tail + k, bi: b.length - tail + k });
  return ops;
}

// src/scan.ts
import { existsSync, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/rules.ts
var GUIDE_URL = "https://supabase.com/docs/guides/local-development/cli/migrating-to-v3";
var guideLink = (section) => `${GUIDE_URL}#${section}`;
var RULES = [
  {
    id: "inbucket-section",
    severity: "error",
    title: "[inbucket] config section is removed",
    why: "v3 can't load a config.toml with an [inbucket] section, so supabase start, stop, status and the db commands all fail.",
    fix: "Rename [inbucket] to [local_smtp] (and [remotes.<name>.inbucket] to [remotes.<name>.local_smtp]). The keys inside stay the same. v2.108.0 and later already read [local_smtp].",
    section: "inbucket",
    fixable: true
  },
  {
    id: "remote-flag-missing",
    severity: "error",
    title: "Database command now targets the local stack",
    why: "In v3, db push/pull/dump, migration list/fetch/repair, inspect, gen types and storage run against the local stack unless you pass --remote. In CI a bare db push either fails (no local stack) or succeeds against a local stack and never reaches the hosted project.",
    fix: "Add --remote at the end of every command that should reach the hosted project.",
    section: "database-commands-target-the-local-stack-by-default",
    fixable: true
  },
  {
    id: "yes-flag-missing",
    severity: "error",
    title: "Hosted change without --yes in a run that can't prompt",
    why: "Every command that changes a hosted project asks first and defaults to No. When it can't ask (CI, machine-readable output, an AI agent) it fails with HostedMutationConsentRequiredError and changes nothing.",
    fix: "Pass --yes in unattended runs, or export SUPABASE_YES=1 in the job's shell environment (not in a .env file).",
    section: "commands-that-need---yes-in-unattended-runs",
    fixable: true
  },
  {
    id: "piped-confirmation",
    severity: "error",
    title: "Piping y into the CLI no longer confirms",
    why: "v3 doesn't read piped answers. `echo y | supabase db push` fails in CI with HostedMutationConsentRequiredError.",
    fix: "Drop the pipe and pass --yes.",
    section: "hosted-changes-need-confirmation",
    fixable: true
  },
  {
    id: "deprecated-target-flag",
    severity: "warning",
    title: "Deprecated target flag",
    why: "--linked, --project-ref, --db-url, --local and gen types --project-id still work in v3 but print a warning and are removed in v4. db diff --from/--to linked is now remote.",
    fix: "Use --remote, --remote=<ref> or --remote=<url>, at the end of the command. Drop --local (local is the default). Note that v2 has no --remote flag.",
    section: "deprecated-target-flags",
    fixable: true
  },
  {
    id: "remote-value-without-equals",
    severity: "warning",
    title: "--remote value without =",
    why: '--remote works on its own, so a value must be attached with =. A word after a bare --remote is read as an argument, or the CLI stops with a "did you mean" error.',
    fix: "Write --remote=<value>.",
    section: "use--with---remote",
    fixable: true
  },
  {
    id: "removed-command",
    severity: "error",
    title: "Removed command",
    why: "A removed command still parses but exits with code 1 and prints its replacement.",
    fix: "Use the replacement the guide lists for it.",
    section: "removed-commands-and-flags",
    fixable: true
  },
  {
    id: "removed-flag",
    severity: "error",
    title: "Removed flag",
    why: "A removed flag exits with code 1 and prints its replacement.",
    fix: "Use the replacement the guide lists for it.",
    section: "removed-commands-and-flags",
    fixable: true
  },
  {
    id: "secrets-unset-without-names",
    severity: "error",
    title: "secrets unset with no names",
    why: "v2 unset every secret when you named none. v3 fails instead, and asks before unsetting anything.",
    fix: "Name the secrets to remove, or pass --all if you really mean every secret (plus --yes when it runs unattended).",
    section: "secrets-unset-defaults-to-no",
    fixable: false
  },
  {
    id: "supabase-go-binary",
    severity: "error",
    title: "supabase-go is no longer installed",
    why: "v3 ships one supabase executable. Scripts that call supabase-go fail, and SUPABASE_GO_BINARY is ignored.",
    fix: "Call supabase instead. The commands that ran through supabase-go are removed, so check what the call did.",
    section: "supabase-go-is-no-longer-installed",
    fixable: false
  },
  {
    id: "removed-config-key",
    severity: "error",
    title: "Removed or stricter config key",
    why: "Removed config keys and invalid values fail every command that loads the project config.",
    fix: "Apply the replacement the guide lists for the key.",
    section: "removed-config-keys-and-environment-variables",
    fixable: false
  },
  {
    id: "function-import-map",
    severity: "error",
    title: "Per-function import_map.json is removed",
    why: "A function's own supabase/functions/<name>/import_map.json now fails. The shared supabase/functions/import_map.json fallback still works.",
    fix: "Rename it to deno.json, or set [functions.<name>] import_map in config.toml.",
    section: "removed-config-keys-and-environment-variables",
    fixable: false
  },
  {
    id: "removed-env-var",
    severity: "warning",
    title: "Removed or ignored environment variable",
    why: "Some removed variables fail, others are silently ignored, so the setting quietly stops applying.",
    fix: "Use the replacement variable the guide lists.",
    section: "removed-config-keys-and-environment-variables",
    fixable: true
  },
  {
    id: "inbucket-url",
    severity: "warning",
    title: "INBUCKET_URL is no longer printed",
    why: "supabase status -o env no longer prints INBUCKET_URL, so a script that reads it gets an empty value.",
    fix: "Read MAILPIT_URL instead, and use --override-name mailpit.url instead of inbucket.url.",
    section: "removed-config-keys-and-environment-variables",
    fixable: true
  },
  {
    id: "password-with-url-target",
    severity: "error",
    title: "--password with a database URL",
    why: "--password only applies to a hosted project. With a database URL or the local stack it exits with code 1.",
    fix: "Put the password in the URL instead.",
    section: "database-passwords",
    fixable: false
  },
  {
    id: "diff-remote-with-from-to",
    severity: "error",
    title: "db diff with both --remote and --from/--to",
    why: "db diff rejects --remote together with --from or --to.",
    fix: "Use --from=remote or --to=remote.",
    section: "other-target-changes",
    fixable: false
  },
  {
    id: "declarative-diff",
    severity: "warning",
    title: "db diff no longer reads supabase/schemas",
    why: 'Under pg-delta, the default engine in v3, the declarative files in supabase/schemas and [db.migrations] schema_paths are no longer inputs to db diff, so "edit schemas, then db diff -f" stops picking up your edits.',
    fix: "Use supabase db schema declarative sync, or keep migra with [experimental.pgdelta] enabled = false.",
    section: "pg-delta-is-the-default-diff-engine",
    fixable: false
  },
  {
    id: "project-id-env-target",
    severity: "warning",
    title: "SUPABASE_PROJECT_ID no longer picks the target",
    why: "SUPABASE_PROJECT_ID no longer selects a hosted project on its own. It only sets which project a bare --remote means.",
    fix: "Add --remote to the commands that should use that project, or link the project first.",
    section: "database-commands-target-the-local-stack-by-default",
    fixable: false
  },
  {
    id: "env-overrides-remotes",
    severity: "warning",
    title: "SUPABASE_* variables now beat [remotes.<name>] blocks",
    why: "In v2 a matched [remotes.<name>] block beat SUPABASE_* environment variables. In v3 the variable wins, and config push pushes it.",
    fix: "Check which SUPABASE_* variables CI and your env files set, set SUPABASE_ENV in CI, keep .env.local out of CI, and run supabase config diff before the first v3 config push.",
    section: "flags-and-environment-variables-override-config",
    fixable: false
  },
  {
    id: "sms-confirmations-flip",
    severity: "warning",
    title: "[auth.sms] enable_confirmations now applies as written",
    why: "v2 config push applied enable_confirmations inverted. v3 applies it as written, so phone confirmation on the project flips on the next config push.",
    fix: "Check the value in [auth.sms] and [remotes.<name>.auth.sms], then run supabase config diff before the first v3 config push.",
    section: "config-push-applies-sms-confirmations-as-written",
    fixable: false
  },
  {
    id: "supabase-yes-in-env-file",
    severity: "warning",
    title: "SUPABASE_YES in an env file doesn't count",
    why: "SUPABASE_YES in supabase/.env or another project env file doesn't confirm anything, and while such a file defines it, a shell-exported SUPABASE_YES doesn't count either.",
    fix: "Remove it from the env file and pass --yes.",
    section: "hosted-changes-need-confirmation",
    fixable: false
  },
  {
    id: "cli-version",
    severity: "note",
    title: "Which CLI version the workflow installs",
    why: "supabase/setup-cli installs latest, which is now v3, when version isn't set (unless a root lockfile pins supabase). v2.stable and semver ranges need supabase/setup-cli@v3.",
    fix: "Pin version: v2.stable on supabase/setup-cli@v3 to upgrade later, or fix the findings and stay on latest.",
    section: "github-actions",
    fixable: false
  },
  {
    id: "enable-signup-deprecated",
    severity: "note",
    title: "enable_signup in [auth.email] / [auth.sms] is deprecated",
    why: "The key was renamed to enabled. It still works in v3 with a warning and is removed in v4.",
    fix: "Rename it to enabled. To block only new sign-ups, set enable_signup = false under [auth], which is not deprecated.",
    section: "deprecated-in-v3",
    fixable: true
  },
  {
    id: "project-id-missing",
    severity: "note",
    title: "No project_id in config.toml",
    why: "Without project_id, v3 names local containers and volumes after the project folder, so an existing local stack seems to lose its data.",
    fix: "Run supabase stop before upgrading, or set project_id in config.toml.",
    section: "local-container-names",
    fixable: false
  },
  {
    id: "error-name-renamed",
    severity: "note",
    title: "Renamed error name",
    why: "Scripts that match MigrationPasswordFlagsError in JSON output no longer match; v3 calls it DbPasswordFlagsError.",
    fix: "Match DbPasswordFlagsError.",
    section: "error-names-and-messages",
    fixable: true
  }
];
var byId = new Map(RULES.map((r) => [r.id, r]));
function ruleMeta(id) {
  const meta = byId.get(id);
  if (!meta) throw new Error(`unknown rule ${id}`);
  return meta;
}

// src/shell.ts
var isOp = (l) => "op" in l;
function lex(text, from = 0, to = text.length) {
  const out = [];
  let i = from;
  const blank = (c) => c === " " || c === "	" || c === "\r";
  while (i < to) {
    const c = text[i];
    if (blank(c)) {
      i++;
      continue;
    }
    if (c === "\\" && text[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "#") {
      while (i < to && text[i] !== "\n") i++;
      continue;
    }
    if (c === "\n" || c === ";" || c === "(" || c === ")" || c === "`") {
      out.push({ op: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "|" || c === "&") {
      const two = text.slice(i, i + 2);
      if (two === "||" || two === "&&") {
        out.push({ op: two, start: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (c === "&" && text[i + 1] === ">") {
        i = readWord(text, i, to, out, true);
        continue;
      }
      out.push({ op: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "$" && text[i + 1] === "(" && text[i + 2] !== "(") {
      out.push({ op: "(", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    const redirect = c === ">" || c === "<" || /[0-9]/.test(c) && /^[0-9]+[<>]/.test(text.slice(i, i + 4));
    i = readWord(text, i, to, out, redirect);
  }
  return out;
}
function readWord(text, i, to, out, redirect) {
  const start = i;
  if (redirect) {
    const op = /^[0-9]*(?:&>>|&>|>>|>&|<&|>|<)/.exec(text.slice(i, Math.min(to, i + 5)))?.[0] ?? text[i];
    i += op.length;
    if (op.endsWith("&") && /[0-9-]/.test(text[i] ?? "")) i++;
    else {
      while (i < to && (text[i] === " " || text[i] === "	")) i++;
      if (i < to && !/[\s;|&()`<>]/.test(text[i])) i = readPlain(text, i, to).end;
    }
    out.push({ value: text.slice(start, i).replace(/\s+/g, " "), raw: text.slice(start, i), start, end: i, redirect: true });
    return i;
  }
  const { value, end } = readPlain(text, i, to);
  out.push({ value, raw: text.slice(start, end), start, end });
  return end;
}
function readPlain(text, i, to) {
  let value = "";
  while (i < to) {
    const c = text[i];
    if (/[\s;|&()`<>]/.test(c)) break;
    if (c === "\\") {
      if (text[i + 1] === "\n") break;
      value += text[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      const stop = close === -1 || close >= to ? to : close;
      value += text.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < to && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < to) {
          value += text[i + 1];
          i += 2;
          continue;
        }
        value += text[i++];
      }
      i++;
      continue;
    }
    if (c === "$" && (text[i + 1] === "{" || text[i + 1] === "(")) {
      const end = matchBrace(text, i + 1, to);
      value += text.slice(i, end);
      i = end;
      continue;
    }
    value += c;
    i++;
  }
  return { value, end: Math.min(i, to) };
}
function matchBrace(text, open, to) {
  const pair = { "{": "}", "(": ")" };
  const stack = [];
  for (let i = open; i < to; i++) {
    const c = text[i];
    if (c === "{" || c === "(") stack.push(pair[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return to;
}
var LAUNCHERS = /* @__PURE__ */ new Set(["npx", "bunx", "pnpx", "pnpm", "yarn", "npm", "bun", "dlx", "exec", "x", "sudo", "time", "env", "nohup", "command", "$", "-y", "--yes", "--", "--no-install"]);
var BINARY = /^[@-]?(?:.*\/)?(supabase|supabase-go)(?:@[\w.^~<>=*-]+)?$/;
function findInvocations(text, from = 0, to = text.length) {
  const lexemes = lex(text, from, to);
  const commands = [];
  let current = [];
  let sep2;
  for (const l of lexemes) {
    if (isOp(l)) {
      commands.push({ words: current, sepBefore: sep2 });
      current = [];
      sep2 = l;
    } else current.push(l);
  }
  commands.push({ words: current, sepBefore: sep2 });
  const found = [];
  for (const l of lexemes) {
    if (isOp(l)) continue;
    for (let at = text.indexOf("$(", l.start); at !== -1 && at < l.end; at = text.indexOf("$(", at + 2)) {
      if (text[at + 2] === "(") continue;
      const close = matchBrace(text, at + 1, l.end);
      found.push(...findInvocations(text, at + 2, close - 1));
      at = close - 2;
    }
  }
  commands.forEach((cmd, index) => {
    const envPrefix = /* @__PURE__ */ new Map();
    let k = 0;
    for (; k < cmd.words.length; k++) {
      const w = cmd.words[k];
      const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(w.value);
      if (assign && !w.redirect) {
        envPrefix.set(assign[1], assign[2]);
        continue;
      }
      if (LAUNCHERS.has(w.value)) continue;
      break;
    }
    const bin = cmd.words[k];
    const match = bin && !bin.redirect ? BINARY.exec(bin.value) : null;
    if (!bin || !match) return;
    const args = cmd.words.slice(k + 1);
    const lastArg = [...args].reverse().find((t) => !t.redirect);
    const inv = {
      binary: match[1],
      binaryToken: bin,
      args,
      argsEnd: lastArg ? lastArg.end : bin.end,
      envPrefix
    };
    const prev = commands[index - 1];
    if (cmd.sepBefore?.op === "|" && prev && prev.words.length > 0) {
      inv.pipedFrom = { words: prev.words.map((w) => w.value), start: prev.words[0].start, end: firstWordStart(cmd.words) };
    }
    found.push(inv);
  });
  return found.sort((a, b) => a.binaryToken.start - b.binaryToken.start);
}
var firstWordStart = (words) => words[0].start;
var VALUED = /* @__PURE__ */ new Set([
  "--project-ref",
  "--db-url",
  "--project-id",
  "--password",
  "-p",
  "--file",
  "-f",
  "--schema",
  "-s",
  "--workdir",
  "--output",
  "-o",
  "--output-format",
  "--env-file",
  "--from",
  "--to",
  "--status",
  "--lang",
  "--diff-engine",
  "--override-name",
  "--jobs",
  "-j",
  "--last",
  "--version",
  "--profile",
  "--network-id",
  "--dns-resolver",
  "--import-map",
  "--name",
  "--region",
  "--org-id",
  "--db-password",
  "--size",
  "--git-branch",
  "--exclude",
  "-x"
]);
var TREE = {
  db: ["push", "pull", "dump", "diff", "reset", "query", "lint", "start", "remote", "branch", "schema", "test"],
  "db remote": ["changes", "commit"],
  "db branch": ["create", "delete", "list", "switch"],
  "db schema": ["declarative"],
  "db schema declarative": ["generate", "sync"],
  migration: ["list", "fetch", "repair", "up", "down", "squash", "new"],
  inspect: ["db", "report"],
  gen: ["types", "keys", "signing-key", "bearer-jwt"],
  storage: ["ls", "cp", "mv", "rm"],
  functions: ["deploy", "delete", "download", "serve", "new", "list"],
  secrets: ["set", "unset", "list"],
  config: ["push", "diff"],
  test: ["db", "new"],
  seed: ["buckets"],
  projects: ["create", "delete", "list", "api-keys"],
  orgs: ["create", "list"],
  branches: ["create", "delete", "disable", "pause", "unpause", "update", "list", "get"],
  backups: ["restore", "list"],
  encryption: ["update-root-key", "get-root-key"],
  "network-bans": ["remove", "get"],
  "network-restrictions": ["update", "get"],
  "ssl-enforcement": ["update", "get"],
  "postgres-config": ["update", "delete", "get"],
  sso: ["add", "update", "remove", "list", "show", "info"],
  "vanity-subdomains": ["activate", "delete", "get", "check-availability"],
  domains: ["create", "activate", "delete", "get", "reverify"],
  compute: ["push", "delete"],
  notebooks: ["push"],
  feedback: ["delete"]
};
var TOP_LEVEL = /* @__PURE__ */ new Set([
  ...Object.keys(TREE).filter((k) => !k.includes(" ")),
  "backups",
  "bootstrap",
  "completion",
  "init",
  "issue",
  "link",
  "login",
  "logout",
  "logs",
  "pull",
  "services",
  "snippets",
  "start",
  "status",
  "stop",
  "telemetry",
  "unlink",
  "whoami",
  "stack",
  "compute",
  "migration",
  "migrations"
]);
var isKnownCommand = (path) => path.length > 0 && TOP_LEVEL.has(path[0]);
function parseCommand(args) {
  const path = [];
  const pathIndex = [];
  const flags = [];
  const positionals = [];
  let pathOpen = true;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t.redirect) continue;
    if (t.value.startsWith("-") && t.value.length > 1) {
      const eq = t.value.indexOf("=");
      if (eq > 0 && t.value.startsWith("--")) {
        const rawEq = t.raw.indexOf("=");
        flags.push({ name: t.value.slice(0, eq), value: t.value.slice(eq + 1), rawValue: t.raw.slice(rawEq + 1), attached: true, index: i });
        continue;
      }
      const next = args[i + 1];
      if (VALUED.has(t.value) && next && !next.redirect && !next.value.startsWith("-")) {
        flags.push({ name: t.value, value: next.value, rawValue: next.raw, attached: false, index: i, valueIndex: i + 1 });
        i++;
        continue;
      }
      flags.push({ name: t.value, attached: false, index: i });
      continue;
    }
    if (pathOpen) {
      const parent = path.join(" ");
      if (path.length === 0 || TREE[parent]?.includes(t.value) || parent === "inspect db") {
        path.push(t.value);
        pathIndex.push(i);
        if (parent === "inspect db") pathOpen = false;
        continue;
      }
      pathOpen = false;
    }
    positionals.push({ value: t.value, index: i });
  }
  return { path, pathIndex, flags, positionals };
}

// src/sources.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join as join2, posix } from "node:path";
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".output", "vendor", "coverage", ".turbo", ".vercel", ".netlify", ".venv", "target"]);
var MAX_BYTES = 1024 * 1024;
var MAX_FILES = 2e4;
var AGENT_DOCS = /* @__PURE__ */ new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", ".windsurfrules", ".clinerules", "copilot-instructions.md"]);
var CI_OTHER = /* @__PURE__ */ new Set(["bitbucket-pipelines.yml", "azure-pipelines.yml"]);
function classify(path) {
  const name = posix.basename(path);
  const dir = posix.dirname(path);
  if (/(^|\/)\.github\/workflows$/.test(dir) && /\.ya?ml$/.test(name)) return "workflow";
  if (/(^|\/)\.github\/actions(\/|$)/.test(dir) && /^action\.ya?ml$/.test(name)) return "workflow";
  if (name === ".gitlab-ci.yml" || /\.gitlab-ci\.ya?ml$/.test(name)) return "gitlab";
  if (CI_OTHER.has(name) || /(^|\/)\.circleci$/.test(dir) && name === "config.yml") return "ci-other";
  if (name === "package.json") return "package";
  if (/\.(sh|bash)$/.test(name)) return "shell";
  if (name === "Makefile" || name === "makefile" || name === "GNUmakefile" || name.endsWith(".mk")) return "makefile";
  if (name === "Dockerfile" || /^Dockerfile\./.test(name) || name.endsWith(".Dockerfile")) return "dockerfile";
  if (/(^|\/)supabase$/.test(dir) && name === "config.toml") return "config-toml";
  if (/(^|\/)supabase$/.test(dir) && name === "config.json") return "config-json";
  if (/^\.env(\.[\w-]+)*$/.test(name) && !/\.(example|sample|template|dist|defaults)$/.test(name)) return "env";
  if (AGENT_DOCS.has(name)) return "agent-doc";
  if (/(^|\/)\.cursor\/rules(\/|$)/.test(dir) && /\.mdc?$/.test(name)) return "agent-doc";
  if (/(^|\/)\.claude\/(commands|agents)(\/|$)/.test(dir) && name.endsWith(".md")) return "agent-doc";
  return void 0;
}
function loadRepo(root) {
  const files = [];
  const paths = [];
  let truncated = false;
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (paths.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join2(dir, e.name), relPath);
        continue;
      }
      if (!e.isFile()) continue;
      paths.push(relPath);
      const kind = classify(relPath);
      if (!kind) continue;
      const full = join2(dir, e.name);
      if (statSync(full).size > MAX_BYTES) continue;
      files.push({ path: relPath, text: readFileSync(full, "utf8"), kind });
    }
  };
  walk(root, "");
  return { root, files, paths, truncated };
}
var CI_KINDS = /* @__PURE__ */ new Set(["workflow", "gitlab", "ci-other"]);
var isCi = (f) => CI_KINDS.has(f.kind);
var YAML_SHELL_KEY = /^(\s*)(?:-\s+)?(run|script|before_script|after_script|command):[ \t]*(.*)$/;
function yamlShellSpans(text) {
  const spans = [];
  const lines = text.split("\n");
  const offsets = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const m = YAML_SHELL_KEY.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const value = m[3];
    const valueStart = offsets[i] + lines[i].length - value.length;
    if (value && !/^[|>][-+0-9]*\s*(#.*)?$/.test(value)) {
      const q = value[0];
      if ((q === '"' || q === "'") && value.trimEnd().endsWith(q) && value.trimEnd().length > 1) {
        spans.push({ start: valueStart + 1, end: valueStart + value.trimEnd().length - 1 });
      } else spans.push({ start: valueStart, end: offsets[i] + lines[i].length });
    }
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") continue;
      if (l.length - l.trimStart().length <= indent) break;
    }
    if (j > i + 1) {
      const items = lines.slice(i + 1, j).filter((l) => l.trim() !== "");
      if (items.length > 0 && /^\s*-\s/.test(items[0])) {
        for (let k = i + 1; k < j; k++) {
          const item = /^(\s*-\s+)(.*?)\s*$/.exec(lines[k]);
          if (!item || !item[2]) continue;
          const s = offsets[k] + item[1].length;
          const body = item[2];
          const quoted = body.length > 1 && (body[0] === '"' || body[0] === "'") && body.endsWith(body[0]);
          spans.push(quoted ? { start: s + 1, end: s + body.length - 1 } : { start: s, end: s + body.length });
        }
      } else {
        spans.push({ start: offsets[i + 1], end: offsets[j - 1] + lines[j - 1].length });
      }
      i = j - 1;
    }
  }
  return spans;
}
function packageScriptSpans(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = json.scripts && typeof json.scripts === "object" ? json.scripts : {};
  const scriptsAt = text.search(/"scripts"\s*:\s*\{/);
  if (scriptsAt === -1) return [];
  const spans = [];
  let cursor = scriptsAt;
  for (const name of Object.keys(scripts)) {
    if (typeof scripts[name] !== "string") continue;
    const key = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`, "g");
    key.lastIndex = cursor;
    const m = key.exec(text);
    if (!m) continue;
    const start = m.index + m[0].length;
    let end = start;
    while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
    spans.push({ name, start, end });
    cursor = end;
  }
  return spans;
}
function markdownCodeSpans(text) {
  const spans = [];
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
  const fenced = [];
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const start = m.index + m[0].indexOf("\n") + 1;
    const span = { start, end: start + m[3].length };
    spans.push(span);
    fenced.push({ start: m.index, end: m.index + m[0].length });
  }
  const inline = /`([^`\n]+)`/g;
  for (let m = inline.exec(text); m; m = inline.exec(text)) {
    const at = m.index;
    if (fenced.some((f) => at >= f.start && at < f.end)) continue;
    spans.push({ start: at + 1, end: at + 1 + m[1].length });
  }
  return spans.sort((a, b) => a.start - b.start);
}
var maskJsonEscapes = (text) => text.replace(/\\(["\\])/g, " $1");
function regionsOf(file, ciScripts, ciFiles) {
  const whole = (context) => [{ file, start: 0, end: file.text.length, context, lexText: file.text }];
  switch (file.kind) {
    case "workflow":
    case "gitlab":
    case "ci-other":
      return yamlShellSpans(file.text).map((s) => ({ file, ...s, context: "ci", lexText: file.text }));
    case "package": {
      const lexText = maskJsonEscapes(file.text);
      return packageScriptSpans(file.text).map((s) => ({
        file,
        start: s.start,
        end: s.end,
        script: s.name,
        context: ciScripts.has(s.name) || ciFiles.has(file.path) ? "ci" : "script",
        lexText
      }));
    }
    case "shell":
    case "makefile":
    case "dockerfile":
      return whole(ciFiles.has(file.path) ? "ci" : "script");
    case "agent-doc":
      return markdownCodeSpans(file.text).map((s) => ({ file, ...s, context: "agent", lexText: file.text }));
    default:
      return [];
  }
}
var SCRIPT_RUN = /\b(?:npm\s+run(?:-script)?|pnpm(?:\s+run)?|yarn(?:\s+run)?|bun\s+run)\s+([\w:.@/-]+)/g;
var SHELL_FILE = /(?:^|[\s"'=])(?:\.\/)?([\w./-]+\.(?:sh|bash))\b/g;
var PNPM_BUILTINS = /* @__PURE__ */ new Set(["install", "i", "add", "exec", "dlx", "ci", "test", "run", "x", "build", "--filter", "-r"]);
function ciReach(files) {
  const scripts = /* @__PURE__ */ new Set();
  const reached = /* @__PURE__ */ new Set();
  const shellFiles = files.filter((f) => f.kind === "shell");
  const makefiles = files.filter((f) => f.kind === "makefile");
  const scan2 = (text) => {
    for (const m of text.matchAll(SCRIPT_RUN)) if (!PNPM_BUILTINS.has(m[1])) scripts.add(m[1]);
    for (const m of text.matchAll(SHELL_FILE)) {
      const ref = m[1].replace(/^\.\//, "");
      for (const f of shellFiles) if (f.path === ref || f.path.endsWith(`/${ref}`)) reached.add(f.path);
    }
    if (/(^|[\s;&|])make(\s|$)/m.test(text)) for (const f of makefiles) reached.add(f.path);
  };
  for (const f of files.filter(isCi)) scan2(f.text);
  for (let changed = true; changed; ) {
    const before = scripts.size + reached.size;
    for (const f of files) {
      if (f.kind === "package") {
        for (const s of packageScriptSpans(f.text)) if (scripts.has(s.name)) scan2(f.text.slice(s.start, s.end));
      } else if (reached.has(f.path)) scan2(f.text);
    }
    changed = scripts.size + reached.size !== before;
  }
  return { scripts, files: reached };
}
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// src/checks/commands.ts
var LOCAL_BY_DEFAULT = ["db push", "db pull", "db dump", "migration fetch", "migration list", "migration repair", "inspect report", "storage ls", "storage cp", "storage mv", "storage rm"];
var ALWAYS_HOSTED = /* @__PURE__ */ new Set([
  "functions deploy",
  "functions delete",
  "secrets set",
  "secrets unset",
  "config push",
  "projects create",
  "projects delete",
  "orgs create",
  "bootstrap",
  "backups restore",
  "branches create",
  "branches delete",
  "branches disable",
  "branches pause",
  "branches unpause",
  "branches update",
  "encryption update-root-key",
  "network-bans remove",
  "network-restrictions update",
  "ssl-enforcement update",
  "postgres-config update",
  "postgres-config delete",
  "sso add",
  "sso update",
  "sso remove",
  "vanity-subdomains activate",
  "vanity-subdomains delete",
  "domains create",
  "domains activate",
  "domains delete",
  "compute push",
  "compute delete",
  "notebooks push",
  "feedback delete"
]);
var MUTATE_TARGET = /* @__PURE__ */ new Set(["db push", "db pull", "pull", "migration up", "migration down", "migration squash", "migration repair", "db reset", "test db", "db query", "storage cp", "storage mv", "storage rm", "seed buckets"]);
var TRUTHY = /^(1|t|T|true|True|TRUE)$/;
var PROJECT_REF = /^[a-z]{20}$/;
var PG_URL = /^postgres(ql)?:\/\//;
var VARIABLE = /^\$/;
function checkCommands(regions, facts) {
  const out = [];
  for (const region of regions) {
    for (const inv of findInvocations(region.lexText, region.start, region.end)) {
      const cmd = parseCommand(inv.args);
      if (cmd.flags.some((f) => f.name === "--help" || f.name === "-h") || cmd.path[0] === "help") continue;
      if (inv.binary === "supabase" && !isKnownCommand(cmd.path)) continue;
      const c = { region, inv, cmd, path: cmd.path.join(" "), facts, out };
      if (inv.binary === "supabase-go") {
        add(c, "supabase-go-binary", void 0, "`supabase-go` is not installed by v3; call `supabase` (the commands that ran through supabase-go were removed)");
        continue;
      }
      removedCommand(c);
      removedFlags(c);
      const piped = pipedConfirmation(c);
      deprecatedTargets(c);
      remoteMissing(c);
      if (!piped) yesMissing(c);
      remoteWithoutEquals(c);
      smallerRules(c);
    }
  }
  return out;
}
var flag = (c, ...names) => c.cmd.flags.find((f) => names.includes(f.name));
var hasFlag = (c, ...names) => flag(c, ...names) !== void 0;
var original = (c, start, end) => c.region.file.text.slice(start, end);
function rawValue(c, f) {
  const t = c.inv.args[f.index];
  if (f.attached) return original(c, t.start + t.raw.indexOf("=") + 1, t.end);
  const v = c.inv.args[f.valueIndex];
  return original(c, v.start, v.end);
}
function removeFlag(c, f) {
  const prevEnd = f.index === 0 ? c.inv.binaryToken.end : c.inv.args[f.index - 1].end;
  const last = c.inv.args[f.valueIndex ?? f.index];
  return { start: prevEnd, end: last.end, text: "" };
}
function replaceFlag(c, f, text) {
  const first = c.inv.args[f.index];
  const last = c.inv.args[f.valueIndex ?? f.index];
  return { start: first.start, end: last.end, text };
}
var append = (c, text, order) => ({ start: c.inv.argsEnd, end: c.inv.argsEnd, text: ` ${text}`, order });
var snippet = (c) => original(c, c.inv.pipedFrom?.start ?? c.inv.binaryToken.start, c.inv.argsEnd).replace(/\s*\\\n\s*/g, " ").trim();
function add(c, rule, edits, message, severity) {
  const file = c.region.file;
  c.out.push({
    rule,
    severity: severity ?? ruleMeta(rule).severity,
    message,
    file: file.path,
    line: lineOf(file.text, c.inv.binaryToken.start),
    snippet: snippet(c),
    ...edits && edits.length ? { edits } : {}
  });
}
var hasTarget = (c) => hasFlag(c, "--remote", "--linked", "--project-ref", "--db-url", "--local") || c.path === "gen types" && hasFlag(c, "--project-id");
var linkedByDefaultInV2 = (c) => LOCAL_BY_DEFAULT.includes(c.path) || c.path.startsWith("inspect db ");
var willAddRemote = (c) => c.region.context === "ci" && linkedByDefaultInV2(c) && !hasTarget(c) && !c.facts.startsLocalStack.has(c.region.file.path);
var code = (s) => `\`${s}\``;
var REMOVED_COMMANDS = {
  "db remote changes": { use: "supabase db diff --remote", replace: "db diff", remote: true },
  "db remote commit": { use: "supabase db pull --remote", replace: "db pull", remote: true },
  "gen keys": { use: "supabase projects api-keys --remote=<ref>" },
  "inspect db total-index-size": { use: "supabase inspect db index-stats", replace: "inspect db index-stats" },
  "inspect db total-table-sizes": { use: "supabase inspect db table-stats", replace: "inspect db table-stats" },
  "inspect db table-index-sizes": { use: "supabase inspect db table-stats", replace: "inspect db table-stats" }
};
function removedCommand(c) {
  if (c.path.startsWith("db branch ") || c.path === "db branch") {
    add(c, "removed-command", void 0, `${code(`supabase ${c.path}`)} was removed: local database branches are gone; manage hosted preview branches with ${code("supabase branches")}`);
    return;
  }
  const r = REMOVED_COMMANDS[c.path];
  if (!r) return;
  const edits = [];
  if (r.replace) {
    const first = c.inv.args[c.cmd.pathIndex[0]];
    const last = c.inv.args[c.cmd.pathIndex[c.cmd.pathIndex.length - 1]];
    edits.push({ start: first.start, end: last.end, text: r.replace });
    if (r.remote && !hasTarget(c)) edits.push(append(c, "--remote", 2));
  }
  add(c, "removed-command", edits, `${code(`supabase ${c.path}`)} was removed in v3 (exits 1); use ${code(r.use)}`);
}
function removedFlags(c) {
  const f = (name) => flag(c, name);
  const useSchema = c.path === "db diff" ? f("--use-pg-schema") : void 0;
  if (useSchema) add(c, "removed-flag", [removeFlag(c, useSchema)], `${code("db diff --use-pg-schema")} was removed; drop it to use the default engine (pg-delta), or pass ${code("--use-pg-delta")}`);
  if (c.path === "db pull") {
    const pgDelta = f("--use-pg-delta");
    if (pgDelta) {
      const edit = hasFlag(c, "--declarative") ? removeFlag(c, pgDelta) : replaceFlag(c, pgDelta, "--declarative");
      add(c, "removed-flag", [edit], `${code("db pull --use-pg-delta")} was removed; use ${code("db pull --declarative")}`);
    }
    const experimental = f("--experimental");
    const envExperimental = c.inv.envPrefix.has("SUPABASE_EXPERIMENTAL") || c.facts.setsExperimental.has(c.region.file.path);
    const expOn = experimental && (experimental.value === void 0 || TRUTHY.test(experimental.value));
    if ((expOn || envExperimental) && !hasFlag(c, "--declarative")) {
      add(c, "removed-flag", void 0, `${code("db pull")} with ${expOn ? code("--experimental") : code("SUPABASE_EXPERIMENTAL")} and no ${code("--declarative")} now fails; pass ${code("--declarative")} for a declarative pull or ${code("--experimental=false")} for a migration pull`);
    }
  }
  const legacy = c.path === "functions download" ? f("--legacy-bundle") : void 0;
  if (legacy) add(c, "removed-flag", [replaceFlag(c, legacy, "--use-api")], `${code("functions download --legacy-bundle")} was removed; use ${code("--use-api")} (if that fails and the function was deployed with a CLI older than 1.120.0, redeploy it first)`);
  const raw = /^domains (create|get|reverify|activate|delete)$/.test(c.path) ? f("--include-raw-output") : void 0;
  if (raw) {
    const edit = hasFlag(c, "-o", "--output") ? removeFlag(c, raw) : replaceFlag(c, raw, "-o json");
    add(c, "removed-flag", [edit], `${code("--include-raw-output")} was removed; use ${code("-o json")}`);
  }
  const ticket = f("--create-ticket");
  if (ticket) add(c, "removed-flag", [removeFlag(c, ticket)], `the global ${code("--create-ticket")} flag was removed; report CLI problems with ${code("supabase issue bug")}`);
}
function isYesFeeder(words) {
  const [cmd, ...rest] = words;
  const args = rest.filter((w) => !/^-[en]+$/.test(w));
  if (cmd === "yes") return args.length === 0 || args.length === 1 && /^y(es)?$/i.test(args[0]);
  if (cmd === "echo" || cmd === "printf") return args.length === 1 && /^y(es)?(\\n)?$/i.test(args[0]);
  return false;
}
function pipedConfirmation(c) {
  const p = c.inv.pipedFrom;
  if (!p || !isYesFeeder(p.words)) return false;
  const edits = [{ start: p.start, end: p.end, text: "" }];
  if (!hasFlag(c, "--yes")) edits.push(append(c, "--yes", 1));
  add(c, "piped-confirmation", edits, `${code(`${p.words.join(" ")} |`)} no longer confirms anything in v3; pass ${code("--yes")} instead`);
  return true;
}
function deprecatedTargets(c) {
  if (c.cmd.path[0] === "link") return;
  const linked = flag(c, "--linked");
  const ref = flag(c, "--project-ref");
  const url = flag(c, "--db-url");
  const pid = c.path === "gen types" ? flag(c, "--project-id") : void 0;
  const local = flag(c, "--local");
  const diffLinked = c.path === "db diff" ? c.cmd.flags.filter((f) => (f.name === "--from" || f.name === "--to") && f.value === "linked") : [];
  const found = [linked, ref, url, pid, local].filter((f) => f !== void 0);
  if (found.length === 0 && diffLinked.length === 0) return;
  const names = [...found.map((f) => f.name), ...diffLinked.map((f) => `${f.name} linked`)];
  const valued = [ref, url, pid].filter((f) => f !== void 0 && f.value !== void 0);
  const hasRemote = hasFlag(c, "--remote");
  const conflict = valued.length > 1 || local !== void 0 && (linked !== void 0 || valued.length > 0) || hasRemote;
  let wanted = "";
  if (valued.length === 1) wanted = `--remote=${rawValue(c, valued[0])}`;
  else if (linked || ref || url || pid) wanted = "--remote";
  const edits = [];
  if (!conflict) {
    for (const f of found) edits.push(removeFlag(c, f));
    for (const f of diffLinked) edits.push(replaceFlag(c, f, `${f.name}=remote`));
    if (wanted) edits.push(append(c, wanted, 2));
  }
  const advice = conflict ? hasRemote ? `${code("--remote")} can't be combined with ${names.map(code).join(", ")}; keep only ${code("--remote[=<value>]")}` : `conflicting target flags ${names.map(code).join(", ")}; pick one target and write it as ${code("--remote[=<value>]")}` : wanted ? `use ${code(wanted)} at the end of the command` : local ? `drop ${code("--local")}: local is the default in v3` : `use ${code("--from=remote")} / ${code("--to=remote")}`;
  add(c, "deprecated-target-flag", edits, `${names.map(code).join(", ")} ${names.length > 1 ? "are" : "is"} deprecated in v3 (removed in v4): ${advice}`);
}
function remoteMissing(c) {
  if (!linkedByDefaultInV2(c) || hasTarget(c)) return;
  const what = code(`supabase ${c.path}`);
  switch (c.region.context) {
    case "ci":
      if (c.facts.startsLocalStack.has(c.region.file.path)) {
        add(c, "remote-flag-missing", void 0, `${what} now runs against the local stack this job starts and never reaches the hosted project; add ${code("--remote")} if it should`, "warning");
      } else {
        add(c, "remote-flag-missing", [append(c, "--remote", 2)], `${what} targets the local stack in v3 (v2 used the linked project); add ${code("--remote")} at the end to keep deploying to the hosted project`);
      }
      return;
    case "agent":
      add(c, "remote-flag-missing", void 0, `agents following this now run ${what} against the local stack; write ${code("--remote")} where the hosted project is meant`, "warning");
      return;
    case "script":
      add(c, "remote-flag-missing", void 0, `${what} targets the local stack in v3 (v2 used the linked project); add ${code("--remote")} if this script should reach the hosted project`, "note");
  }
}
function machineReadable(c) {
  const o = flag(c, "-o", "--output");
  const of = flag(c, "--output-format");
  return o?.value !== void 0 && /^(json|yaml|toml|env)$/.test(o.value) || of?.value !== void 0 && /^(json|stream-json)$/.test(of.value);
}
function yesMissing(c) {
  const p = c.path;
  if (hasFlag(c, "--dry-run")) return;
  if (p === "db query" && hasFlag(c, "--read-only")) return;
  if (p === "secrets unset" && c.cmd.positionals.length === 0 && !hasFlag(c, "--all")) return;
  const remoteTarget = hasFlag(c, "--remote", "--linked", "--project-ref", "--db-url");
  const hosted = ALWAYS_HOSTED.has(p) || MUTATE_TARGET.has(p) && (remoteTarget || willAddRemote(c) || p === "pull");
  if (!hosted) return;
  const yesEnv = c.inv.envPrefix.get("SUPABASE_YES");
  if (hasFlag(c, "--yes") || yesEnv !== void 0 && TRUTHY.test(yesEnv) || c.facts.exportsYes.has(c.region.file.path)) return;
  const what = code(`supabase ${p}`);
  const maybe = p === "db pull" ? " when it updates the remote migration history" : "";
  if (c.region.context === "ci") {
    const severity = p === "db pull" ? "warning" : "error";
    add(c, "yes-flag-missing", [append(c, "--yes", 1)], `${what} changes the hosted project and asks first in v3${maybe}; in CI it fails with HostedMutationConsentRequiredError unless you pass ${code("--yes")}`, severity);
  } else if (c.region.context === "agent") {
    add(c, "yes-flag-missing", void 0, `an agent running ${what} never gets a prompt in v3: it fails with HostedMutationConsentRequiredError and is told to ask you before passing ${code("--yes")}; say here whether that is allowed`, "warning");
  } else if (machineReadable(c)) {
    add(c, "yes-flag-missing", void 0, `${what} with machine-readable output can't prompt in v3 and fails with HostedMutationConsentRequiredError; pass ${code("--yes")}`, "warning");
  } else {
    add(c, "yes-flag-missing", void 0, `${what} now asks for confirmation (default No); fine in a terminal, but pass ${code("--yes")} if this runs unattended`, "note");
  }
}
function remoteWithoutEquals(c) {
  const remote = c.cmd.flags.find((f) => f.name === "--remote" && !f.attached);
  if (!remote) return;
  const next = c.inv.args[remote.index + 1];
  if (!next || next.redirect || next.value.startsWith("-")) return;
  const value = next.value;
  const clear = PROJECT_REF.test(value) || PG_URL.test(value) || VARIABLE.test(value);
  const edits = clear ? [{ start: c.inv.args[remote.index].end, end: next.start, text: "=" }] : void 0;
  const hint = clear ? "" : ` (if ${code(value)} is an argument, not the target, move ${code("--remote")} to the end instead)`;
  add(c, "remote-value-without-equals", edits, `${code(`--remote ${next.raw}`)}: a value must be attached with =, write ${code(`--remote=${next.raw}`)}${hint}`);
}
function smallerRules(c) {
  const p = c.path;
  if (p === "secrets unset" && c.cmd.positionals.length === 0 && !hasFlag(c, "--all")) {
    add(c, "secrets-unset-without-names", void 0, `${code("supabase secrets unset")} with no names used to remove every secret; v3 fails instead. Name the secrets, or pass ${code("--all")} if that is what you mean`);
  }
  const password = flag(c, "--password", "-p");
  if (password) {
    const remote = flag(c, "--remote");
    const urlTarget = hasFlag(c, "--db-url") || remote?.value !== void 0 && PG_URL.test(remote.value);
    const passwordCommands = ["db push", "db pull", "db dump", "db schema declarative generate", "migration list", "migration repair"];
    if (urlTarget && passwordCommands.includes(p)) {
      add(c, "password-with-url-target", void 0, `${code(`${password.name}`)} with a database URL exits 1 in v3 (DbPasswordFlagsError); put the password in the URL`);
    } else if (p === "migration squash" && !hasFlag(c, "--remote", "--linked", "--project-ref", "--db-url")) {
      add(c, "password-with-url-target", void 0, `${code("migration squash")} targets the local database by default in v3, so ${code(password.name)} also needs ${code("--remote")}`);
    }
  }
  if (p === "db diff" && hasFlag(c, "--remote") && hasFlag(c, "--from", "--to")) {
    add(c, "diff-remote-with-from-to", void 0, `${code("db diff")} rejects ${code("--remote")} together with ${code("--from")}/${code("--to")}; use ${code("--from=remote")} or ${code("--to=remote")}`);
  }
  if (p === "db diff" && c.facts.declarativeSchemas && !c.facts.migraPinned && !hasFlag(c, "--use-migra")) {
    add(c, "declarative-diff", void 0, `${code("db diff")} no longer reads supabase/schemas under pg-delta (the v3 default); generate migrations with ${code("supabase db schema declarative sync")}`);
  }
  const override = c.cmd.flags.find((f) => f.name === "--override-name" && /^inbucket\.url(=|$)/.test(f.value ?? ""));
  if (override) {
    const t = c.inv.args[override.valueIndex ?? override.index];
    const at = t.start + t.raw.lastIndexOf("inbucket.url");
    add(c, "inbucket-url", [{ start: at, end: at + "inbucket.url".length, text: "mailpit.url" }], `${code("--override-name inbucket.url")} fails in v3; use ${code("--override-name mailpit.url")}`, "error");
  }
}

// src/toml.ts
function parseToml(text) {
  const headers = [];
  const keys = [];
  let table = "";
  let offset = 0;
  let multiline = null;
  text.split("\n").forEach((raw, i) => {
    const lineStart = offset;
    offset += raw.length + 1;
    if (multiline) {
      if (raw.includes(multiline)) multiline = null;
      return;
    }
    const header = /^(\s*)(\[\[?)\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(raw);
    if (header) {
      const nameStart = lineStart + raw.indexOf(header[3], header[1].length + header[2].length);
      table = header[3].split(".").map((p) => p.trim().replace(/^"(.*)"$/, "$1")).join(".");
      headers.push({ name: table, array: header[2] === "[[", line: i + 1, nameStart, nameEnd: nameStart + header[3].length });
      return;
    }
    const kv = /^(\s*)([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(raw);
    if (!kv) return;
    const value = stripComment(kv[3]);
    if (/^("""|''')/.test(value) && !value.slice(3).includes(value.slice(0, 3))) multiline = value.slice(0, 3);
    const keyStart = lineStart + kv[1].length;
    keys.push({ table, key: kv[2].replace(/^"(.*)"$/, "$1"), value, line: i + 1, keyStart, keyEnd: keyStart + kv[2].length });
  });
  return { headers, keys };
}
function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return value.slice(0, i).trim();
  }
  return value.trim();
}
var unquote = (v) => v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

// src/checks/config.ts
var finding = (rule, file, line, message, edits, severity) => ({
  rule,
  severity: severity ?? ruleMeta(rule).severity,
  message,
  file: file.path,
  line,
  snippet: file.text.split("\n")[line - 1]?.trim(),
  ...edits && edits.length ? { edits } : {}
});
var REMOTE = /^remotes\.([^.]+)\.(.+)$/;
var base = (table) => REMOTE.exec(table)?.[2] ?? table;
function checkConfigToml(file, facts) {
  const doc = parseToml(file.text);
  const out = [];
  inbucket(file, doc, out);
  removedKeys(file, doc, out);
  enableSignup(file, doc, out);
  smsConfirmations(file, doc, facts, out);
  remotesPrecedence(file, doc, facts, out);
  if (!doc.keys.some((k) => k.table === "" && k.key === "project_id" && unquote(k.value) !== "")) {
    out.push(finding("project-id-missing", file, 1, "no project_id: v3 names local containers and volumes after the folder, so run `supabase stop` before upgrading or set project_id"));
  }
  return out;
}
function inbucket(file, doc, out) {
  for (const h of doc.headers) {
    const parts = h.name.split(".");
    const at = parts[0] === "inbucket" ? 0 : parts[0] === "remotes" && parts[2] === "inbucket" ? 2 : -1;
    if (at === -1) continue;
    const renamed = [...parts.slice(0, at), "local_smtp", ...parts.slice(at + 1)].join(".");
    const header = `[${h.name}]`;
    out.push(finding("inbucket-section", file, h.line, `${header} makes every v3 command that loads the config fail ("[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead."); rename it to [${renamed}]`, [
      { start: h.nameStart, end: h.nameEnd, text: renamed }
    ]));
  }
}
function removedKeys(file, doc, out) {
  for (const k of doc.keys) {
    if (base(k.table) === "experimental" && k.key === "orioledb_version" && unquote(k.value) !== "") {
      out.push(finding("removed-config-key", file, k.line, "[experimental] orioledb_version fails in v3; move it to [db] orioledb_version"));
    }
    if (/port$/.test(k.key) && /^0\d+$/.test(k.value)) {
      out.push(finding("removed-config-key", file, k.line, `${k.key} = ${k.value}: v3 rejects ports with a leading zero`));
    }
  }
  for (const h of doc.headers) {
    const b = base(h.name);
    const provider = /^auth\.external\.(linkedin|slack)$/.exec(b);
    if (provider) {
      out.push(finding("removed-config-key", file, h.line, `[${h.name}] fails in v3, even when disabled; use [${h.name}_oidc] (the OIDC provider needs its own app settings, so this is not a rename)`));
    }
    if (b === "experimental.inspect.rules" && !h.array) {
      out.push(finding("removed-config-key", file, h.line, "inspect report needs [[experimental.inspect.rules]] (an array of tables); a single [experimental.inspect.rules] table fails"));
    }
  }
}
function enableSignup(file, doc, out) {
  for (const k of doc.keys) {
    const b = base(k.table);
    if (k.key !== "enable_signup" || b !== "auth.email" && b !== "auth.sms") continue;
    const hasEnabled = doc.keys.some((o) => o.table === k.table && o.key === "enabled");
    const edits = hasEnabled ? void 0 : [{ start: k.keyStart, end: k.keyEnd, text: "enabled" }];
    out.push(finding("enable-signup-deprecated", file, k.line, `enable_signup in [${k.table}] is deprecated (removed in v4); rename it to enabled. false also stops existing users signing in that way; to block only new sign-ups set enable_signup = false under [auth]`, edits));
  }
}
function smsConfirmations(file, doc, facts, out) {
  for (const k of doc.keys) {
    if (k.key !== "enable_confirmations" || base(k.table) !== "auth.sms") continue;
    const now = k.value === "true" ? "turns phone confirmation on (sign-ups need a working SMS provider)" : "turns phone confirmation off";
    const severity = facts.runsConfigPush ? "warning" : "note";
    out.push(finding("sms-confirmations-flip", file, k.line, `[${k.table}] enable_confirmations = ${k.value}: v3 config push applies it as written and ${now}; v2 applied it inverted. Run supabase config diff before the first v3 push`, void 0, severity));
  }
}
function remotesPrecedence(file, doc, facts, out) {
  const first = doc.headers.find((h) => REMOTE.test(h.name) || /^remotes\.[^.]+$/.test(h.name));
  if (!first) return;
  const names = [...facts.envOverrides.keys()];
  if (names.length) {
    const list = names.slice(0, 6).map((n) => `${n} (${facts.envOverrides.get(n)})`).join(", ");
    out.push(finding("env-overrides-remotes", file, first.line, `[remotes.*] blocks no longer beat SUPABASE_* variables in v3, and these are set: ${list}${names.length > 6 ? ", \u2026" : ""}. They now win and config push pushes them`));
  } else {
    out.push(finding("env-overrides-remotes", file, first.line, "[remotes.*] blocks no longer beat SUPABASE_* variables in v3; check `env | grep ^SUPABASE_` in CI, set SUPABASE_ENV there, and run supabase config diff before the first v3 config push", void 0, "note"));
  }
}
function checkConfigJson(file) {
  const out = [];
  for (const m of file.text.matchAll(/"inbucket"(\s*:)/g)) {
    const at = m.index;
    out.push(finding("inbucket-section", file, lineOf(file.text, at), 'the "inbucket" key fails in v3; rename it to "local_smtp" (the keys inside stay the same)', [
      { start: at, end: at + '"inbucket"'.length, text: '"local_smtp"' }
    ]));
  }
  return out;
}
function configFacts(files, paths) {
  let declarativeSchemas = paths.some((p) => /(^|\/)supabase\/schemas\/.+\.sql$/.test(p));
  let migraPinned = false;
  for (const f of files.filter((x) => x.kind === "config-toml")) {
    const doc = parseToml(f.text);
    if (doc.keys.some((k) => k.table === "db.migrations" && k.key === "schema_paths" && k.value !== "[]")) declarativeSchemas = true;
    if (doc.keys.some((k) => k.table === "experimental.pgdelta" && k.key === "enabled" && k.value === "false")) migraPinned = true;
  }
  return { declarativeSchemas, migraPinned };
}

// src/checks/repo.ts
var finding2 = (rule, file, line, message, opts = {}) => ({
  rule,
  severity: opts.severity ?? ruleMeta(rule).severity,
  message,
  file,
  line,
  ...opts.snippet ? { snippet: opts.snippet } : {},
  ...opts.edits && opts.edits.length ? { edits: opts.edits } : {}
});
var TEXT_KINDS = /* @__PURE__ */ new Set(["workflow", "gitlab", "ci-other", "shell", "makefile", "dockerfile", "env", "package"]);
var TRUTHY2 = `["']?(?:1|t|T|true|True|TRUE)["']?`;
var lineAt = (text, offset) => {
  const line = lineOf(text, offset);
  return { line, snippet: text.split("\n")[line - 1]?.trim() };
};
var RENAMES = [
  { name: "SUPABASE_EXPERIMENTAL_PG_DELTA", rule: "removed-env-var", to: "SUPABASE_EXPERIMENTAL_PGDELTA_ENABLED", message: "SUPABASE_EXPERIMENTAL_PG_DELTA is ignored by v3; use SUPABASE_EXPERIMENTAL_PGDELTA_ENABLED" },
  { name: "SUPABASE_EXPERIMENTAL_ORIOLEDB_VERSION", rule: "removed-env-var", severity: "error", to: "SUPABASE_DB_ORIOLEDB_VERSION", message: "SUPABASE_EXPERIMENTAL_ORIOLEDB_VERSION fails in v3 when non-empty; use SUPABASE_DB_ORIOLEDB_VERSION" },
  { name: "COBRA_COMPLETION_DESCRIPTIONS", rule: "removed-env-var", severity: "note", to: "SUPABASE_COMPLETION_DESCRIPTIONS", message: "COBRA_COMPLETION_DESCRIPTIONS is ignored by v3; use SUPABASE_COMPLETION_DESCRIPTIONS" },
  { name: "SUPABASE_GO_BINARY", rule: "supabase-go-binary", severity: "warning", message: "SUPABASE_GO_BINARY is ignored by v3, which ships a single supabase executable" },
  {
    name: "INBUCKET_URL",
    rule: "inbucket-url",
    to: "MAILPIT_URL",
    message: "supabase status no longer prints INBUCKET_URL, so this reads an empty value in v3; use MAILPIT_URL",
    fixIf: (f) => /\bsupabase\s+status\b/.test(f.text)
  },
  { name: "MigrationPasswordFlagsError", rule: "error-name-renamed", to: "DbPasswordFlagsError", message: "v3 renamed MigrationPasswordFlagsError to DbPasswordFlagsError" }
];
function checkRenames(files) {
  const out = [];
  for (const f of files) {
    if (!TEXT_KINDS.has(f.kind)) continue;
    for (const r of RENAMES) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${r.name}(?![A-Za-z0-9_])`, "g");
      for (const m of f.text.matchAll(re)) {
        const at = m.index;
        const fix = r.to && (!r.fixIf || r.fixIf(f)) ? [{ start: at, end: at + r.name.length, text: r.to }] : void 0;
        out.push(finding2(r.rule, f.path, lineOf(f.text, at), r.message, { edits: fix, severity: r.severity, snippet: lineAt(f.text, at).snippet }));
      }
    }
  }
  return out;
}
function checkEnvFiles(files) {
  const out = [];
  for (const f of files.filter((x) => x.kind === "env")) {
    for (const m of f.text.matchAll(/^[ \t]*(?:export[ \t]+)?SUPABASE_YES[ \t]*=/gm)) {
      const { line, snippet: snippet2 } = lineAt(f.text, m.index);
      out.push(finding2("supabase-yes-in-env-file", f.path, line, "SUPABASE_YES in an env file doesn't confirm hosted changes, and while it is defined here a shell-exported SUPABASE_YES doesn't count either; remove it and pass --yes", { snippet: snippet2 }));
    }
  }
  return out;
}
function checkFunctionImportMaps(paths) {
  return paths.filter((p) => /(^|\/)supabase\/functions\/[^/]+\/import_map\.json$/.test(p)).map((p) => finding2("function-import-map", p, 1, "a function's own import_map.json fails in v3; rename it to deno.json or set [functions.<name>] import_map in config.toml (the shared supabase/functions/import_map.json still works)"));
}
function lockfilePin(paths, read) {
  if (paths.includes("package-lock.json")) {
    const m = /"node_modules\/supabase":\s*\{[^}]*?"version":\s*"([^"]+)"/.exec(read("package-lock.json") ?? "");
    if (m) return `package-lock.json pins supabase ${m[1]}`;
  }
  if (paths.includes("pnpm-lock.yaml") && /\n\s+supabase@?['"]?\d|\/supabase@\d|\n\s+supabase:\n/.test(read("pnpm-lock.yaml") ?? "")) return "pnpm-lock.yaml pins supabase";
  if (paths.includes("bun.lock") && /"supabase":\s*\["supabase@/.test(read("bun.lock") ?? "")) return "bun.lock pins supabase";
  return void 0;
}
function checkSetupCli(files, pin) {
  const out = [];
  for (const f of files.filter((x) => x.kind === "workflow")) {
    const lines = f.text.split("\n");
    lines.forEach((l, i) => {
      const m = /^(\s*)(-\s+)?uses:\s*["']?supabase\/setup-cli@([\w.-]+)/.exec(l);
      if (!m) return;
      const stepIndent = m[2] ? m[1].length : m[1].length - 2;
      let version;
      for (let j = i + 1; j < lines.length; j++) {
        const n = lines[j];
        if (n.trim() === "") continue;
        if (n.length - n.trimStart().length <= stepIndent) break;
        const v = /^\s*version:\s*(.+?)\s*(#.*)?$/.exec(n);
        if (v) version = unquote(v[1]);
      }
      const ref = m[3];
      const major = Number(/^v?(\d+)/.exec(ref)?.[1] ?? "0");
      const snippet2 = l.trim();
      const v2Pin = version !== void 0 && (/^v?2(\.|$)/.test(version) || /^[\^~]2/.test(version) || version === "v2.stable");
      const needsV3Action = version !== void 0 && (version === "v2.stable" || /^[\^~<>=*]/.test(version) || /x/i.test(version));
      if (needsV3Action && major < 3) {
        out.push(finding2("cli-version", f.path, i + 1, `version: ${version} needs supabase/setup-cli@v3; @${ref} can't resolve it`, { severity: "error", snippet: snippet2 }));
      } else if (version === void 0 || version === "latest") {
        const how = version === void 0 ? "no version set" : "version: latest";
        const extra = pin ? ` (${pin}, and setup-cli uses that instead)` : "";
        out.push(finding2("cli-version", f.path, i + 1, `${how}: this job installs CLI v3 since 2026-11-02${extra}. Pin version: v2.stable on supabase/setup-cli@v3 to upgrade later, or fix the other findings`, { snippet: snippet2 }));
      } else if (v2Pin) {
        out.push(finding2("cli-version", f.path, i + 1, `pinned to CLI v2 (${version}); the other findings are what breaks when you move this job to v3`, { snippet: snippet2 }));
      }
    });
  }
  return out;
}
function checkProjectIdTarget(files, commands) {
  const out = [];
  for (const f of files.filter(isCi)) {
    const cmds = commands.get(f.path) ?? [];
    if (cmds.length === 0 || cmds.some((c) => c.path[0] === "link")) continue;
    const explicit = (c) => c.flags.some((x) => x.name === "--remote" && x.value || x.name === "--project-ref" || x.name === "--db-url" || x.name === "--project-id") || c.positionals.some((p) => p.value.includes("SUPABASE_PROJECT_ID"));
    const untargeted = cmds.some((c) => !explicit(c));
    if (!untargeted) continue;
    const m = /^[ \t]*(?:-[ \t]+)?(?:export[ \t]+)?SUPABASE_PROJECT_ID[ \t]*[:=]/m.exec(f.text);
    if (!m) continue;
    const { line, snippet: snippet2 } = lineAt(f.text, m.index);
    out.push(finding2("project-id-env-target", f.path, line, "SUPABASE_PROJECT_ID no longer selects the hosted project in v3 and this file never runs supabase link; it only says which project a bare --remote means, so add --remote to the commands that should use it", { snippet: snippet2 }));
  }
  return out;
}
var CONFIG_SECTIONS = /^SUPABASE_(AUTH|API|DB|STUDIO|STORAGE|REALTIME|LOCAL_SMTP|INBUCKET|EDGE_RUNTIME|ANALYTICS|EXPERIMENTAL|FUNCTIONS)_[A-Z0-9_]+$/;
var NOT_OVERRIDES = /* @__PURE__ */ new Set(["SUPABASE_DB_PASSWORD"]);
function envOverrides(files) {
  const found = /* @__PURE__ */ new Map();
  for (const f of files) {
    if (!isCi(f) && f.kind !== "env") continue;
    for (const m of f.text.matchAll(/^[ \t]*(?:-[ \t]+)?(?:export[ \t]+)?(SUPABASE_[A-Z0-9_]+)[ \t]*[:=]/gm)) {
      const name = m[1];
      if (CONFIG_SECTIONS.test(name) && !NOT_OVERRIDES.has(name) && !found.has(name)) found.set(name, f.path);
    }
  }
  return found;
}
var exportsYes = (f) => new RegExp(`(^[ \\t]*(?:-[ \\t]+)?SUPABASE_YES[ \\t]*:[ \\t]*${TRUTHY2}[ \\t]*$)|(export[ \\t]+SUPABASE_YES=${TRUTHY2})|(SUPABASE_YES=${TRUTHY2}["']?[ \\t]*>>[ \\t]*["']?\\$GITHUB_ENV)`, "m").test(f.text);
var setsExperimental = (f) => new RegExp(`(^|[\\s"'])SUPABASE_EXPERIMENTAL[ \\t]*[:=][ \\t]*${TRUTHY2}`, "m").test(f.text);

// src/types.ts
var SEVERITY_ORDER = { error: 3, warning: 2, note: 1 };

// src/scan.ts
function isDirectory(path) {
  return existsSync(path) && statSync2(path).isDirectory();
}
function scan(root, skip = []) {
  const repo = loadRepo(root);
  const reach = ciReach(repo.files);
  const regions = repo.files.flatMap((f) => regionsOf(f, reach.scripts, reach.files));
  const commands = /* @__PURE__ */ new Map();
  for (const r of regions) {
    const list = commands.get(r.file.path) ?? [];
    for (const inv of findInvocations(r.lexText, r.start, r.end)) list.push(parseCommand(inv.args));
    commands.set(r.file.path, list);
  }
  const all = [...commands.values()].flat();
  const pathsOf = (file) => (commands.get(file) ?? []).map((c) => c.path.join(" "));
  const files = repo.files;
  const cfg = configFacts(files, repo.paths);
  const findings = [
    ...checkCommands(regions, {
      startsLocalStack: new Set(files.filter((f) => pathsOf(f.path).some((p) => p === "start" || p === "db start")).map((f) => f.path)),
      exportsYes: new Set(files.filter(exportsYes).map((f) => f.path)),
      setsExperimental: new Set(files.filter(setsExperimental).map((f) => f.path)),
      ...cfg
    }),
    ...files.filter((f) => f.kind === "config-toml").flatMap(
      (f) => checkConfigToml(f, { runsConfigPush: all.some((c) => c.path.join(" ") === "config push"), envOverrides: envOverrides(files) })
    ),
    ...files.filter((f) => f.kind === "config-json").flatMap(checkConfigJson),
    ...checkRenames(files),
    ...checkEnvFiles(files),
    ...checkFunctionImportMaps(repo.paths),
    ...checkSetupCli(files, lockfilePin(repo.paths, (p) => readText(join3(root, p)))),
    ...checkProjectIdTarget(files, commands)
  ].filter((f) => !skip.includes(f.rule));
  const order = new Map(RULES.map((r, i) => [r.id, i]));
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0));
  const scanned = {};
  for (const f of files) scanned[f.kind] = (scanned[f.kind] ?? 0) + 1;
  return {
    root,
    findings,
    rules: RULES.filter((r) => !skip.includes(r.id)),
    scanned,
    ciReached: [...reach.files, ...[...reach.scripts].map((s) => `npm script "${s}"`)],
    truncated: repo.truncated
  };
}
function readText(path) {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return void 0;
  }
}
function failsAt(findings, level) {
  return findings.some((f) => SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[level]);
}
function counts(findings) {
  const c = { error: 0, warning: 0, note: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

// src/report/markdown.ts
var ICON = { error: "Error", warning: "Warning", note: "Note" };
var MAX_ROWS = 200;
var cell = (s) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
function markdownReport(result, options = {}) {
  const c = counts(result.findings);
  const out = ["## Supabase CLI v3 upgrade check", ""];
  if (result.findings.length === 0) {
    out.push("No Supabase CLI v3 breaking changes found.");
    return `${out.join("\n")}
`;
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
  return `${out.join("\n")}
`;
}

// src/version.ts
var VERSION = "0.1.0";
var TOOL_NAME = "supabase-cli-v3-upgrade";
var REPO_URL = "https://github.com/atokim4/supabase-cli-v3-upgrade";

// src/report/sarif.ts
var SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
var pascal = (id) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
var plain = (s) => s.replace(/`/g, "");
var cap = (s, max = 1024) => s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;
function sarifRule(rule) {
  return {
    id: rule.id,
    name: pascal(rule.id),
    shortDescription: { text: cap(plain(rule.title)) },
    fullDescription: { text: cap(plain(rule.why)) },
    help: {
      text: `Why: ${plain(rule.why)}

Fix: ${plain(rule.fix)}

Guide: ${guideLink(rule.section)}`,
      markdown: `**Why it breaks:** ${rule.why}

**What to write instead:** ${rule.fix}

[Migration guide: this section](${guideLink(rule.section)})`
    },
    helpUri: guideLink(rule.section),
    defaultConfiguration: { level: rule.severity },
    properties: { tags: ["supabase", "supabase-cli-v3", "ci"], precision: rule.fixable ? "high" : "medium" }
  };
}
var encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
function toSarif(result, pathPrefix = "") {
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
          ruleIndex: index.get(f.rule),
          level: f.severity,
          message: { text: plain(f.message) },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: encodePath(prefix ? `${prefix}/${f.file}` : f.file), uriBaseId: "%SRCROOT%" },
                region: { startLine: Math.max(1, f.line) }
              }
            }
          ]
        }))
      }
    ]
  };
}

// src/report/text.ts
var COLORS = { error: "\x1B[31m", warning: "\x1B[33m", note: "\x1B[36m" };
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
function textReport(result, color = false) {
  const paint = (s, code2) => color ? `${code2}${s}${RESET}` : s;
  const lines = [];
  const kinds = Object.entries(result.scanned).map(([k, n]) => `${n} ${k}`).join(", ") || "no files the CLI runs from";
  lines.push(`Scanned ${kinds}.`);
  if (result.truncated) lines.push("Stopped after 20000 files; run it on a smaller folder for a full scan.");
  if (result.findings.length === 0) {
    lines.push("No Supabase CLI v3 breaking changes found.");
    return `${lines.join("\n")}
`;
  }
  lines.push("");
  for (const f of result.findings) {
    const fixable2 = f.edits ? paint(" [fixable]", DIM) : "";
    lines.push(`${f.file}:${f.line}  ${paint(f.severity.padEnd(7), COLORS[f.severity])} ${f.rule}${fixable2}`);
    lines.push(`  ${f.message.replace(/`/g, "")}`);
    if (f.snippet) lines.push(paint(`  > ${f.snippet.length > 160 ? `${f.snippet.slice(0, 157)}...` : f.snippet}`, DIM));
  }
  const c = counts(result.findings);
  const fixable = result.findings.filter((f) => f.edits).length;
  lines.push("");
  lines.push(`${c.error} error(s), ${c.warning} warning(s), ${c.note} note(s); ${fixable} can be rewritten with --fix.`);
  lines.push(`Guide: ${GUIDE_URL}`);
  return `${lines.join("\n")}
`;
}

// src/action/github.ts
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { EOL } from "node:os";
function getInput(name, env = process.env) {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function setOutput(name, value, env = process.env) {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  if (!/[\r\n]/.test(value)) {
    appendFileSync(file, `${name}=${value}${EOL}`);
    return;
  }
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
}
function appendSummary(markdown, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  appendFileSync(file, markdown.endsWith("\n") ? markdown : `${markdown}
`);
  return true;
}
var escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
var escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
function annotation(level, message, props = {}) {
  const parts = Object.entries(props).filter(([, v]) => v !== void 0 && v !== "").map(([k, v]) => `${k}=${escapeProperty(String(v))}`);
  return `::${level}${parts.length ? ` ${parts.join(",")}` : ""}::${escapeData(message)}`;
}

// src/action/main.ts
var InputError = class extends Error {
};
function oneOf(name, value, allowed) {
  if (allowed.includes(value)) return value;
  throw new InputError(`input "${name}" must be one of ${allowed.join(", ")} (got "${value}")`);
}
var toPosix = (p) => p.split(sep).join("/");
function readInputs(env) {
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
    failOn: oneOf("fail-on", getInput("fail-on", env) || "error", ["error", "warning", "note", "none"]),
    format: oneOf("format", getInput("format", env) || "sarif", ["sarif", "markdown"]),
    exclude,
    sarifFile: getInput("sarif-file", env) || "supabase-cli-v3.sarif",
    fix: oneOf("fix", getInput("fix", env) || "false", ["true", "false"]) === "true"
  };
}
function blobUrl(env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = env;
  return server && repo && sha ? `${server}/${repo}/blob/${sha}` : void 0;
}
function writeSarif(result, inputs) {
  const file = resolve(inputs.workspace, inputs.sarifFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync2(file, `${JSON.stringify(toSarif(result, inputs.prefix), null, 2)}
`);
  const rel = toPosix(relative(inputs.workspace, file));
  return rel.startsWith("..") || isAbsolute(rel) ? file : rel;
}
function applyFixes(result, inputs, log) {
  const fixable = result.findings.filter((f) => f.edits);
  const texts = new Map([...new Set(fixable.map((f) => f.file))].map((f) => [f, readFileSync3(join4(inputs.root, f), "utf8")]));
  const fixes = planFixes(texts, fixable);
  writeFixes(inputs.root, fixes);
  for (const f of fixes) log(unifiedDiff(inputs.prefix ? `${inputs.prefix}/${f.file}` : f.file, f.before, f.after));
  return fixes.reduce((n, f) => n + f.applied.length, 0);
}
var LEVEL = { error: "error", warning: "warning", note: "notice" };
function run(env = process.env, log = (l) => process.stdout.write(`${l}
`)) {
  let inputs;
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

// src/action/index.ts
try {
  process.exitCode = run();
} catch (error) {
  process.stdout.write(`${annotation("error", `supabase-cli-v3-upgrade crashed: ${error.stack ?? String(error)}`)}
`);
  process.exitCode = 1;
}
