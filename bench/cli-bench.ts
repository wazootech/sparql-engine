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
import { resolve } from "@std/path";
import { COMPILED_PATH, REPO_ROOT } from "./cli-bench-env.ts";
import { compileCli, hasGnuTime, parseOptions } from "./cli-bench-build.ts";
import { measureSize } from "./cli-bench-measure.ts";
import { printReport } from "./cli-bench-report.ts";
import { OPERATIONS } from "./cli-bench-ops.ts";
import type { SizeMeasurement } from "./cli-bench-types.ts";
import { linearFit } from "./cli-bench-stats.ts";

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
  printReport(
    options,
    environment,
    sizes,
    measurements,
    slopes,
  );
}
