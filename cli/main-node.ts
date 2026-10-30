// main-node is the Node-API host entrypoint for the `sparql` command, used by
// native builds that compile against Node's standard library (scriptc, issue
// #221). It mirrors cli/main.ts; all behavior lives in run-cli.ts. Plain
// `node` cannot run it: the `@/` imports resolve through cli/tsconfig.json
// `paths`, which scriptc reads and Node does not.
import { readFile } from "node:fs/promises";
import process from "node:process";
import { runCli } from "./run-cli.ts";

const result = await runCli(process.argv.slice(2), {
  readTextFile: (path) => readFile(path, "utf8"),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
