/**
 * cli-bench-measure runs the per-target measurement protocol: one timed
 * invocation per workload per round, with parsed stage timings and peak RSS
 * where `/usr/bin/time` provides it.
 */
import { join } from "@std/path";
import type {
  Operation,
  Options,
  Sample,
  SizeMeasurement,
} from "./cli-bench-types.ts";
import { buildPeopleTurtle, WORKLOADS } from "./cli-workloads.ts";
import { runOnce } from "./cli-bench-run.ts";
import { OPERATIONS } from "./cli-bench-ops.ts";
import { rotate, sampleKey } from "./cli-bench-stats.ts";
import { summarize } from "./cli-bench-stats.ts";
import type { Summary } from "./cli-bench-types.ts";

export async function measureSize(
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
