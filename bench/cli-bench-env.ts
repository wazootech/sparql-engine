/**
 * cli-bench-env resolves the benchmark's environment: repo paths, host OS
 * quirks and the compiled binary location shared by every bench module.
 */

import process from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const IS_WINDOWS = process.platform === "win32";

export const COMPILED_PATH = join(
  REPO_ROOT,
  "dist",
  IS_WINDOWS ? "sparql.exe" : "sparql",
);
