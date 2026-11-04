/**
 * cli-bench-env resolves the benchmark's environment: repo paths, host OS
 * quirks and the compiled binary location shared by every bench module.
 */
import { dirname, fromFileUrl, join, resolve } from "@std/path";

export const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

export const IS_WINDOWS = Deno.build.os === "windows";

export const COMPILED_PATH = join(
  REPO_ROOT,
  "dist",
  IS_WINDOWS ? "sparql.exe" : "sparql",
);
