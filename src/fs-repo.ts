import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileFix } from "./fix.ts";
import { classify, MAX_BYTES, MAX_FILES, SKIP_DIRS, type Repo } from "./sources.ts";
import type { SourceFile } from "./types.ts";

/** The file-system side of the scanner (CLI and Action). Everything else is pure and also runs in a browser. */

export function loadRepo(root: string): Repo {
  const files: SourceFile[] = [];
  const paths: string[] = [];
  let truncated = false;
  const walk = (dir: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (paths.length >= MAX_FILES) { truncated = true; return; }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), relPath);
        continue;
      }
      if (!e.isFile()) continue;
      paths.push(relPath);
      const kind = classify(relPath);
      if (!kind) continue;
      const full = join(dir, e.name);
      if (statSync(full).size > MAX_BYTES) continue;
      files.push({ path: relPath, text: readFileSync(full, "utf8"), kind });
    }
  };
  walk(root, "");
  return { root, files, paths, truncated };
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function writeFixes(root: string, fixes: readonly FileFix[]): void {
  for (const f of fixes) writeFileSync(join(root, f.file), f.after);
}
