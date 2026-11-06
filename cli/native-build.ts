// native-build runs `scriptc build` for the Node-API CLI entry (cli/node-main.ts,
// issue #221). On Windows and musl Linux, scriptc links through zig — see
// https://scriptc.dev/docs/quickstart — so this task fails fast when zig is
// missing from PATH.
//
//   deno task native:build              # compile to dist/sparql-node.exe|.out
//   deno task native:gate               # coverage summary, then build attempt
//
// The scriptc version matches cli/native-coverage.ts.
import { dirname, fromFileUrl, resolve } from "@std/path";

const SCRIPTC_VERSION = "0.4.5";
const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const OUTPUT = resolve(
  REPO_ROOT,
  "dist",
  Deno.build.os === "windows" ? "sparql-node.exe" : "sparql-node",
);

async function zigOnPath(): Promise<boolean> {
  const isWindows = Deno.build.os === "windows";
  // `command` is a shell builtin, not a program, so POSIX hosts go through sh.
  const { code } = await new Deno.Command(
    isWindows ? "where.exe" : "sh",
    {
      args: isWindows ? ["zig"] : ["-c", "command -v zig"],
      stdout: "null",
      stderr: "null",
    },
  ).spawn().status;
  return code === 0;
}

if (!(await zigOnPath())) {
  console.error(
    "zig is not on PATH. Install it (Windows: winget install -e --id zig.zig) " +
      "and open a new shell, then re-run deno task native:build.",
  );
  Deno.exit(1);
}

const isWindows = Deno.build.os === "windows";
const { code, stderr } = await new Deno.Command(
  isWindows ? "npx.cmd" : "npx",
  {
    args: [
      "--yes",
      `scriptc@${SCRIPTC_VERSION}`,
      "build",
      "cli/node-main.ts",
      "-o",
      OUTPUT,
    ],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "piped",
  },
).output();

if (code !== 0) {
  console.error(new TextDecoder().decode(stderr));
  Deno.exit(code);
}

console.log(`Wrote ${OUTPUT}`);
