// native-gate is the local scriptc loop: summarize blockers, build when the
// linker (zig on Windows) is available, then hold the built hosts to the same
// CLI contract as the in-process core (cli/run-cli.test.ts). It runs the three
// steps with the Bun binary that is running it.
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runProcess, scriptCommand, testCommand } from "../test/run-process.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** runStep runs one command with inherited output and returns its exit code. */
async function runStep(command: string[]): Promise<number> {
  const [program, ...args] = command;
  const { code } = await runProcess(program, args, {
    cwd: REPO_ROOT,
    inherit: true,
  });
  return code;
}

if ((await runStep(scriptCommand("cli/native-coverage.ts"))) !== 0) {
  process.exit(1);
}
if ((await runStep(scriptCommand("cli/native-build.ts"))) !== 0) {
  process.exit(1);
}

// The parity run discovers dist/sparql-node and dist/sparql itself, so the
// freshly built native host is compared against the in-process core without
// any argument passing here.
process.exit(await runStep(testCommand("cli/run-cli.test.ts")));
