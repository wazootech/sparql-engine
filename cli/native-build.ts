// native-build runs `scriptc build` for the Node-API CLI entry (cli/node-main.ts,
// issue #221). On Windows and musl Linux, scriptc links through zig — see
// https://scriptc.dev/docs/quickstart — so this task fails fast when zig is
// missing from PATH.
//
//   deno task native:build              # compile to dist/sparql-node.exe|.out
//   deno task native:gate               # coverage summary, then build attempt
//
// The scriptc version matches cli/native-coverage.ts.

import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../test/run-process.ts";
const SCRIPTC_VERSION = "0.4.5";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(
  REPO_ROOT,
  "dist",
  process.platform === "win32" ? "sparql-node.exe" : "sparql-node",
);

async function zigOnPath(): Promise<boolean> {
  const isWindows = process.platform === "win32";
  // `command` is a shell builtin, not a program, so POSIX hosts go through sh.
  const { code } = await runProcess(
    isWindows ? "where.exe" : "sh",
    isWindows ? ["zig"] : ["-c", "command -v zig"],
  );
  return code === 0;
}

if (!(await zigOnPath())) {
  console.error(
    "zig is not on PATH. Install it (Windows: winget install -e --id zig.zig) " +
      "and open a new shell, then re-run the native:build task.",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const { code, stdout, stderr } = await runProcess(
  isWindows ? "npx.cmd" : "npx",
  [
    "--yes",
    `scriptc@${SCRIPTC_VERSION}`,
    "build",
    "cli/node-main.ts",
    "-o",
    OUTPUT,
  ],
  { cwd: REPO_ROOT },
);
process.stdout.write(stdout);

if (code !== 0) {
  console.error(stderr);
  process.exit(code);
}

console.log(`Wrote ${OUTPUT}`);
