import { join } from "node:path";
import { loadRepo, readText } from "./fs-repo.ts";
import { scanRepo, type ScanResult } from "./engine.ts";

export { counts, failsAt, scanRepo, type ScanResult } from "./engine.ts";
export { isDirectory } from "./fs-repo.ts";

/** Scans a folder on disk. */
export function scan(root: string, skip: readonly string[] = []): ScanResult {
  return scanRepo(loadRepo(root), (p) => readText(join(root, p)), skip);
}
