// native-gate is the local scriptc loop: summarize blockers, build when the
// linker (zig on Windows) is available, then hold the built hosts to the same
// CLI contract as the in-process core (cli/run-cli.test.ts).
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
if ((await build.status).code !== 0) {
  Deno.exit(1);
}

// The parity run discovers dist/sparql-node and dist/sparql itself, so the
// freshly built native host is compared against the Deno core without any
// argument passing here.
const parity = new Deno.Command(Deno.execPath(), {
  args: ["test", "--allow-all", "cli/run-cli.test.ts"],
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
Deno.exit((await parity.status).code);
