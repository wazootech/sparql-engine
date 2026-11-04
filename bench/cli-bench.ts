// cli-bench measures `sparql` CLI builds end to end as processes: binary
// size, cold start, the load stages, and a join-heavy query, plus peak RSS
// where `/usr/bin/time` exists (Linux). It is the baseline any other native
// build (e.g. scriptc, issue #221) must beat; every target must honor the
// cli/run-cli.ts contract, and the harness fails if targets disagree on
// output, so a faster but wrong build never "wins".
//
// Measurement protocol: each round runs every target once per workload in a
// rotated order, so a machine that drifts during the run cannot land on one
// target. Drift that survives rotation is removed again when the operations
// are separated by paired subtraction inside the same round:
//
//   cold start            = startup workload (no data, cheapest query)
//   read + parse + index  = load workload - cold start
//   query evaluation      = join workload - load workload
//
// Targets are also compared per round (baseline / target), and the reported
// multiplier is the median of those paired ratios rather than a ratio of
// medians. Pass several sizes to separate fixed cost from per-triple cost.
//
//   deno task bench:cli                      # deno-compile vs deno-run
//   deno task bench:cli --target scriptc=./sparql-native
//   deno task bench:cli --people 200,800,3200 --runs 9
//
// Numbers are machine-specific: report them in PRs/issues with the machine,
// never commit them (README.md owns committed numbers).
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { buildPeopleTurtle, WORKLOADS } from "./cli-workloads.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const IS_WINDOWS = Deno.build.os === "windows";
const COMPILED_PATH = join(
  REPO_ROOT,
  "dist",
  IS_WINDOWS ? "sparql.exe" : "sparql",
);

/** Operation separates one stage of an invocation from the stages before it. */
interface Operation {
  /** name labels the stage in output. */
  name: string;

  /** workload is the invocation that includes the stage. */
  workload: string;

  /** subtrahend is the earlier workload to subtract, absent for cold start. */
  subtrahend?: string;
}

/**
 * OPERATIONS are the stages a CLI invocation is decomposed into. Subtracting
 * inside one round keeps machine drift out of the difference, which is what
 * makes a stage measurement steadier than the totals it comes from.
 */
const OPERATIONS: Operation[] = [
  { name: "cold start", workload: "startup" },
  { name: "read + parse + index", workload: "load", subtrahend: "startup" },
  { name: "query evaluation", workload: "join", subtrahend: "load" },
];

interface Target {
  name: string;
  command: string[];
  binaryPath?: string;
}

interface Options {
  targets: Target[];
  people: number[];
  runs: number;
  json: boolean;
}

interface Sample {
  round: number;
  workload: string;
  target: string;
  ms: number;
}

/** Summary is a distribution reduced to the median and the middle half. */
interface Summary {
  median: number;
  lowerQuartile: number;
  upperQuartile: number;
}

interface SizeMeasurement {
  people: number;
  triples: number;
  /** peakRssMiB is keyed by target, undefined without `/usr/bin/time`. */
  peakRssMiB: Record<string, number | undefined>;
  /** raw holds the measured workload totals, keyed by target then workload. */
  raw: Record<string, Record<string, Summary>>;
  /** operations holds the paired per-round stage times, target then operation. */
  operations: Record<string, Record<string, Summary>>;
  /** ratios holds baseline/target per round, target then operation; >1 wins. */
  ratios: Record<string, Record<string, Summary>>;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    targets: [],
    people: [10_000],
    runs: 7,
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--people") {
      const spec = args[++index];
      const sizes = spec.split(",").map(Number);
      if (sizes.some((size) => !Number.isInteger(size) || size < 1)) {
        throw new Error(`--people needs positive integers: ${spec}`);
      }
      options.people = sizes;
    } else if (flag === "--runs") {
      options.runs = Number(args[++index]);
    } else if (flag === "--target") {
      const spec = args[++index];
      const separator = spec.indexOf("=");
      if (separator < 1) {
        throw new Error(`--target needs name=command: ${spec}`);
      }
      const command = spec.slice(separator + 1).split(/\s+/);
      options.targets.push({
        name: spec.slice(0, separator),
        command,
        binaryPath: command.length === 1 ? command[0] : undefined,
      });
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return options;
}

