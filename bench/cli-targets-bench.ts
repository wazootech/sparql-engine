// cli-targets-bench compares one CLI invocation across the builds a host can
// produce: `deno run` on the runtime-agnostic entry, the `deno compile` binary,
// and the scriptc native binary. Deno.bench supplies the warmup and the
// statistics, and `deno-compile` is the baseline so scriptc reports a relative
// multiplier instead of two numbers a reader has to divide.
//
//   deno task bench:cli:targets
//   deno bench --allow-all bench/cli-targets-bench.ts --json
//
// This measures time only. Output equality is asserted by
// cli/run-cli.test.ts: a bench must not fold an assertion into the timed
// region, and a bench that throws tells you nothing about correctness.
//
// Numbers are machine-specific: report them in PRs/issues with the machine,
// never commit them (README.md owns committed numbers).
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { buildPeopleTurtle, WORKLOADS } from "./cli-workloads.ts";

/**
 * CliTarget is one way to invoke the CLI, expressed as an argv prefix. A built
 * host is an argv prefix of one; `deno run` needs the runtime plus the entry.
 */
interface CliTarget {
  /** name labels the target in the bench table and group summary. */
  name: string;

  /** command is the argv prefix; workload arguments are appended to it. */
  command: string[];

  /** baseline marks the target every other target is reported relative to. */
  baseline: boolean;
}

const REPOSITORY_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const EXECUTABLE_SUFFIX = Deno.build.os === "windows" ? ".exe" : "";
const PEOPLE = 200;

/** builtBinary resolves one build artifact produced by a `dist/` target. */
function builtBinary(name: string): string {
  return join(REPOSITORY_ROOT, `dist/${name}${EXECUTABLE_SUFFIX}`);
}

/** binaryExists reports whether a built host is on disk. */
function binaryExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

const dataDirectory = await Deno.makeTempDir({ prefix: "sparql-cli-targets-" });
const dataPath = join(dataDirectory, "people.ttl");
await Deno.writeTextFile(dataPath, buildPeopleTurtle(PEOPLE));

addEventListener("unload", () => {
  try {
    Deno.removeSync(dataDirectory, { recursive: true });
  } catch {
    // A leftover temp directory is not worth failing a bench run over.
  }
});

const denoCompile = builtBinary("sparql");
const scriptc = builtBinary("sparql-node");

const TARGETS: CliTarget[] = [
  {
    name: "deno-run",
    command: [Deno.execPath(), "run", "--allow-read", "cli/deno-main.ts"],
    baseline: !binaryExists(denoCompile),
  },
];

if (binaryExists(denoCompile)) {
  TARGETS.push({
    name: "deno-compile",
    command: [denoCompile],
    baseline: true,
  });
}

if (binaryExists(scriptc)) {
  TARGETS.push({ name: "scriptc", command: [scriptc], baseline: false });
} else {
  console.log(
    "cli-targets-bench: dist/sparql-node is missing (deno task native:build), " +
      "so the scriptc target is skipped",
  );
}

for (const workload of WORKLOADS) {
  for (const target of TARGETS) {
    Deno.bench({
      name: target.name,
      group: `${workload.name} (${PEOPLE} people)`,
      baseline: target.baseline,
      async fn() {
        const result = await new Deno.Command(target.command[0], {
          args: [
            ...target.command.slice(1),
            ...workload.args(dataPath),
          ],
          cwd: REPOSITORY_ROOT,
          stdout: "piped",
          stderr: "piped",
        }).output();
        if (result.code !== 0) {
          throw new Error(
            `${target.name} exited ${result.code}: ` +
              new TextDecoder().decode(result.stderr),
          );
        }
      },
    });
  }
}
