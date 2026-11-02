// deno-main is the Deno host entrypoint for the `sparql` command; `deno task
// compile` builds it into a standalone binary at dist/sparql. All behavior
// lives in run-cli.ts; see cli/node-main.ts for the scriptc entry.
import { runCli } from "./run-cli.ts";

const result = await runCli(Deno.args, {
  readTextFile: (path) => Deno.readTextFile(path),
});
const encoder = new TextEncoder();
if (result.stdout) await Deno.stdout.write(encoder.encode(result.stdout));
if (result.stderr) await Deno.stderr.write(encoder.encode(result.stderr));
Deno.exit(result.exitCode);
