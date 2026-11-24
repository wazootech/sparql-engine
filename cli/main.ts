// main is the cross-runtime host entrypoint for the `sparql` command: it runs
// on Bun (and Node) and uses only `node:` APIs. `bun run compile` (`bun build --compile`)
// builds it into a standalone binary at dist/sparql. All behavior lives in run-cli.ts;
// see cli/node-main.ts for the scriptc entry.
import { readFile } from "node:fs/promises";
import process from "node:process";
import { runCli } from "./run-cli.ts";

const result = await runCli(process.argv.slice(2), {
  readTextFile: (path) => readFile(path, "utf8"),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