async function compileCli(): Promise<void> {
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "--allow-read",
      "--output",
      COMPILED_PATH,
      "cli/deno-main.ts",
    ],
    cwd: REPO_ROOT,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(
      `deno compile failed:\n${new TextDecoder().decode(stderr)}`,
    );
  }
}

async function hasGnuTime(): Promise<boolean> {
  if (IS_WINDOWS) return false;
  try {
    const { code } = await new Deno.Command("/usr/bin/time", {
      args: ["-f", "%M", "true"],
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

async function runOnce(
  command: string[],
  args: string[],
  measureRss: boolean,
): Promise<{ ms: number; stdout: string; peakRssKiB?: number }> {
  const [program, ...rest] = measureRss
    ? ["/usr/bin/time", "-f", "%M", ...command, ...args]
    : [...command, ...args];
  const started = performance.now();
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args: rest,
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const ms = performance.now() - started;
  const errorText = new TextDecoder().decode(stderr);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} exited ${code}:\n${errorText}`);
  }
  const peakRssKiB = measureRss
    ? Number(errorText.trim().split("\n").at(-1))
    : undefined;
  return { ms, stdout: new TextDecoder().decode(stdout), peakRssKiB };
}

/** rotate returns values shifted by offset, wrapping around. */
function rotate<T>(values: T[], offset: number): T[] {
  const shift = offset % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

/** quantile interpolates the fraction-th quantile of sorted values. */
function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

/** summarize reduces values to median and interquartile range. */
function summarize(values: number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: quantile(sorted, 0.5),
    lowerQuartile: quantile(sorted, 0.25),
    upperQuartile: quantile(sorted, 0.75),
  };
}

/** linearFit returns the least-squares slope and intercept of points. */
function linearFit(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const count = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / count;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  const slope = variance === 0 ? 0 : covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

/** sampleKey identifies one timed invocation. */
function sampleKey(round: number, workload: string, target: string): string {
  return `${round}\u0000${workload}\u0000${target}`;
}

async function measureSize(
  people: number,
  options: Options,
  measureRss: boolean,
): Promise<SizeMeasurement> {
  const directory = await Deno.makeTempDir({ prefix: "sparql-cli-bench-" });
  const dataPath = join(directory, "people.ttl");
  await Deno.writeTextFile(dataPath, buildPeopleTurtle(people));
  const samples: Sample[] = [];
  const peakRssKiB: Record<string, number> = {};
  try {
    // One untimed warm run per workload and target fills the OS file cache and
    // proves the targets agree, so a faster but wrong build cannot win. It also
    // absorbs a first-execution virus scan, which otherwise lands on whichever
    // binary happens to run first after a rebuild.
    for (const workload of WORKLOADS) {
      const args = workload.args(dataPath);
      let referenceOutput: string | undefined;
      for (const target of options.targets) {
        const warm = await runOnce(target.command, args, false);
        referenceOutput ??= warm.stdout;
        if (warm.stdout !== referenceOutput) {
          throw new Error(
            `${target.name} disagrees with ${
              options.targets[0].name
            } on ${workload.name}`,
          );
        }
      }
    }
    for (let round = 0; round < options.runs; round++) {
      for (const workload of WORKLOADS) {
        const args = workload.args(dataPath);
        for (const target of rotate(options.targets, round)) {
          const result = await runOnce(target.command, args, measureRss);
          samples.push({
            round,
            workload: workload.name,
            target: target.name,
            ms: result.ms,
          });
          peakRssKiB[target.name] = Math.max(
            peakRssKiB[target.name] ?? 0,
            result.peakRssKiB ?? 0,
          );
        }
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  const byKey = new Map(
    samples.map((sample) => [
      sampleKey(sample.round, sample.workload, sample.target),
      sample.ms,
    ]),
  );
  const sampleAt = (round: number, workload: string, target: string) => {
    const value = byKey.get(sampleKey(round, workload, target));
    if (value === undefined) {
      throw new Error(`missing sample: ${workload}/${target}/round ${round}`);
    }
    return value;
  };

  const raw: Record<string, Record<string, Summary>> = {};
  for (const target of options.targets) {
    raw[target.name] = {};
    for (const workload of WORKLOADS) {
      raw[target.name][workload.name] = summarize(
        Array.from(
          { length: options.runs },
          (_, round) => sampleAt(round, workload.name, target.name),
        ),
      );
    }
  }

  const operationValues = (
    target: string,
    operation: Operation,
  ): number[] =>
    Array.from({ length: options.runs }, (_, round) => {
      const value = sampleAt(round, operation.workload, target);
      const subtrahend = operation.subtrahend
        ? sampleAt(round, operation.subtrahend, target)
        : 0;
      return value - subtrahend;
    });

  const operations: Record<string, Record<string, Summary>> = {};
  for (const target of options.targets) {
    operations[target.name] = {};
    for (const operation of OPERATIONS) {
      operations[target.name][operation.name] = summarize(
        operationValues(target.name, operation),
      );
    }
  }

  const baseline = options.targets[0];
  const ratios: Record<string, Record<string, Summary>> = {};
  for (const target of options.targets.slice(1)) {
    ratios[target.name] = {};
    for (const operation of OPERATIONS) {
      const baselineValues = operationValues(baseline.name, operation);
      const targetValues = operationValues(target.name, operation);
      const paired = baselineValues
        .map((value, round) => ({
          baseline: value,
          target: targetValues[round],
        }))
        // A stage at or below zero cannot be compared as a multiple; at that
        // point the stage is smaller than the drift the round removes.
        .filter((pair) => pair.baseline > 0 && pair.target > 0)
        .map((pair) => pair.baseline / pair.target);
      ratios[target.name][operation.name] = paired.length > 0
        ? summarize(paired)
        : {
          median: Number.NaN,
          lowerQuartile: Number.NaN,
          upperQuartile: Number.NaN,
        };
    }
  }

  const peakRssMiB: Record<string, number | undefined> = {};
  for (const target of options.targets) {
    peakRssMiB[target.name] = measureRss
      ? (peakRssKiB[target.name] ?? 0) / 1024
      : undefined;
  }

  return {
    people,
    triples: people * 5,
    peakRssMiB,
    raw,
    operations,
    ratios,
  };
}

function formatSummary(summary: Summary): string {
  return `${summary.median.toFixed(1)} (${summary.lowerQuartile.toFixed(0)}–${
    summary.upperQuartile.toFixed(0)
  })`;
}

function formatRatio(summary: Summary): string {
  if (!Number.isFinite(summary.median)) return "n/a (below drift)";
  return summary.median >= 1
    ? `${summary.median.toFixed(2)}x faster`
    : `${(1 / summary.median).toFixed(2)}x slower`;
}

const options = parseOptions(Deno.args);
if (options.targets.length === 0) {
  await compileCli();
  options.targets.push(
    {
      name: "deno-compile",
      command: [COMPILED_PATH],
      binaryPath: COMPILED_PATH,
    },
    {
      name: "deno-run",
      command: [Deno.execPath(), "run", "--allow-read", "cli/deno-main.ts"],
    },
  );
}

const sizes: Record<string, number | undefined> = {};
for (const target of options.targets) {
  sizes[target.name] = target.binaryPath
    ? (await Deno.stat(resolve(REPO_ROOT, target.binaryPath))).size
    : undefined;
}
const measureRss = await hasGnuTime();
const measurements: SizeMeasurement[] = [];
for (const people of options.people) {
  measurements.push(await measureSize(people, options, measureRss));
}

/** slopes separates fixed cost from per-triple cost across sizes. */
const slopes: Record<
  string,
  Record<string, { fixedMs: number; perTripleUs: number }>
> = {};
if (measurements.length > 1) {
  for (const target of options.targets) {
    slopes[target.name] = {};
    for (const operation of OPERATIONS) {
      const points = measurements.map((measurement) => ({
        x: measurement.triples,
        y: measurement.operations[target.name][operation.name].median,
      }));
      const { slope, intercept } = linearFit(points);
      slopes[target.name][operation.name] = {
        fixedMs: intercept,
        perTripleUs: slope * 1000,
      };
    }
  }
}

const environment = {
  os: `${Deno.build.os}-${Deno.build.arch}`,
  deno: Deno.version.deno,
  people: options.people,
  triples: options.people.map((people) => people * 5),
  runs: options.runs,
};

if (options.json) {
  console.log(JSON.stringify(
    { environment, sizes, measurements, slopes },
    null,
    2,
  ));
} else {
  const targetNames = options.targets.map((target) => target.name);
  console.log(
    `sparql CLI bench — ${environment.os}, Deno ${environment.deno}\n` +
      `targets: ${targetNames[0]} (baseline), ${
        targetNames.slice(1).join(", ") || "none"
      }\n` +
      `sizes: ${measurements.map((m) => `${m.people} people`).join(", ")}\n` +
      `rounds: ${environment.runs}, target order rotated each round\n` +
      `stage times subtract inside the round; ratios are paired per round`,
  );
  console.log("\n| Target | Binary size |\n| --- | --- |");
  for (const target of options.targets) {
    const size = sizes[target.name];
    console.log(
      `| ${target.name} | ${
        size === undefined
          ? "n/a (needs a runtime)"
          : `${(size / 1024 / 1024).toFixed(1)} MiB`
      } |`,
    );
  }
  for (const measurement of measurements) {
    console.log(
      `\n#### ${measurement.triples.toLocaleString("en-US")} triples ` +
        `(${measurement.people.toLocaleString("en-US")} people)`,
    );
    console.log("\n| Workload | Target | Median ms (IQR) | Peak RSS |");
    console.log("| --- | --- | --- | --- |");
    for (const workload of WORKLOADS) {
      for (const targetName of targetNames) {
        const peakRss = measurement.peakRssMiB[targetName];
        console.log(
          `| ${workload.name} | ${targetName} | ${
            formatSummary(measurement.raw[targetName][workload.name])
          } | ${peakRss === undefined ? "n/a" : `${peakRss.toFixed(1)} MiB`} |`,
        );
      }
    }
    console.log(
      "\n| Isolated operation | " +
        targetNames.join(" | ") +
        ` | ${targetNames[1] ?? "second"} vs baseline |`,
    );
    console.log(
      `| --- | ${targetNames.map(() => "---").join(" | ")} | --- |`,
    );
    for (const operation of OPERATIONS) {
      const cells = targetNames.map((targetName) =>
        formatSummary(measurement.operations[targetName][operation.name])
      );
      const ratio = targetNames[1]
        ? formatRatio(measurement.ratios[targetNames[1]][operation.name])
        : "n/a";
      console.log(
        `| ${operation.name} | ${cells.join(" | ")} | ${ratio} |`,
      );
    }
  }
  if (measurements.length > 1) {
    console.log(
      "\n#### Scaling across sizes\n\n" +
        "| Target | Operation | Fixed cost | Per triple |\n" +
        "| --- | --- | --- | --- |",
    );
    for (const targetName of targetNames) {
      for (const operation of OPERATIONS) {
        const fit = slopes[targetName][operation.name];
        console.log(
          `| ${targetName} | ${operation.name} | ${
            fit.fixedMs.toFixed(1)
          } ms | ${fit.perTripleUs.toFixed(1)} µs |`,
        );
      }
    }
  }
}
