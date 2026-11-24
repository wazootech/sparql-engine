// cli-targets-bench compares one CLI invocation across the builds a host can
// produce: the running runtime on the runtime-agnostic entry, its compiled
// binary (`bun build --compile`), and the scriptc native binary. The shared bench
// helper (mitata) supplies the warmup and the statistics, and the compiled
// binary is the baseline so scriptc reports a relative multiplier instead of
// two numbers a reader has to divide.
//
//   bun run bench:cli:targets
//   bun bench/cli-targets-bench.ts --json
//
// This measures time only. Output equality is asserted by
// cli/run-cli.test.ts: a bench must not fold an assertion into the timed
// region, and a bench that throws tells you nothing about correctness.
//
// Numbers are machine-specific: report them in PRs/issues with the machine,
// never commit them (README.md owns committed numbers).
import { bench, runBenches } from "./bench.ts";
import { buildPeopleTurtle, WORKLOADS } from "./cli-workloads.ts";
import { runProcess, runtimeName, scriptCommand } from "../test/run-process.ts";
import process from "node:process";
import { rmSync, statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CliTarget is one way to invoke the CLI, expressed as an argv prefix. A built
 * host is an argv prefix of one; `bun run` needs the runtime plus the entry.
 */
interface CliTarget {
  /** name labels the target in the bench table and group summary. */
  name: string;

  /** command is the argv prefix; workload arguments are appended to it. */
  command: string[];

  /** baseline marks the target every other target is reported relative to. */
  baseline: boolean;
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE_SUFFIX = process.platform === "win32" ? ".exe" : "";
const PEOPLE = 200;

/** builtBinary resolves one build artifact produced by a `dist/` target. */
function builtBinary(name: string): string {
  return join(REPOSITORY_ROOT, `dist/${name}${EXECUTABLE_SUFFIX}`);
}

/** binaryExists reports whether a built host is on disk. */
function binaryExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const dataDirectory = await mkdtemp(join(tmpdir(), "sparql-cli-targets-"));
const dataPath = join(dataDirectory, "people.ttl");
await writeFile(dataPath, buildPeopleTurtle(PEOPLE));

process.on("exit", () => {
  try {
    rmSync(dataDirectory, { recursive: true });
  } catch {
    // A leftover temp directory is not worth failing a bench run over.
  }
});

const bunCompile = builtBinary("sparql");
const scriptc = builtBinary("sparql-node");

const TARGETS: CliTarget[] = [
  {
    name: `${runtimeName}-run`,
    command: scriptCommand("cli/main.ts"),
    baseline: !binaryExists(bunCompile),
  },
];

if (binaryExists(bunCompile)) {
  TARGETS.push({
    name: `${runtimeName}-compile`,
    command: [bunCompile],
    baseline: true,
  });
}

if (binaryExists(scriptc)) {
  TARGETS.push({ name: "scriptc", command: [scriptc], baseline: false });
} else {
  console.log(
    "cli-targets-bench: dist/sparql-node is missing (bun run native:build), " +
      "so the scriptc target is skipped",
  );
}

for (const workload of WORKLOADS) {
  for (const target of TARGETS) {
    bench(
      {
        name: target.name,
        group: `${workload.name} (${PEOPLE} people)`,
        baseline: target.baseline,
      },
      async () => {
        const result = await runProcess(
          target.command[0],
          [...target.command.slice(1), ...workload.args(dataPath)],
          { cwd: REPOSITORY_ROOT },
        );
        if (result.code !== 0) {
          throw new Error(
            `${target.name} exited ${result.code}: ${result.stderr}`,
          );
        }
      },
    );
  }
}

await runBenches();
