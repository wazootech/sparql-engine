/**
 * cli-bench-aggregate reduces one size run's raw samples into the report's
 * summary tables: per-workload raw summaries, per-operation stage summaries
 * (paired subtraction inside each round), and per-target baseline ratios.
 */
import type { Operation, Options, Sample, Summary } from "./cli-bench-types.ts";
import { OPERATIONS } from "./cli-bench-ops.ts";
import { sampleKey, summarize } from "./cli-bench-stats.ts";
import { WORKLOADS } from "./cli-workloads.ts";

/**
 * aggregateSamples reduces one size run's raw samples into the report's
 * summary tables: per-workload raw summaries, per-operation stage summaries
 * (with the paired-subtraction protocol), and per-target baseline ratios.
 */
export function aggregateSamples(
  samples: Sample[],
  options: Options,
): {
  raw: Record<string, Record<string, Summary>>;
  operations: Record<string, Record<string, Summary>>;
  ratios: Record<string, Record<string, Summary>>;
} {
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
          minimum: Number.NaN,
        };
    }
  }

  return { raw, operations, ratios };
}
