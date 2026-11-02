// native-gate is the local scriptc loop: summarize blockers, then try a full
// build when the linker (zig on Windows) is available.
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

const coverage = new Deno.Command(Deno.execPath(), {
  args: ["task", "native:coverage"],
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
if ((await coverage.status).code !== 0) {
  Deno.exit(1);
}

const build = new Deno.Command(Deno.execPath(), {
  args: ["task", "native:build"],
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
Deno.exit((await build.status).code);
