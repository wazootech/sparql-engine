/**
 * cli-bench-report renders the benchmark's human-readable report: the run
 * header, the per-target size and stage tables, and the scaling table. The
 * JSON reporter lives in cli-bench.ts (it prints the raw measurements).
 */
import type { Options, SizeMeasurement } from "./cli-bench-types.ts";
import { OPERATIONS } from "./cli-bench-ops.ts";
import { WORKLOADS } from "./cli-workloads.ts";
import { formatRatio, formatSummary } from "./cli-bench-stats.ts";

type Slopes = Record<
  string,
  Record<string, { fixedMs: number; perTripleUs: number }>
>;

/** printReport writes the human-readable benchmark report to stdout. */
export function printReport(
  options: Options,
  environment: { os: string; deno: string; runs: number },
  sizes: Record<string, number | undefined>,
  measurements: SizeMeasurement[],
  slopes: Slopes,
): void {
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
